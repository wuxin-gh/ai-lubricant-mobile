/** 资源中心 API：薄封装 web 已有后端端点（MCP principal/grants、资源引用、
 * 项目提示词、市场消费侧）。移动端复用同一组 /api/v1/... 路由，鉴权走 cookie。
 */
import { request } from '@/api/client';

// ── MCP 个人服务（沿用 resources.ts 的接口语义；这里不重复，资源中心页面直接 import）─
export type { MyMcpService, MyMcpPayload } from '@/api/resources';

// ── MCP Principal（MCP 主体：name + token + grants，对齐 web mcpClient）─
export interface McpPrincipal {
  id: number; name: string; description?: string; enabled: boolean;
  token?: string; token_hint?: string; token_status?: 'active' | 'disabled';
  expires_at?: string | null; usage_type?: 'agent' | 'external' | 'task';
}
export interface McpGrant { grant_key: string; grant_value: string; created_at?: string | null }
export interface McpAuthorizationResource {
  resource_kind: string; resource_id: number; resource_type: string;
  name: string; url?: string; description?: string; tool_count?: number;
  transport?: string; source?: string; kind?: string; stdio?: boolean;
  required_param?: string; children: { child_kind: string; child_id: number; name: string }[];
}
export interface McpAuthorizationParamKind { key: string; label: string; resource_type: string }

