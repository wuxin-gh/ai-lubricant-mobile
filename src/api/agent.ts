/**
 * Agent / 聊天 API 客户端 —— 与 Web 端 `user-frontend/src/api/agentClient.ts` 同构。
 *
 * 直连后端 `/agent/*` 路由，用 monkeycode C 端 session cookie 鉴权
 * （`credentials: 'include'`）。这些路由返回**裸 JSON**（不是 `{code,message,data}`
 * 信封），所以不走 `client.ts` 的 `request()` —— 那层会按信封语义处理。这里照 Web 的
 * `agentFetch` 写法：!ok 时读 `detail`/`message` 抛错；成功时空响应容错。
 *
 * 唯一比 Web 多的一点：测试环境的 HTTP Basic Auth 头（authHeaders()），Web 同源不需要。
 */
import { ApiError, authHeaders, getBaseUrl } from './client';
import { IncrementalSseParser } from './sse';

/** 与 Web agentFetch 等价：裸 JSON + cookie 鉴权 + detail 错误提取。 */
async function agentFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}/agent${path}`;
  let r: Response;
  try {
    r = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers || {}) },
    });
  } catch (e) {
    throw new ApiError((e as Error)?.message || '网络错误');
  }
  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      const data = (await r.json()) as { detail?: string; message?: string };
      detail = data?.detail || data?.message || detail;
    } catch {
      /* 解析失败保留默认 detail */
    }
    throw new ApiError(detail, undefined, r.status);
  }
  // 204 / 空响应容错（与 Web 一致）
  const text = await r.text();
  return (text ? JSON.parse(text) : {}) as T;
}

// ==================== 类型（对齐 Web agentClient） ====================

export interface AgentDef {
  id: number;
  name?: string;
  display_name?: string;
  description?: string;
  enabled?: boolean;
  system_prompt?: string;
  max_turns?: number;
  memory_enabled?: boolean;
  skill_auto_learn?: boolean;
  scheduler_enabled?: boolean;
  workspace_root?: string;
  allowed_roots?: string[];
  denied_patterns?: string[];
  guardian_enabled?: boolean;
  guardian_interval?: number;
  autonomous_enabled?: boolean;
  thinking_enabled?: boolean;
  reasoning_effort?: string;
  /** agent 层 429 自动重试次数；0=关闭。 */
  llm_retry_429?: number;
  /** 需确认工具的审批等待上限；0=不过期。 */
  approval_timeout_seconds?: number;
  /** 浏览器 CDP 对话能否执行 code_run（开启后仍走审批卡）。 */
  browser_code_run_enabled?: boolean;
  main_api_key_id?: number | null;
  main_model?: string;
  subagent_api_key_id?: number | null;
  subagent_model?: string;
  scheduled_api_key_id?: number | null;
  scheduled_model?: string;
  mcp_user_id?: number | null;
  model?: string;
  user_id?: string | null;
  team_id?: string | null;
  is_team_shared?: boolean;
  stats?: { conversations?: number; insights?: number; facts?: number; skills?: number; scheduled_tasks?: number };
}

export interface AgentConversation {
  id: string;
  title?: string;
  system_prompt?: string;
  model?: string;
  agent_id?: number | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

/** 落库消息（与 SSE 事件不同：历史回放用这个）。 */
export interface AttachmentMediaPart {
  type?: 'attachment';
  attachment_id?: number;
  url?: string;
  /** 服务端签发的短时签名 URL（无需登录态）。前端优先用此字段。 */
  content_url?: string;
  thumbnail_url?: string;
  name?: string;
  mime_type?: string;
  size?: number;
  status?: 'active' | 'expired' | 'purged';
  expires_at?: string;
}

export interface AttachmentMeta extends AttachmentMediaPart {
  id: number;
  created_at?: string;
  last_renewed_at?: string;
  renewed_count?: number;
  renewable?: boolean;
  download_url?: string;
  thumbnail_url?: string;
}

export interface AgentStoredMessage {
  id: number | string;
  conversation_id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string;
  tool_calls?: { name?: string; args?: unknown; status?: string }[] | string | null;
  tool_results?: unknown[] | string | null;
  media?: AttachmentMediaPart[] | string | null;
  /** 模型思考(reasoning)全文；未开思考或旧消息为空。 */
  reasoning?: string;
  turn_number?: number;
  status?: 'pending' | 'streaming' | 'done' | 'error';
  error?: string | null;
  created_at?: string;
}

/** 附件元信息（不含字节）。过期/清理时后端返回 410。 */
export function getAttachmentMeta(attachmentId: number): Promise<AttachmentMeta> {
  return agentFetch<AttachmentMeta>(`/attachments/${attachmentId}`);
}

/** 续期 +30 天（仅 owner）。 */
export function renewAttachment(attachmentId: number): Promise<AttachmentMeta> {
  return agentFetch<AttachmentMeta>(`/attachments/${attachmentId}/renew`, { method: 'POST' });
}

/** 附件内容/缩略图的绝对地址（RN 的 Image / fetch 需要绝对地址 + 登录态）。 */
export function attachmentContentUrl(attachmentId: number): string {
  return `${getBaseUrl()}/agent/attachments/${attachmentId}/content`;
}

export function attachmentThumbnailUrl(attachmentId: number): string {
  return `${getBaseUrl()}/agent/attachments/${attachmentId}/thumbnail`;
}

/** 聊天会话（kind='chat'，与 Agent 会话隔离）。 */
export type ChatMode = 'chat' | 'image' | 'video' | 'tts';

export interface ChatSettings {
  mode: ChatMode;
  model: string;
  apiKeyId: number | null;
  temperature: number;
  maxTokens: number;
  stream: boolean;
  systemPrompt: string;
  reasoningEffort: '' | 'low' | 'medium' | 'high' | 'xhigh';
  imageSize: string;
  imageN: number;
  videoSize: string;
  videoSeconds: number;
  ttsVoice: string;
  ttsFormat: string;
  ttsSpeed: number;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  mode: 'chat',
  model: '',
  apiKeyId: null,
  temperature: 0.7,
  maxTokens: 4096,
  stream: true,
  systemPrompt: '',
  reasoningEffort: '',
  imageSize: '1024x1024',
  imageN: 1,
  videoSize: '1280x720',
  videoSeconds: 5,
  ttsVoice: 'alloy',
  ttsFormat: 'mp3',
  ttsSpeed: 1,
};

export interface ChatConversation {
  id: string;
  title?: string;
  system_prompt?: string;
  model?: string;
  status?: string;
  kind?: string;
  chat_settings?: Partial<ChatSettings> & Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

export interface ChatMediaItem {
  type: 'image' | 'video' | 'audio' | string;
  url?: string;
  b64?: string;
  mimeType?: string;
}

export interface ChatStoredMessage {
  id: number | string;
  conversation_id?: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  status?: 'pending' | 'streaming' | 'done' | 'error';
  error?: string | null;
  media?: ChatMediaItem[] | null;
  model?: string;
  usage?: Record<string, unknown> | null;
  created_at?: string;
}

/** 可用网关 Key（聊天发送必须带 api_key_id）。 */
export interface RuntimeKeyItem {
  id: number;
  key_masked: string;
  name: string;
  vm_id: string | null;
  disabled: boolean;
  created_at: number | null;
}

export interface AvailableModel {
  id: string;
  name?: string;
  remark?: string;
  description?: string;
  /** model_group = 管理端配置的自定义模型组（成员模型在发送时按组路由）。 */
  type?: 'model_group' | string;
  /** 模型输出模态（image/video/audio），媒体生成模式按此过滤。 */
  output_modalities?: string[];
  input_modalities?: string[];
  max_context_tokens?: number;
  [k: string]: unknown;
}

// ==================== Agent 定义 ====================

export function listAgents(): Promise<AgentDef[]> {
  return agentFetch<AgentDef[]>('/agents');
}

export interface AgentPayload {
  name: string;
  display_name?: string;
  description?: string;
  system_prompt?: string;
  max_turns?: number;
  enabled?: boolean;
  memory_enabled?: boolean;
  skill_auto_learn?: boolean;
  scheduler_enabled?: boolean;
  workspace_root?: string;
  allowed_roots?: string[];
  denied_patterns?: string[];
  guardian_enabled?: boolean;
  guardian_interval?: number;
  autonomous_enabled?: boolean;
  thinking_enabled?: boolean;
  reasoning_effort?: string;
  llm_retry_429?: number;
  approval_timeout_seconds?: number;
  browser_code_run_enabled?: boolean;
  main_api_key_id?: number | null;
  main_model?: string;
  subagent_api_key_id?: number | null;
  subagent_model?: string;
  scheduled_api_key_id?: number | null;
  scheduled_model?: string;
  is_team_shared?: boolean;
  mcp_user_id?: number | null;
}

export function getAgent(id: number): Promise<AgentDef> { return agentFetch(`/agents/${id}`); }
export function createAgent(payload: AgentPayload): Promise<AgentDef> { return agentFetch('/agents', { method: 'POST', body: JSON.stringify(payload) }); }
export function updateAgent(id: number, payload: Partial<Omit<AgentPayload, 'name'>>): Promise<AgentDef> { return agentFetch(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
export function deleteAgent(id: number): Promise<{ ok?: boolean }> { return agentFetch(`/agents/${id}`, { method: 'DELETE' }); }
export function toggleAgent(id: number): Promise<{ id: number; enabled: boolean }> { return agentFetch(`/agents/${id}/toggle`, { method: 'POST' }); }

// ==================== Agent 对话（kind='agent'，跑 agent loop） ====================

export function listAgentConversations(limit = 50): Promise<AgentConversation[]> {
  return agentFetch<AgentConversation[]>(`/conversations?limit=${limit}`);
}

export function getAgentConversation(convId: string): Promise<{
  conversation: AgentConversation;
  messages: AgentStoredMessage[];
}> {
  return agentFetch(`/conversations/${convId}`);
}

export function createAgentConversation(payload: {
  title?: string;
  system_prompt?: string;
  model?: string;
  agent_id?: number | null;
}): Promise<AgentConversation> {
  return agentFetch<AgentConversation>('/conversations', { method: 'POST', body: JSON.stringify(payload) });
}

export function deleteAgentConversation(convId: string): Promise<{ deleted: boolean }> {
  return agentFetch(`/conversations/${convId}`, { method: 'DELETE' });
}

export function abortAgentConversation(convId: string): Promise<{ aborted: boolean }> {
  return agentFetch(`/conversations/${convId}/abort`, { method: 'POST' });
}

// ==================== 节点命令审批 ====================

/** 一条挂起中的节点命令审批（后端 approval_registry 的投影）。 */
export interface NodeApproval {
  confirmation_id: string;
  conversation_id?: string;
  node_id?: string;
  tool_name?: string;
  command?: string;
  commands?: string[];
  command_hash?: string;
  requester?: string | null;
  created_at?: number;
  /** POSIX 秒；0/缺失表示不过期。 */
  expires_at?: number;
  resolved?: string | null;
  message?: string;
  shell_flavor?: string;
  metadata?: Record<string, unknown>;
}

/** 批准或拒绝一条挂起的节点命令；command_hash 防止批准到被改写的命令。 */
export function resolveApproval(
  convId: string,
  confirmationId: string,
  result: 'allow' | 'deny',
  commandHash?: string,
): Promise<{ ok: boolean; confirmation_id: string; result: string }> {
  return agentFetch(`/conversations/${convId}/approvals/${confirmationId}`, {
    method: 'POST',
    body: JSON.stringify({ result, command_hash: commandHash || '' }),
  });
}

/** 断线重连后取回仍挂起的审批。 */
export async function listApprovals(convId: string): Promise<NodeApproval[]> {
  const data = await agentFetch<{ approvals?: NodeApproval[] }>(`/conversations/${convId}/approvals`);
  return data.approvals ?? [];
}

// ==================== Agent 对话扩展（分页 / 更新 / 重试 / 附件） ====================

export interface AgentConversationPage {
  conversations: AgentConversation[];
  page: { cursor: string | null; has_next_page: boolean };
}

/** 分页 Agent 会话列表（可按 agent 过滤 / 标题搜索）。后端返回 items + page.next_cursor。 */
export async function listAgentConversationsPage(params: { limit?: number; cursor?: string | null; agentId?: number; search?: string } = {}): Promise<AgentConversationPage> {
  const query = new URLSearchParams({ paged: 'true', limit: String(params.limit ?? 20) });
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.agentId) query.set('agent_id', String(params.agentId));
  if (params.search?.trim()) query.set('search', params.search.trim());
  const data = await agentFetch<{ items?: AgentConversation[]; page?: { next_cursor?: string | null; has_next_page?: boolean } } | AgentConversation[]>(`/conversations?${query}`);
  if (Array.isArray(data)) return { conversations: data, page: { cursor: null, has_next_page: false } };
  return {
    conversations: Array.isArray(data?.items) ? data.items : [],
    page: { cursor: data?.page?.next_cursor ?? null, has_next_page: !!data?.page?.has_next_page },
  };
}

export interface AgentMessagesPage {
  messages: AgentStoredMessage[];
  page: { next_cursor: number | null; has_more: boolean };
}

/** Agent 消息分页（向前翻更早）。 */
export function listAgentConversationMessagesPage(convId: string, cursor?: number | null, limit = 20): Promise<AgentMessagesPage> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor != null) query.set('cursor', String(cursor));
  return agentFetch(`/conversations/${convId}/messages?${query}`);
}

/** 会话元信息（不拉消息）。 */
export function getAgentConversationMeta(convId: string): Promise<AgentConversation> {
  return agentFetch(`/conversations/${convId}/meta`);
}

/** 更新 Agent 会话（模型 / 推理强度 / 标题 / 系统提示词）。 */
export function updateAgentConversation(
  convId: string,
  payload: { title?: string; system_prompt?: string; model?: string; reasoning_effort?: string },
): Promise<AgentConversation> {
  return agentFetch(`/conversations/${convId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

/** 批量删除 Agent 会话。 */
export function batchDeleteAgentConversations(ids: string[]): Promise<{ deleted: number; not_found: string[] }> {
  return agentFetch('/conversations/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) });
}

// ==================== Agent 附件上传 ====================

/**
 * Agent 会话附件：落到该 Agent 的工作区，运行时用 file 工具读。
 * Content-Type 用文件真实 mime，后端据此判断类型。
 */
export async function uploadAgentConversationAttachment(
  convId: string,
  file: { uri: string; name: string; mimeType?: string },
): Promise<ConversationAttachment> {
  const body = await readLocalArrayBuffer(file.uri);
  const res = await fetch(`${getBaseUrl()}/agent/conversations/${encodeURIComponent(convId)}/attachments?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...authHeaders(), 'Content-Type': file.mimeType || 'application/octet-stream' },
    body,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: string };
      detail = data?.detail || detail;
    } catch {
      /* keep */
    }
    throw new ApiError(`附件上传失败：${detail}`, undefined, res.status);
  }
  return (await res.json()) as ConversationAttachment;
}

// ==================== 定时任务（Agent Scheduled Tasks） ====================
// 后端 /agent/scheduled-tasks*。两种任务：
// - prompt：到点把 task_prompt 交给 Agent 跑；
// - script：到点执行 script_code（子进程），必须人工授权（approve-script）才执行。

export type ScheduledTaskKind = 'prompt' | 'script';
export type ScheduledTaskScriptType = 'python' | 'powershell';
export type ScheduledTaskOnError = 'none' | 'diagnose' | 'diagnose_fix_retry';

export interface ScheduledTaskListItem {
  id: number;
  name: string;
  cron_expression: string;
  task_kind: ScheduledTaskKind;
  enabled: boolean;
  agent_id?: number | null;
  user_id?: string | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_result?: string | null;
  last_exit_code?: number | null;
  consecutive_failures?: number | null;
  background?: string | null;
  on_error?: ScheduledTaskOnError;
  script_type?: ScheduledTaskScriptType;
  allow_ai_script_fix?: boolean;
  approved_hash?: string | null;
  has_pending_fix?: boolean;
  api_key_id?: number | null;
  model?: string | null;
  created_at?: string;
}

export interface ScheduledTaskDetail extends ScheduledTaskListItem {
  task_prompt?: string | null;
  script_code?: string | null;
  script_timeout?: number | null;
  pending_script_code?: string | null;
  pending_script_hash?: string | null;
  heal_history?: Array<{ at?: string; exit_code?: number | null; diagnosis?: string; applied?: boolean }>;
}

export interface CreateScheduledTaskPayload {
  name: string;
  cron_expression: string;
  agent_id?: number | null;
  enabled?: boolean;
  task_kind?: ScheduledTaskKind;
  task_prompt?: string;
  script_code?: string;
  script_type?: ScheduledTaskScriptType;
  script_timeout?: number;
  background?: string;
  on_error?: ScheduledTaskOnError;
  allow_ai_script_fix?: boolean;
  api_key_id?: number | null;
  model?: string;
}

export interface CreateScheduledTaskResult {
  id: number;
  name: string;
  cron_expression: string;
  task_kind: ScheduledTaskKind;
  needs_approval?: boolean;
}

export function listScheduledTasks(): Promise<ScheduledTaskListItem[]> {
  return agentFetch<ScheduledTaskListItem[]>('/scheduled-tasks');
}

export function getScheduledTask(jobId: number): Promise<ScheduledTaskDetail> {
  return agentFetch<ScheduledTaskDetail>(`/scheduled-tasks/${jobId}`);
}

export function createScheduledTask(payload: CreateScheduledTaskPayload): Promise<CreateScheduledTaskResult> {
  return agentFetch<CreateScheduledTaskResult>('/scheduled-tasks', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateScheduledTask(jobId: number, payload: Partial<Omit<CreateScheduledTaskPayload, 'agent_id'>>): Promise<ScheduledTaskDetail> {
  return agentFetch<ScheduledTaskDetail>(`/scheduled-tasks/${jobId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function deleteScheduledTask(jobId: number): Promise<{ deleted: boolean }> {
  return agentFetch(`/scheduled-tasks/${jobId}`, { method: 'DELETE' });
}

export function runScheduledTaskNow(jobId: number): Promise<{ triggered: boolean }> {
  return agentFetch(`/scheduled-tasks/${jobId}/run`, { method: 'POST' });
}

export function toggleScheduledTask(jobId: number): Promise<{ id: number; enabled: boolean }> {
  return agentFetch(`/scheduled-tasks/${jobId}/toggle`, { method: 'POST' });
}

export function approveScheduledTaskScript(jobId: number): Promise<{ approved: boolean; id: number }> {
  return agentFetch(`/scheduled-tasks/${jobId}/approve-script`, { method: 'POST' });
}

// ==================== Agent 可选 LLM 模型 ====================

export interface LlmModelOption {
  id: number;
  llm_config_id?: number;
  model_name?: string;
  display_name?: string;
  enabled?: boolean;
  config_name?: string;
  config_enabled?: boolean;
}

/** Agent 编辑器可选的 LLM 模型库存（脱敏，不含密钥）。 */
export function listLlmModels(enabledOnly = true): Promise<LlmModelOption[]> {
  return agentFetch<LlmModelOption[]>(`/llm-models?enabled_only=${enabledOnly}`);
}

// ==================== Agent SOP / 一级工具（只读） ====================

export interface ManagedAgentSop {
  id: string;
  name: string;
  description?: string;
  filename?: string;
  enabled?: boolean;
  is_builtin?: boolean;
  revision?: number;
  updated_at?: string | null;
  exists?: boolean;
}

export async function getAgentSops(agentId: number): Promise<ManagedAgentSop[]> {
  const data = await agentFetch<{ available?: ManagedAgentSop[] }>(`/agents/${agentId}/sops`);
  return data.available ?? [];
}

export interface BuiltinToolSchema { name: string; description: string }

export async function fetchBuiltinToolsSchema(): Promise<BuiltinToolSchema[]> {
  try {
    const data = await agentFetch<{ tools?: Array<{ function?: { name?: string; description?: string } }> }>('/tools/schema');
    return (data.tools ?? []).map((t) => ({ name: t.function?.name || '', description: t.function?.description || '' })).filter((t) => t.name);
  } catch {
    return [];
  }
}

// ==================== 聊天历史（kind='chat'，纯 LLM 对话） ====================

export function listChatConversations(limit = 50): Promise<ChatConversation[]> {
  return agentFetch<ChatConversation[]>(`/chat/conversations?limit=${limit}`);
}

export function getChatConversation(convId: string): Promise<{
  conversation: ChatConversation;
  messages: ChatStoredMessage[];
}> {
  return agentFetch(`/chat/conversations/${convId}`);
}

export function createChatConversation(payload: {
  title?: string;
  system_prompt?: string;
  model?: string;
  chat_settings?: Record<string, unknown>;
}): Promise<ChatConversation> {
  return agentFetch<ChatConversation>('/chat/conversations', { method: 'POST', body: JSON.stringify(payload) });
}

export function deleteChatConversation(convId: string): Promise<{ deleted: boolean }> {
  return agentFetch(`/chat/conversations/${convId}`, { method: 'DELETE' });
}

export function updateChatConversation(
  convId: string,
  payload: { title?: string; system_prompt?: string; model?: string; chat_settings?: Record<string, unknown> },
): Promise<ChatConversation> {
  return agentFetch(`/chat/conversations/${convId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

/** 追加一条聊天消息到历史（发送流本身不落库，前端收完后补写）。 */
export function appendChatMessage(
  convId: string,
  payload: { role: string; content: string; status?: string; error?: string | null; media?: ChatMediaItem[] | null; model?: string; usage?: Record<string, unknown> | null },
): Promise<ChatStoredMessage> {
  return agentFetch<ChatStoredMessage>(`/chat/conversations/${convId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** 软删一条聊天消息（重试失败轮时清掉残留的 error assistant 消息）。 */
export function deleteChatMessage(convId: string, messageId: string | number): Promise<{ deleted: boolean }> {
  return agentFetch(`/chat/conversations/${convId}/messages/${encodeURIComponent(String(messageId))}`, { method: 'DELETE' });
}

export interface ConversationPage<T> {
  items: T[];
  page: { next_cursor: string | null; has_next_page: boolean };
}

function normalizeConversationPage<T>(response: ConversationPage<T> | T[]): ConversationPage<T> {
  if (Array.isArray(response)) {
    return { items: response, page: { next_cursor: null, has_next_page: false } };
  }
  return {
    items: Array.isArray(response?.items) ? response.items : [],
    page: {
      next_cursor: response?.page?.next_cursor || null,
      has_next_page: Boolean(response?.page?.has_next_page),
    },
  };
}

/** 分页会话列表（游标）。 */
export async function listChatConversationsPage(params: { limit?: number; cursor?: string | null } = {}): Promise<ConversationPage<ChatConversation>> {
  const query = new URLSearchParams({ paged: 'true', limit: String(params.limit ?? 20) });
  if (params.cursor) query.set('cursor', params.cursor);
  const response = await agentFetch<ConversationPage<ChatConversation> | ChatConversation[]>(`/chat/conversations?${query}`);
  return normalizeConversationPage(response);
}

/** 批量删除聊天会话。 */
export function batchDeleteChatConversations(ids: string[]): Promise<{ deleted: number; not_found: string[] }> {
  return agentFetch('/chat/conversations/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) });
}

export interface ChatMessagesPage {
  messages: ChatStoredMessage[];
  page: { next_cursor: number | null; has_more: boolean };
}

/** 聊天消息分页（向前翻更早；cursor 传上一页最旧消息 id）。 */
export function listChatConversationMessagesPage(convId: string, cursor?: number | null, limit = 20): Promise<ChatMessagesPage> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor != null) query.set('cursor', String(cursor));
  return agentFetch(`/chat/conversations/${convId}/messages?${query}`);
}

/** 会话元信息（标题/设置），不拉消息。 */
export function getChatConversationMeta(convId: string): Promise<ChatConversation> {
  return agentFetch(`/chat/conversations/${convId}/meta`);
}

/** 该 Key 下可用模型（含自定义模型）。 */
export async function listChatModels(apiKeyId: number): Promise<AvailableModel[]> {
  const data = await agentFetch<{ object?: string; data?: AvailableModel[] }>(`/chat/models?api_key_id=${apiKeyId}`);
  return data.data || [];
}

/** 任务/编辑器选择器统一使用的按 Key 模型选项。 */
export async function listRuntimeModelOptions(apiKeyId: number): Promise<Array<{ value: string; label: string }>> {
  const models = await listChatModels(apiKeyId);
  return models
    .map((item) => {
      const id = String(item.id || '').trim();
      return id ? { value: id, label: String(item.name || item.remark || id) } : null;
    })
    .filter((item): item is { value: string; label: string } => item !== null);
}

// ==================== 流式发送 ====================

/** agent_runner_loop 通过 SSE 吐出的事件（见 agent/agent_loop.py 的 on_event）。 */
export interface AgentStreamEvent {
  type:
    | 'turn_start'
    | 'turn_end'
    | 'content'
    | 'reasoning'
    | 'tool_call'
    | 'tool_result'
    | 'done'
    | 'retry'
    | 'question'
    | 'error'
    | string;
  text?: string;
  name?: string;
  args?: unknown;
  data?: unknown;
  index?: number;
  id?: string;
  turn?: number;
  message?: string;
  usage?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface SendMessageHandle {
  /** 流结束（正常收完或被 abort）后 resolve。 */
  done: Promise<void>;
  /** 断开本地读取（不等于服务端停止，服务端需另调 abortAgentConversation）。 */
  cancel: () => void;
}

/**
 * Agent 发消息 + SSE 流式接收。与 Web `sendMessageStream` 同构：
 * POST /agent/conversations/{id}/messages，返回 text/event-stream。
 * 唯一差别：Web 把 Response 交回上层自行读流；移动端在这里读完并逐帧回调，
 * 因为上层 hook 不想关心 ReadableStream。
 *
 * 注意这里仍用全局 fetch（不是 expo/fetch）—— 与 Web 同一个 fetch，行为一致，
 * 避免 cookie jar 不共享导致的 401。
 */
export type AgentExecutionMode = 'interact' | 'plan' | 'goal';

export interface AgentGoalConfig {
  objective: string;
  budget_seconds: number;
  max_turns?: number;
}

export function sendAgentMessage(
  convId: string,
  content: string,
  onEvent: (event: AgentStreamEvent) => void,
  opts: { maxTurns?: number; mode?: AgentExecutionMode; goalConfig?: AgentGoalConfig } = {},
): SendMessageHandle {
  return readAgentEventStream(
    `${getBaseUrl()}/agent/conversations/${convId}/messages`,
    {
      content,
      max_turns: opts.maxTurns,
      mode: opts.mode ?? 'interact',
      goal_config: opts.goalConfig,
    },
    onEvent,
  );
}

/** 重试失败的 assistant 消息；返回与普通 send 相同的 SSE 事件流。 */
export function retryAgentConversationMessage(
  convId: string,
  messageId: string | number,
  onEvent: (event: AgentStreamEvent) => void,
): SendMessageHandle {
  return readAgentEventStream(
    `${getBaseUrl()}/agent/conversations/${convId}/messages/${encodeURIComponent(String(messageId))}/retry`,
    undefined,
    onEvent,
  );
}

/** Agent SSE 读取器：普通 send 与 retry 共用。 */
function readAgentEventStream(
  url: string,
  body: Record<string, unknown> | undefined,
  onEvent: (event: AgentStreamEvent) => void,
): SendMessageHandle {
  const controller = new AbortController();

  const done = (async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) return;
      throw new ApiError((e as Error)?.message || '网络错误');
    }

    if (!res.status || !res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const data = (await res.json()) as { detail?: string; message?: string };
        detail = data?.detail || data?.message || detail;
      } catch {
        /* ignore */
      }
      throw new ApiError(detail, undefined, res.status);
    }

    const stream = res.body;
    if (!stream) throw new ApiError('当前环境不支持流式响应');

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const parser = new IncrementalSseParser(({ data }) => {
      try {
        onEvent(JSON.parse(data) as AgentStreamEvent);
      } catch {
        /* 跳过坏帧，不中断整条流 */
      }
    });
    try {
      for (;;) {
        const { done: eof, value } = await reader.read();
        if (eof) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
      parser.finish();
    } catch (e) {
      if (!controller.signal.aborted) throw e;
    } finally {
      reader.cancel().catch(() => undefined);
    }
  })();

  return { done, cancel: () => controller.abort() };
}

// ==================== 聊天流式发送（OpenAI 兼容 SSE） ====================

/** 一条聊天消息：content 为纯文本，或 OpenAI content parts 数组（文本 + image_url）。 */
export interface ChatSendMessagesItem {
  role: string;
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

export interface ChatSendPayload {
  api_key_id: number;
  model: string;
  messages: ChatSendMessagesItem[];
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: string;
}

/** SSE 帧里的 usage 结构（部分字段缺省，键与 OpenAI 一致）。 */
export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cached_tokens?: number;
  cache_creation_input_tokens?: number;
  reasoning_tokens?: number;
  [k: string]: unknown;
}

export interface ChatSendHandle {
  /** 流结束（收到 [DONE] 或被 abort）后 resolve。 */
  done: Promise<void>;
  /** 断开本地读取。 */
  cancel: () => void;
}

/** 从一帧 OpenAI SSE 提取增量文本 / usage / 上游错误。 */
function parseChatChunk(data: string): { delta?: string; usage?: ChatUsage; error?: string } {
  const chunk = JSON.parse(data) as {
    choices?: Array<{ delta?: { content?: string } }>;
    usage?: ChatUsage;
    error?: { message?: string } | string;
    [k: string]: unknown;
  };
  const text = chunk?.choices?.[0]?.delta?.content;
  const usageKey = (chunk as { usage?: ChatUsage }).usage;
  const error = typeof chunk.error === 'string' ? chunk.error : chunk.error?.message;
  return {
    delta: typeof text === 'string' ? text : undefined,
    usage: usageKey && typeof usageKey === 'object' ? usageKey : undefined,
    error: error ? String(error) : undefined,
  };
}

/**
 * 聊天文本对话流式发送：POST /agent/chat/send，stream=true。
 * 与 Web chatSendStream 同构，但移动端在这里读完流并逐增量回调。
 * 输出是 OpenAI /v1/chat/completions 的 SSE：每帧 `data: {json}`，结尾 `data: [DONE]`。
 * 增量文本在 `choices[0].delta.content`；usage 在带 `usage` 字段的帧（结尾帧）。
 */
export function chatSendOnce(
  payload: ChatSendPayload,
): Promise<Record<string, unknown>> {
  return agentFetch('/chat/send', { method: 'POST', body: JSON.stringify({ ...payload, stream: false }) });
}

export function chatSendStream(
  payload: ChatSendPayload,
  onDelta: (text: string) => void,
  onUsage?: (usage: ChatUsage) => void,
): ChatSendHandle {
  const controller = new AbortController();

  const done = (async () => {
    let res: Response;
    try {
      res = await fetch(`${getBaseUrl()}/agent/chat/send`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, stream: true }),
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) return;
      throw new ApiError((e as Error)?.message || '网络错误');
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const data = (await res.json()) as { detail?: string; message?: string; error?: { message?: string } };
        detail = data?.detail || data?.message || data?.error?.message || detail;
      } catch {
        /* ignore */
      }
      throw new ApiError(detail, undefined, res.status);
    }

    const body = res.body;
    if (!body) throw new ApiError('当前环境不支持流式响应');

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let streamDone = false;
    const parser = new IncrementalSseParser(({ data }) => {
      if (data === '[DONE]') {
        streamDone = true;
        parser.stop();
        return;
      }
      try {
        const { delta, usage, error } = parseChatChunk(data);
        // 上游错误帧：透传成异常（限流/余额不足会以这种帧结束，不能静默当成功）。
        if (error) throw new ApiError(error);
        if (delta) onDelta(delta);
        if (usage) onUsage?.(usage);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        /* 跳过坏帧 */
      }
    });
    try {
      for (;;) {
        const { done: eof, value } = await reader.read();
        if (eof || streamDone) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      if (!streamDone) {
        parser.push(decoder.decode());
        parser.finish();
      }
    } catch (e) {
      if (!controller.signal.aborted) throw e;
    } finally {
      reader.cancel().catch(() => undefined);
    }
  })();

  return { done, cancel: () => controller.abort() };
}

// ==================== 聊天媒体生成（image / video / tts） ====================

export interface ChatMediaPayload {
  api_key_id: number;
  mode: 'image' | 'video' | 'tts';
  model: string;
  prompt?: string;
  input?: string;
  size?: string;
  n?: number;
  seconds?: number;
  voice?: string;
  response_format?: string;
  speed?: number;
}

/** 图片 / 视频 / 语音生成（非流式，返回 data / url 结构）。 */
export function chatMedia(payload: ChatMediaPayload): Promise<Record<string, unknown>> {
  return agentFetch('/chat/media', { method: 'POST', body: JSON.stringify(payload) });
}

// ==================== 聊天附件上传 ====================

export interface ConversationAttachment {
  /** 落盘相对路径（聊天落在 agent/temp）。 */
  path: string;
  filename: string;
  size: number;
  mime?: string;
  /** 图片：可直接作 OpenAI image_url content part 的 data URL（仅聊天返回）。 */
  data_url?: string;
  /** 文本类文件的 UTF-8 内容（仅聊天返回）。 */
  text?: string;
}

/** 读本地文件为 ArrayBuffer（RN fetch 发送 ArrayBuffer 不会自动补 Content-Type）。 */
function readLocalArrayBuffer(uri: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      if (xhr.response instanceof ArrayBuffer) resolve(xhr.response);
      else reject(new Error('读取本地文件失败'));
    };
    xhr.onerror = () => reject(new Error('读取本地文件失败'));
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
}

/**
 * 聊天会话附件：落到 temp 目录，并按类型回 data_url（图片）/ text（文本），
 * 供前端拼进消息一起发给 LLM——聊天没有工作区也没有文件工具。
 */
export async function uploadChatConversationAttachment(
  convId: string,
  file: { uri: string; name: string; mimeType?: string; size?: number },
): Promise<ConversationAttachment> {
  const body = await readLocalArrayBuffer(file.uri);
  const res = await fetch(`${getBaseUrl()}/agent/chat/conversations/${encodeURIComponent(convId)}/attachments?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...authHeaders(), 'Content-Type': file.mimeType || 'application/octet-stream' },
    body,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: string };
      detail = data?.detail || detail;
    } catch {
      /* keep */
    }
    throw new ApiError(`附件上传失败：${detail}`, undefined, res.status);
  }
  return (await res.json()) as ConversationAttachment;
}

/** 可用网关 Key：自有 runtime key + 分组授权的系统 key（与 Web listUsableKeys 同构）。 */
export async function listUsableKeys(): Promise<RuntimeKeyItem[]> {
  const pull = async (path: string): Promise<Record<string, unknown>[]> => {
    const r = await fetch(`${getBaseUrl()}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!r.ok) throw new ApiError(`HTTP ${r.status}`, undefined, r.status);
    const data = await r.json();
    return Array.isArray(data) ? data : (data?.data ?? data?.rows ?? []);
  };
  const [own, system] = await Promise.all([
    pull('/api/v1/users/model-gateway/runtime-keys').catch(() => [] as Record<string, unknown>[]),
    pull('/api/v1/users/model-gateway/system-keys').catch(() => [] as Record<string, unknown>[]),
  ]);
  const byId = new Map<number, RuntimeKeyItem>();
  for (const row of [...own, ...system]) {
    const id = Number(row.id);
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      key_masked: String(row.key_masked ?? ''),
      name: String(row.name ?? ''),
      vm_id: (row.vm_id as string | null) ?? null,
      disabled: Boolean(row.disabled),
      created_at: (row.created_at as number | null) ?? null,
    });
  }
  return Array.from(byId.values());
}
