/**
 * 轻量 HTTP 客户端。
 *
 * 鉴权沿用 Web 端的会话 Cookie（后端签发的平台会话 Cookie）。React Native 的原生网络层
 * （iOS NSURLSession / Android OkHttp）会自动持久化并回传 Cookie，因此登录成功后
 * 后续请求无需手动携带 token。
 */
import type {
  AddGitIdentityReq,
  ApiEnvelope,
  AssignIssueReq,
  CheckModelResp,
  CreateIssueReq,
  CreateModelReq,
  CreateProjectReq,
  CreateTaskReq,
  GitIdentity,
  ListProjectResp,
  ListTaskResp,
  Model,
  Node,
  Project,
  ProjectIssue,
  ProjectIssueComment,
  ProjectTask,
  ProviderModelItem,
  Skill,
  TeamUser,
  UpdateGitIdentityReq,
  UpdateIssueReq,
  UpdateModelReq,
  UserStatus,
} from './types';
import { base64Encode } from '@/messages/base64';
import type { UserTaskSummary } from './task';
import { normalizeData } from './endpointMap';

export const DEFAULT_BASE_URL = '';

let baseUrl = DEFAULT_BASE_URL;
let basicAuth = ''; // 形如 "user:pass"，用于连接带 HTTP Basic Auth 的测试环境（反向代理层鉴权）
let onUnauthorized: (() => void) | null = null;

export function setBaseUrl(url: string) {
  baseUrl = url.replace(/\/+$/, '');
}
export function getBaseUrl() {
  return baseUrl;
}

export function setBasicAuth(v: string) {
  basicAuth = (v || '').trim();
}
export function getBasicAuth() {
  return basicAuth;
}
/** 测试环境的 Basic Auth 头（未设置时为空对象，可安全展开）。 */
export function authHeaders(): Record<string, string> {
  if (!basicAuth) return {};
  // 用应用自带的 base64（不依赖 btoa —— Hermes 上 btoa 可能缺失，会让 Basic Auth 头静默丢失，
  // 表现为 Android 下载 401 而 iOS 因系统凭据缓存仍可用）。
  return { Authorization: `Basic ${base64Encode(basicAuth)}` };
}
/** 拆出 Basic Auth 的用户名/密码（给 WebView 的 basicAuthCredential 用）。 */
export function basicAuthCredential(): { username: string; password: string } | undefined {
  if (!basicAuth) return undefined;
  const i = basicAuth.indexOf(':');
  return i < 0 ? { username: basicAuth, password: '' } : { username: basicAuth.slice(0, i), password: basicAuth.slice(i + 1) };
}

/**
 * 建一个带 Basic Auth 头的 WebSocket。
 * RN 的 WebSocket 支持第三个 options 参数透传请求头（TS 类型未声明，故 cast）；
 * 没设置 Basic Auth 时 headers 为空对象，无副作用。
 */
export function openWebSocket(url: string): WebSocket {
  const WS = WebSocket as unknown as { new (url: string, protocols: undefined, options: { headers: Record<string, string> }): WebSocket };
  return new WS(url, undefined, { headers: authHeaders() });
}

/**
 * 把可能是相对路径的资源地址（头像等）解析成绝对地址。
 * 浏览器里相对地址会按同源自动补全，但 RN 的 <Image> 必须是绝对地址。
 */
