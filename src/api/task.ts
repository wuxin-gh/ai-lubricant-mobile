import { ApiError, authHeaders, errorMessageFromBody, fetchStream, getBaseUrl, openWebSocket, request } from './client';
import { IncrementalSseParser } from './sse';

export type TaskProvider = 'claude' | 'codex' | 'opencode' | 'cursor';

export interface UserTaskKeyMetadata {
  key_id: number;
  name?: string;
  key_masked: string;
  version?: number;
  disabled: boolean;
  expires_at?: number | string | null;
  usage_limit?: Record<string, number>;
}

export interface UserTaskSummary {
  id: string;
  user_id?: string;
  kind: string;
  sub_type?: string | null;
  task_role?: string | null;
  title?: string | null;
  content: string;
  summary?: string | null;
  status: string;
  provider: TaskProvider | string;
  cli_name?: string | null;
  node_id?: string | null;
  node_session_id?: string | null;
  project_id?: string | null;
  model_id?: string | null;
  models?: string[];
  git_identity_id?: string | null;
  repo_url?: string | null;
  branch?: string | null;
  mode?: string | null;
  mode_label?: string | null;
  reasoning_effort?: '' | 'low' | 'medium' | 'high' | 'xhigh';
  env_mode?: 'isolated' | 'shared' | 'system' | null;
  env_id?: string | null;
  env_name?: string | null;
  workspace_state?: string | null;
  dispatch_error?: string | null;
  runtime_stage?: {
    stage?: string | null;
    label?: string | null;
    ok?: boolean;
    detail?: string | null;
    index?: number;
    total?: number;
    preparing?: boolean;
  } | null;
  api_key_id?: number | null;
  parent_api_key_id?: number | null;
  api_key?: UserTaskKeyMetadata | null;
  usage_limit?: Record<string, number>;
  created_at?: string | number | null;
  last_active_at?: string | number | null;
  completed_at?: string | number | null;
}

export interface UserTaskDetail extends UserTaskSummary {
  log_store?: string | null;
  mcp_config?: Record<string, unknown>[];
  skill_config?: Record<string, unknown>[];
  plugin_config?: Record<string, unknown>[];
  mcp_overlay?: Record<string, unknown>[];
  /** 创建时勾选的新资源装进环境/节点本机的失败清单（best-effort，不阻断创建）。 */
  env_install_warnings?: string[];
}

/**
 * 资源引用绑定。裸 id 字符串 = 旧表引用；``{reference_id, entries}`` = 统一资源池
 * 引用（按 entries 过滤子技能，缺省=整个集合）；``{resource_id, entries}`` 同理走
 * 旧表。服务端 resolve_reference_specs 按这些键分流。
 */
export type TaskResourceBinding =
  | string
  | { resource_id?: string; reference_id?: string; entries?: string[] };

/** MCP 绑定：团队引用 {resource_id}，或内置服务/实例 {service_id, param_key?, param_values?}。 */
export type TaskMcpBinding =
  | { resource_id: string }
  | { service_id: number; param_key?: string; param_values?: string[] };

export interface CreateUserTaskPayload {
  content: string;
  node_id?: string;
  provider?: TaskProvider;
  cli_name?: TaskProvider;
  model_id?: string;
  models?: string[];
  git_identity_id?: string;
  // 分支策略对齐编辑器：default=跟随仓库默认分支；existing=checkout 已有分支
  // （branch 必填）；auto=首次初始化时从默认分支确定性创建 task/<task_id>。
  // commit 与凭据字段在公开路由不可达（pydantic 先丢弃），故不声明。
  repo?: { repo_url?: string; branch?: string; branch_mode?: 'default' | 'existing' | 'auto' };
  extra?: {
    project_id?: string;
    issue_id?: string;
    skill_ids?: TaskResourceBinding[];
    plugin_ids?: TaskResourceBinding[];
  };
  mode?: string;
  // 执行环境档位：isolated（默认/缺省，一次性 home）/ shared（节点上命名的持久
  // 环境，需 env_id）/ system（节点操作者真实 home，需节点已开启该模式）。
  env_mode?: 'isolated' | 'shared' | 'system';
  env_id?: string;
  env_name?: string;
  // 环境自带资源的激活子集（环境清单里的名字）：只激活列出的技能/插件，其余
  // 环境已装项本次任务不启用。**空/缺省 = 全激活**（空列表不可表达）。
  active_skills?: string[];
  active_plugins?: string[];
  parent_api_key_id?: number;
  usage_limit?: Record<string, number>;
  expires_at?: number;
  expected_client_id?: string;
  bootstrap_content?: string;
  skill_config?: Record<string, unknown>[];
  mcp_config?: TaskMcpBinding[];
  plugin_config?: Record<string, unknown>[];
  // 子 Key 收窄参数（复用既有 api_keys 列）。省略=继承父级。注意：可用模型的
  // 真相源是 ``models``（服务端同源写 models_snapshot 与子 Key model_whitelist），
  // 服务端虽声明了 model_whitelist 但不消费，故这里不暴露。
  rate_limit?: Record<string, number>;
  editor_provider_whitelist?: string[];
  selection_strategy?: string;
  /** 项目提示词 id：服务端取 content 前置拼进任务正文，自身不落库。 */
  prompt_id?: string;
  task_type?: string;
  sub_type?: string;
  task_role?: string;
}

