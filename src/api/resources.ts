import { request } from '@/api/client';

export type ToolKind = 'cdp' | 'mail';
export interface BuiltinToolInstance { id: number; tool_kind: ToolKind; name: string; enabled: boolean; created_at?: string; updated_at?: string }
export interface BuiltinToolDetail { id: number; instance_id: number; detail_type: string; revision?: number; name?: string; enabled?: boolean; data?: Record<string, unknown>; _secrets?: Record<string, { state: 'set' | 'unset' }>; [key: string]: unknown }
export interface BuiltinToolToken { id: number; name?: string; token_hint?: string; target_type?: string; status?: string; created_at?: string }
export interface BuiltinIntegration { tool_kind: ToolKind; display_name: string; description: string; sse_url: string; runtime_status?: string; enabled: boolean; tools?: { name: string; description?: string }[] }
export interface CdpClient extends BuiltinToolDetail { name?: string; enabled?: boolean; token_hint?: string; client_id?: string; agent_ids?: number[] }
export interface CdpConnectionInfo { ws_session_url: string; extension_download_url: string; extension_file_name: string }
export interface CdpSessionContext { context_id?: string; clients?: { client_id: string; name?: string; connected: boolean; pages?: { id: string; url?: string; title?: string; active: boolean; status?: string }[]; active_count?: number }[]; active_count?: number }
export interface MailAccount extends BuiltinToolDetail { display_name?: string; mailbox_type?: string; base_url?: string; username?: string; enabled?: boolean }
export interface MailAddress extends BuiltinToolDetail { address?: string; source_address?: string }
export interface MailQueryResult { requested_address: string; received_address: string; messages: Record<string, unknown>[]; count: number; limit: number; offset: number }

const BASE = '/api/v1/users/builtin-tools';
export async function listBuiltinInstances(kind?: ToolKind): Promise<BuiltinToolInstance[]> { const r = await request<{ instances?: BuiltinToolInstance[] }>(`${BASE}/instances`, { query: { tool_kind: kind } }); return r.data?.instances ?? []; }
export async function createBuiltinInstance(body: { tool_kind: ToolKind; name: string; enabled?: boolean }): Promise<BuiltinToolInstance> { const r = await request<BuiltinToolInstance>(`${BASE}/instances`, { method: 'POST', body }); return r.data as BuiltinToolInstance; }
export async function updateBuiltinInstance(id: number, body: { name?: string; enabled?: boolean }): Promise<void> { await request(`${BASE}/instances/${id}`, { method: 'PUT', body }); }
export async function deleteBuiltinInstance(id: number): Promise<void> { await request(`${BASE}/instances/${id}`, { method: 'DELETE' }); }
export async function listBuiltinDetails(id: number, detailType?: string): Promise<BuiltinToolDetail[]> { const r = await request<{ details?: BuiltinToolDetail[] }>(`${BASE}/instances/${id}/details`, { query: { detail_type: detailType } }); return r.data?.details ?? []; }
export async function updateBuiltinDetail(id: number, data: Record<string, unknown>, expectedRevision?: number): Promise<BuiltinToolDetail> { const r = await request<BuiltinToolDetail>(`${BASE}/details/${id}`, { method: 'PUT', body: { data, expected_revision: expectedRevision } }); return r.data as BuiltinToolDetail; }
export async function deleteBuiltinDetail(id: number): Promise<void> { await request(`${BASE}/details/${id}`, { method: 'DELETE' }); }
export async function listBuiltinTokens(id: number): Promise<BuiltinToolToken[]> { const r = await request<{ tokens?: BuiltinToolToken[] }>(`${BASE}/instances/${id}/tokens`); return r.data?.tokens ?? []; }
export async function createExternalOpening(id: number): Promise<{ token: BuiltinToolToken; plaintext: string }> { const r = await request<{ token: BuiltinToolToken; plaintext: string }>(`${BASE}/instances/${id}/tokens`, { method: 'POST', body: { target_type: 'external', display_token: true } }); return r.data as { token: BuiltinToolToken; plaintext: string }; }
export async function rotateBuiltinToken(id: number): Promise<{ token: BuiltinToolToken; plaintext: string }> { const r = await request<{ token: BuiltinToolToken; plaintext: string }>(`${BASE}/tokens/${id}/rotate`, { method: 'POST' }); return r.data as { token: BuiltinToolToken; plaintext: string }; }
export async function deleteBuiltinToken(id: number): Promise<void> { await request(`${BASE}/tokens/${id}`, { method: 'DELETE' }); }
export async function getBuiltinIntegration(kind: ToolKind): Promise<BuiltinIntegration> { const r = await request<BuiltinIntegration>(`${BASE}/mcp-integration/${kind}`); return r.data as BuiltinIntegration; }