export function resolveAssetUrl(url?: string | null): string | undefined {
  const u = (url || '').trim();
  if (!u) return undefined;
  if (/^(https?:)?\/\//i.test(u) || u.startsWith('data:')) return u; // 已是绝对地址 / data URI
  const b = baseUrl.replace(/\/+$/, '');
  return u.startsWith('/') ? `${b}${u}` : `${b}/${u}`;
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code?: number,
    public status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildQuery(query?: Query): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
}

export async function request<T = unknown>(
  path: string,
  opts: RequestOpts = {},
): Promise<ApiEnvelope<T>> {
  const { method = 'GET', query, body } = opts;
  const url = `${baseUrl}${path}${buildQuery(query)}`;

  const headers: Record<string, string> = { ...authHeaders() };
  if (body) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: Object.keys(headers).length ? headers : undefined,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError((e as Error)?.message || '网络错误');
  }

  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError('登录已过期，请重新登录', undefined, 401);
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // 某些接口（如登出）成功时无 JSON 体；解析失败按状态码处理
    if (!res.ok) {
      throw new ApiError(`请求失败（${res.status}）`, undefined, res.status);
    }
    return { code: 0 } as ApiEnvelope<T>;
  }

  // 后端 FastAPI 的 C 端接口大多返回裸 REST JSON（{rows,total,...} 或裸对象/数组），
  // 只有 /status、/oidc/default-team 仍返回 {code,message,data} 信封。
  // 这里统一：信封里的错误码照旧抛；否则把裸体包成 {code:0, data: body}，
  // 再按 path 套 transform 重映射成 wrapper 期望的形状（见 endpointMap.ts）。
  if (json && typeof json === 'object' && typeof (json as any).code === 'number' && (json as any).code !== 0) {
    throw new ApiError((json as any).message || '请求失败', (json as any).code, res.status);
  }
  if (!res.ok) {
    const detail = (json as any)?.detail || (json as any)?.message;
    throw new ApiError(typeof detail === 'string' && detail ? detail : `请求失败（${res.status}）`, undefined, res.status);
  }
  const data = normalizeData(method, path, json);
  return { code: 0, message: '', data } as ApiEnvelope<T>;
}

/* ----------------------------- 具体接口 ----------------------------- */

export function login(email: string, password: string, captchaToken: string) {
  return request<UserStatus>('/api/v1/users/password-login', {
    method: 'POST',
    body: { email, password, captcha_token: captchaToken },
  });
}

export function logout() {
  return request('/api/v1/users/logout', { method: 'POST' }).catch(() => undefined);
}

export async function getUserStatus(): Promise<UserStatus> {
  const resp = await request<{ user?: UserStatus }>('/api/v1/users/status');
  return resp.data?.user ?? {};
}

/** 任务数（读 page_info.total）。传 project_id 即为该项目下的任务数，可再按 status 过滤。 */
export async function getTaskCount(params: { project_id?: string; status?: string } = {}): Promise<number> {
  const resp = await request<ListTaskResp>('/api/v1/users/tasks', { query: { page: 1, page_size: 1, ...params } });
  const pi = resp.data?.page_info;
  return pi?.total_count ?? pi?.total ?? resp.data?.tasks?.length ?? 0;
}

export async function listTasks(params: {
  page?: number;
  page_size?: number;
  status?: string;
  project_id?: string;
}): Promise<ProjectTask[]> {
  const resp = await request<ListTaskResp>('/api/v1/users/tasks', { query: params });
  return resp.data?.tasks ?? [];
}

export async function listProjects(params: {
  page?: number;
  page_size?: number;
} = {}): Promise<{ projects: Project[]; hasMore: boolean }> {
  const resp = await request<ListProjectResp>('/api/v1/users/projects', { query: params });
  return {
    projects: resp.data?.projects ?? [],
    hasMore: !!resp.data?.page?.has_more,
  };
}

export async function getProjectDetail(id: string): Promise<Project | null> {
  const resp = await request<Project>(`/api/v1/users/projects/${id}`);
  return resp.data ?? null;
}

/** 项目下需求/bug 列表。筛选参数直接透传后端双状态线接口。 */
export async function listIssues(projectId: string, filters: {
  type?: 'requirement' | 'bug';
  status?: string;
  priority?: number;
  assigned_to_me?: boolean;
} = {}): Promise<ProjectIssue[]> {
  const resp = await request<ProjectIssue[]>(`/api/v1/users/projects/${projectId}/issues`, {
    query: { ...filters, assigned_to_me: filters.assigned_to_me ? true : undefined },
  });
  return Array.isArray(resp.data) ? resp.data : [];
}

/** 创建需求或 bug。服务端统一将初始状态设为 unassigned。 */
export async function createIssue(projectId: string, req: CreateIssueReq): Promise<ProjectIssue | null> {
  const resp = await request<ProjectIssue>(`/api/v1/users/projects/${projectId}/issues`, { method: 'POST', body: req });
  return resp.data ?? null;
}

/** 更新 issue 字段（包括人工状态变更）。 */
export function updateIssue(projectId: string, issueId: string, fields: Partial<UpdateIssueReq>) {
  return request(`/api/v1/users/projects/${projectId}/issues/${issueId}`, { method: 'PUT', body: fields });
}

