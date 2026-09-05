/**
 * Agent 活动流的消息块渲染 —— 对齐设计稿 screen-chat.jsx。
 * 复用 messages/handler 的 ChatMessage 类型（user / agent / thought / tool / error / system / ask）。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { AskQuestion, ChatMessage, AgentAttachment } from '@/messages/handler';
import { buildAskAnswers, CUSTOM_ANSWER_KEY, type AnswerMap } from '@/messages/askAnswers';
import { resolveAssetUrl, authHeaders } from '@/api/client';
import { attachmentContentUrl, renewAttachment } from '@/api/agent';
import { Icons, Spinner } from '@/components/Icons';
import { buildMermaidHtml, fenceLanguage, trimFenceContent } from '@/components/mermaidHtml';
import { useTheme, type Theme } from '@/theme';

export type { AnswerMap } from '@/messages/askAnswers';
export type AnswerSubmitResult = 'sent' | 'queued' | 'rejected';
export type AnswerSubmitState = Exclude<AnswerSubmitResult, 'rejected'>;

const MERMAID_RUNTIME_ASSET = require('../../assets/mermaid.min.mermaidjs');
let mermaidRuntimePromise: Promise<string> | null = null;

function loadMermaidRuntime(): Promise<string> {
  if (mermaidRuntimePromise) return mermaidRuntimePromise;
  mermaidRuntimePromise = (async () => {
    const asset = Asset.fromModule(MERMAID_RUNTIME_ASSET);
    // expo-file-system 的 read/download API 在 Web 不可用；浏览器直接 fetch 打包资产。
    if (Platform.OS === 'web') {
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error(`Mermaid runtime asset failed to load (${response.status})`);
      return response.text();
    }
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    if (!uri) throw new Error('Mermaid runtime asset is unavailable');
    return FileSystem.readAsStringAsync(uri);
  })().catch((error) => {
    mermaidRuntimePromise = null;
    throw error;
  });
  return mermaidRuntimePromise;
}

function mdStyles(t: Theme) {
  return {
    body: { color: t.tx, fontSize: 14.5, lineHeight: 23 },
    paragraph: { color: t.tx, fontSize: 14.5, lineHeight: 23, marginTop: 0, marginBottom: 8 },
    heading1: { color: t.tx, fontSize: 20, fontWeight: '700', marginVertical: 6 },
    heading2: { color: t.tx, fontSize: 17, fontWeight: '700', marginVertical: 5 },
    heading3: { color: t.tx, fontSize: 15, fontWeight: '700', marginVertical: 4 },
    strong: { color: t.tx, fontWeight: '700' },
    em: { color: t.tx, fontStyle: 'italic' },
    link: { color: t.acTx },
    bullet_list: { marginVertical: 4 },
    ordered_list: { marginVertical: 4 },
    list_item: { color: t.tx, marginVertical: 1 },
    code_inline: { color: t.acTx, backgroundColor: t.bg3, borderRadius: 5, paddingHorizontal: 5, fontFamily: 'monospace', fontSize: 13 },
    code_block: { color: t.termTx, backgroundColor: t.termBg, borderRadius: 11, padding: 12, fontFamily: 'monospace', fontSize: 12 },
    fence: { color: t.termTx, backgroundColor: t.termBg, borderRadius: 11, padding: 12, fontFamily: 'monospace', fontSize: 12 },
    blockquote: { backgroundColor: t.bg3, borderColor: t.line2, borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    hr: { backgroundColor: t.line2, height: 1 },
  } as const;
}

// markdown 里的图片（AI 常用 ![](url) 返回图）。默认 react-native-markdown-display 用 react-native-fit-image
// 渲染 → 它把含 key 的 props 展开进 JSX（React19 告警），且 indicator 转圈在新架构上不消失。
// 这里用普通 <Image> + Image.getSize 自适应比例替代：无转圈、无告警；点按可保存到相册。
function MarkdownImage({ uri, t, onSave }: { uri: string; t: Theme; onSave?: (url: string) => void }) {
  const [ratio, setRatio] = useState(1.6);
  const [failed, setFailed] = useState(false);
  // uri 变化时重置，避免上一张的失败/比例残留到新图（流式重渲染、列表复用时）。
  useEffect(() => { setFailed(false); setRatio(1.6); }, [uri]);
  if (failed || !uri) return null;
  // 直接用渲染这张图时的 onLoad 拿尺寸（单次加载），不再额外 Image.getSize 探测一遍。
  return (
    <Pressable onPress={() => onSave?.(uri)} style={{ marginVertical: 6 }}>
      <Image source={{ uri }} resizeMode="contain"
        onLoad={(e) => { const s = e?.nativeEvent?.source; if (s?.width && s?.height) setRatio(s.width / s.height); }}
        onError={() => setFailed(true)}
        style={{ width: '100%', aspectRatio: ratio, borderRadius: 10, backgroundColor: t.bg3 }} />
    </Pressable>
  );
}

function MermaidDiagram({ code, t }: { code: string; t: Theme }) {
  const [height, setHeight] = useState(120);
  const [failed, setFailed] = useState(false);
  const [runtime, setRuntime] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMermaidRuntime()
      .then((script) => { if (!cancelled) setRuntime(script); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { setHeight(120); setFailed(false); }, [code]);

  const html = useMemo(() => runtime ? buildMermaidHtml(code, t, runtime) : '', [code, runtime, t]);

  if (failed) {
    return <Text style={mdStyles(t).fence}>{code}</Text>;
  }

  return (
    <View style={{ marginVertical: 7, height: runtime ? height : 120, borderRadius: 12, overflow: 'hidden', backgroundColor: t.bg2 }}>
      {!runtime ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 120, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="small" color={t.acTx} />
        </View>
      ) : null}
      {runtime ? (
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          javaScriptEnabled
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          onMessage={(event) => {
            try {
              const msg = JSON.parse(event.nativeEvent.data);
              if (msg.type === 'height' && Number.isFinite(msg.value)) setHeight(Math.max(32, Math.min(1600, Number(msg.value))));
              if (msg.type === 'error') setFailed(true);
            } catch { /* ignore malformed WebView messages */ }
          }}
          onError={() => setFailed(true)}
          style={{ height, backgroundColor: 'transparent' }}
        />
      ) : null}
    </View>
  );
}

