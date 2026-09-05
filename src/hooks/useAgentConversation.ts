/**
 * Agent 对话状态：历史回放 + SSE 增量。
 *
 * 复用 `messages/handler` 的 ChatMessage 类型，这样 `components/StreamBlocks` 里现成的
 * 气泡/思考块/工具卡渲染可以直接用（那套原本是给任务 ACP 流写的，消息形状通用）。
 * Agent 侧事件来自 `agent/agent_loop.py` 的 on_event：content / tool_call / tool_result /
 * turn_* / done / retry / error。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  abortAgentConversation,
  getAgentConversation,
  listApprovals,
  resolveApproval as resolveApprovalApi,
  retryAgentConversationMessage,
  sendAgentMessage,
  updateAgentConversation,
  uploadAgentConversationAttachment,
  type AgentConversation,
  type AgentStoredMessage,
  type AttachmentMediaPart,
  type AgentStreamEvent,
  type SendMessageHandle,
  type AgentExecutionMode,
  type AgentGoalConfig,
} from '@/api/agent';
import { ApiError } from '@/api/client';
import type { ChatMessage } from '@/messages/handler';

let seq = 0;
const nextId = () => `a${(seq += 1)}`;

/** 工具结果转成可读文本（后端 data 可能是任意结构）。 */
function resultText(data: unknown): string {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

/** ClickHouse JSON 字段在不同驱动版本下可能是数组或 JSON 文本，统一归一后再渲染。 */
function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

/** media part（{type:'attachment', attachment_id? | url?, ...}）→ 渲染用附件块。 */
function attachmentMessageFromPart(part: AttachmentMediaPart, id: string): ChatMessage | null {
  const rawId = (part as { attachment_id?: unknown }).attachment_id;
  const attachmentId = typeof rawId === 'number' || typeof rawId === 'string' ? Number(rawId) : NaN;
  const url = typeof (part as { url?: unknown }).url === 'string' ? (part as { url: string }).url : undefined;
  const contentUrl = typeof (part as { content_url?: unknown }).content_url === 'string'
    ? (part as { content_url: string }).content_url
    : undefined;
  const thumbnailUrl = typeof (part as { thumbnail_url?: unknown }).thumbnail_url === 'string'
    ? (part as { thumbnail_url: string }).thumbnail_url
    : undefined;
  if (!Number.isFinite(attachmentId) && !url) return null;
  return {
    id,
    kind: 'attachment',
    attachment: {
      attachmentId: Number.isFinite(attachmentId) ? attachmentId : undefined,
      url,
      contentUrl,
      thumbnailUrl,
      name: typeof part.name === 'string' ? part.name : undefined,
      mimeType: typeof part.mime_type === 'string' ? part.mime_type : undefined,
      size: typeof part.size === 'number' ? part.size : undefined,
      status: part.status,
      expiresAt: typeof part.expires_at === 'string' ? part.expires_at : undefined,
    },
  };
}

/** 落库的历史消息 → 渲染用消息列表。 */
function historyToMessages(stored: AgentStoredMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of stored) {
    if (m.role === 'user') {
      if (m.content) out.push({ id: nextId(), kind: 'user', text: m.content });
      continue;
    }
    if (m.role === 'system') continue; // system prompt 不展示
    // assistant：思考在最前（发生在工具/正文之前），再工具调用，最后正文
    if (m.reasoning) out.push({ id: nextId(), kind: 'thought', text: m.reasoning });
    const calls = asArray(m.tool_calls) as Array<{ name?: string; args?: unknown; status?: string }>;
    const results = asArray(m.tool_results);
    calls.forEach((c, i) => {
      out.push({
        id: nextId(),
        kind: 'tool',
        toolCallId: `${m.id}-${i}`,
        title: c.name || '工具调用',
        status: c.status === 'done' ? 'completed' : c.status,
        rawInput: c.args,
        rawOutput: results[i],
      });
    });
    // 卡死流恢复：历史里残留 streaming/pending 的 assistant（服务重启/断流）降级为 error，
    // 提示可重试 —— 与 Web agent-chat 的恢复逻辑一致。
    if (m.status === 'streaming' || m.status === 'pending') {
      out.push({ id: nextId(), kind: 'error', text: '该轮回复中断（服务重启或连接断开）。可发新消息继续。' });
    }
    if (m.status === 'error' && m.error) out.push({ id: nextId(), kind: 'error', text: m.error });
    if (m.content) out.push({ id: nextId(), kind: 'agent', text: m.content });
    for (const part of asArray(m.media) as AttachmentMediaPart[]) {
      const msg = attachmentMessageFromPart(part, nextId());
      if (msg) out.push(msg);
    }
  }
  return out;
}