export interface UserTaskList {
  total: number;
  page: number;
  page_size: number;
  rows: UserTaskSummary[];
}

export interface UserTaskStats {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  llm_requests?: number;
}

export interface UserTaskLog {
  id: number;
  request_id?: string;
  request_path?: string;
  model?: string;
  status_code?: number;
  total_tokens?: number;
  created_at?: string | number;
  [key: string]: unknown;
}

export interface UserTaskFileEntry {
  name?: string;
  path?: string;
  size?: number;
  is_dir?: boolean;
  [key: string]: unknown;
}

export interface UserTaskFileResponse {
  path: string;
  is_dir: boolean;
  entries?: UserTaskFileEntry[];
  count?: number;
  content?: string;
  encoding?: 'utf-8' | 'base64';
  truncated?: boolean;
}

/** Historical repo_file_changes contract, now served by canonical Task REST. */
export interface UserTaskFileChange {
  path: string;
  status?: string;
  additions?: number;
  deletions?: number;
  old_path?: string;
}

export interface UserTaskFileChangesResponse {
  changes: UserTaskFileChange[];
  branch?: string;
  commit_hash?: string;
  success: boolean;
  error?: string;
}

export interface UserTaskFileDiffResponse {
  path?: string;
  diff?: string;
  success: boolean;
  error?: string;
}

export interface UserTaskTerminal {
  id: string;
  current_command?: string;
  running?: boolean;
  created_at?: string | number | null;
  [key: string]: unknown;
}

export interface TaskEvent {
  kind: string;
  text?: string;
  content?: string;
  message?: string;
  [key: string]: unknown;
}

export interface ParentKeyItem {
  id: number;
  key_masked: string;
  name: string;
  source: string;
  disabled?: boolean;
  editor_provider_whitelist?: TaskProvider[];
  editor_provider_blacklist?: TaskProvider[];
}

export interface GatewayModelOption {
  value: string;
  label: string;
}

export interface TaskEventStreamHandle {
  done: Promise<void>;
  cancel: () => void;
}

const TASKS_PATH = '/api/v1/users/tasks';
const taskPath = (taskId: string) => `${TASKS_PATH}/${encodeURIComponent(taskId)}`;

function queryString(params: Record<string, string | number | undefined>): string {
  const values = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return values.length ? `?${values.join('&')}` : '';
}

function stripPlaintextKey<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  const copy = { ...(value as Record<string, unknown>) };
  if (copy.api_key && typeof copy.api_key === 'object') {
    const { key: _discarded, ...safeKey } = copy.api_key as Record<string, unknown>;
    copy.api_key = safeKey;
  }
  delete copy.key;
  return copy as T;
}

export async function listUserTasks(params: {
  page?: number;
  page_size?: number;
  project_id?: string;
  status?: string;
} = {}): Promise<UserTaskList> {
  const response = await request<UserTaskList>(TASKS_PATH, { query: params });
  return response.data ?? { total: 0, page: params.page ?? 1, page_size: params.page_size ?? 24, rows: [] };
}

export async function getUserTask(taskId: string): Promise<UserTaskDetail> {
  const response = await request<UserTaskDetail>(taskPath(taskId));
  if (!response.data) throw new ApiError('任务不存在', undefined, 404);
  return response.data;
}

export async function createUserTask(payload: CreateUserTaskPayload): Promise<UserTaskDetail> {
  const response = await request<UserTaskDetail>(TASKS_PATH, { method: 'POST', body: payload });
  if (!response.data) throw new ApiError('创建任务失败');
  return stripPlaintextKey(response.data);
}

export async function updateUserTask(taskId: string, payload: { title?: string; summary?: string; mode?: string; mode_label?: string; reasoning_effort?: string; mcp_config?: Record<string, unknown>[]; skill_config?: Record<string, unknown>[]; plugin_config?: Record<string, unknown>[] }) {
  return (await request<{ ok?: boolean; config_resync?: { applied?: string[]; failed?: string[]; skipped?: string[] } }>(taskPath(taskId), { method: 'PUT', body: payload })).data;
}