function stableMermaidKey(node: { content?: string; index?: number; tokenIndex?: number }): string {
  const text = trimFenceContent(node.content);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 31) + text.charCodeAt(i)) | 0;
  return `mermaid-${node.tokenIndex ?? node.index ?? 0}-${text.length}-${hash >>> 0}`;
}

/** 覆盖 markdown 的 image/fence 规则（图片修告警；mermaid fence 渲染为图）。 */
function markdownRules(t: Theme, onSave?: (url: string) => void, renderMermaid = true) {
  return {
    image: (node: { key: string; attributes?: { src?: string; alt?: string } }) => (
      <MarkdownImage key={node.key} uri={resolveAssetUrl(node.attributes?.src) ?? node.attributes?.src ?? ''} t={t} onSave={onSave} />
    ),
    fence: (node: { key: string; content?: string; sourceInfo?: string; info?: string; index?: number; tokenIndex?: number }, _children: unknown, _parent: unknown, styles: Record<string, any>, inheritedStyles: any = {}) => {
      const lang = fenceLanguage(node);
      const content = trimFenceContent(node.content);
      if (lang === 'mermaid' && renderMermaid) return <MermaidDiagram key={stableMermaidKey(node)} code={content} t={t} />;
      return <Text key={node.key} style={[inheritedStyles, styles.fence]}>{content}</Text>;
    },
  };
}

function useThrottledText(text: string, active: boolean, intervalMs = 100): string {
  const [renderText, setRenderText] = useState(text);
  const lastUpdateRef = useRef(0);
  const latestTextRef = useRef(text);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  latestTextRef.current = text;

  useEffect(() => () => {
    if (pendingRef.current) clearTimeout(pendingRef.current);
  }, []);

  useEffect(() => {
    if (!active) {
      if (pendingRef.current) clearTimeout(pendingRef.current);
      pendingRef.current = null;
      lastUpdateRef.current = Date.now();
      setRenderText(text);
      return;
    }

    const now = Date.now();
    const elapsed = now - lastUpdateRef.current;
    if (elapsed >= intervalMs) {
      if (pendingRef.current) clearTimeout(pendingRef.current);
      pendingRef.current = null;
      lastUpdateRef.current = now;
      setRenderText(text);
      return;
    }

    if (!pendingRef.current) {
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        lastUpdateRef.current = Date.now();
        setRenderText(latestTextRef.current);
      }, intervalMs - elapsed);
    }
  }, [active, intervalMs, text]);

  return renderText;
}

function AgentMarkdown({ text, isStreaming, t, onCopy, onSaveImage }: { text: string; isStreaming?: boolean; t: Theme; onCopy?: (text: string) => void; onSaveImage?: (url: string) => void }) {
  const displayText = useThrottledText(text, !!isStreaming);
  const rules = useMemo(() => markdownRules(t, onSaveImage, !isStreaming), [isStreaming, onSaveImage, t]);
  return (
    <Pressable onPress={() => Keyboard.dismiss()} onLongPress={() => onCopy?.(text)}>
      <Markdown style={mdStyles(t) as any} rules={rules}>{displayText}</Markdown>
    </Pressable>
  );
}

function toolIcon(kind?: string): string {
  switch (kind) {
    case 'read': return 'file';
    case 'edit': return 'edit';
    case 'create': return 'filePlus';
    case 'delete': case 'move': return 'file';
    case 'execute': return 'terminal';
    case 'search': return 'search';
    case 'fetch': return 'search';
    case 'think': return 'brain';
    default: return 'cube';
  }
}