export async function listCdpClients(instanceId: number): Promise<CdpClient[]> { return listBuiltinDetails(instanceId, 'cdp_client') as Promise<CdpClient[]>; }
export async function createCdpClient(instanceId: number, name: string): Promise<{ client: CdpClient; token: string }> { const r = await request<{ client: CdpClient; token: string }>(`${BASE}/instances/${instanceId}/cdp-clients`, { method: 'POST', body: { name } }); return r.data as { client: CdpClient; token: string }; }
export async function updateCdpClient(id: number, body: { name?: string; enabled?: boolean; agent_ids?: number[] }): Promise<void> { await updateBuiltinDetail(id, body); }
export async function deleteCdpClient(id: number): Promise<void> { await deleteBuiltinDetail(id); }
export async function rotateCdpToken(id: number): Promise<{ client: CdpClient; token: string }> { const r = await request<{ client: CdpClient; token: string }>(`${BASE}/details/${id}/rotate-cdp-token`, { method: 'POST' }); return r.data as { client: CdpClient; token: string }; }
export async function revokeCdpToken(id: number): Promise<void> { await request(`${BASE}/details/${id}/revoke-cdp-token`, { method: 'POST' }); }
export async function getCdpConnectionInfo(): Promise<CdpConnectionInfo> { const r = await request<CdpConnectionInfo>(`${BASE}/cdp/connection-info`); return r.data as CdpConnectionInfo; }
export async function getCdpInstanceSessions(id: number): Promise<CdpSessionContext[]> { const r = await request<{ contexts?: CdpSessionContext[] }>(`${BASE}/instances/${id}/cdp-sessions`); return r.data?.contexts ?? []; }

export async function createMailAccount(instanceId: number, body: { display_name: string; mailbox_type?: string; base_url?: string; username?: string; password?: string; secret_key?: string; enabled?: boolean }): Promise<void> { await request(`${BASE}/instances/${instanceId}/mail-accounts`, { method: 'POST', body }); }
export async function createMailAddress(instanceId: number, body: { address: string; source_address?: string }): Promise<void> { await request(`${BASE}/instances/${instanceId}/mail-addresses`, { method: 'POST', body }); }
export async function queryMailMessages(instanceId: number, body: { address?: string; keyword?: string; limit?: number; offset?: number }): Promise<MailQueryResult> { const r = await request<MailQueryResult>(`${BASE}/instances/${instanceId}/mail-query`, { method: 'POST', body }); return r.data as MailQueryResult; }

export interface MyMcpService { id: number; name: string; display_name?: string; description?: string; url: string; enabled: boolean; runtime_status?: string; runtime_last_error?: string; tool_count?: number; tools?: { name: string; description?: string }[] }
export interface MyMcpPayload { name?: string; display_name?: string; description?: string; url?: string; token?: string; headers?: Record<string, string>; enabled?: boolean }
const MCP = '/mcp/my-services';
export async function listMyMcpServices(): Promise<MyMcpService[]> { const r = await request<{ services?: MyMcpService[] } | MyMcpService[]>(MCP); return Array.isArray(r.data) ? r.data : r.data?.services ?? []; }
export async function createMyMcpService(body: MyMcpPayload & { name: string; url: string }): Promise<void> { await request(MCP, { method: 'POST', body }); }
export async function updateMyMcpService(id: number, body: MyMcpPayload): Promise<void> { await request(`${MCP}/${id}`, { method: 'PATCH', body }); }
export async function deleteMyMcpService(id: number): Promise<void> { await request(`${MCP}/${id}`, { method: 'DELETE' }); }
export async function syncMyMcpService(id: number): Promise<{ ok?: boolean; tool_count?: number; error?: string }> { const r = await request<{ ok?: boolean; tool_count?: number; error?: string }>(`${MCP}/${id}/sync`, { method: 'POST' }); return r.data ?? {}; }