export async function stopUserTask(taskId: string) {
  return (await request<{ ok: boolean }>(`${TASKS_PATH}/stop`, { method: 'PUT', query: { task_id: taskId } })).data;
}

export async function deleteUserTask(taskId: string) {
  return (await request<{ deleted: boolean }>(taskPath(taskId), { method: 'DELETE' })).data;
}

export async function sendUserTaskMessage(
  taskId: string,
  content: string,
  attachments?: { url: string; filename: string }[],
  clientMessageId?: string,
) {
  return (await request<{ accepted: boolean; client_message_id?: string; delivery_status?: string }>(`${taskPath(taskId)}/messages`, {
    method: 'POST',
    // 端到端幂等键：同 ID 重复请求不会把同一句话投递/执行两遍。
    body: {
      content,
      ...(attachments?.length ? { attachments } : {}),
      ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
    },
  })).data;
}

export async function cancelUserTask(taskId: string) {
  return (await request<{ accepted: boolean }>(`${taskPath(taskId)}/cancel`, { method: 'POST' })).data;
}

export async function restartUserTask(taskId: string, loadSession = true) {
  return (await request<{ restarted: boolean; load_session: boolean }>(`${taskPath(taskId)}/restart`, {
    method: 'POST',
    body: { load_session: loadSession },
  })).data;
}

export async function startUserTask(taskId: string) {
  return (await request<{ started?: boolean; restarted?: boolean }>(`${taskPath(taskId)}/start`, {
    method: 'POST',
  })).data;
}

export async function switchUserTaskModel(taskId: string, modelId: string) {
  const response = await request<{ task_id: string; model_id: string; models: string[] }>(`${taskPath(taskId)}/model`, { method: 'POST', body: { model_id: modelId } });
  return response.data;
}

/** 把模型追加进任务的已添加集合（按创建时父 API Key 的允许目录校验）。 */
export async function addUserTaskModels(taskId: string, models: string[]) {
  const response = await request<{ task_id: string; models: string[] }>(`${taskPath(taskId)}/models`, { method: 'POST', body: { models } });
  return response.data;
}

export interface UserTaskPort {
  port?: number;
  status?: string;
  preview_url?: string;
  error_message?: string;
}

/**
 * 任务工作区端口预览。后端目前对任务返回 ``{ports: [], supported: true}``
 * （节点侧任务端口发现还没落地），所以 UI 走正常的「无端口」空态，而不是伪造数据。
 */
export async function listUserTaskPorts(taskId: string): Promise<{ ports: UserTaskPort[]; supported: boolean }> {
  const response = await request<{ ports?: UserTaskPort[]; supported?: boolean }>(`${taskPath(taskId)}/ports`);
  return { ports: response.data?.ports ?? [], supported: response.data?.supported ?? true };
}

export interface UserTaskEventRow {
  seq: number;
  kind: string;
  event_type?: string;
  payload?: Record<string, unknown>;
  /** 用户消息行才有：端到端幂等键与投递状态机（pending→…→completed）。 */
  client_message_id?: string | null;
  delivery_status?: string | null;
  delivery_attempt?: number;
  failure_reason?: string | null;
  created_at?: string | number;
}

export async function listUserTaskEventsHistory(taskId: string, before?: number, limit = 50) {
  const response = await request<{ rows?: UserTaskEventRow[]; next_before?: number | null }>(`${taskPath(taskId)}/events/history`, { query: { before, limit } });
  return response.data ?? { rows: [], next_before: null };
}

export async function getUserTaskStats(taskId: string): Promise<UserTaskStats> {
  const response = await request<UserTaskStats>(`${taskPath(taskId)}/stats`);
  return response.data ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
}

export async function listUserTaskLogs(taskId: string, limit = 100, offset = 0): Promise<{ total?: number; rows: UserTaskLog[] }> {
  const response = await request<{ total?: number; rows?: UserTaskLog[]; logs?: UserTaskLog[] }>(`${taskPath(taskId)}/logs`, { query: { limit, offset } });
  return { total: response.data?.total, rows: response.data?.rows ?? response.data?.logs ?? [] };
}

export async function getUserTaskLog(taskId: string, logId: number): Promise<UserTaskLog> {
  const response = await request<UserTaskLog>(`${taskPath(taskId)}/logs/${logId}`);
  if (!response.data) throw new ApiError('日志不存在', undefined, 404);
  return response.data;
}

export async function getUserTaskFiles(taskId: string, path = '/'): Promise<UserTaskFileResponse> {
  const response = await request<UserTaskFileResponse>(`${taskPath(taskId)}/files`, { query: { path } });
  return response.data ?? { path, is_dir: true, entries: [] };
}

export async function getUserTaskFileChanges(taskId: string): Promise<UserTaskFileChangesResponse> {
  const response = await request<UserTaskFileChangesResponse>(`${taskPath(taskId)}/files/changes`);
  return response.data ?? { changes: [], success: false, error: '文件变更暂不可用' };
}