function ThoughtBlock({ text, t, onCopy }: { text: string; t: Theme; onCopy?: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((o) => !o)} onLongPress={() => onCopy?.(text)} style={{ paddingVertical: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icons.brain size={14} color={t.tx3} sw={1.6} />
        <Text style={{ color: t.tx3, fontSize: 12.5, fontWeight: '500' }}>思考过程</Text>
        <Icons.chevron size={13} color={t.tx3} sw={1.9} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
      </View>
      {open ? <Text style={{ marginTop: 7, paddingLeft: 21, color: t.tx3, fontSize: 13, lineHeight: 20, fontStyle: 'italic' }}>{text}</Text> : null}
    </Pressable>
  );
}

// ── 错误块：默认折叠（最多 6 行），完整错误可能很长（堆栈）→ 点击展开 / 长按复制 ──────
function ErrorBlock({ text, t, onCopy, onRetry, retryBusy }: { text: string; t: Theme; onCopy?: (s: string) => void; onRetry?: () => void; retryBusy?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 200 || text.split('\n').length > 6;
  return (
    <View style={{ backgroundColor: t.redGhost, borderWidth: 1, borderColor: t.red, borderRadius: 13, padding: 12 }}>
      <Pressable onPress={long ? () => setExpanded((v) => !v) : undefined} onLongPress={() => onCopy?.(text)}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
          <Icons.alert size={16} color={t.red} sw={1.9} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={long && !expanded ? 6 : undefined} style={{ color: t.red, fontSize: 13.5, lineHeight: 20 }}>{text}</Text>
            {long ? <Text style={{ color: t.red, opacity: 0.75, fontSize: 11.5, fontWeight: '700', marginTop: 7 }}>{expanded ? '收起' : '展开完整错误'} · 长按复制</Text> : null}
          </View>
        </View>
      </Pressable>
      {onRetry ? (
        <Pressable onPress={onRetry} disabled={retryBusy} style={({ pressed }) => [{ marginTop: 10, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: t.red, opacity: retryBusy ? 0.5 : 1 }, pressed && { opacity: 0.75 }]}>
          <Icons.refresh size={13} color="#fff" sw={2.2} />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{retryBusy ? '重试中…' : '重试这一条'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── 工具调用卡片：两行（动作 + 目标）+ 点击展开详情（对齐 web message-toolcall）──────
type ToolMsg = Extract<ChatMessage, { kind: 'tool' }>;

const cleanStr = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim() : '');

/** 动作名：按 ACP kind；编辑类随状态变化；未知 kind 回退到中文短标题或「工具调用」。 */
function toolAction(m: ToolMsg): string {
  const editing = m.status === 'failed' ? '修改文件失败'
    : (m.status === 'pending' || m.status === 'in_progress') ? '正在修改文件' : '修改文件';
  switch (m.toolKind) {
    case 'edit': return editing;
    case 'read': return '读取文件';
    case 'execute': return '执行命令';
    case 'search': return '查找内容';
    case 'fetch': return '获取网页';
    case 'delete': return '删除文件';
    case 'move': return '移动文件';
    case 'think': return '思考';
    default:
      if (typeof m.title === 'string' && m.title.length < 24 && /[一-龥]/.test(m.title)) return m.title;
      return '工具调用';
  }
}

/** MCP 工具名美化：Claude SDK 用 mcp__server__tool 命名，展示为可读的 server/tool。 */
function prettyToolName(title: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(title);
  if (mcp) return `MCP ${mcp[1]}/${mcp[2]}`;
  return title;
}

/** 卡片首行：显式显示运行时工具名，同时保留易读的中文动作。 */
function toolLabel(m: ToolMsg): string {
  const title = prettyToolName(cleanStr(m.title));
  const action = toolAction(m);
  if (!title || title === '工具调用') return action;
  if (title === action || (title === '命令执行' && action === '执行命令')) return title;
  return `${title} · ${action}`;
}

/** 目标：文件路径 / 命令 / 关键词 / URL。 */
function toolTarget(m: ToolMsg): string {
  const ri = m.rawInput ?? {};
  const path = cleanStr(ri.file_path ?? ri.filePath ?? ri.path);
  if (path) return path;
  if (typeof ri.command === 'string') return cleanStr(ri.command);
  if (Array.isArray(ri.command) && ri.command.length) return cleanStr(ri.command[ri.command.length - 1]);
  if (ri.parsed_cmd?.[0]?.cmd) return cleanStr(ri.parsed_cmd[0].cmd);
  if (ri.pattern) return cleanStr(ri.pattern);
  if (ri.url) return cleanStr(ri.url);
  if (ri.query) return cleanStr(ri.query);
  return '';
}

/** 展开详情：编辑 diff / 命令输出 / 文件内容 / 兜底原始入参。 */
function toolDetail(m: ToolMsg): string {
  const ri = m.rawInput ?? {};
  const ro = m.rawOutput ?? {};
  if (m.toolKind === 'edit') {
    const oldS = typeof ri.old_string === 'string' ? ri.old_string : '';
    const newS = typeof (ri.new_string ?? ri.content) === 'string' ? (ri.new_string ?? ri.content) : '';
    const minus = oldS ? oldS.split('\n').map((l: string) => '- ' + l).join('\n') : '';
    const plus = newS ? newS.split('\n').map((l: string) => '+ ' + l).join('\n') : '';
    const diff = [minus, plus].filter(Boolean).join('\n');
    if (diff) return diff;
  }
  let out = '';
  if (typeof ro.output === 'string') out = ro.output;
  else {
    if (typeof ro.stdout === 'string') out += ro.stdout;
    if (typeof ro.stderr === 'string' && ro.stderr) out += (out ? '\n' : '') + ro.stderr;
  }
  if (!out && Array.isArray(m.content) && m.content[0]?.content?.text) out = String(m.content[0].content.text);
  if (!out && typeof m.content === 'string') out = m.content;
  if (m.toolKind === 'execute') {
    const cmd = typeof ri.command === 'string' ? ri.command
      : Array.isArray(ri.command) ? ri.command[ri.command.length - 1]
      : (ri.parsed_cmd?.[0]?.cmd ?? '');
    return `$ ${cmd}\n${out || '（命令输出为空）'}`.trim();
  }
  if (out) return out;
  try { return Object.keys(ri).length ? JSON.stringify(ri, null, 2) : ''; } catch { return ''; }
}

function ToolCard({ msg, t, onCopy }: { msg: ToolMsg; t: Theme; onCopy?: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const I = Icons[toolIcon(msg.toolKind)] ?? Icons.cube;
  const running = msg.status === 'in_progress' || msg.status === 'pending';
  const failed = msg.status === 'failed';
  const action = toolAction(msg);
  const label = toolLabel(msg);
  const target = toolTarget(msg);
  const detail = toolDetail(msg);
  const canExpand = !running && detail.trim().length > 0;
  const isEdit = msg.toolKind === 'edit';
  const copyText = detail || [action, target].filter(Boolean).join(' ');

  return (
    <View style={{ backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line, borderRadius: 13, overflow: 'hidden' }}>
      <Pressable onPress={() => { if (canExpand) setOpen((o) => !o); }} onLongPress={() => onCopy?.(copyText)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
        <View style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: t.bg4, alignItems: 'center', justifyContent: 'center' }}>
          <I size={15} color={failed ? t.red : t.acTx} sw={1.8} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: failed ? t.red : t.tx }}>{label}</Text>
          {target ? <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx3, fontFamily: 'monospace', marginTop: 1.5 }}>{target}</Text> : null}
        </View>
        {running ? <Spinner size={15} color={t.acTx} sw={2} />
          : failed ? <Icons.alert size={15} color={t.red} sw={2} />
          : <Icons.check size={16} color={t.acTx} sw={2.4} />}
        {canExpand ? <Icons.chevron size={13} color={t.tx3} sw={2} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} /> : null}
      </Pressable>
      {open && canExpand ? (
        <View style={{ borderTopWidth: 1, borderColor: t.line, backgroundColor: t.termBg }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12 }}>
            <View>
              {detail.split('\n').slice(0, 200).map((line, i) => {
                const color = isEdit && line.startsWith('+') ? '#3fb950'
                  : isEdit && line.startsWith('-') ? '#f85149'
                  : t.termTx;
                return <Text key={i} style={{ fontFamily: 'monospace', fontSize: 11.5, lineHeight: 17, color }}>{line || ' '}</Text>;
              })}
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function formatFileSize(size?: number) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function formatExpiry(value?: string) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * show_file 的媒体渲染：图片直接内联大图，其它文件显示下载/续期卡。
 * 工作区文件走鉴权 attachment 内容端点；公网 url 直接使用。
 */
function webDownload(url: string, filename: string): void {
  // Web 上 expo-file-system.downloadAsync / expo-sharing 都不可用；
  // 浏览器自己的下载流程（同源 anchor + download 属性）就够用。
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || '';
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function AttachmentBlock({ attachment, t, onCopy }: { attachment: AgentAttachment; t: Theme; onCopy?: (text: string) => void }) {
  const [busy, setBusy] = useState<'idle' | 'downloading' | 'renewing'>('idle');
  const [error, setError] = useState('');
  const [status, setStatus] = useState(attachment.status);
  const [expiresAt, setExpiresAt] = useState(attachment.expiresAt);
  const [previewOpen, setPreviewOpen] = useState(false);

  const isImage = (attachment.mimeType || '').startsWith('image/');
  const purged = status === 'purged';
  const expired = status === 'expired';
  const name = attachment.name || (isImage ? '图片' : '文件');
  // 优先用服务端签发的短时签名 URL（无需登录态）；回退公网 url；再回退裸 id URL（带 cookie）。
  const signedAbsolute = resolveAssetUrl(attachment.contentUrl);
  const sourceUrl = signedAbsolute
    || attachment.url
    || (attachment.attachmentId != null ? attachmentContentUrl(attachment.attachmentId) : '');
  // 签名 URL 自带凭证，不需要 auth 头；只有裸 id URL（登录态）才需要。
  const sourceHeaders = signedAbsolute ? undefined : (attachment.attachmentId != null ? authHeaders() : undefined);

  const open = async () => {
    if (busy !== 'idle' || purged || expired || !sourceUrl) return;
    if (Platform.OS === 'web') {
      webDownload(sourceUrl, name);
      return;
    }
    setBusy('downloading');
    setError('');
    try {
      const safe = name.replace(/[^\w.\-一-龥]/g, '_');
      const key = attachment.attachmentId ?? 'url';
      const target = `${FileSystem.cacheDirectory ?? ''}show-file-${key}-${safe}`;
      const dl = await FileSystem.downloadAsync(sourceUrl, target, { headers: sourceHeaders });
      if (dl.status === 410) throw new Error('文件已过期，请先续期');
      if (dl.status < 200 || dl.status >= 300) throw new Error(`下载失败（${dl.status}）`);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, { mimeType: attachment.mimeType || undefined, dialogTitle: name });
      } else {
        setError(`已下载到：${dl.uri}`);
      }
    } catch (e) {
      setError((e as Error)?.message || '打开文件失败');
    } finally {
      setBusy('idle');
    }
  };

  const renew = async () => {
    if (busy !== 'idle' || purged || attachment.attachmentId == null) return;
    setBusy('renewing');
    setError('');
    try {
      const meta = await renewAttachment(attachment.attachmentId);
      setStatus(meta.status ?? 'active');
      setExpiresAt(meta.expires_at ?? expiresAt);
    } catch (e) {
      setError((e as Error)?.message || '续期失败');
    } finally {
      setBusy('idle');
    }
  };

  if (isImage && sourceUrl && !purged && !expired) {
    return (
      <View style={{ maxWidth: '100%' }}>
        <Pressable onPress={() => setPreviewOpen(true)} onLongPress={() => onCopy?.(sourceUrl)} style={{ maxWidth: '100%' }}>
          <Image
            source={{ uri: sourceUrl, headers: sourceHeaders }}
            resizeMode="contain"
            style={{ width: '100%', height: 280, borderRadius: 10, backgroundColor: t.bg3 }}
          />
        </Pressable>
        {error ? <Text style={{ fontSize: 11, color: t.red, marginTop: 4 }}>{error}</Text> : null}
        {/* 点击图片 → 全屏预览（与 Web 的 lightbox 一致）；下载/分享动作收进预览页，
            不再在点击时直接走 expo-file-system（Web 上该 API 不存在）。 */}
        <Modal visible={previewOpen} transparent animationType="fade" onRequestClose={() => setPreviewOpen(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 46, paddingBottom: 10, paddingHorizontal: 16 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{name}</Text>
              </View>
              <Pressable
                onPress={() => { if (Platform.OS === 'web') webDownload(sourceUrl, name); else void open(); }}
                hitSlop={8}
                accessibilityLabel={Platform.OS === 'web' ? '下载图片' : '保存图片'}
                style={{ padding: 6 }}
              >
                <Icons.download size={20} color="#fff" sw={2} />
              </Pressable>
              <Pressable onPress={() => setPreviewOpen(false)} hitSlop={8} accessibilityLabel="关闭预览" style={{ padding: 6 }}>
                <Icons.x size={20} color="#fff" sw={2} />
              </Pressable>
            </View>
            <Pressable style={{ flex: 1 }} onPress={() => setPreviewOpen(false)}>
              <Image
                source={{ uri: sourceUrl, headers: sourceHeaders }}
                resizeMode="contain"
                style={{ flex: 1 }}
              />
            </Pressable>
          </View>
        </Modal>
      </View>
    );
  }

  const meta = [formatFileSize(attachment.size), attachment.mimeType].filter(Boolean).join(' · ');
  const expiryLabel = purged ? '已清理' : expired ? '已过期' : expiresAt ? `有效至 ${formatExpiry(expiresAt)}` : '';

  return (
    <View style={{ backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line, borderRadius: 13, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 44, height: 44, borderRadius: 9, backgroundColor: t.bg4, alignItems: 'center', justifyContent: 'center' }}>
        <Icons.file size={19} color={purged || expired ? t.tx3 : t.acTx} sw={1.8} />
      </View>
      <Pressable onLongPress={() => onCopy?.(sourceUrl || name)} style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '600', color: purged ? t.tx3 : t.tx }}>{name}</Text>
        <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx3, marginTop: 2 }}>
          {meta || (attachment.url ? '网络文件' : '未知大小')}{(meta || attachment.url) && expiryLabel ? ' · ' : ''}
          {expiryLabel ? <Text style={{ color: expired || purged ? t.amber : t.tx3 }}>{expiryLabel}</Text> : null}
        </Text>
        {error ? <Text style={{ fontSize: 11, color: t.red, marginTop: 2 }}>{error}</Text> : null}
      </Pressable>
      {busy !== 'idle' ? (
        <Spinner size={17} color={t.acTx} sw={2} />
      ) : expired && !purged && attachment.attachmentId != null ? (
        <Pressable onPress={renew} hitSlop={8} style={{ padding: 4 }}>
          <Icons.refresh size={17} color={t.amber} sw={2} />
        </Pressable>
      ) : purged || !sourceUrl ? null : (
        <Pressable onPress={open} hitSlop={8} style={{ padding: 4 }}>
          <Icons.download size={18} color={t.acTx} sw={2} />
        </Pressable>
      )}
    </View>
  );
}

function SubagentBlock({ message, t }: { message: Extract<ChatMessage, { kind: 'subagent' }>; t: Theme }) {
  const [open, setOpen] = useState(false);
  const running = message.status === 'running';
  return (
    <View style={{ backgroundColor: t.bg2, borderWidth: 1, borderColor: running ? t.acLine : t.line, borderRadius: 13, overflow: 'hidden' }}>
      <Pressable onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
        <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}>
          <Icons.brain size={15} color={t.acTx} sw={1.9} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: t.tx, fontSize: 13.5, fontWeight: '700' }}>{message.name || '子 Agent'}</Text>
          {message.task ? <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11.5, marginTop: 2 }}>{message.task}</Text> : null}
        </View>
        {running ? <Spinner size={15} color={t.acTx} sw={2} /> : <Icons.check size={16} color={t.add} sw={2.3} />}
        <Icons.chevron size={13} color={t.tx3} sw={2} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
      </Pressable>
      {open ? (
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line, padding: 12, gap: 8 }}>
          {message.text ? <Text style={{ color: t.tx2, fontSize: 13, lineHeight: 19 }}>{message.text}</Text> : null}
          {message.summary ? <Text style={{ color: t.tx, fontSize: 13, lineHeight: 19, fontWeight: '600' }}>总结：{message.summary}</Text> : null}
          {message.tools?.length ? (
            <View style={{ gap: 5 }}>
              {message.tools.map((tool, i) => (
                <View key={`${tool.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {tool.status === 'done' ? <Icons.check size={12} color={t.add} sw={2.2} /> : <Spinner size={12} color={t.acTx} sw={2} />}
                  <Text style={{ color: t.tx3, fontSize: 11.5, fontFamily: 'monospace' }}>{tool.name}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {!message.text && !message.summary && !message.tools?.length ? <Text style={{ color: t.tx3, fontSize: 12 }}>子 Agent 正在工作…</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function ApprovalBlock({ message, t, onResolve }: { message: Extract<ChatMessage, { kind: 'approval' }>; t: Theme; onResolve?: (approvalId: string, result: 'allow' | 'deny') => void }) {
  const [now, setNow] = useState(Date.now());
  const expiredByClock = !!message.expiresAt && message.expiresAt <= now;
  const state = expiredByClock && message.state === 'pending' ? 'expired' : message.state;

  useEffect(() => {
    if (!message.expiresAt || message.state !== 'pending') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [message.expiresAt, message.state]);

  const remaining = message.expiresAt ? Math.max(0, Math.ceil((message.expiresAt - now) / 1000)) : 0;
  const remainingLabel = remaining > 0
    ? remaining >= 3600 ? `${Math.floor(remaining / 3600)}小时 ${Math.floor((remaining % 3600) / 60)}分后过期`
      : remaining >= 60 ? `${Math.floor(remaining / 60)}分 ${remaining % 60}秒后过期`
        : `${remaining}秒后过期`
    : '';
  const pending = state === 'pending';
  const submitting = state === 'submitting';
  const stateText = state === 'allowed' ? '已允许' : state === 'denied' ? '已拒绝' : state === 'expired' ? '已过期' : state === 'interrupted' ? '审批已中断' : submitting ? '提交中…' : remainingLabel;
  const stateColor = state === 'allowed' ? t.add : state === 'denied' || state === 'expired' ? t.red : state === 'interrupted' ? t.amber : t.tx3;
  const commands = message.commands?.length ? message.commands : ['（命令内容为空）'];

  return (
    <View style={{ backgroundColor: t.amberGhost, borderWidth: 1, borderColor: pending || submitting ? t.amber : t.line, borderRadius: 14, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 9 }}>
        <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: t.bg2, alignItems: 'center', justifyContent: 'center' }}>
          <Icons.terminal size={15} color={pending ? t.amber : stateColor} sw={2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: t.tx, fontSize: 13.5, fontWeight: '700' }}>需要命令审批</Text>
          <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 10.5, marginTop: 2 }}>{message.toolName || 'node_shell_exec'}{message.nodeId ? ` · ${message.nodeId}` : ''}</Text>
        </View>
        {submitting ? <ActivityIndicator size="small" color={t.amber} /> : <Text style={{ color: stateColor, fontSize: 11.5, fontWeight: '700' }}>{stateText}</Text>}
      </View>
      {message.message ? <Text style={{ color: t.tx2, fontSize: 12.5, lineHeight: 18, paddingHorizontal: 13, paddingBottom: 8 }}>{message.message}</Text> : null}
      <View style={{ backgroundColor: t.termBg, marginHorizontal: 10, borderRadius: 10, padding: 10, gap: 6 }}>
        {commands.map((command, index) => <Text key={`${index}-${command}`} selectable style={{ color: t.termTx, fontFamily: 'monospace', fontSize: 11.5, lineHeight: 17 }}>$ {command}</Text>)}
      </View>
      {pending && onResolve ? (
        <View style={{ flexDirection: 'row', gap: 8, padding: 10 }}>
          <Pressable onPress={() => onResolve(message.approvalId, 'deny')} style={({ pressed }) => [{ flex: 1, height: 40, borderRadius: 11, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.red, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.65 }]}>
            <Text style={{ color: t.red, fontSize: 13, fontWeight: '700' }}>拒绝</Text>
          </Pressable>
          <Pressable onPress={() => onResolve(message.approvalId, 'allow')} style={({ pressed }) => [{ flex: 1, height: 40, borderRadius: 11, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.65 }]}>
            <Text style={{ color: t.acInk, fontSize: 13, fontWeight: '700' }}>允许执行</Text>
          </Pressable>
        </View>
      ) : <View style={{ height: 10 }} />}
    </View>
  );
}

function StreamBlockBase({ message, canAnswer, answerSubmitState, isStreaming, onAnswer, onCopy, onSaveImage, onResolveApproval, onRetry, retryBusy }: { message: ChatMessage; canAnswer?: boolean; answerSubmitState?: AnswerSubmitState; isStreaming?: boolean; onAnswer?: (askId: string, answers: AnswerMap) => AnswerSubmitResult; onCopy?: (text: string) => void; onSaveImage?: (url: string) => void; onResolveApproval?: (approvalId: string, result: 'allow' | 'deny') => void; onRetry?: () => void; retryBusy?: boolean }) {
  const t = useTheme();
  switch (message.kind) {
    case 'user': {
      const atts = message.attachments ?? [];
      return (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => Keyboard.dismiss()} onLongPress={() => onCopy?.(message.text)} style={{ maxWidth: '84%', backgroundColor: t.acGhost, borderWidth: 1, borderColor: t.acLine, borderRadius: 16, borderBottomRightRadius: 5, paddingHorizontal: 14, paddingVertical: 10 }}>
            {atts.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, marginBottom: message.text ? 8 : 0 }}>
                {atts.map((a, i) => {
                  const uri = resolveAssetUrl(a.url);
                  return (
                    <Pressable key={i} onPress={() => uri && onSaveImage?.(uri)}>
                      <Image source={{ uri }} resizeMode="cover" style={{ width: 116, height: 116, borderRadius: 10, backgroundColor: t.bg3 }} />
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {message.text ? <Text style={{ color: t.tx, fontSize: 14.5, lineHeight: 21 }}>{message.text}</Text> : null}
          </Pressable>
        </View>
      );
    }
    case 'agent':
      return <AgentMarkdown text={message.text} isStreaming={isStreaming} t={t} onCopy={onCopy} onSaveImage={onSaveImage} />;
    case 'attachment':
      return <AttachmentBlock attachment={message.attachment} t={t} onCopy={onCopy} />;
    case 'thought':
      return <ThoughtBlock text={message.text} t={t} onCopy={onCopy} />;
    case 'tool':
      return <ToolCard msg={message} t={t} onCopy={onCopy} />;
    case 'error':
      return <ErrorBlock text={message.text} t={t} onCopy={onCopy} onRetry={onRetry} retryBusy={retryBusy} />;
    case 'system':
      return <Text style={{ color: t.tx3, fontSize: 12, textAlign: 'center', paddingHorizontal: 12 }}>{message.text}</Text>;
    case 'ask':
      return <AskBlock askId={message.askId} status={message.status} questions={message.questions} canAnswer={!!canAnswer && message.status === 'pending'} answerSubmitState={answerSubmitState} onAnswer={onAnswer} t={t} />;
    case 'approval':
      return <ApprovalBlock message={message} t={t} onResolve={onResolveApproval} />;
    case 'subagent':
      return <SubagentBlock message={message} t={t} />;
    default:
      return null;
  }
}

// 按内容比较：流式更新时消息数组会整体重建，只有真正变化的消息（通常是最后一条）才重渲染，
// 其余 Markdown 块不再反复解析/测量 —— 避免列表中间空白与高度跳动。
type MsgCmp = { id?: string; kind?: string; text?: string; title?: string; status?: string; state?: string; questions?: unknown; attachment?: AgentAttachment; name?: string; task?: string; summary?: string; tools?: unknown };
export const StreamBlock = React.memo(StreamBlockBase, (a, b) => {
  const m = a.message as MsgCmp;
  const n = b.message as MsgCmp;
  if (m.kind === 'ask' && (a.canAnswer !== b.canAnswer || a.answerSubmitState !== b.answerSubmitState || a.onAnswer !== b.onAnswer)) return false;
  if (m.kind === 'approval' && a.onResolveApproval !== b.onResolveApproval) return false;
  if (m.kind === 'agent' && a.isStreaming !== b.isStreaming) return false;
  if (a.onCopy !== b.onCopy || a.onSaveImage !== b.onSaveImage) return false;
  if (m.kind === 'error' && (a.onRetry !== b.onRetry || a.retryBusy !== b.retryBusy)) return false;
  if (m.kind === 'subagent') {
    // 子 Agent 卡是聚合视图：tools 数组每次重建（引用必不等），按内容串比，避免遗漏状态推进。
    return (
      m.id === n.id &&
      m.kind === n.kind &&
      m.text === n.text &&
      m.status === n.status &&
      m.name === n.name &&
      m.task === n.task &&
      m.summary === n.summary &&
      JSON.stringify(m.tools) === JSON.stringify(n.tools)
    );
  }
  return (
    m.id === n.id &&
    m.kind === n.kind &&
    m.text === n.text &&
    m.title === n.title &&
    m.status === n.status &&
    m.state === n.state &&
    m.questions === n.questions &&
    m.attachment === n.attachment
  );
});

function AskBlock({ askId, status, questions, canAnswer, answerSubmitState, onAnswer, t }: { askId: string; status: string; questions: AskQuestion[]; canAnswer: boolean; answerSubmitState?: AnswerSubmitState; onAnswer?: (askId: string, answers: AnswerMap) => AnswerSubmitResult; t: Theme }) {
  const [selected, setSelected] = useState<Record<number, Set<string>>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});
  const [submitState, setSubmitState] = useState<'idle' | AnswerSubmitState>('idle');

  useEffect(() => {
    setSelected({});
    setCustomAnswers({});
    setSubmitState('idle');
  }, [askId]);

  useEffect(() => {
    if (answerSubmitState) setSubmitState(answerSubmitState);
  }, [answerSubmitState, askId]);

  const toggle = (qi: number, label: string, multi: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      const set = new Set(next[qi] ?? []);
      if (multi) {
        if (set.has(label)) set.delete(label);
        else set.add(label);
      }
      else { set.clear(); set.add(label); }
      next[qi] = set;
      return next;
    });
  };

  const submit = () => {
    if (!onAnswer) return;
    const answers = buildAskAnswers(questions, selected, customAnswers);
    if (!answers) return;
    const result = onAnswer(askId, answers);
    if (result !== 'rejected') setSubmitState(result);
  };

  const interactive = canAnswer && submitState === 'idle';
  const answered = status === 'completed';
  const expired = status === 'expired' || status === 'failed';
  const statusLabel = answered ? '已回答' : expired ? '问题已过期' : null;
  const canSubmit = interactive && buildAskAnswers(questions, selected, customAnswers) !== null;

  return (
    <View style={{ backgroundColor: t.bg2, borderWidth: 1, borderColor: expired ? t.line : t.acLine, borderRadius: 13, padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {expired ? <Icons.alert size={15} color={t.tx3} sw={1.8} /> : <Icons.sparkle size={15} color={t.acTx} sw={1.8} />}
        <Text style={{ color: expired ? t.tx3 : t.acTx, fontSize: 13.5, fontWeight: '700', flex: 1 }}>AI 提问</Text>
        {statusLabel ? <Text style={{ color: t.tx3, fontSize: 11.5 }}>{statusLabel}</Text> : null}
      </View>
      {questions.map((q, qi) => (
        <View key={qi} style={{ gap: 4 }}>
          {q.header ? <Text style={{ color: t.tx3, fontSize: 11.5, fontWeight: '600' }}>{q.header}</Text> : null}
          <Text style={{ color: t.tx, fontSize: 13.5, lineHeight: 20 }}>{q.question}</Text>
          <View style={{ gap: 6, marginTop: 4 }}>
            {q.options.map((opt) => {
              const isSel = answered
                ? Array.isArray(q.answer) ? q.answer.includes(opt.label) : q.answer === opt.label
                : (selected[qi]?.has(opt.label) ?? false);
              return (
                <Pressable key={opt.label} disabled={!interactive} onPress={() => toggle(qi, opt.label, q.multiSelect)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: isSel ? t.ac : t.line, backgroundColor: isSel ? t.acGhost : 'transparent', borderRadius: 11, paddingHorizontal: 11, paddingVertical: 10 }}>
                  {q.multiSelect
                    ? <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: isSel ? t.ac : t.line2, backgroundColor: isSel ? t.ac : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{isSel ? <Icons.check size={12} color={t.acInk} sw={3} /> : null}</View>
                    : <View style={{ width: 18, height: 18, borderRadius: 99, borderWidth: 1.5, borderColor: isSel ? t.ac : t.line2, alignItems: 'center', justifyContent: 'center' }}>{isSel ? <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: t.ac }} /> : null}</View>}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: isSel ? t.tx : t.tx2, fontSize: 13.5, fontWeight: isSel ? '600' : '400' }}>{opt.label}</Text>
                    {opt.description ? <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 2 }}>{opt.description}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
            {(() => {
              const optionLabels = new Set(q.options.map((opt) => opt.label));
              const recordedAnswers = Array.isArray(q.answer) ? q.answer : q.answer ? [q.answer] : [];
              const recordedCustom = recordedAnswers.find((answer) => !optionLabels.has(answer));
              const customSelected = answered ? !!recordedCustom : (selected[qi]?.has(CUSTOM_ANSWER_KEY) ?? false);
              if (!interactive && !recordedCustom) return null;
              return (
                <View style={{ gap: 6 }}>
                  <Pressable disabled={!interactive} onPress={() => toggle(qi, CUSTOM_ANSWER_KEY, q.multiSelect)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: customSelected ? t.ac : t.line, backgroundColor: customSelected ? t.acGhost : 'transparent', borderRadius: 11, paddingHorizontal: 11, paddingVertical: 10 }}>
                    {q.multiSelect
                      ? <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: customSelected ? t.ac : t.line2, backgroundColor: customSelected ? t.ac : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{customSelected ? <Icons.check size={12} color={t.acInk} sw={3} /> : null}</View>
                      : <View style={{ width: 18, height: 18, borderRadius: 99, borderWidth: 1.5, borderColor: customSelected ? t.ac : t.line2, alignItems: 'center', justifyContent: 'center' }}>{customSelected ? <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: t.ac }} /> : null}</View>}
                    <Text style={{ flex: 1, color: customSelected ? t.tx : t.tx2, fontSize: 13.5, fontWeight: customSelected ? '600' : '400' }}>其他</Text>
                  </Pressable>
                  {interactive && customSelected ? (
                    <TextInput
                      value={customAnswers[qi] ?? ''}
                      onChangeText={(value) => setCustomAnswers((prev) => ({ ...prev, [qi]: value }))}
                      placeholder="请输入回答"
                      placeholderTextColor={t.tx3}
                      autoFocus
                      style={{ minHeight: 42, borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, color: t.tx, fontSize: 13.5 }}
                    />
                  ) : recordedCustom ? (
                    <Text style={{ color: t.tx2, fontSize: 12.5, lineHeight: 18, paddingHorizontal: 4 }}>{recordedCustom}</Text>
                  ) : null}
                </View>
              );
            })()}
          </View>
        </View>
      ))}
      {interactive ? (
        <Pressable disabled={!canSubmit} onPress={submit} style={{ backgroundColor: t.ac, borderRadius: 12, paddingVertical: 11, alignItems: 'center', marginTop: 2, opacity: canSubmit ? 1 : 0.45 }}>
          <Text style={{ color: t.acInk, fontSize: 14, fontWeight: '700' }}>提交回答</Text>
        </Pressable>
      ) : expired ? (
        <Text style={{ color: t.tx3, fontSize: 11.5, fontStyle: 'italic' }}>问题已过期（可在下方直接输入消息）</Text>
      ) : !answered && submitState === 'queued' ? (
        <Text style={{ color: t.amber, fontSize: 11.5 }}>网络恢复后将自动发送回答</Text>
      ) : !answered && submitState === 'sent' ? (
        <Text style={{ color: t.tx3, fontSize: 11.5 }}>回答已发送，等待处理</Text>
      ) : !answered && status !== 'pending' ? (
        <Text style={{ color: t.tx3, fontSize: 11.5, fontStyle: 'italic' }}>该提问已失效（可在下方直接输入消息）</Text>
      ) : null}
    </View>
  );
}