/** 后端 approval_registry 的挂起审批 → 审批卡消息（重连恢复用）。 */
function approvalMessageFromRow(row: Record<string, unknown>, id: string): ChatMessage | null {
  const approvalId = String(row.confirmation_id ?? '');
  if (!approvalId) return null;
  const resolved = String(row.resolved ?? row.status ?? '');
  const state: Extract<ChatMessage, { kind: 'approval' }>['state'] =
    resolved === 'allow' ? 'allowed' : resolved === 'deny' ? 'denied' : resolved === 'timeout' ? 'expired' : resolved === 'interrupted' ? 'interrupted' : 'pending';
  const commandsRaw = Array.isArray(row.commands) ? (row.commands as unknown[]).map((c) => String(c ?? '').trim()).filter(Boolean) : [];
  const single = String(row.command ?? '').trim();
  const commands = commandsRaw.length ? commandsRaw : single ? [single] : [];
  const expiresAtRaw = Number(row.expires_at ?? 0);
  const expiresAt = Number.isFinite(expiresAtRaw) && expiresAtRaw > 0 ? expiresAtRaw * 1000 : 0;
  return {
    id,
    kind: 'approval',
    approvalId,
    state,
    toolName: String(row.tool_name ?? 'node_shell_exec'),
    nodeId: String(row.node_id ?? ''),
    commands,
    message: String(row.message ?? ''),
    commandHash: String(row.command_hash ?? ''),
    expiresAt,
  };
}

export interface AgentConversationState {
  conversation: AgentConversation | null;
  messages: ChatMessage[];
  loading: boolean;
  /** 正在跑一轮（SSE 未结束） */
  streaming: boolean;
  error: string;
  send: (text: string, opts?: { mode?: AgentExecutionMode; goalConfig?: AgentGoalConfig; attachments?: { uri: string; name: string; mimeType?: string }[] }) => void;
  abort: () => void;
  reload: () => Promise<void>;
  /** 裁决一条挂起审批（提交中/已裁决/失败回退由本 hook 维护消息状态）。 */
  resolveApproval: (approvalId: string, result: 'allow' | 'deny') => Promise<void>;
  /** 更新会话级模型 / 推理强度 / 系统提示词。 */
  updateContext: (patch: { model?: string; reasoning_effort?: string; system_prompt?: string }) => Promise<void>;
  /** 通过服务端 retry endpoint 重试最后一条失败 assistant。 */
  retryFailed: () => Promise<void>;
}