export async function getUserTaskFileDiff(taskId: string, path: string, contextLines = 20): Promise<UserTaskFileDiffResponse> {
  const response = await request<UserTaskFileDiffResponse>(`${taskPath(taskId)}/files/diff`, { query: { path, context_lines: contextLines } });
  return response.data ?? { path, diff: '', success: false, error: '文件差异暂不可用' };
}

export async function listUserTaskTerminals(taskId: string): Promise<UserTaskTerminal[]> {
  const response = await request<{ terminals?: UserTaskTerminal[] }>(`${taskPath(taskId)}/terminals`);
  return response.data?.terminals ?? [];
}

/**
 * 某 Git 身份有权访问的仓库分支名列表（创建任务「指定已有分支」用）。
 *
 * 路径里的 repo_full_name 含 ``/``，服务端按 ``{escaped_repo_full_name:path}``
 * 收，且只 unquote 一次 —— 所以这里 encode 恰好一次，不要二次编码。
 */
export async function listRepoBranches(gitIdentityId: string, repoFullName: string): Promise<string[]> {
  const response = await request<{ name?: string }[]>(
    `/api/v1/users/git-identities/${encodeURIComponent(gitIdentityId)}/${encodeURIComponent(repoFullName)}/branches`,
  );
  const rows = Array.isArray(response.data) ? response.data : [];
  return rows.map((item) => String(item?.name || '')).filter(Boolean);
}

export async function deleteUserTaskTerminal(taskId: string, terminalId: string) {
  return (await request(`${taskPath(taskId)}/terminals/${encodeURIComponent(terminalId)}`, { method: 'DELETE' })).data;
}

export async function disableUserTaskKey(taskId: string) {
  return (await request(`${taskPath(taskId)}/api-key/disable`, { method: 'POST' })).data;
}

export async function rotateUserTaskKey(taskId: string) {
  const response = await request<Record<string, unknown>>(`${taskPath(taskId)}/api-key/rotate`, { method: 'POST' });
  return stripPlaintextKey(response.data ?? {});
}

export async function listParentKeys(): Promise<ParentKeyItem[]> {
  const response = await request<ParentKeyItem[]>('/api/v1/users/model-gateway/parent-keys');
  return Array.isArray(response.data) ? response.data : [];
}

/** A team-granted resource reference (skill / mcp / plugin). The ``id`` is the
 * ``resource_id`` the backend resolver accepts; only granted rows are listed,
 * so anything picked here is authorized before persistence. */
export interface AuthorizedResource {
  id: string;
  resource_type: string;
  name: string;
  display_name?: string;
  version?: string;
  status?: string;
}

export type TaskResourceKind = 'skill' | 'mcp' | 'plugin';

export async function listAuthorizedResources(kind: TaskResourceKind): Promise<AuthorizedResource[]> {
  const response = await request<AuthorizedResource[]>('/api/v1/resources/references', { query: { resource_type: kind } });
  return Array.isArray(response.data) ? response.data : [];
}

export function userTaskTerminalUrl(taskId: string, terminalId: string): string {
  const wsBase = getBaseUrl().replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  return `${wsBase}${taskPath(taskId)}/terminals/connect${queryString({ terminal_id: terminalId })}`;
}

export function openUserTaskTerminal(taskId: string, terminalId: string): WebSocket {
  return openWebSocket(userTaskTerminalUrl(taskId, terminalId));
}

export function streamTaskEvents(
  taskId: string,
  onEvent: (event: TaskEvent) => void,
): TaskEventStreamHandle {
  const controller = new AbortController();
  const done = (async () => {
    let response: Response;
    try {
      response = await fetchStream(`${getBaseUrl()}${taskPath(taskId)}/events`, {
        credentials: 'include',
        headers: authHeaders(),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      throw new ApiError((error as Error)?.message || '任务事件连接失败');
    }
    if (!response.ok) {
      // 与 client.request 同源：HTTPException 被全局 handler 包成 {error:{message}}，
      // 只读 detail 会把真实原因退化成 HTTP 状态码。
      const body = await response.json().catch(() => null);
      throw new ApiError(errorMessageFromBody(body, response.status), undefined, response.status);
    }
    if (!response.body) throw new ApiError('当前环境不支持流式响应');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new IncrementalSseParser(({ event, data }) => {
      try {
        const parsed = JSON.parse(data) as TaskEvent;
        onEvent({ ...parsed, kind: event || parsed.kind || 'message' });
      } catch {
        onEvent({ kind: event || 'message', text: data });
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
    } finally {
      reader.cancel().catch(() => undefined);
    }
  })();
  return { done, cancel: () => controller.abort() };
}
