/**
 * 聊天会话状态：历史回放（游标分页）+ OpenAI 兼容 SSE 流式收发。
 *
 * 与 Agent 会话（useAgentConversation，跑 agent loop 带工具调用）不同：聊天是纯 LLM
 * 文本对话，走 /agent/chat/* 接口。历史只存 user/assistant 文本（+媒体/usage 元数据）。
 *
 * 发送流程：先 POST /agent/chat/conversations/{id}/messages 把 user 消息落库，
 * 再 POST /agent/chat/send 流式拿 assistant 回复，收完后把 assistant 文本落库。
 * 失败轮重试 = 软删 error assistant + 重发最后一条 user（与 Web retryMessage 同构）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendChatMessage,
  chatSendOnce,
  chatSendStream,
  createChatConversation,
  deleteChatMessage,
  getChatConversationMeta,
  listChatConversationMessagesPage,
  listChatConversationsPage,
  listChatModels,
  listUsableKeys,
  updateChatConversation,
  uploadChatConversationAttachment,
  type AvailableModel,
  type ChatConversation,
  type ChatMediaItem,
  type ChatSendMessagesItem,
  type ChatStoredMessage,
  type ChatUsage,
  type RuntimeKeyItem,
} from '@/api/agent';
import { ApiError } from '@/api/client';
import type { ChatMessage } from '@/messages/handler';

let seq = 0;
const nextId = () => `c${(seq += 1)}`;

/** 渲染用消息元数据：媒体、usage、模型、后端消息 id（软删重试时用）。 */
export interface ChatMessageMeta {
  media?: ChatMediaItem[];
  usage?: ChatUsage;
  model?: string;
  /** 落库消息 id；未落库（乐观插入/发送失败）为空。 */
  remoteId?: string | number;
}

/** 渲染层消息：ChatMessage + 元数据（挂在 id 上以复用 StreamBlock）。 */
export type ChatRenderMessage = ChatMessage & { meta?: ChatMessageMeta };

/** 落库历史 → 渲染消息。聊天只关心 user/assistant 文本、媒体、usage 与错误。 */
function historyToMessages(stored: ChatStoredMessage[]): ChatRenderMessage[] {
  return stored
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const meta: ChatMessageMeta = { media: m.media ?? undefined, usage: m.usage ?? undefined, model: m.model, remoteId: m.id };
      if (m.role === 'user') return { id: nextId(), kind: 'user' as const, text: m.content || '', meta };
      if (m.status === 'error') return { id: nextId(), kind: 'error' as const, text: m.error || m.content || '出错', meta };
      return { id: nextId(), kind: 'agent' as const, text: m.content || '', meta };
    });
}

/** 消息 content：纯文本或 content parts（图片 → image_url，文本附件 → text）。 */
function buildContent(text: string, media: ChatMediaItem[] | undefined): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  const images = (media ?? []).filter((m) => (m.type === 'image' || m.type === 'image_url') && (m.url || m.b64));
  if (!images.length) return text;
  const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
  if (text) parts.push({ type: 'text', text });
  for (const img of images) parts.push({ type: 'image_url', image_url: { url: img.url || (img.b64 ? `data:${img.mimeType || 'image/png'};base64,${img.b64}` : '') } });
  return parts;
}

export interface UseChatOptions {
  /** 发送需要的参数：选中的 key / 模型。 */
  apiKeyId: number | null;
  model: string;
  /** 推理强度（'' 表示不传，由模型/渠道默认）。 */
  reasoningEffort?: string;
}

export interface ChatConversationState {
  conversation: ChatConversation | null;
  messages: ChatRenderMessage[];
  loading: boolean;
  streaming: boolean;
  error: string;
  /** 更早的消息是否还有（向上翻页）。 */
  hasMore: boolean;
  loadingOlder: boolean;
  send: (text: string, media?: { uri: string; name: string; mimeType?: string }[]) => void;
  /** 上滑加载更早的历史。 */
  loadOlder: () => Promise<void>;
  /** 重试最后一条失败的 assistant：软删失败消息并重发最后一条 user。 */
  retry: () => void;
  abort: () => void;
  reload: () => Promise<void>;
  updateContext: (patch: { system_prompt?: string; model?: string; chat_settings?: Record<string, unknown> }) => Promise<void>;
  uploadAttachment: (file: { uri: string; name: string; mimeType?: string }) => Promise<{ dataUrl?: string; text?: string; media: ChatMediaItem } | null>;
}

