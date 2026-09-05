/**
 * 任务事件流解码：把运行时帧翻译成「对话条目 + 运行状态」两类结果。
 *
 * 与 Web editor-session-stream-client / item-to-message 同一套语义：
 * - 运行时帧分两族。`agent_event` 里携带标准化 item 的才是对话内容；
 *   `agent_turn_started` / `agent_turn_completed` / `usage_update` / `llm_call_retry`
 *   / `compact_status` / `confirmation_*` 是会话遥测，只驱动 UI 状态。
 * - 无法识别的帧一律丢弃。之前把认不出的帧 `JSON.stringify` 当消息渲染，
 *   于是 `agent_turn_started` 这种生命周期帧会以整段 JSON 出现在对话里，
 *   刷新后又因为历史只回放标准化 item 而消失。
 * - 工具标题取运行时给的工具名（Claude runner 已把工具名写进 `title`），
 *   Codex 系的 command_execution / mcp_tool_call / web_search 各有自己的取名规则。
 */
import type { ChatMessage } from '@/messages/handler';

/** 能进入对话流的标准化条目类型，与 node_server/task_event_log.py 的白名单一致。 */
const RENDERABLE_ITEM_TYPES = new Set([
  'user_input',
  'agent_message',
  'reasoning',
  'thinking',
  'tool_call',
  'command_execution',
  'mcp_tool_call',
  'file_change',
  'web_search',
  'error',
]);

const TOOL_ITEM_TYPES = new Set(['tool_call', 'command_execution', 'mcp_tool_call', 'file_change', 'web_search']);
const TEXT_ITEM_TYPES = new Set(['agent_message', 'reasoning', 'thinking']);

export interface DisplayEvent {
  id: string;
  kind: string;
  text: string;
  time: number;
  seq?: number;
  payload?: Record<string, unknown>;
  eventType?: string;
}

export interface TaskEventEffect {
  /** 本轮是否在运行：true=开始/推进，false=结束，undefined=不影响。 */
  running?: boolean;
  /** 轮次收尾：把仍标记 running 的工具卡结算为完成，避免 spinner 永久转。 */
  settleTools?: boolean;
  /** 终态（result/error）：需要回拉任务详情。 */
  terminal?: boolean;
  usage?: { used: number; size: number };
  /** 进入对话流的标准化条目。 */
  item?: Record<string, unknown>;
  /** 系统提示（模型重试、上下文压缩）。 */
  system?: string;
  /** 运行时错误文本。 */
  error?: string;
  /** 折叠进子 Agent 记录的标准化条目（subagent_id 非空，不进主对话）。 */
  subagent?: { id: string; item: Record<string, unknown> };
  /** todo_list 推进的计划条目（与 Web PlanStepsBlock 同源）。 */
  plan?: { content: string; status: string }[];
}

/** 子 Agent 折叠记录：对话流里每个子 Agent 一张可展开卡（复用 StreamBlocks 的 SubagentBlock）。 */
export interface SubagentTool { name: string; status: 'running' | 'done' }
export interface SubagentRecord {
  id: string;
  name: string;
  task: string;
  status: 'running' | 'done';
  /** 流式累积的正文（按标准化条目分段，同条目增长替换该段）。 */
  content: string;
  /** 最近一段正文所属条目 id：同一条目流式增长时替换而不是追加，避免同句叠加。 */
  lastTextItemId?: string;
  tools: SubagentTool[];
  summary?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringField(source: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!source) return '';
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

/** 取出标准化 item，兼容 `{item}` / `{event:{item}}` / `{payload:{event:{item}}}` 等包法。 */
export function normalizedItem(payload?: Record<string, unknown> | null): Record<string, unknown> | null {
  let current: Record<string, unknown> | null = payload ?? null;
  // 网关帧最多是 raw → payload → event → item；限定深度避免异常自引用对象死循环。
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (isRecord(current.item)) return current.item;
    if (isRecord(current.event)) {
      current = current.event;
      continue;
    }
    if (isRecord(current.payload)) {
      current = current.payload;
      continue;
    }
    return null;
  }
  return null;
}

