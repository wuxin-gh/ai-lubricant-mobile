import { request } from '@/api/client';

/** /admin/dashboard-stats 的 summary（字段与后端一一对应；后端不返回 retry_count）。 */
export interface DashboardSummary {
  requests: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  cache_creation_tokens: number;
  reasoning_tokens: number;
  reasoning_requests: number;
  reasoning_request_rate: number;
  avg_duration_ms: number;
  error_count: number;
  avg_prm: number;
  avg_tpm: number;
}

/** 排行项。基础字段所有榜单共有，其余按榜单类型可选出现。 */
export interface DashboardRankItem {
  name: string;
  requests: number;
  tokens: number;
  token_share?: number;
  request_share?: number;
  success_requests?: number;
  success_rate?: number;
  failure_rate?: number;
  avg_duration_ms?: number;
  cache_hit_rate?: number;
  cached_tokens?: number;
  prompt_tokens?: number;
}

/**
 * 后端 rankings 的 12 个榜单键。注意后端不返回 by_provider，
 * 渠道维度要从 provider_* 榜单里取。
 */
export type DashboardRankKey =
  | 'model_usage_top' | 'provider_usage_top'
  | 'model_requests_top' | 'provider_requests_top'
  | 'provider_success_rate_top'
  | 'model_failure_rate_top' | 'provider_failure_rate_top'
  | 'model_speed_top' | 'provider_speed_top'
  | 'model_cache_hit_top' | 'provider_cache_hit_top'
  // 账号维度占比榜：按 account_username 聚合；provider 参数可限定到单渠道。
  | 'account_usage_top' | 'account_requests_top'
  | 'custom_model_usage_top';

export interface DashboardSeriesItem {
  bucket: number;
  name: string;
  value: number;
  problem?: string;
}

export interface DashboardStats {
  grain?: string;
  summary?: Partial<DashboardSummary>;
  /** 按系统模型（actual_model）聚合的 Top 20。 */
  by_model?: Array<{ name: string; requests: number; tokens: number }>;
  rankings?: Partial<Record<DashboardRankKey, DashboardRankItem[]>>;
  series?: Record<string, DashboardSeriesItem[]>;
}

export type DashboardGrain = 'hour' | 'day' | 'week';

export interface AdminUserRow {
  created_at?: number | null;
  last_active_at?: number | null;
  is_admin?: boolean;
  is_first_admin?: boolean;
  user: {
    id: string;
    name?: string;
    email?: string | null;
    role?: string;
    status?: string;
    is_blocked?: boolean;
  };
}

export interface ProviderSummary {
  id: string;
  name: string;
  enabled: boolean;
  remark?: string;
  type?: 'custom' | 'builtin';
  protocol?: string | null;
  tags?: string[];
  account_count?: number;
  enabled_account_count?: number;
  auth_failed_account_count?: number;
  requesting_account_count?: number;
  cooldown_account_count?: number;
  models?: string[];
}

export interface ModelMetadataEntry {
  model_id?: string;
  id?: string;
  name?: string;
  owned_by?: string;
  max_context_tokens?: number;
  max_tokens?: number;
  input_modalities?: string[];
  output_modalities?: string[];
}

export interface ModelMetadataResponse {
  models: ModelMetadataEntry[];
  runtime_models: Array<{
    model_id: string;
    providers?: string[];
    has_metadata?: boolean;
    available?: boolean;
    metadata?: ModelMetadataEntry | null;
    reason?: string | null;
  }>;
  summary?: {
    runtime_model_count?: number;
    route_count?: number;
    metadata_model_count?: number;
    missing_metadata_count?: number;
  };
}

export interface AdminApiKey {
  id: number;
  key?: string;
  name: string;
  disabled: boolean;
  created_at?: number;
  selection_strategy?: string;
  provider_whitelist?: unknown;
  provider_blacklist?: unknown;
  model_whitelist?: unknown;
  model_blacklist?: unknown;
  parent_id?: number | null;
  expires_at?: number | null;
  editor_name?: string | null;
  usage_limit?: Record<string, unknown>;
  rate_limit?: Record<string, unknown>;
}

/** API Key 选路策略（与 Web 管理端同一组取值）。 */
export const KEY_SELECTION_STRATEGIES = [
  { value: 'intelligent', label: '智能选择（推荐）' },
  { value: 'fast_intelligent', label: '快速智能' },
  { value: 'sequential', label: '顺序' },
  { value: 'random_member', label: '成员随机' },
  { value: 'model_random', label: '模型随机' },
  { value: 'random_all', label: '全局随机' },
] as const;