export function useChatConversation(
  convId: string | undefined,
  opts: UseChatOptions,
): ChatConversationState {
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatRenderMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const sendHandleRef = useRef<{ cancel: () => void } | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  /** 最旧一条的后端消息 id（向前翻页游标）。 */
  const oldestCursorRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    if (!convId) return;
    try {
      // 元信息 + 最新一页消息（游标分页；更早的向上翻页加载）。
      // cursor 语义：后端按用户轮次分页，next_cursor 是本页最早的 user message id。
      const [conv, page] = await Promise.all([
        getChatConversationMeta(convId),
        listChatConversationMessagesPage(convId, null, 20),
      ]);
      setConversation(conv);
      setMessages(historyToMessages(page.messages ?? []));
      oldestCursorRef.current = page.page?.next_cursor ?? null;
      setHasMore(!!page.page?.has_more);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载对话失败');
    } finally {
      setLoading(false);
    }
  }, [convId]);

  const loadOlder = useCallback(async () => {
    if (!convId || loadingOlder || oldestCursorRef.current == null) return;
    setLoadingOlder(true);
    try {
      const page = await listChatConversationMessagesPage(convId, oldestCursorRef.current, 20);
      const older = historyToMessages(page.messages ?? []);
      setMessages((prev) => [...older, ...prev]);
      oldestCursorRef.current = page.page?.next_cursor ?? null;
      setHasMore(!!page.page?.has_more);
    } catch {
      /* 翻页失败静默：用户可下拉重试整页 */
    } finally {
      setLoadingOlder(false);
    }
  }, [convId, loadingOlder]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => () => sendHandleRef.current?.cancel(), []);

  // 发送（供 send/retry 共用）：history 由当前消息列表重建；attachmentsMedia 追加到本轮 content。
  // resendLastUser：重试时 user 轮已在闭包 history 里（首次发送时闭包是旧 state，不含乐观 user），
  // 此时不再额外 append 本轮，避免 user 轮重复。
  const runSend = useCallback(
    (content: string, images: ChatMediaItem[] | undefined, resendLastUser = false) => {
      if (!convId) return;
      const { apiKeyId, model, reasoningEffort } = optsRef.current;
      if (!apiKeyId || !model) {
        setError('请先选择 API Key 和模型');
        return;
      }
      setError('');
      setStreaming(true);

      const context = conversation?.system_prompt?.trim();
      const history: ChatSendMessagesItem[] = context ? [{ role: 'system', content: context }] : [];
      for (const m of messages) {
        if (m.kind === 'user' && m.text) history.push({ role: 'user', content: buildContent(m.text, m.meta?.media) });
        else if (m.kind === 'agent' && m.text) history.push({ role: 'assistant', content: m.text });
      }
      if (!resendLastUser) history.push({ role: 'user', content: buildContent(content, images) });

      const chatSettings = (conversation?.chat_settings ?? {}) as { temperature?: number; maxTokens?: number; max_tokens?: number; stream?: boolean };
      const payload = {
        api_key_id: apiKeyId,
        model,
        messages: history,
        temperature: chatSettings.temperature,
        max_tokens: chatSettings.maxTokens ?? chatSettings.max_tokens,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      };

      let acc = '';
      let usage: ChatUsage | undefined;
      const useStream = chatSettings.stream !== false;
      const handle = useStream
        ? chatSendStream(payload, (delta) => {
            acc += delta;
            setMessages((prev) => prev.map((m) => (m.id === assistantId && m.kind === 'agent' ? { ...m, text: acc } : m)));
          }, (u) => {
            usage = u;
            setMessages((prev) => prev.map((m) => (m.id === assistantId && m.kind === 'agent' ? { ...m, meta: { ...m.meta, usage: u } } : m)));
          })
        : {
            cancel: () => undefined,
            done: chatSendOnce(payload).then((result) => {
              const choices = result.choices as { message?: { content?: string }; usage?: ChatUsage }[] | undefined;
              acc = choices?.[0]?.message?.content || '';
              usage = (result as { usage?: ChatUsage }).usage ?? choices?.[0]?.usage;
              setMessages((prev) => prev.map((m) => (m.id === assistantId && m.kind === 'agent' ? { ...m, text: acc, meta: { ...m.meta, usage } } : m)));
            }),
          };
      sendHandleRef.current = handle;

      // 本轮消息先乐观插入（外层完成），这里只引用 assistant 占位 id。
      const assistantId = pendingAssistantIdRef.current;
      handle.done
        .then(async () => {
          if (acc || usage) {
            await appendChatMessage(convId, { role: 'assistant', content: acc, status: 'done', model, ...(usage ? { usage } : {}) }).catch(() => undefined);
          }
        })
        .catch((e) => {
          const msg = e instanceof ApiError ? e.message : '发送失败';
          setMessages((prev) => prev.map((m) => (m.id === assistantId && m.kind === 'agent' ? { id: nextId(), kind: 'error', text: msg, meta: m.meta } : m)));
          setError(msg);
        })
        .finally(() => {
          sendHandleRef.current = null;
          setStreaming(false);
        });
    },
    // messages/conversation 参与 history 重建；images 由闭包参数传入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convId, messages, conversation?.system_prompt, conversation?.chat_settings],
  );

  // assistant 占位 id 由 send 创建后写入 ref 供 runSend 引用（避免把 state setter 传进回调链）。
  const pendingAssistantIdRef = useRef<string>('');

  const send = useCallback(
    (text: string, files?: { uri: string; name: string; mimeType?: string }[]) => {
      const content = text.trim();
      if (!convId || (!content && !files?.length) || streaming) return;
      // 从附件上传开始即锁住发送，避免用户在上传窗口重复点发送。
      setStreaming(true);

      // 上传附件（失败不阻塞文本发送，只丢附件）。
      let images: ChatMediaItem[] | undefined;
      let textParts = '';
      const upload = (async () => {
        if (!files?.length || !convId) return;
        const uploaded: ChatMediaItem[] = [];
        const extraTexts: string[] = [];
        for (const f of files) {
          try {
            const att = await uploadChatConversationAttachment(convId, f);
            if (att.data_url) uploaded.push({ type: 'image', url: att.data_url, mimeType: att.mime });
            else if (att.text) extraTexts.push(`--- ${att.filename} ---\n${att.text}`);
          } catch {
            /* 单个附件失败跳过 */
          }
        }
        images = uploaded.length ? uploaded : undefined;
        textParts = extraTexts.join('\n\n');
      })();

      void upload.finally(() => {
        const full = [content, textParts].filter(Boolean).join('\n\n');
        if (!full && !images?.length) {
          setStreaming(false);
          setError('附件上传失败，请重试');
          return;
        }
        const userMsg: ChatRenderMessage = { id: nextId(), kind: 'user', text: full, ...(images?.length ? { meta: { media: images } } : {}) };
        const assistantId = nextId();
        const assistantMsg: ChatRenderMessage = { id: assistantId, kind: 'agent', text: '', meta: { model: optsRef.current.model } };
        pendingAssistantIdRef.current = assistantId;
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
        // 落库 user 消息（失败不阻塞流，历史最终以 reload 为准）。
        void appendChatMessage(convId, { role: 'user', content: full, status: 'done', ...(images?.length ? { media: images } : {}) }).catch(() => undefined);
        runSend(full, images);
      });
    },
    [convId, runSend, streaming],
  );

  /** 重试：软删最后一条失败 assistant，再重发最后一条 user（不重复落库 user）。 */
  const retry = useCallback(() => {
    if (!convId || streaming) return;
    // 失败形态：末尾是 error 块（发送失败时把 assistant 占位替换成了 error）。
    const lastErrIdx = messages.map((m) => m.kind).lastIndexOf('error');
    if (lastErrIdx < 0) return;
    let lastUserIdx = -1;
    for (let i = lastErrIdx - 1; i >= 0; i--) {
      if (messages[i].kind === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;
    const lastUser = messages[lastUserIdx];
    const errMsg = messages[lastErrIdx];
    if (lastUser.kind !== 'user' || errMsg.kind !== 'error') return;

    // 软删失败的 assistant 落库行（历史 error 块带 remoteId）。
    if (errMsg.meta?.remoteId != null) {
      void deleteChatMessage(convId, errMsg.meta.remoteId).catch(() => undefined);
    }
    const assistantId = nextId();
    pendingAssistantIdRef.current = assistantId;
    const assistantMsg: ChatRenderMessage = { id: assistantId, kind: 'agent', text: '', meta: { model: optsRef.current.model } };
    setMessages([...messages.slice(0, lastErrIdx), assistantMsg]);
    // user 消息已在 history / 持久层中，resendLastUser=true 避免重复追加。
    runSend(lastUser.text, lastUser.meta?.media, true);
  }, [convId, messages, runSend, streaming]);

  const abort = useCallback(() => {
    sendHandleRef.current?.cancel();
    sendHandleRef.current = null;
    setStreaming(false);
  }, []);

  const updateContext = useCallback(async (patch: { system_prompt?: string; model?: string; chat_settings?: Record<string, unknown> }) => {
    if (!convId) return;
    const updated = await updateChatConversation(convId, patch);
    setConversation(updated);
  }, [convId]);

  /** 附件上传便捷方法（发送前预检大小 / 类型由调用方把关）。 */
  const uploadAttachment = useCallback(async (file: { uri: string; name: string; mimeType?: string }) => {
    if (!convId) return null;
    try {
      const att = await uploadChatConversationAttachment(convId, file);
      const media: ChatMediaItem = att.data_url
        ? { type: 'image', url: att.data_url, mimeType: att.mime }
        : { type: 'file', url: att.path, mimeType: att.mime };
      return { dataUrl: att.data_url, text: att.text, media };
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '附件上传失败');
      return null;
    }
  }, [convId]);

  return { conversation, messages, loading, streaming, error, hasMore, loadingOlder, send, loadOlder, retry, abort, reload, updateContext, uploadAttachment };
}