/** 条目正文：直接字段优先，命令执行回退聚合输出，文件变更拼变更清单。 */
export function itemText(item: Record<string, unknown>): string {
  const direct = stringField(item, 'text', 'message', 'content');
  if (direct) return direct;
  const type = String(item.type || '');
  if (type === 'command_execution') return stringField(item, 'aggregated_output', 'output');
  if (type === 'file_change' && Array.isArray(item.changes)) {
    return item.changes
      .map((change) => (isRecord(change) ? `${String(change.kind)}: ${String(change.path)}` : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof item.output === 'string') return item.output;
  if (Array.isArray(item.output)) {
    return item.output
      .map((part) => (typeof part === 'string' ? part : isRecord(part) ? stringField(part, 'text') : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** 工具名：Claude runner 把工具名写进 title；Codex 系按类型各自取名。 */
export function itemTitle(item: Record<string, unknown>): string {
  const explicit = stringField(item, 'title');
  if (explicit) return explicit;
  const type = String(item.type || '');
  if (type === 'command_execution') return stringField(item, 'command') || '命令执行';
  if (type === 'mcp_tool_call') {
    const parts = [stringField(item, 'server'), stringField(item, 'tool')].filter(Boolean);
    return parts.length ? parts.join('/') : 'MCP 调用';
  }
  if (type === 'file_change') return '文件变更';
  if (type === 'web_search') return stringField(item, 'query') || '联网搜索';
  // title 缺失（历史行只回放了稀疏完成帧）时也不把协议类型名当工具名展示。
  return '工具调用';
}

/** 工具名 → 渲染 kind，与 Web kindForTool 一致。 */
export function toolKindFor(title: string, itemType?: string): string {
  switch (title) {
    case 'Read': return 'read';
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit': return 'edit';
    case 'Bash':
    case 'BashOutput': return 'execute';
    case 'Grep':
    case 'Glob': return 'search';
    case 'WebFetch':
    case 'WebSearch': return 'fetch';
    default:
      switch (itemType) {
        case 'command_execution': return 'execute';
        case 'file_change': return 'edit';
        case 'web_search': return 'fetch';
        default: return 'other';
      }
  }
}

function mapToolStatus(status: unknown): 'in_progress' | 'failed' | 'completed' {
  switch (String(status || '')) {
    case 'running':
    case 'pending':
    case 'in_progress': return 'in_progress';
    case 'failed':
    case 'error': return 'failed';
    default: return 'completed';
  }
}

// ── 子 Agent 折叠 ────────────────────────────────────────────────────────────
// 与 Web item-to-message 的 reduceItems / EditorSessionStreamClient 同一套语义：
// subagent_id 是归属的唯一事实（空 = 根对话，非空 = 该子 Agent 的详情），绝不按
// 名称/文本猜。子 Agent 条目折进各自的记录，主对话里每个子 Agent 只留一张卡。

/** 归属 id：帧顶层 / 条目 / payload 里的 subagent_id（含旧字段 agent_id 同义兜底）。 */
export function subagentIdOf(raw: object, item: Record<string, unknown> | null): string {
  const r = isRecord(raw) ? raw : {};
  return (
    stringField(r, 'subagent_id') ||
    stringField(item, 'subagent_id') ||
    (isRecord(r.payload) ? stringField(r.payload, 'subagent_id', 'agent_id') : '') ||
    stringField(item, 'agent_id') ||
    (isRecord(r.payload) && isRecord(r.payload.event) ? stringField(r.payload.event, 'subagent_id', 'agent_id') : '') ||
    ''
  );
}

/** 子 Agent 条目折进记录：文本条目分段累积（同条目流式增长替换），工具按名推进状态。 */
export function foldSubagentItem(prev: SubagentRecord | undefined, item: Record<string, unknown>, id: string): SubagentRecord {
  const name = stringField(item, 'agent_name', 'name') || prev?.name || `子 Agent ${id.slice(0, 8)}`;
  const task = stringField(item, 'task', 'goal') || prev?.task || '';
  const type = String(item.type || '').toLowerCase();
  const itemId = String(item.id || '');
  const base: SubagentRecord = prev
    ? { ...prev, name, task, status: 'running' }
    : { id, name, task, status: 'running', content: '', tools: [] };
  if (TEXT_ITEM_TYPES.has(type)) {
    const text = itemText(item);
    if (!text) return base;
    if (itemId && base.lastTextItemId === itemId) {
      // 同一条目流式增长：替换最后一段，而不是把同一句叠加。
      const cut = base.content.lastIndexOf('\n');
      base.content = cut === -1 ? text : `${base.content.slice(0, cut)}\n${text}`;
    } else {
      base.content = base.content ? `${base.content}\n${text}` : text;
    }
    if (itemId) base.lastTextItemId = itemId;
  } else if (TOOL_ITEM_TYPES.has(type)) {
    const toolName = itemTitle(item);
    const done = mapToolStatus(item.status) === 'completed';
    const tools = base.tools.slice();
    let runningIdx = -1;
    for (let i = tools.length - 1; i >= 0; i -= 1) {
      if (tools[i].name === toolName && tools[i].status === 'running') { runningIdx = i; break; }
    }
    if (done) {
      if (runningIdx >= 0) tools[runningIdx] = { name: toolName, status: 'done' };
      else tools.push({ name: toolName, status: 'done' });
    } else if (runningIdx < 0) {
      // 新一次调用：同名的已完成条目不复活，追加一条在跑的。
      tools.push({ name: toolName, status: 'running' });
    }
    base.tools = tools;
  } else if (type === 'error') {
    const text = itemText(item) || '运行时报告错误';
    base.content = base.content ? `${base.content}\n${text}` : text;
  }
  return base;
}

/** 历史与实时各自按条目累积，同一子 Agent 的两份记录可能互为子集：内容取更完整的一边，工具按名合并（done 优先）。 */
export function mergeSubagentRecord(prev: SubagentRecord, next: SubagentRecord): SubagentRecord {
  const tools: SubagentTool[] = [];
  for (const tool of [...prev.tools, ...next.tools]) {
    const idx = tools.findIndex((candidate) => candidate.name === tool.name);
    if (idx === -1) tools.push({ ...tool });
    else if (tool.status === 'done') tools[idx] = { ...tool, status: 'done' };
  }
  const nextFresher = next.content.length >= prev.content.length;
  return {
    id: prev.id,
    name: next.name || prev.name,
    task: next.task || prev.task,
    status: prev.status === 'running' || next.status === 'running' ? 'running' : 'done',
    content: nextFresher ? next.content : prev.content,
    lastTextItemId: nextFresher ? next.lastTextItemId : prev.lastTextItemId,
    tools,
    summary: next.summary || prev.summary,
  };
}

function subagentRecordOf(event: DisplayEvent): SubagentRecord | null {
  if (!isRecord(event.payload) || !isRecord(event.payload.subagent)) return null;
  return event.payload.subagent as unknown as SubagentRecord;
}

/** 标准化条目 → 对话消息；不该内联渲染的条目返回 null（不再兜底成 JSON）。 */
export function itemToMessage(item: Record<string, unknown>, fallbackId: string, time = 0): ChatMessage | null {
  const type = String(item.type || '').toLowerCase();
  const id = String(item.id || fallbackId);
  const text = itemText(item);
  if (!RENDERABLE_ITEM_TYPES.has(type)) return null;
  if (type === 'user_input') return text ? { id, kind: 'user', text, time } : null;
  if (type === 'error') return { id, kind: 'error', text: text || '运行时报告错误', time };
  if (type === 'reasoning' || type === 'thinking') return text ? { id, kind: 'thought', text, time } : null;
  if (type === 'agent_message') return text ? { id, kind: 'agent', text, time } : null;
  if (TOOL_ITEM_TYPES.has(type)) {
    const title = itemTitle(item);
    return {
      id,
      kind: 'tool',
      title,
      toolKind: toolKindFor(title, type),
      status: mapToolStatus(item.status),
      rawInput: item.input ?? item.arguments ?? item,
      rawOutput: item.output ?? item.result,
      content: text,
      time,
    };
  }
  return null;
}

function usageFrom(source: Record<string, unknown> | null | undefined): { used: number; size: number } | null {
  if (!source) return null;
  const size = Number(source.context_window ?? source.max_context ?? source.window ?? source.size ?? source.context_size ?? NaN);
  const used = Number(source.used ?? source.total_tokens ?? source.tokens ?? source.input_tokens ?? NaN);
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(used)) return null;
  return { used: Math.max(0, used), size };
}

function retryText(body: Record<string, unknown>): string {
  const info = isRecord(body.retry) ? body.retry : body;
  const delayMs = Number(info.delay_ms ?? info.delayMs ?? 0) || 0;
  const seconds = Math.max(1, Math.round(delayMs / 1000));
  const attempt = Number(info.attempt ?? 0) || 0;
  const max = Number(info.max ?? info.max_attempts ?? 0) || 0;
  const status = stringField(info, 'status');
  const message = stringField(info, 'message', 'detail');
  const attemptLabel = max > 0 ? `${attempt}/${max}` : String(attempt || 1);
  return `${status ? `${status} ` : ''}模型调用失败，${seconds} 秒后重试（第 ${attemptLabel} 次）${message ? `：${message}` : ''}`;
}

function errorText(raw: Record<string, unknown>): string {
  const direct = stringField(raw, 'error', 'message', 'detail', 'text');
  if (direct) return direct;
  const body = isRecord(raw.payload) ? raw.payload : {};
  const nested = stringField(body, 'message', 'error', 'detail');
  if (nested) return nested;
  const inner = isRecord(body.error) ? body.error : isRecord(body.event) ? body.event : null;
  return stringField(inner, 'message', 'detail') || '运行时报告错误';
}

/**
 * 解码一帧实时事件。
 *
 * 返回的 effect 只描述「该帧意味着什么」，副作用由调用方施加，便于单测。
 */
export function classifyTaskEvent(raw: Record<string, unknown>): TaskEventEffect {
  const kind = String(raw.kind || '').toLowerCase();
  const type = String(raw.event_type || '').toLowerCase();

  // 原始 stdio：结构化事件已经渲染过了，这里是噪音。
  if (kind === 'output' || kind === 'stdout' || kind === 'stderr' || kind === 'command') return {};
  if (kind === 'started' || type === 'started') return { running: true };
  if (kind === 'result' || type === 'result') return { running: false, settleTools: true, terminal: true };
  if (kind === 'error' || type === 'error') {
    // 运行时错误既要停轮次，也要在对话里留一条可重试的错误卡。
    const text = errorText(raw);
    const item = normalizedItem(raw);
    return {
      running: false,
      settleTools: true,
      terminal: true,
      error: text,
      item: item && String(item.type || '') === 'error' ? item : { id: `error-${raw.seq ?? ''}`, type: 'error', text },
    };
  }
  if (type === 'agent_turn_started') return { running: true };
  if (type === 'agent_turn_completed') return { running: false, settleTools: true };
  // input_status 是 runtime 对用户消息的 ACK：cancelled/failed 意味着本轮结束；
  // received 只是「已收到」，不推进「正在处理」（那是 agent_turn_started 的事）。
  if (type === 'input_status') {
    const status = stringField(isRecord(raw.payload) ? raw.payload : null, 'status', 'state');
    if (status === 'cancelled' || status === 'failed') return { running: false, settleTools: true };
    return {};
  }
  // 审批在任务面板由审批卡单独处理，这里不进对话流。
  if (type.startsWith('confirmation_')) return {};

  const body = isRecord(raw.payload) ? raw.payload : {};
  const inner = isRecord(body.event) ? body.event : body;

  if (type === 'usage_update') {
    const usage = usageFrom(isRecord(inner.usage) ? inner.usage : inner);
    return usage ? { usage } : {};
  }
  if (type === 'llm_call_retry') return { system: retryText(inner) };
  if (type === 'compact_status') {
    const state = stringField(inner, 'status', 'state');
    if (state === 'started') return { system: '上下文接近上限，正在压缩会话…' };
    if (state === 'completed' || state === 'done') return { system: '会话上下文已压缩' };
    return {};
  }

  const item = normalizedItem(raw);
  if (!item) return {};
  const itemType = String(item.type || raw.item_type || '').toLowerCase();
  // todo 列表驱动计划条（与 Web PlanStepsBlock 同源），不进消息流。
  if (itemType === 'todo_list') {
    if (!Array.isArray(item.items)) return {};
    const entries = (item.items as unknown[])
      .filter(isRecord)
      .map((entry) => ({ content: stringField(entry, 'content', 'text'), status: stringField(entry, 'status') || 'pending' }))
      .filter((entry) => entry.content);
    return entries.length ? { plan: entries } : {};
  }
  // 子 Agent 隔离的唯一事实是 subagent_id：空 = 根（主对话），非空 = 该子
  // Agent 的专属详情（含旧字段 agent_id 同义兜底）。子 Agent 条目折进各自的卡，
  // 不混入主对话——绝不按名称/文本猜。
  const subagentId = subagentIdOf(raw, item);
  if (subagentId) {
    if (!RENDERABLE_ITEM_TYPES.has(itemType)) return { running: true };
    return { running: true, subagent: { id: subagentId, item } };
  }
  if (!RENDERABLE_ITEM_TYPES.has(itemType)) {
    // 认不出的条目类型丢弃：宁可少显示一条，也不把原始帧倒进对话。
    return { running: true };
  }
  const usage = usageFrom(isRecord(item.usage) ? item.usage : isRecord(inner.usage) ? inner.usage : null);
  const effect: TaskEventEffect = { item: { ...item, type: itemType }, running: itemType !== 'error' };
  if (itemType === 'error') {
    effect.running = false;
    effect.settleTools = true;
    effect.terminal = true;
  }
  if (usage) effect.usage = usage;
  return effect;
}

/** 后续报告只覆盖它真正携带的字段：完成帧稀疏，盲覆盖会抹掉开始帧的 title/input。 */
export function mergeNormalizedItem(previous: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && !value) continue;
    merged[key] = value;
  }
  return merged;
}

export function eventLogicalId(event: DisplayEvent): string {
  const sub = subagentRecordOf(event);
  if (sub?.id) return `subagent:${sub.id}`;
  const item = normalizedItem(event.payload);
  const itemId = String(item?.id || '').trim();
  return itemId ? `item:${itemId}` : event.seq != null ? `seq:${event.seq}` : event.id;
}

function mergeDisplayEvent(previous: DisplayEvent, next: DisplayEvent): DisplayEvent {
  const prevSub = subagentRecordOf(previous);
  const nextSub = subagentRecordOf(next);
  if (prevSub && nextSub) {
    return { ...previous, ...next, payload: { subagent: mergeSubagentRecord(prevSub, nextSub) } };
  }
  const prevItem = normalizedItem(previous.payload);
  const nextItem = normalizedItem(next.payload);
  if (!prevItem || !nextItem) return { ...previous, ...next };
  const item = mergeNormalizedItem(prevItem, nextItem);
  return { ...previous, ...next, payload: { item }, text: itemText(item) || next.text || previous.text };
}

/** 历史与实时按 item id 归一：同一条目只保留一份，完成帧原地合并。 */
export function mergeEventLists(first: DisplayEvent[], second: DisplayEvent[]): DisplayEvent[] {
  const out: DisplayEvent[] = [];
  const index = new Map<string, number>();
  for (const event of [...first, ...second]) {
    const key = eventLogicalId(event);
    const existing = index.get(key);
    if (existing == null) {
      index.set(key, out.length);
      out.push(event);
    } else {
      out[existing] = mergeDisplayEvent(out[existing], event);
    }
  }
  return out;
}

/** 轮次结束时把仍在运行的工具条目与子 Agent 结算掉，避免 spinner 永久转。 */
export function settleRunningTools(events: DisplayEvent[]): DisplayEvent[] {
  let changed = false;
  const next = events.map((event) => {
    const sub = subagentRecordOf(event);
    if (sub) {
      // 轮次已结束：子 Agent 不可能还在跑（与 Web agent_turn_completed 的收尾一致）。
      if (sub.status !== 'running' && !sub.tools.some((tool) => tool.status === 'running')) return event;
      changed = true;
      return {
        ...event,
        payload: {
          subagent: {
            ...sub,
            status: 'done' as const,
            tools: sub.tools.map((tool) => (tool.status === 'running' ? { ...tool, status: 'done' as const } : tool)),
          },
        },
      };
    }
    const item = normalizedItem(event.payload);
    if (!item || !TOOL_ITEM_TYPES.has(String(item.type || ''))) return event;
    const status = String(item.status || '');
    if (status !== 'running' && status !== 'pending' && status !== 'in_progress') return event;
    changed = true;
    return { ...event, payload: { item: { ...item, status: 'done' } } };
  });
  return changed ? next : events;
}

/** 一次失败常以两条形态到达对话流：provider 先把上游错误文本当普通 assistant
 * 消息回显，运行时自己的错误帧随后重复一遍；历史回放又可能再给一份孪生。
 * 全部渲染就成了「一条普通气泡 + 一张重试错误卡」（Web 同款问题）。这里折
 * 叠成一张：同轮次内文本相同的普通气泡被原位升级成错误卡（卡片自带重试），
 * 后续同文本的错误帧被丢弃。逐轮重置——新一轮用户消息之后的错误与上一轮无关。
 * 与 Web collapseErrorDuplicates 同构，纯函数便于在渲染出口统一套用。 */
export function collapseErrorEvents(events: DisplayEvent[]): DisplayEvent[] {
  const seen = new Set<string>();
  const out: DisplayEvent[] = [];
  let turnStart = 0;
  for (const event of events) {
    const message = displayMessage(event);
    if (message?.kind === 'user') {
      seen.clear();
      turnStart = out.length;
      out.push(event);
      continue;
    }
    if (message?.kind !== 'error') {
      out.push(event);
      continue;
    }
    const text = String(message.text || '');
    if (!text) {
      out.push(event);
      continue;
    }
    // 同轮次里已有同文本的普通气泡：原位升级成错误卡（位置不变，卡片带重试）。
    let bubbleIndex = -1;
    for (let i = turnStart; i < out.length; i += 1) {
      const candidate = displayMessage(out[i]);
      if (candidate?.kind === 'agent' && String(candidate.text || '') === text) { bubbleIndex = i; break; }
    }
    if (bubbleIndex >= 0) {
      out[bubbleIndex] = event;
      seen.add(text);
      continue;
    }
    // 同一次失败已经留过卡片了：丢弃重复帧（实时帧 / 历史孪生）。
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(event);
  }
  return out;
}

/** 历史行里最后一条 todo_list 的条目（rows 按时间正序时即最新计划）；没有则 null。 */
export function planEntriesFromRows(rows: { payload?: Record<string, unknown> }[]): { content: string; status: string }[] | null {  let entries: { content: string; status: string }[] | null = null;
  for (const row of rows) {
    const item = normalizedItem(row.payload);
    if (!item || String(item.type || '').toLowerCase() !== 'todo_list' || !Array.isArray(item.items)) continue;
    const parsed = (item.items as unknown[])
      .filter(isRecord)
      .map((entry) => ({ content: stringField(entry, 'content', 'text'), status: stringField(entry, 'status') || 'pending' }))
      .filter((entry) => entry.content);
    if (parsed.length) entries = parsed;
  }
  return entries;
}

/**
 * 从历史行推断「本轮是否还在跑」。
 *
 * `mc_tasks.status` 是任务级状态：发过消息就停在 processing，直到运行时整个
 * 退出才变 finished/error —— 轮与轮之间不会回 pending，拿它当轮次状态会
 * 让「正在处理/中止本轮」在空闲时也常驻。真正的轮次状态是每条用户消息行上的
 * ``delivery_status``（pending→dispatching→received→running→completed/…），
 * 由 agent_turn_started/completed 帧在控制面推进并持久化，历史接口原样带回。
 * 这里取最近一条带投递状态的用户消息行判定。
 */
const IN_FLIGHT_DELIVERY = new Set(['pending', 'dispatching', 'received', 'running']);

/**
 * 从历史行推断「本轮是否还在跑」。
 *
 * `mc_tasks.status` 是任务级状态：发过消息就停在 processing，直到运行时整个
 * 退出才变 finished/error —— 轮与轮之间不会回 pending，拿它当轮次状态会
 * 让「正在处理/中止本轮」在空闲时也常驻。真正的轮次状态是每条用户消息行上的
 * ``delivery_status``（pending→dispatching→received→running→completed/…），
 * 由 agent_turn_started/completed 帧在控制面推进并持久化，历史接口原样带回。
 *
 * 但只看 `delivery_status` 有一个缺口：provider 侧失败（如模型 429 无可用账号）
 * 时运行时进程未必退出——`task_finalize` 不触发，`delivery_status` 可能永远停
 * 在 `received`，于是页面推不出「这一轮已死」，常驻「Agent 正在处理」+ 假中止。
 * 兜底：如果最近一轮（最近一条 user_input 之后）已经出现过 error 事件，就视
 * 为该轮已结束——和实时路径 `classifyTaskEvent` 对 error 帧返回 running:false
 * 同一套语义。历史回放不重放 agent_turn_* 生命周期帧，所以这个信号只能从 item
 * 流本身读。
 */
export function turnRunningFromHistory(rows: { delivery_status?: string | null; event_type?: string | null; payload?: Record<string, unknown> | null }[]): boolean {
  // 倒序扫完最近一轮（到最近一条 user_input 为止）再判定：投递状态只挂在
  // 用户消息行上，error 收尾却出现在它之后的流里——倒序时先遇到流、后遇到
  // 用户消息，必须在轮次边界处把两个信号都收集齐。
  let sawError = false;
  let delivery = '';
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i] || {};
    const eventType = String(row.event_type || '').toLowerCase();
    const item = normalizedItem(row.payload);
    const itemType = String(item?.type || eventType || '').toLowerCase();
    const status = String(row.delivery_status || '').toLowerCase();
    if (status && !delivery) delivery = status;
    if (itemType === 'user_input') break;
    if (itemType === 'error' || eventType === 'error') sawError = true;
  }
  if (!delivery) return false;
  // 投递状态说已结束（completed/failed/cancelled）→ 没在跑。
  if (!IN_FLIGHT_DELIVERY.has(delivery)) return false;
  // 投递状态卡在途，但这一轮已经出过 error → provider 侧失败已收尾，视作没在跑。
  return !sawError;
}

/** 把消息渲染成消息卡；不可渲染的条目返回 null，由调用方跳过。 */
export function displayMessage(event: DisplayEvent): ChatMessage | null {
  const sub = subagentRecordOf(event);
  if (sub) {
    return {
      id: event.id,
      kind: 'subagent',
      subagentId: sub.id,
      name: sub.name,
      task: sub.task,
      status: sub.status,
      text: sub.content,
      summary: sub.summary,
      tools: sub.tools,
      time: event.time,
    };
  }
  const item = normalizedItem(event.payload);
  if (item) return itemToMessage(item, event.id, event.time);
  // 本地乐观插入的用户气泡没有标准化条目。
  if (event.kind === 'user') return { id: event.id, kind: 'user', text: event.text, time: event.time };
  if (event.kind === 'system') return { id: event.id, kind: 'system', text: event.text, time: event.time };
  if (event.kind === 'error') return { id: event.id, kind: 'error', text: event.text || '运行时报告错误', time: event.time };
  return null;
}