/** 只换分配者，不启动任务（区别于 assignIssue）。 */
export async function reassignIssue(projectId: string, issueId: string, assigneeId: string): Promise<ProjectIssue | null> {
  const resp = await request<ProjectIssue>(`/api/v1/users/projects/${projectId}/issues/${issueId}/reassign`, {
    method: 'POST',
    body: { assignee_id: assigneeId },
  });
  return resp.data ?? null;
}

/** Issue 评论列表。 */
export async function listIssueComments(projectId: string, issueId: string): Promise<ProjectIssueComment[]> {
  const resp = await request<ProjectIssueComment[]>(`/api/v1/users/projects/${projectId}/issues/${issueId}/comments`);
  return Array.isArray(resp.data) ? resp.data : [];
}

/** 发表 Issue 评论。 */
export async function addIssueComment(projectId: string, issueId: string, comment: string): Promise<ProjectIssueComment | null> {
  const resp = await request<ProjectIssueComment>(`/api/v1/users/projects/${projectId}/issues/${issueId}/comments`, {
    method: 'POST',
    body: { comment },
  });
  return resp.data ?? null;
}

/** 团队成员列表（分配者选择用；后端隐藏 email）。 */
export async function listTeamUsers(): Promise<TeamUser[]> {
  const resp = await request<{ users?: Array<{ user?: TeamUser; is_admin?: boolean }> }>('/api/v1/teams/users/all');
  return (resp.data?.users ?? [])
    .map((row) => ({ ...(row.user ?? {}), id: String(row.user?.id ?? ''), is_admin: row.is_admin }))
    .filter((u) => !!u.id);
}

/** 分配 issue 并创建对应 coding task。 */
export async function assignIssue(projectId: string, issueId: string, req: AssignIssueReq) {
  const resp = await request<{ issue?: ProjectIssue; task?: UserTaskSummary }>(
    `/api/v1/users/projects/${projectId}/issues/${issueId}/assign`,
    { method: 'POST', body: req },
  );
  return resp.data;
}

/** 人工确认/退回设计文档或 bug 根因。 */
export async function confirmIssue(projectId: string, issueId: string, confirmed: boolean, comment?: string) {
  const resp = await request<{ issue?: ProjectIssue; task?: UserTaskSummary }>(
    `/api/v1/users/projects/${projectId}/issues/${issueId}/confirm`,
    { method: 'POST', body: { approve: confirmed, note: comment } },
  );
  return resp.data;
}

/** 创建项目（关联一个已绑定的 Git 身份 + 仓库）。对齐 Web add-project。 */
export async function createProject(req: CreateProjectReq): Promise<Project | null> {
  const resp = await request<Project>('/api/v1/users/projects', { method: 'POST', body: req });
  return resp.data ?? null;
}

/* ----------------------------- Git 身份 ----------------------------- */

/** 当前用户的 Git 身份列表（过滤系统内部身份，与 Web data-provider 一致）。 */
export async function listGitIdentities(): Promise<GitIdentity[]> {
  const resp = await request<GitIdentity[]>('/api/v1/users/git-identities');
  return (resp.data ?? []).filter((i) => i.platform !== 'internal');
}

/** 单个 Git 身份详情，含 authorized_repositories；flush=true 刷新远端仓库缓存。 */
export async function getGitIdentity(id: string, flush = false): Promise<GitIdentity | null> {
  const resp = await request<GitIdentity>(`/api/v1/users/git-identities/${id}`, { query: { flush } });
  return resp.data ?? null;
}

/** 手动绑定 Git 身份（填写 Access Token 方式）。 */
export async function addGitIdentity(req: AddGitIdentityReq): Promise<GitIdentity | null> {
  const resp = await request<GitIdentity>('/api/v1/users/git-identities', { method: 'POST', body: req });
  return resp.data ?? null;
}

/** 更新 Git 身份（只传需变更的字段；platform/base_url 不可改，access_token 留空表示不动）。 */
export function updateGitIdentity(id: string, req: UpdateGitIdentityReq) {
  return request(`/api/v1/users/git-identities/${id}`, { method: 'PUT', body: req });
}

/** 移除 Git 身份。被项目占用时后端返回 409。 */
export function deleteGitIdentity(id: string) {
  return request(`/api/v1/users/git-identities/${id}`, { method: 'DELETE' });
}