export function useAgentConversation(convId: string | undefined): AgentConversationState {
  const [conversation, setConversation] = useState<AgentConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const handleRef = useRef<SendMessageHandle | null>(null);
  // 本轮 tool_call 的下标 → 消息 id，用于把 tool_result 回填到对应工具卡。
  const toolIdxRef = useRef<Map<number, string>>(new Map());
  // 最新消息列表镜像：applyEvent 用 setMessages(prev => …) 写状态，但 reload 里
  // 读的是闭包里的旧 messages，故单独维护一份镜像供 reload 合并已裁决的审批卡。
  const messagesRef = useRef<ChatMessage[]>([]);

  const reload = useCallback(async () => {
    if (!convId) return;
    try {
      const raw = await getAgentConversation(convId);
      const conv = raw?.conversation ?? ((raw as unknown as AgentConversation)?.id ? raw as unknown as AgentConversation : null);
      const stored = Array.isArray(raw?.messages) ? raw.messages : [];
      if (!conv) throw new ApiError('对话不存在或无权访问');
      setConversation(conv);
      // 保留已经本地裁决的审批卡（历史不持久化裁决态）；重连恢复的只取 pending。
      const localResolvedApprovals = messagesRef.current.filter(
        (m) => m.kind === 'approval' && m.state !== 'pending' && m.state !== 'submitting',
      );
      const baseHistory = historyToMessages(stored);
      let pendingApprovals: ChatMessage[] = [];
      try {
        const rows = await listApprovals(convId);
        pendingApprovals = rows
          .map((row) => approvalMessageFromRow(row as unknown as Record<string, unknown>, nextId()))
          .filter((m): m is ChatMessage => m !== null);
      } catch {
        // 审批恢复失败不阻塞历史回放。
      }
      setMessages([...baseHistory, ...localResolvedApprovals, ...pendingApprovals]);
      messagesRef.current = [...baseHistory, ...localResolvedApprovals, ...pendingApprovals];
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error)?.message || '加载对话失败');
    } finally {
      setLoading(false);
    }
  }, [convId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 离开页面时只断开本地读取；服务端那一轮继续跑，回来 reload 能看到完整结果。
  useEffect(() => () => handleRef.current?.cancel(), []);

  // 把 setMessages 同时写进 ref 镜像，使 reload 能读到最新已裁决审批卡。
  const commitMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      messagesRef.current = next;
      return next;
    });
  }, []);

  const applyEvent = useCallback((ev: AgentStreamEvent) => {
    commitMessages((prev) => {
      switch (ev.type) {
        case 'content': {
          const text = typeof ev.text === 'string' ? ev.text : '';
          if (!text) return prev;
          const last = prev[prev.length - 1];
          // 增量拼接必须换新对象，否则 React.memo 比较不出文本增长。
          if (last?.kind === 'agent') return [...prev.slice(0, -1), { ...last, text: last.text + text }];
          return [...prev, { id: nextId(), kind: 'agent', text }];
        }
        case 'reasoning': {
          // 思考增量复用现有 thought 块（ThoughtBlock 渲染），与正文分开累积。
          const text = typeof ev.text === 'string' ? ev.text : '';
          if (!text) return prev;
          const last = prev[prev.length - 1];
          // 增量拼接必须换新对象，否则 React.memo 比较不出文本增长。
          if (last?.kind === 'thought') return [...prev.slice(0, -1), { ...last, text: last.text + text }];
          return [...prev, { id: nextId(), kind: 'thought', text }];
        }
        case 'tool_call': {
          const id = nextId();
          if (typeof ev.index === 'number') toolIdxRef.current.set(ev.index, id);
          return [
            ...prev,
            {
              id,
              kind: 'tool',
              toolCallId: id,
              title: ev.name || '工具调用',
              status: 'in_progress',
              rawInput: ev.args,
            },
          ];
        }
        case 'tool_result': {
          const id = typeof ev.index === 'number' ? toolIdxRef.current.get(ev.index) : undefined;
          const data = ev.data && typeof ev.data === 'object' ? ev.data as Record<string, unknown> : null;
          // show_file 工具：kind=attachment 带 id（工作区文件），kind=url 直接透传公网地址。
          const isShowFile = String(ev.name || '') === 'show_file' && data != null;
          const next = id
            ? prev.map((m) =>
                m.id === id && m.kind === 'tool'
                  ? { ...m, status: 'completed', rawOutput: ev.data, content: resultText(ev.data) }
                  : m,
              )
            : prev;
          if (isShowFile && data) {
            const rawId = data.id;
            const attachmentId = typeof rawId === 'number' || typeof rawId === 'string' ? Number(rawId) : NaN;
            const url = typeof data.url === 'string' ? data.url : undefined;
            const card = attachmentMessageFromPart(
              {
                attachment_id: Number.isFinite(attachmentId) ? attachmentId : undefined,
                url,
                name: typeof data.name === 'string' ? data.name : undefined,
                mime_type: typeof data.mime_type === 'string' ? data.mime_type : undefined,
                size: typeof data.size === 'number' ? data.size : undefined,
                status: data.status as AttachmentMediaPart['status'],
                expires_at: typeof data.expires_at === 'string' ? data.expires_at : undefined,
              },
              nextId(),
            );
            // 去重：同一 attachment / url 只渲染一张卡（重连回放 + 实时都可能到）。
            const key = card && card.kind === 'attachment'
              ? (card.attachment.attachmentId ?? card.attachment.url)
              : undefined;
            const exists = key != null
              && next.some((m) => m.kind === 'attachment' && (m.attachment.attachmentId ?? m.attachment.url) === key);
            if (card && !exists) return [...next, card];
          }
          return next;
        }
        case 'confirmation_required': {
          // 节点命令审批卡：同 confirmation_id 只插一张（重连回放 + 实时去重）。
          const approvalId = String((ev as Record<string, unknown>).confirmation_id ?? '');
          if (!approvalId) return prev;
          if (prev.some((m) => m.kind === 'approval' && m.approvalId === approvalId)) return prev;
          const row = approvalMessageFromRow(ev as unknown as Record<string, unknown>, nextId());
          return row ? [...prev, row] : prev;
        }
        case 'question': {
          // Agent 主动提问（非审批），作为正文追加一条提示。
          const text = String((ev as Record<string, unknown>).question ?? (ev as Record<string, unknown>).message ?? '需要补充信息');
          if (!text) return prev;
          const last = prev[prev.length - 1];
          if (last?.kind === 'agent') return [...prev.slice(0, -1), { ...last, text: last.text ? `${last.text}\n\n${text}` : text }];
          return [...prev, { id: nextId(), kind: 'agent', text }];
        }
        case 'retry': {
          const msg = ev.message ? `模型调用失败，正在重试：${ev.message}` : '模型调用失败，正在重试';
          return [...prev, { id: nextId(), kind: 'system', text: msg }];
        }
        case 'done': {
          // done 带 agent_loop 累积的 usage / 最终 model：以系统行展示用量。
          const usage = (ev as Record<string, unknown>).usage as Record<string, unknown> | undefined;
          if (!usage) return prev;
          const input = Number(usage.prompt_tokens ?? usage.input_tokens) || 0;
          const output = Number(usage.completion_tokens ?? usage.output_tokens) || 0;
          const total = Number(usage.total_tokens) || input + output;
          const cached = Number(usage.cached_tokens ?? usage.cache_read_input_tokens) || 0;
          const reasoning = Number(usage.reasoning_tokens) || 0;
          const parts = [`${total} tokens`, cached ? `缓存 ${cached}` : '', reasoning ? `思考 ${reasoning}` : ''].filter(Boolean);
          return [...prev, { id: nextId(), kind: 'system', text: `本轮用量：${parts.join(' · ')}` }];
        }
        case 'subagent_start': {
          const subagentId = String((ev as Record<string, unknown>).subagent_id ?? 'subagent');
          return [...prev, {
            id: nextId(),
            kind: 'subagent',
            subagentId,
            name: String((ev as Record<string, unknown>).subagent_name ?? '子 Agent'),
            task: String((ev as Record<string, unknown>).task ?? ''),
            status: 'running',
            text: '',
            tools: [],
          }];
        }
        case 'subagent_content': {
          const subagentId = String((ev as Record<string, unknown>).subagent_id ?? '');
          const text = typeof ev.text === 'string' ? ev.text : '';
          if (!subagentId || !text) return prev;
          return prev.map((m) => m.kind === 'subagent' && m.subagentId === subagentId ? { ...m, text: (m.text ?? '') + text } : m);
        }
        case 'subagent_tool_call': {
          const subagentId = String((ev as Record<string, unknown>).subagent_id ?? '');
          if (!subagentId) return prev;
          return prev.map((m) => m.kind === 'subagent' && m.subagentId === subagentId
            ? { ...m, tools: [...(m.tools ?? []), { name: String(ev.name || 'unknown'), status: 'running' }] }
            : m);
        }
        case 'subagent_tool_result': {
          const subagentId = String((ev as Record<string, unknown>).subagent_id ?? '');
          if (!subagentId) return prev;
          return prev.map((m) => {
            if (m.kind !== 'subagent' || m.subagentId !== subagentId) return m;
            const tools = (m.tools ?? []).map((tool) => tool.name === String(ev.name || '') && tool.status === 'running' ? { ...tool, status: 'done' } : tool);
            return { ...m, tools };
          });
        }
        case 'subagent_end': {
          const subagentId = String((ev as Record<string, unknown>).subagent_id ?? '');
          if (!subagentId) return prev;
          return prev.map((m) => m.kind === 'subagent' && m.subagentId === subagentId
            ? { ...m, status: 'done', summary: typeof (ev as Record<string, unknown>).summary === 'string' ? (ev as Record<string, unknown>).summary as string : m.summary }
            : m);
        }
        case 'error':
          return [...prev, { id: nextId(), kind: 'error', text: String(ev.message || '执行出错') }];
        default:
          return prev; // turn_start / turn_end 暂不单独渲染
      }
    });
  }, [commitMessages]);

  const send = useCallback(
    (text: string, opts?: { mode?: AgentExecutionMode; goalConfig?: AgentGoalConfig; attachments?: { uri: string; name: string; mimeType?: string }[] }) => {
      const content = text.trim();
      if (!convId || (!content && !opts?.attachments?.length) || streaming) return;
      setError('');
      setStreaming(true);

      void (async () => {
        // Agent 附件：上传后落 Agent 工作区；消息正文标注文件名（运行时用 file 工具读）。
        let note = '';
        if (opts?.attachments?.length && convId) {
          const names: string[] = [];
          for (const f of opts.attachments) {
            try {
              await uploadAgentConversationAttachment(convId, f);
              names.push(f.name);
            } catch {
              /* 单个附件失败跳过，不打断发送 */
            }
          }
          if (names.length) note = `${content ? '\n\n' : ''}📎 已上传文件：${names.join('、')}`;
        }
        const full = content + note;
        if (!full) {
          setStreaming(false);
          setError('附件上传失败，请重试');
          return;
        }

        commitMessages((prev) => [...prev, { id: nextId(), kind: 'user', text: full }]);
        toolIdxRef.current.clear();

        const handle = sendAgentMessage(convId, full, applyEvent, {
          mode: opts?.mode,
          goalConfig: opts?.goalConfig,
        });
        handleRef.current = handle;
        try {
          await handle.done;
        } catch (e) {
          setError(e instanceof ApiError ? e.message : '发送失败');
        } finally {
          handleRef.current = null;
          setStreaming(false);
          // 流里未落库的收尾状态（标题、最终内容）以服务端为准。
          void reload();
        }
      })();
    },
    [commitMessages, convId, streaming, applyEvent, reload],
  );

  const abort = useCallback(() => {
    if (!convId) return;
    handleRef.current?.cancel();
    handleRef.current = null;
    setStreaming(false);
    abortAgentConversation(convId).catch(() => undefined);
  }, [convId]);

  const resolveApproval = useCallback(async (approvalId: string, result: 'allow' | 'deny') => {
    if (!convId) return;
    // 找到当前审批卡的 commandHash，与裁决一起回传防改写。
    const card = messagesRef.current.find((m) => m.kind === 'approval' && m.approvalId === approvalId);
    const commandHash = card && card.kind === 'approval' ? card.commandHash : undefined;
    commitMessages((prev) => prev.map((m) => m.kind === 'approval' && m.approvalId === approvalId && (m.state === 'pending' || m.state === 'interrupted' || m.state === 'expired') ? { ...m, state: 'submitting' } : m));
    try {
      await resolveApprovalApi(convId, approvalId, result, commandHash);
      commitMessages((prev) => prev.map((m) => m.kind === 'approval' && m.approvalId === approvalId ? { ...m, state: result === 'allow' ? 'allowed' : 'denied' } : m));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '裁决失败';
      commitMessages((prev) => prev.map((m) => m.kind === 'approval' && m.approvalId === approvalId && m.state === 'submitting' ? { ...m, state: 'pending' } : m));
      setError(msg);
    }
  }, [commitMessages, convId]);

  const updateContext = useCallback(async (patch: { model?: string; reasoning_effort?: string; system_prompt?: string }) => {
    if (!convId) return;
    try {
      const updated = await updateAgentConversation(convId, patch);
      setConversation(updated);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败');
    }
  }, [convId]);

  const retryFailed = useCallback(async () => {
    if (!convId || streaming) return;
    try {
      // 找服务端最后一条 error assistant（历史里保留 remote id），调 retry endpoint 重跑。
      const raw = await getAgentConversation(convId);
      const stored = Array.isArray(raw?.messages) ? raw.messages : [];
      const failed = [...stored].reverse().find((m) => m.role === 'assistant' && m.status === 'error');
      if (!failed) {
        setError('没有可重试的失败消息');
        return;
      }
      setError('');
      setStreaming(true);
      const handle = retryAgentConversationMessage(convId, failed.id, applyEvent);
      handleRef.current = handle;
      try {
        await handle.done;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : '重试失败');
      } finally {
        handleRef.current = null;
        setStreaming(false);
        void reload();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '重试失败');
    }
  }, [applyEvent, convId, reload, streaming]);

  return { conversation, messages, loading, streaming, error, send, abort, reload, resolveApproval, updateContext, retryFailed };
}