export const DEFAULT_KEY_SELECTION_STRATEGY = 'intelligent';

/**
 * 后端 jsonb 字段偶发返回 JSON 文本而非数组，读取前一律归一为字符串数组。
 * 与 Web 管理端 asStringList 同语义。
 */
export function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string' && value.trim()) {
    try { return asStringList(JSON.parse(value)); } catch { return []; }
  }
  return [];
}

/** 从 rate_limit/usage_limit 里按候选键读出正数，读不到返回 undefined。 */
export function limitValue(src: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = src?.[k];
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

export interface RequestLogRow {
  id: number;
  request_id?: string;
  attempt_key?: string | null;
  attempt_no?: number | null;
  time?: number;
  api_key_name?: string | null;
  provider_name?: string;
  account_username?: string;
  // model = 客户端请求的自定义别名；actual_model = 请求真正路由到的系统模型（route_info.public_model_id，空时回退 model）。
  // 列表/详情主显示用 actual_model（系统模型名），requested_model/model 仅作为别名辅助展示。
  requested_model?: string;
  model?: string;
  actual_model?: string;
  upstream_returned_model?: string | null;
  endpoint?: string | null;
  success?: boolean;
  status?: string;
  stream?: boolean | null;
  duration_ms?: number | null;
  first_token_ms?: number | null;
  client_type?: string | null;
  session_id?: string | null;
  editor_id?: string | null;
  editor_session_id?: string | null;
  upstream_status?: number | string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  cached_tokens?: number | null;
  cache_creation_tokens?: number | null;
  payload_truncated?: boolean | null;
  route_duration_ms?: number | null;
  candidate_collect_ms?: number | null;
  strategy_select_ms?: number | null;
  account_reserve_ms?: number | null;
  routing_redis_degraded?: boolean | null;
  routing_detail?: Record<string, unknown> | null;
  proxy_info?: { mode?: string; target_host?: string; node_id?: string; proxy_url?: string } | null;
  has_error?: boolean;
  error_preview?: string;
}

export interface AuditRow {
  id?: string;
  operation?: string;
  target?: string;
  created_at?: string | number;
  source_ip?: string;
  user_agent?: string;
  request?: string;
  response?: string;
  user?: { id?: string; name?: string; email?: string };
}

export interface AuditFilters {
  operation?: string;
  user_id?: string;
  start_time?: string;
  end_time?: string;
}

export interface ProxyEntry {
  id: string;
  name: string;
  mode: 'network' | 'url_prefix' | 'direct' | 'node' | string;
  url?: string;
  username?: string;
  password?: string;
  node_id?: string;
}

export interface NodeInfo {
  node_id: string;
  node_name?: string;
  status?: string;
  role?: string;
  is_passive?: boolean;
  startup_method?: string;
  manager_node_id?: string;
  connected?: boolean;
  online?: boolean;
  last_heartbeat_at?: string;
  active_session_ids?: string[];
  capabilities?: Record<string, string>;
}

export type OnboardNodeRole = 'execution' | 'management' | 'passive_management';
export interface OnboardNodeResult {
  node_id: string;
  secret?: string;
  otpauth_uri?: string;
  install_command?: string;
  script_url?: string;
  launched?: boolean;
  node?: NodeInfo;
}

/**
 * 看板统计。section 只能是 all/summary/tables 或单个 series 名，
 * 传别的值后端只回 { grain }。这里固定 all 取 summary + tables。
 */
export async function getAdminDashboard(
  rangeSeconds = 7 * 24 * 60 * 60,
  grain: DashboardGrain = 'day',
  startAt?: number,
): Promise<DashboardStats> {
  const end = Math.floor(Date.now() / 1000);
  const start = startAt ?? end - rangeSeconds;
  const r = await request<DashboardStats>('/admin/dashboard-stats', {
    query: { start, end, grain, section: 'all' },
  });
  return r.data ?? {};
}

/** 渠道/账号概览 + 可选的按 Key token 用量。 */
export interface AdminStats {
  providers?: Array<{ name: string; total_accounts: number; auth_ok: number; cooldown: number }>;
  models_count?: number;
  total_requests?: number;
}

export async function getAdminStats(): Promise<AdminStats> {
  const r = await request<AdminStats>('/admin/stats');
  return r.data ?? {};
}

export async function getAdminUsers(): Promise<AdminUserRow[]> {
  const r = await request<{ users?: AdminUserRow[] }>('/api/v1/teams/users/all');
  return r.data?.users ?? [];
}

export async function getAdminProviders(): Promise<ProviderSummary[]> {
  const r = await request<ProviderSummary[]>('/admin/providers');
  return Array.isArray(r.data) ? r.data : [];
}

export async function setAdminProviderEnabled(id: string, enabled: boolean): Promise<void> {
  await request(`/admin/providers/${encodeURIComponent(id)}/enabled`, { method: 'PUT', query: { enabled } });
}

export interface ModelRoutingResponse {
  model_groups?: { groups?: Record<string, Record<string, unknown>> };
  providers?: Array<{ name: string; remark?: string; enabled?: boolean; tags?: string[]; models?: string[]; accounts?: string[] }>;
  models?: Array<Record<string, unknown>>;
  api_keys?: Array<Record<string, unknown>>;
}

export async function getAdminModelRouting(): Promise<ModelRoutingResponse> {
  const r = await request<ModelRoutingResponse>('/admin/model-routing');
  return r.data ?? { model_groups: { groups: {} }, providers: [], models: [] };
}

export async function createAdminModelGroup(payload: Record<string, unknown>): Promise<void> {
  await request('/admin/model-groups', { method: 'POST', body: payload });
}

export async function updateAdminModelGroup(name: string, payload: Record<string, unknown>): Promise<void> {
  await request(`/admin/model-groups/${encodeURIComponent(name)}`, { method: 'PUT', body: payload });
}

export async function deleteAdminModelGroup(name: string): Promise<void> {
  await request(`/admin/model-groups/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function getAdminModelMetadata(): Promise<ModelMetadataResponse> {
  const r = await request<ModelMetadataResponse>('/admin/model-metadata');
  return r.data ?? { models: [], runtime_models: [] };
}

export async function getAdminApiKeys(): Promise<{ enabled: boolean; keys: AdminApiKey[] }> {
  const r = await request<{ enabled: boolean; keys: AdminApiKey[] }>('/admin/config/api-keys');
  return r.data ?? { enabled: false, keys: [] };
}

export async function setAdminApiKeyDisabled(id: number, disabled: boolean): Promise<void> {
  await request(`/admin/config/api-keys/${id}/disable`, { method: 'PUT', query: { disabled } });
}

/**
 * 请求日志筛选条件（对应后端 query_request_logs 的查询参数）。
 * 省略/空串表示不筛选；success/stream 为 undefined 表示不筛选。
 */
export interface RequestLogFilters {
  provider_name?: string;
  account_username?: string;
  api_key_name?: string;
  model?: string;
  success?: boolean;
  status?: string;
  stream?: boolean;
  client_type?: string;
  session_id?: string;
  start_time?: number;
  end_time?: number;
}

export async function getAdminRequestLogs(
  offset = 0,
  limit = 50,
  filters: RequestLogFilters = {},
): Promise<{ total: number; rows: RequestLogRow[] }> {
  const query: Record<string, string | number | boolean> = { source: 'live', offset, limit };
  Object.entries(filters).forEach(([k, v]) => {
    if (v === undefined || v === '' || v === null) return;
    query[k] = v as string | number | boolean;
  });
  const r = await request<{ total?: number; rows?: RequestLogRow[] }>('/admin/request-logs', { query });
  return { total: r.data?.total ?? 0, rows: r.data?.rows ?? [] };
}

export async function getAdminAudits(
  cursor?: string,
  limit = 50,
  filters: Pick<AuditFilters, 'operation' | 'user_id'> = {},
): Promise<{ audits: AuditRow[]; cursor?: string; hasNext: boolean }> {
  const r = await request<{ audits?: AuditRow[]; page?: { cursor?: string; has_next_page?: boolean } }>('/api/v1/teams/audits', {
    query: { cursor, limit, operation: filters.operation, user_id: filters.user_id },
  });
  return {
    audits: r.data?.audits ?? [],
    cursor: r.data?.page?.cursor,
    hasNext: !!r.data?.page?.has_next_page,
  };
}

export async function getAdminProxies(): Promise<ProxyEntry[]> {
  const r = await request<ProxyEntry[]>('/admin/config/proxies');
  return Array.isArray(r.data) ? r.data : [];
}

export async function getAdminNodes(): Promise<NodeInfo[]> {
  const r = await request<{ nodes?: NodeInfo[] }>('/api/v1/admin/nodes');
  return r.data?.nodes ?? [];
}

/* ==================== 写操作（共用管理端现有接口，不新增后端） ==================== */

/** 单次尝试（重试链上的一环）。 */
export interface RequestLogAttempt {
  attempt_no?: number | null;
  provider_name?: string | null;
  account_username?: string | null;
  model?: string | null;
  actual_model?: string | null;
  upstream_returned_model?: string | null;
  success?: boolean | null;
  status?: string | null;
  upstream_status?: number | string | null;
  duration_ms?: number | null;
  error?: string | null;
  error_preview?: string | null;
  proxy_info?: Record<string, unknown> | null;
  routing_detail?: Record<string, unknown> | null;
}

/** 请求日志详情：含完整正文与重试链。 */
export interface RequestLogDetail extends RequestLogRow {
  request_body?: Record<string, unknown>;
  request_headers?: Record<string, unknown>;
  router_request_path?: string | null;
  router_request_body?: Record<string, unknown>;
  router_request_headers?: Record<string, unknown>;
  router_response_body?: unknown;
  response_body?: unknown;
  response_headers?: Record<string, unknown>;
  error?: string | null;
  attempts?: RequestLogAttempt[];
  archived?: boolean;
  source?: 'live' | 'archive';
}

export async function getAdminRequestLogDetail(logId: number): Promise<RequestLogDetail | null> {
  const r = await request<RequestLogDetail>(`/admin/request-logs/${logId}`);
  return r.data ?? null;
}

/** API Key 写入载荷（与 Web 管理端 formDataToPayload 同结构）。 */
export interface ApiKeyPayload {
  name: string;
  rate_limit?: Record<string, number>;
  usage_limit?: Record<string, number>;
  provider_whitelist?: string[];
  provider_blacklist?: string[];
  model_whitelist?: string[];
  model_blacklist?: string[];
  selection_strategy?: string;
  expires_at?: number | null;
}

/** 新增 API Key。明文 key 仅在此响应里出现一次，调用方不得持久化。 */
export async function createAdminApiKey(payload: ApiKeyPayload): Promise<AdminApiKey | null> {
  const r = await request<{ ok?: boolean; key?: AdminApiKey }>('/admin/config/api-keys/add', {
    method: 'PUT',
    body: payload,
  });
  return r.data?.key ?? null;
}

export async function deleteAdminApiKey(id: number): Promise<void> {
  await request(`/admin/config/api-keys/${id}`, { method: 'DELETE' });
}

/**
 * 派生子 Key（父子关系，用量汇总回父）。省略字段继承父范围；
 * 给出的维度必须落在父范围内，越权后端返回 400。
 */
export async function copyAdminApiKey(id: number, payload: Partial<ApiKeyPayload> = {}): Promise<AdminApiKey | null> {
  const r = await request<{ ok?: boolean; key?: AdminApiKey }>(`/admin/config/api-keys/${id}/copy`, {
    method: 'PUT',
    body: payload,
  });
  return r.data?.key ?? null;
}

/** 渠道健康检查（逐账号实测，返回结果摘要）。 */
export async function runAdminProviderHealthCheck(id: string): Promise<Record<string, unknown>> {
  const r = await request<Record<string, unknown>>(`/admin/providers/${encodeURIComponent(id)}/health-check`, {
    method: 'POST',
  });
  return r.data ?? {};
}

/**
 * 代理池写操作。
 *
 * 后端只有全量 `PUT /admin/config/proxies`，没有单条新增/删除端点，因此新增与删除
 * 都是「读当前列表 → 改 → 全量回写」。未变更条目必须原样带回 id（含 node 模式的
 * node_id），否则后端会按 name|mode|url 重算 id，让绑定该代理的账号引用失效。
 */
function toProxyInput(p: ProxyEntry): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    mode: p.mode,
    url: p.url ?? '',
    username: p.username ?? '',
    password: p.password ?? '',
    ...(p.mode === 'node' ? { node_id: p.node_id ?? '' } : {}),
  };
}

export async function addAdminProxy(input: {
  name: string;
  mode: ProxyEntry['mode'];
  url?: string;
  username?: string;
  password?: string;
  node_id?: string;
}): Promise<void> {
  const current = await getAdminProxies();
  await request('/admin/config/proxies', {
    method: 'PUT',
    body: [
      ...current.map(toProxyInput),
      {
        name: input.name,
        mode: input.mode,
        url: input.url ?? '',
        username: input.username ?? '',
        password: input.password ?? '',
        ...(input.mode === 'node' ? { node_id: input.node_id ?? '' } : {}),
      },
    ],
  });
}

export async function deleteAdminProxy(id: string): Promise<void> {
  const current = await getAdminProxies();
  await request('/admin/config/proxies', {
    method: 'PUT',
    body: current.filter((p) => p.id !== id).map(toProxyInput),
  });
}

/** 节点控制面：与 Web 管理端共用现有接口。入驻凭证只在响应中出现一次。 */
export async function onboardAdminNode(payload: {
  role: OnboardNodeRole;
  startup_method?: string;
  node_name?: string;
  manager_node_id?: string;
}): Promise<OnboardNodeResult> {
  const r = await request<OnboardNodeResult>('/api/v1/admin/nodes/onboard', { method: 'POST', body: payload });
  return r.data ?? { node_id: '' };
}

export async function moveAdminNode(nodeId: string, managerNodeId: string): Promise<void> {
  await request(`/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/move`, {
    method: 'POST', body: { manager_node_id: managerNodeId },
  });
}

export async function revokeAdminNodeOnboard(nodeId: string): Promise<void> {
  await request(`/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/onboard`, { method: 'DELETE' });
}

export async function installAdminNodeEditor(nodeId: string, editor: string): Promise<{ version?: string }> {
  const r = await request<{ version?: string }>(`/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/editors/${encodeURIComponent(editor)}/install`, { method: 'POST' });
  return r.data ?? {};
}

export async function upgradeAdminNodeEditor(nodeId: string, editor: string): Promise<{ version?: string }> {
  const r = await request<{ version?: string }>(`/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/editors/${encodeURIComponent(editor)}/upgrade`, { method: 'POST' });
  return r.data ?? {};
}

export async function getLatestAdminNodeVersion(): Promise<string> {
  const r = await request<{ version?: string }>('/api/v1/admin/nodes/latest-version');
  return r.data?.version ?? '';
}

export async function selfUpgradeAdminNode(nodeId: string): Promise<void> {
  await request(`/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/self-upgrade`, { method: 'POST' });
}

export async function approveAdminNode(nodeId: string): Promise<void> {
  await request(`/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/approve`, { method: 'POST' });
}

export async function revokeAdminNode(nodeId: string): Promise<void> {
  await request(`/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/revoke`, { method: 'POST' });
}

/* ==================== 成员与分组（/api/v1/teams/*，与管理端共用） ==================== */

export interface TeamGroup {
  id: string;
  name: string;
  created_at?: number | null;
  updated_at?: number | null;
  users?: Array<{ id: string; name?: string; email?: string | null }>;
}

/** 创建用户：返回一次性初始密码，仅在此显示一次。 */
export async function createAdminUser(payload: {
  email: string;
  name?: string;
  is_admin?: boolean;
}): Promise<{ password?: string; user?: { email?: string | null } }> {
  const r = await request<{ password?: string; user?: { email?: string | null } }>('/api/v1/teams/users', {
    method: 'POST',
    body: payload,
  });
  return r.data ?? {};
}

/** 更新用户名称 / 停用状态。 */
export async function updateAdminUser(
  id: string,
  payload: { name?: string; is_blocked?: boolean },
): Promise<void> {
  await request(`/api/v1/teams/users/${encodeURIComponent(id)}`, { method: 'PUT', body: payload });
}

/** 设置/取消管理员。首个管理员后端会拒绝取消。 */
export async function setAdminUserAdmin(id: string, isAdmin: boolean): Promise<void> {
  await request(`/api/v1/teams/users/${encodeURIComponent(id)}/admin`, {
    method: 'PUT',
    body: { is_admin: isAdmin },
  });
}

export async function deleteAdminUser(id: string): Promise<void> {
  await request(`/api/v1/teams/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 重置密码：返回一次性新密码。 */
export async function resetAdminUserPassword(id: string): Promise<{ password?: string }> {
  const r = await request<{ password?: string }>(
    `/api/v1/teams/users/${encodeURIComponent(id)}/passwords/reset`,
    { method: 'PUT' },
  );
  return r.data ?? {};
}

export async function getAdminGroups(): Promise<TeamGroup[]> {
  const r = await request<{ groups?: TeamGroup[] }>('/api/v1/teams/groups');
  return r.data?.groups ?? [];
}

export async function createAdminGroup(name: string): Promise<void> {
  await request('/api/v1/teams/groups', { method: 'POST', body: { name } });
}

export async function renameAdminGroup(id: string, name: string): Promise<void> {
  await request(`/api/v1/teams/groups/${encodeURIComponent(id)}`, { method: 'PUT', body: { name } });
}

export async function deleteAdminGroup(id: string): Promise<void> {
  await request(`/api/v1/teams/groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 覆盖分组成员：传入该分组应包含的全部 user_id。 */
export async function setAdminGroupUsers(groupId: string, userIds: string[]): Promise<void> {
  await request(`/api/v1/teams/groups/${encodeURIComponent(groupId)}/users`, {
    method: 'PUT',
    body: { user_ids: userIds },
  });
}

export interface GroupApiKeyRow { id: number; name: string; key_masked?: string; disabled?: boolean; bound?: boolean }
export interface GroupMcpRow { id: number; name: string; display_name?: string; description?: string; enabled?: boolean; builtin?: boolean; runtime_status?: string; bound?: boolean }
export interface GroupNodeRow extends NodeInfo { bound?: boolean; node_role?: string; is_passive?: boolean; manager_node_id?: string; capabilities?: Record<string, string> }
export interface GroupSkillRow { id: string; name: string; description?: string; source_type?: string; source_label?: string; tags?: string[]; bound?: boolean }

export async function getAdminGroupApiKeys(groupId: string): Promise<GroupApiKeyRow[]> {
  const r = await request<{ keys?: GroupApiKeyRow[] }>(`/api/v1/teams/groups/${encodeURIComponent(groupId)}/api-keys`);
  return r.data?.keys ?? [];
}
export async function setAdminGroupApiKeys(groupId: string, keyIds: number[]): Promise<void> {
  await request(`/api/v1/teams/groups/${encodeURIComponent(groupId)}/api-keys`, { method: 'PUT', body: { key_ids: keyIds } });
}
export async function getAdminGroupMcpServices(groupId: string): Promise<GroupMcpRow[]> {
  const r = await request<{ services?: GroupMcpRow[] }>(`/api/v1/teams/groups/${encodeURIComponent(groupId)}/mcp-services`);
  return r.data?.services ?? [];
}
export async function setAdminGroupMcpServices(groupId: string, serviceIds: number[]): Promise<void> {
  await request(`/api/v1/teams/groups/${encodeURIComponent(groupId)}/mcp-services`, { method: 'PUT', body: { service_ids: serviceIds } });
}
export async function getAdminGroupNodePicker(groupId: string): Promise<GroupNodeRow[]> {
  const r = await request<{ nodes?: GroupNodeRow[] }>(`/api/v1/teams/groups/${encodeURIComponent(groupId)}/node-picker`);
  return r.data?.nodes ?? [];
}
export async function bindAdminGroupNode(groupId: string, nodeId: string): Promise<void> {
  await request(`/api/v1/teams/groups/${encodeURIComponent(groupId)}/nodes`, { method: 'POST', body: { node_id: nodeId } });
}
export async function unbindAdminGroupNode(groupId: string, nodeId: string): Promise<void> {
  await request(`/api/v1/teams/groups/${encodeURIComponent(groupId)}/nodes/${encodeURIComponent(nodeId)}`, { method: 'DELETE' });
}
export async function getAdminGroupSkills(groupId: string): Promise<GroupSkillRow[]> {
  const r = await request<{ skills?: GroupSkillRow[] }>(`/api/v1/teams/groups/${encodeURIComponent(groupId)}/skills`);
  return r.data?.skills ?? [];
}
export async function setAdminGroupSkills(groupId: string, skillIds: string[]): Promise<void> {
  await request(`/api/v1/teams/groups/${encodeURIComponent(groupId)}/skills`, { method: 'PUT', body: { skill_ids: skillIds } });
}

/* ==================== API Key 编辑 + 全局开关 ==================== */

/** 编辑 API Key：name / 限流 / 白名单等，字段全部可选。 */
export async function updateAdminApiKey(id: number, payload: Record<string, unknown>): Promise<AdminApiKey | null> {
  const r = await request<{ ok?: boolean; key?: AdminApiKey }>(`/admin/config/api-keys/${id}`, {
    method: 'PUT',
    body: payload,
  });
  return r.data?.key ?? null;
}

/** 全局开关 API Key 认证。关闭后所有请求不再校验 Key。 */
export async function setAdminApiKeysEnabled(enabled: boolean): Promise<void> {
  await request('/admin/config/api-keys/enabled', { method: 'PUT', query: { enabled } });
}

/* ==================== 模型元数据 编辑/删除 ==================== */

export interface ModelMetadataUpdateBody {
  name?: string;
  owned_by?: string;
  max_context_tokens?: number;
  max_tokens?: number;
  input_modalities?: string[];
  output_modalities?: string[];
  function_calling?: boolean;
  auto_thinking?: boolean;
  auto_search?: boolean;
  icon_url?: string;
}

/** 创建或更新模型元数据（PUT /admin/model-metadata/{id}）。 */
export async function updateAdminModelMetadata(
  id: string,
  body: ModelMetadataUpdateBody,
): Promise<ModelMetadataEntry | null> {
  const r = await request<ModelMetadataEntry>(`/admin/model-metadata/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body,
  });
  return r.data ?? null;
}

export async function deleteAdminModelMetadata(id: string): Promise<void> {
  await request(`/admin/model-metadata/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ==================== 渠道（Provider）增删改 + 账号管理 ==================== */

/** 账号规范状态（后端 rate_limiter.AccountState 同源）。 */
export type AccountState =
  | 'disabled'
  | 'frozen'
  | 'cooling'
  | 'model_frozen'
  | 'auth_failed'
  | 'checking'
  | 'available';

export interface ProviderAccount {
  username?: string;
  api_key?: string;
  password?: string;
  enabled?: boolean;
  switch?: boolean;
  proxy?: string;
  price_remark?: string;
  rpd_limit?: number;
  priority?: number;
  weight?: number;
  /** 账号规范状态：lite/full 视图都返回，状态展示的唯一判据 */
  state?: AccountState;
  /** 是否处于冻结中（永久+临时）；判永久用 state==='frozen' */
  cooldown?: boolean;
  status?: string;
  last_error?: string | null;
  cooldown_until?: number | null;
  [key: string]: unknown;
}

export interface ProviderBaseConfig {
  id?: string;
  name?: string;
  remark?: string;
  protocol?: string | null;
  base_url?: string;
  chat_path?: string;
  models_path?: string;
  timeout?: number;
  retry_count?: number | null;
  enabled?: boolean;
}

/** 渠道账号列表（view=lite 较轻）。 */
export async function getAdminProviderAccounts(id: string): Promise<ProviderAccount[]> {
  const r = await request<ProviderAccount[]>(`/admin/providers/${encodeURIComponent(id)}/accounts`, {
    query: { view: 'lite' },
  });
  return Array.isArray(r.data) ? r.data : [];
}

/** 渠道基础配置（GET /admin/providers/{id}/base）：编辑表单的真实回填来源。 */
export async function getAdminProviderBase(id: string): Promise<Record<string, unknown>> {
  const r = await request<Record<string, unknown>>(`/admin/providers/${encodeURIComponent(id)}/base`);
  return (r.data as Record<string, unknown>) ?? {};
}

/** 渠道模型条目。后端只认这 3 个字段，其余为 UI/历史别名。 */
export interface ProviderModelEntry {
  upstream_model_id: string;
  model_id?: string;
  extra_config?: Record<string, unknown>;
}

export async function getAdminProviderModels(id: string): Promise<ProviderModelEntry[]> {
  const r = await request<{ models?: ProviderModelEntry[] }>(`/admin/providers/${encodeURIComponent(id)}/models`);
  return r.data?.models ?? [];
}

/** 新增/更新单个渠道模型（POST，按 upstream_model_id 去重）。 */
export async function upsertAdminProviderModel(id: string, model: ProviderModelEntry): Promise<void> {
  await request(`/admin/providers/${encodeURIComponent(id)}/models`, { method: 'POST', body: model });
}

export async function deleteAdminProviderModel(id: string, upstreamModelId: string): Promise<void> {
  await request(
    `/admin/providers/${encodeURIComponent(id)}/models/${encodeURIComponent(upstreamModelId)}`,
    { method: 'DELETE' },
  );
}

/** 从上游刷新模型列表。 */
export async function refreshAdminProviderModels(id: string): Promise<{ models?: unknown[] }> {
  const r = await request<{ models?: unknown[] }>(`/admin/providers/${encodeURIComponent(id)}/refresh-models`, {
    method: 'POST',
  });
  return r.data ?? {};
}

/**
 * 渠道限流策略。enabled=false 时后端把四项数值限额全部按 0（不限）处理。
 * cooldown_policy 的值是「秒数字符串」，-1=当天结束，-2=停用账号。
 */
export interface ProviderLimitPolicy {
  provider_name?: string;
  name?: string;
  enabled?: boolean;
  account_rpm?: number;
  account_tpm?: number;
  model_tpm?: number;
  account_concurrent?: number;
  account_rph?: number;
  account_tph?: number;
  account_rpd?: number;
  account_tpd?: number;
  cooldown_policy?: Record<string, string>;
  freeze_policy?: { enabled?: boolean; rules?: unknown[] };
  extra?: Record<string, unknown>;
}

export async function getAdminProviderLimitPolicy(id: string): Promise<ProviderLimitPolicy> {
  const r = await request<ProviderLimitPolicy>(`/admin/providers/${encodeURIComponent(id)}/limit-policy`);
  return r.data ?? {};
}

export async function updateAdminProviderLimitPolicy(id: string, payload: ProviderLimitPolicy): Promise<void> {
  await request(`/admin/providers/${encodeURIComponent(id)}/limit-policy`, { method: 'PUT', body: payload });
}

/** 批量清除该渠道所有账号的冻结/冷却。 */
export async function clearAdminProviderCooldowns(id: string): Promise<{ cleared?: number }> {
  const r = await request<{ ok?: boolean; cleared?: number }>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/clear-all-cooldowns`,
    { method: 'POST' },
  );
  return r.data ?? {};
}

/** 新增渠道账号。后端默认 switch=True。 */
export async function addAdminProviderAccount(
  id: string,
  payload: { username?: string; api_key?: string; password?: string },
): Promise<void> {
  await request(`/admin/providers/${encodeURIComponent(id)}/accounts/add`, {
    method: 'PUT',
    body: payload,
  });
}

export async function updateAdminProviderAccount(id: string, username: string, payload: Record<string, unknown>): Promise<void> {
  await request(`/admin/providers/${encodeURIComponent(id)}/accounts/${encodeURIComponent(username)}`, { method: 'PUT', body: payload });
}

export async function deleteAdminProviderAccount(id: string, username: string): Promise<void> {
  await request(
    `/admin/providers/${encodeURIComponent(id)}/accounts/${encodeURIComponent(username)}`,
    { method: 'DELETE' },
  );
}

export async function setAdminProviderAccountEnabled(
  id: string,
  username: string,
  enabled: boolean,
): Promise<void> {
  await request(
    `/admin/providers/${encodeURIComponent(id)}/accounts/${encodeURIComponent(username)}/switch`,
    { method: 'PUT', query: { switch: enabled } },
  );
}

/**
 * 创建自定义渠道（POST /admin/custom-providers）。
 * 移动端只暴露必要字段：名称、备注、协议、base_url、chat_path、首个账号 api_key、模型列表。
 * 与 Web 管理端同一接口，未暴露的字段由后端补默认值。
 */
export async function createAdminProvider(payload: {
  name?: string;
  remark?: string;
  protocol?: string;
  base_url?: string;
  chat_path?: string;
  models_path?: string;
  enabled?: boolean;
  auto_update_models?: boolean;
  timeout?: number;
  retry_count?: number | null;
  account_priority?: number;
  account_weight?: number;
  accounts?: Array<{ api_key?: string; username?: string; password?: string }>;
  models?: string[];
}): Promise<{ id?: string; name?: string }> {
  const r = await request<{ id?: string; name?: string; provider_id?: string }>('/admin/custom-providers', {
    method: 'POST',
    body: payload,
  });
  return { id: r.data?.id ?? r.data?.provider_id, name: r.data?.name };
}

/** 删除渠道。 */
export async function deleteAdminProvider(id: string): Promise<void> {
  await request(`/admin/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * 更新渠道基础配置（PUT /admin/providers/{id}/custom）。
 * 后端允许的字段子集：remark / base_url / timeout / retry_count / ... 名称不可改。
 */
export async function updateAdminProvider(id: string, payload: Record<string, unknown>): Promise<void> {
  await request(`/admin/providers/${encodeURIComponent(id)}/custom`, { method: 'PUT', body: payload });
}

/* ==================== 代理池：编辑（全量 PUT） ==================== */

/**
 * 编辑代理：读当前列表 → 替换匹配 id 的条目 → 全量回写。
 * 必须回传既有 id（node 模式含 node_id），否则后端重算 id 会让账号引用失效。
 * node 模式的 node_id 不在表单中编辑，编辑时保留原值。
 */
export async function editAdminProxy(
  id: string,
  input: {
    name: string;
    mode: ProxyEntry['mode'];
    url?: string;
    username?: string;
    password?: string;
    node_id?: string;
  },
): Promise<void> {
  const current = await getAdminProxies();
  await request('/admin/config/proxies', {
    method: 'PUT',
    body: current.map((p) => {
      if (p.id !== id) return toProxyInput(p);
      return {
        id: p.id,
        name: input.name,
        mode: input.mode,
        url: input.url ?? '',
        username: input.username ?? '',
        password: input.password ?? '',
        ...(input.mode === 'node' ? { node_id: input.node_id ?? p.node_id ?? '' } : {}),
      };
    }),
  });
}