export async function getTaskDetail(id: string): Promise<ProjectTask | null> {
  const resp = await request<ProjectTask>(`/api/v1/users/tasks/${id}`);
  return resp.data ?? null;
}

export async function listModels(): Promise<Model[]> {
  const resp = await request<{ models?: Model[] }>('/api/v1/users/models');
  return resp.data?.models ?? [];
}

// ── 编辑器（只读）──────────────────────────────────────────────────────
// 后端 /api/v1/users/editors 返回当前用户拥有的编辑器工作区列表（裸数组），
// /{id}/files?path= 读目录（is_dir:true 返回 entries）或文件内容（utf-8/base64）。

export interface EditorEntry {
  id: string;
  name?: string;
  project_id?: string;
  provider?: string;
  branch?: string;
  workdir?: string;
  node_id?: string;
  status?: string;
  created_at?: string;
}

/** 当前用户拥有的编辑器工作区列表。 */
export async function listEditors(): Promise<EditorEntry[]> {
  const resp = await request<EditorEntry[]>('/api/v1/users/editors');
  return Array.isArray(resp.data) ? resp.data : [];
}

export interface EditorFileListResp {
  path: string;
  is_dir: boolean;
  entries?: { name: string; size: number; is_dir: boolean }[];
  content?: string;
  encoding?: 'utf-8' | 'base64';
  truncated?: boolean;
}

/** 读编辑器工作区内的目录或小文件（4MiB 上限，只读）。 */
export async function readEditorFiles(editorId: string, path = '/'): Promise<EditorFileListResp> {
  const resp = await request<EditorFileListResp>(`/api/v1/users/editors/${editorId}/files`, { query: { path } });
  return (resp.data as EditorFileListResp) ?? { path, is_dir: true, entries: [] };
}

/** 创建当前用户的自有模型配置。 */
export async function createModel(req: CreateModelReq): Promise<Model | null> {
  const resp = await request<Model>('/api/v1/users/models', { method: 'POST', body: req });
  return resp.data ?? null;
}

export function updateModel(id: string, req: UpdateModelReq) {
  return request(`/api/v1/users/models/${id}`, { method: 'PUT', body: req });
}

export function deleteModel(id: string) {
  return request(`/api/v1/users/models/${id}`, { method: 'DELETE' });
}

/** 按配置做健康检查（不落库），保存前校验配置可用性。 */
export async function checkModelConfig(req: Pick<CreateModelReq, 'provider' | 'model' | 'base_url' | 'api_key' | 'interface_type'>): Promise<CheckModelResp> {
  const resp = await request<CheckModelResp>('/api/v1/users/models/health-check', { method: 'POST', body: req });
  return resp.data ?? {};
}

/** 拉取供应商支持的模型列表（拉不到时由调用方回退为手动输入）。 */
export async function listProviderModels(params: { api_key: string; base_url: string; provider: string }): Promise<ProviderModelItem[]> {
  const resp = await request<{ models?: ProviderModelItem[]; error?: { message?: string } }>('/api/v1/users/models/providers', { query: params });
  return resp.data?.models ?? [];
}

/**
 * 当前用户可用的执行节点（聚合自其所属分组绑定的 agent-compose 节点）。
 * 任务运行时已从 host+image 改为节点：建任务时从这里挑一个空闲节点传 ``node_id``。
 */
export async function listNodes(): Promise<Node[]> {
  const resp = await request<{ nodes?: Node[] }>('/api/v1/teams/my-nodes');
  return resp.data?.nodes ?? [];
}

export async function listSkills(): Promise<Skill[]> {
  const resp = await request<Skill[]>('/api/v1/skills');
  return (resp.data as Skill[]) ?? [];
}

export async function createTask(req: CreateTaskReq): Promise<ProjectTask | null> {
  const resp = await request<ProjectTask>('/api/v1/users/tasks', { method: 'POST', body: req });
  return resp.data ?? null;
}

export function stopTask(id: string) {
  // 后端 ``PUT /users/tasks/stop`` 用 query 参数 task_id（不是 body）。
  return request('/api/v1/users/tasks/stop', { method: 'PUT', query: { task_id: id } });
}

export function deleteTask(id: string) {
  return request(`/api/v1/users/tasks/${id}`, { method: 'DELETE' });
}