async function principalFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // principals 返回裸 JSON（非信封），与 web principalFetch 同构；不走 client.request。
  const { getBaseUrl, authHeaders, ApiError, errorMessageFromBody } = await import('@/api/client');
  const res = await fetch(`${getBaseUrl()}/api/v1/users/mcp-principals${path}`, {
    ...init, credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    // HTTPException 被全局 handler 包成 {error:{message}}，必须走统一提取。
    const body = await res.json().catch(() => null);
    throw new ApiError(errorMessageFromBody(body, res.status), undefined, res.status);
  }
  const text = await res.text(); return (text ? JSON.parse(text) : {}) as T;
}
export async function listMcpPrincipals(): Promise<McpPrincipal[]> { const r = await principalFetch<{ principals?: McpPrincipal[] }>(''); return r.principals ?? []; }
export async function createMcpPrincipal(payload: { name: string; description?: string; enabled?: boolean; usage_type?: 'external' | 'agent' | 'task' }): Promise<McpPrincipal> { return principalFetch<McpPrincipal>('', { method: 'POST', body: JSON.stringify({ ...payload, usage_type: payload.usage_type || 'external' }) }); }
export async function updateMcpPrincipal(id: number, payload: { name?: string; description?: string; enabled?: boolean }): Promise<McpPrincipal> { return principalFetch<McpPrincipal>(`/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
export async function rotateMcpPrincipalToken(id: number): Promise<McpPrincipal> { return principalFetch<McpPrincipal>(`/${id}/rotate-token`, { method: 'POST' }); }
export async function deleteMcpPrincipal(id: number): Promise<void> { await principalFetch(`/${id}`, { method: 'DELETE' }); }
export async function listMcpPrincipalGrants(id: number): Promise<McpGrant[]> { const r = await principalFetch<{ grants?: McpGrant[] }>(`/${id}/grants`); return r.grants ?? []; }
export async function replaceMcpPrincipalGrants(id: number, grants: McpGrant[]): Promise<void> { await principalFetch(`/${id}/grants`, { method: 'PUT', body: JSON.stringify({ grants }) }); }
export async function listMcpAuthorizationOptions(): Promise<{ resources: McpAuthorizationResource[]; param_kinds?: McpAuthorizationParamKind[] }> { return principalFetch('/authorization/options'); }

// ── 资源引用（Skill / 插件 / MCP / 提示词 的团队级引用）─
export type ResourceModule = 'skills' | 'plugins' | 'mcp' | 'prompts';
export type ResourceType = 'skill' | 'plugin' | 'mcp' | 'project_prompt';
export interface ResourceReference {
  id: string; resource_type: ResourceType; market_module: ResourceModule; market_id: string;
  name: string; display_name?: string; version?: string; status?: string;
  manifest?: Record<string, unknown>; group_ids?: string[];
}
const REF = '/api/v1/resources';
export async function listResourceReferences(resourceType?: ResourceType): Promise<ResourceReference[]> {
  const r = await request<ResourceReference[]>(`${REF}/references${resourceType ? `?resource_type=${encodeURIComponent(resourceType)}` : ''}`);
  return Array.isArray(r.data) ? r.data : [];
}
export async function createReferenceFromGithub(repo: string, ref: string, kind: 'skill' | 'plugin', overrides?: { name?: string; display_name?: string; description?: string }): Promise<ResourceReference> {
  const r = await request<ResourceReference>(`${REF}/references/from-github`, { method: 'POST', body: { repo, ref, kind, ...overrides } });
  return r.data as ResourceReference;
}
export async function deleteResourceReference(resourceId: string): Promise<void> { await request(`${REF}/references/${encodeURIComponent(resourceId)}`, { method: 'DELETE' }); }

/**
 * 当前用户**有权使用**的团队引用（旧表 ``mc_resource_references``）。
 *
 * 与 {@link listResourceReferences} 的区别是关键：后者列团队引用全集（含未授权给
 * 本用户分组的），只适合管理/展示；创建任务时必须用本函数 —— 服务端 resolve 按
 * 授权收窄，选了未授权的资源会在创建时 403「资源未授权或配置无效」。
 */
export async function listEffectiveResources(resourceType: ResourceType): Promise<ResourceReference[]> {
  const r = await request<ResourceReference[]>(`${REF}/effective/${encodeURIComponent(resourceType)}`);
  return Array.isArray(r.data) ? r.data : [];
}

/** 统一资源池引用行（新表 resources + resource_references，按分组授权可见）。 */
export interface ResourceReferenceV2 {
  id: string; team_id: string; resource_id: number; display_name: string;
  description: string; version: string; enabled: boolean;
  resource: {
    id: number;
    resource_type: 'skills' | 'skill' | 'plugin' | 'mcp' | 'prompt';
    resource_data: { entries?: { name?: string; path?: string; description?: string; editors?: string[] }[]; [k: string]: unknown };
    editors: string[]; name: string; display_name: string; description: string; version: string; status: string;
  };
}

/** 列团队引用（新表）。resourceType 兼容旧枚举：skill → skill+skills 集合并集。 */
export async function listReferencesV2(resourceType?: string): Promise<ResourceReferenceV2[]> {
  const q = resourceType ? `?resource_type=${encodeURIComponent(resourceType)}` : '';
  const r = await request<ResourceReferenceV2[]>(`${REF}/v2/references${q}`);
  return Array.isArray(r.data) ? r.data : [];
}

// ── 项目提示词（/api/v1/users/project-prompts，与 web editorClient 同端点）─
export interface ProjectPrompt { id: string; name: string; content: string; providers: string[]; enabled: boolean; scope?: 'system' | 'mine' }
export async function listProjectPrompts(): Promise<ProjectPrompt[]> { const r = await request<ProjectPrompt[]>('/api/v1/users/project-prompts'); return Array.isArray(r.data) ? r.data : []; }
export async function createMyProjectPrompt(payload: { name: string; content: string; providers: string[]; enabled: boolean }): Promise<ProjectPrompt> { const r = await request<ProjectPrompt>('/api/v1/users/project-prompts', { method: 'POST', body: payload }); return r.data as ProjectPrompt; }
export async function updateMyProjectPrompt(id: string, payload: Partial<{ name: string; content: string; providers: string[]; enabled: boolean }>): Promise<ProjectPrompt> { const r = await request<ProjectPrompt>(`/api/v1/users/project-prompts/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }); return r.data as ProjectPrompt; }
export async function deleteMyProjectPrompt(id: string): Promise<void> { await request(`/api/v1/users/project-prompts/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

// ── 市场消费侧（/api/v1/marketplace/consumer/*）─
export type MarketModule = 'mcp' | 'skills' | 'plugins' | 'prompts';
export interface MarketItem { id: string; module?: string; kind?: string; name?: string; display_name?: string; summary?: string; publisher?: string; category?: string; tags?: string[]; latest_version?: string; status?: string }
export interface MarketManifest { id: string; kind?: string; name?: string; display_name?: string; summary?: string; description?: string; publisher?: string; category?: string; tags?: string[]; version?: string; source_url?: string; download_url?: string; digest?: string; [k: string]: unknown }
async function marketFetch<T>(path: string): Promise<T> {
  const { getBaseUrl, authHeaders, ApiError, errorMessageFromBody } = await import('@/api/client');
  const res = await fetch(`${getBaseUrl()}${path}`, { credentials: 'include', headers: { ...authHeaders() } });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(errorMessageFromBody(body, res.status), undefined, res.status);
  }
  const text = await res.text(); return (text ? JSON.parse(text) : {}) as T;
}
export async function fetchMarketIndex(module: MarketModule): Promise<MarketItem[]> {
  const data = await marketFetch<{ items?: MarketItem[] } | MarketItem[]>(`/api/v1/marketplace/consumer/index/${encodeURIComponent(module)}`);
  const items = Array.isArray(data) ? data : (data?.items || []);
  return items.filter((it) => it.status !== 'deleted');
}
export async function fetchMarketManifest(module: MarketModule, itemId: string): Promise<MarketManifest | null> {
  const safe = itemId.replaceAll('/', '.');
  try { return await marketFetch<MarketManifest>(`/api/v1/marketplace/consumer/item/${encodeURIComponent(module)}/${encodeURIComponent(safe)}`); } catch { return null; }
}
