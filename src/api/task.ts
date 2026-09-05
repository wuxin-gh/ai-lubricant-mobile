import { ApiError, authHeaders, getBaseUrl, openWebSocket, request } from './client';
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
}

export interface CreateUserTaskPayload {
  content: string;
  node_id?: string;
  provider?: TaskProvider;
  cli_name?: TaskProvider;
  model_id?: string;
  models?: string[];
  git_identity_id?: string;
  repo?: { repo_url?: string; branch?: string; commit?: string };
  extra?: { project_id?: string; issue_id?: string; skill_ids?: string[]; plugin_ids?: string[] };
  mode?: string;
  parent_api_key_id?: number;
  usage_limit?: Record<string, number>;
  expires_at?: number;
  expected_client_id?: string;
  bootstrap_content?: string;
  skill_config?: Record<string, unknown>[];
  mcp_config?: Record<string, unknown>[];
  plugin_config?: Record<string, unknown>[];
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
      response = await fetch(`${getBaseUrl()}${taskPath(taskId)}/events`, {
        credentials: 'include',
        headers: authHeaders(),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      throw new ApiError((error as Error)?.message || '任务事件连接失败');
    }
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json() as { detail?: string };
        detail = body.detail || detail;
      } catch {
        // Keep the HTTP fallback.
      }
      throw new ApiError(detail, undefined, response.status);
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