// ==================== 聊天列表 / 新建 / 选项预取 ====================

export function useChatList() {
  const [items, setItems] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  const reload = useCallback(async () => {
    try {
      const page = await listChatConversationsPage({ limit: 20 });
      setItems(page.items);
      cursorRef.current = page.page.next_cursor;
      setHasMore(page.page.has_next_page);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载聊天失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !cursorRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const page = await listChatConversationsPage({ limit: 20, cursor: cursorRef.current });
      setItems((prev) => [...prev, ...page.items]);
      cursorRef.current = page.page.next_cursor;
      setHasMore(page.page.has_next_page);
    } catch {
      /* 静默 */
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { items, loading, error, reload, hasMore, loadingMore, loadMore };
}

export function useChatModelOptions() {
  const [keys, setKeys] = useState<RuntimeKeyItem[]>([]);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const k = await listUsableKeys();
        setKeys(k);
        if (k.length) {
          const m = await listChatModels(k[0].id).catch(() => [] as AvailableModel[]);
          setModels(m);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadModelsFor = useCallback(async (apiKeyId: number) => {
    setModels(await listChatModels(apiKeyId).catch(() => [] as AvailableModel[]));
  }, []);

  return { keys, models, loading, loadModelsFor };
}

/** 建聊天会话后返回 id，供页面跳转。 */
export async function createChat(opts: {
  apiKeyId: number;
  model: string;
  title?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}): Promise<string | null> {
  const conv = await createChatConversation({
    title: opts.title?.trim() || undefined,
    system_prompt: opts.systemPrompt?.trim() || undefined,
    model: opts.model,
    chat_settings: {
      mode: 'chat',
      model: opts.model,
      apiKeyId: opts.apiKeyId,
      temperature: opts.temperature ?? 0.7,
      maxTokens: opts.maxTokens ?? 4096,
      stream: opts.stream ?? true,
      systemPrompt: opts.systemPrompt?.trim() || '',
    } as Record<string, unknown>,
  }).catch(() => null);
  return conv?.id ?? null;
}
