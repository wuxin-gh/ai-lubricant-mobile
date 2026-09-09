/** 用户侧「工具与配置」API：内置工具一级资源（CDP/邮箱）+ 个人外部 MCP。
 *
 * 后端为一级资源模型（user_platform/routes_builtin_tools.py，资源直挂用户，
 * 旧实例层 /instances API 已移除），与 web 端 builtinToolsClient.ts 同构。
 * token 明文只在签发/轮换时一次性返回，列表只给 token_hint。
 */
import { request } from '@/api/client';

export type ToolKind = 'cdp' | 'mail' | 'android' | 'ios';
export type ResourceType = 'cdp_client' | 'mail_account' | 'mail_address' | 'device';
export interface BuiltinIntegration { tool_kind: ToolKind; display_name: string; description: string; sse_url: string; runtime_status?: string; enabled: boolean; tools?: { name: string; description?: string }[] }
export interface CdpConnectionInfo { ws_session_url: string; extension_download_url: string; extension_file_name: string }

export interface BuiltinToolResource { id: number; owner_user_id: string; resource_type: ResourceType; detail_type: ResourceType; revision: number; _secrets?: Record<string, { state: 'set' | 'unset' }>; [key: string]: unknown }
export interface CdpClientResource extends BuiltinToolResource { name?: string; enabled?: boolean; token_hint?: string; connected?: boolean; pages?: { id: string; url?: string; title?: string; active: boolean }[] }
export interface MailAddress extends BuiltinToolResource { address?: string; source_address?: string; parent_resource_id?: number }
export interface MailServiceResource extends BuiltinToolResource { resource_id: number; display_name?: string; mailbox_type?: string; base_url?: string; username?: string; mail_suffix?: string; enabled?: boolean; addresses?: MailAddress[] }
export interface MailMessage { [key: string]: unknown }
export interface MailQueryResult { requested_address: string; received_address: string; messages: MailMessage[]; count: number; limit: number; offset: number }

const BASE = '/api/v1/users/builtin-tools';

/* ── 一级资源通用 CRUD（CDP 改名/启停、邮箱编辑、地址删除共用）────────── */
export async function updateResource(id: number, data: Record<string, unknown>, expectedRevision?: number): Promise<BuiltinToolResource> { const r = await request<BuiltinToolResource>(`${BASE}/resources/${id}`, { method: 'PATCH', body: { data, expected_revision: expectedRevision } }); return r.data as BuiltinToolResource; }
export async function deleteResource(id: number): Promise<void> { await request(`${BASE}/resources/${id}`, { method: 'DELETE' }); }

/* ── CDP 浏览器客户端 ─────────────────────────────────────────────────── */
export async function listCdpClients(): Promise<CdpClientResource[]> { const r = await request<{ clients?: CdpClientResource[] }>(`${BASE}/resources/cdp-clients`); return r.data?.clients ?? []; }
export async function createCdpClient(name: string): Promise<{ client: CdpClientResource; token: string }> { const r = await request<{ client: CdpClientResource; token: string }>(`${BASE}/resources/cdp-clients`, { method: 'POST', body: { name } }); return r.data as { client: CdpClientResource; token: string }; }
export async function rotateCdpToken(id: number): Promise<string> { const r = await request<{ client: CdpClientResource; token: string }>(`${BASE}/resources/cdp-clients/${id}/rotate-token`, { method: 'POST' }); return (r.data as { token: string }).token; }
export async function revokeCdpToken(id: number): Promise<void> { await request(`${BASE}/resources/cdp-clients/${id}/revoke-token`, { method: 'POST' }); }
export async function deleteCdpClient(id: number): Promise<void> { return deleteResource(id); }
export async function getCdpConnectionInfo(): Promise<CdpConnectionInfo> { const r = await request<CdpConnectionInfo>(`${BASE}/cdp/connection-info`); return r.data as CdpConnectionInfo; }
export async function getBuiltinIntegration(kind: ToolKind): Promise<BuiltinIntegration> { const r = await request<BuiltinIntegration>(`${BASE}/mcp-integration/${kind}`); return r.data as BuiltinIntegration; }

/* ── 邮箱服务（账户 + 转发别名 + 邮件查询）────────────────────────────── */
export async function listMailServices(): Promise<MailServiceResource[]> { const r = await request<{ services?: MailServiceResource[] }>(`${BASE}/resources/mail-services`); return r.data?.services ?? []; }
export async function createMailService(body: { display_name: string; mailbox_type?: string; base_url?: string; username?: string; mail_suffix?: string; password?: string; secret_key?: string; enabled?: boolean }): Promise<void> { await request(`${BASE}/resources/mail-services`, { method: 'POST', body }); }
export async function deleteMailService(id: number): Promise<void> { await request(`${BASE}/resources/mail-services/${id}`, { method: 'DELETE' }); }
export async function createMailAddress(serviceId: number, body: { address: string; source_address?: string }): Promise<void> { await request(`${BASE}/resources/mail-services/${serviceId}/addresses`, { method: 'POST', body }); }
export async function deleteMailAddress(id: number): Promise<void> { return deleteResource(id); }
export async function queryMailMessages(serviceId: number, body: { address?: string; keyword?: string; limit?: number; offset?: number } = {}): Promise<MailQueryResult> { const r = await request<MailQueryResult>(`${BASE}/resources/mail-services/${serviceId}/query`, { method: 'POST', body }); return r.data as MailQueryResult; }

/* ── 设备控制（Android / iOS，与 web builtinToolsClient 同构）──────────── */
export interface DeviceResource extends BuiltinToolResource {
  name?: string;
  platform?: string;
  device_id?: string;
  status?: string;
  paired?: boolean;
  revoked?: boolean;
  online?: boolean;
  app_version?: string;
  accessibility_enabled?: boolean;
  last_error?: string;
  last_seen_at?: string;
  node_id?: string;
  model?: string;
  [key: string]: unknown;
}
export async function listDeviceResources(): Promise<DeviceResource[]> { const r = await request<{ devices?: DeviceResource[] }>(`${BASE}/resources/devices`); return r.data?.devices ?? []; }
/** 生成设备配对码：在设备控制 App 里输入该码完成配对。 */
export async function mintDevicePairingCodeResource(label: string): Promise<{ code: string; ttl: number }> { const r = await request<{ code: string; ttl: number }>(`${BASE}/resources/device-pairing-codes`, { method: 'POST', body: { label } }); return r.data as { code: string; ttl: number }; }
/** 解除配对（设备需重新配对才能再次受控）。 */
export async function revokeDevice(resourceId: number): Promise<void> { await request(`${BASE}/resources/${resourceId}/revoke-device`, { method: 'POST' }); }

/* ── 个人外部 MCP（/mcp/my-services，契约未变）────────────────────────── */
export interface MyMcpService { id: number; name: string; display_name?: string; description?: string; url: string; token?: string; has_token?: boolean; headers?: Record<string, string>; enabled: boolean; runtime_status?: string; runtime_last_error?: string; tool_count?: number; tools?: { name: string; description?: string }[] }
export interface MyMcpPayload { name?: string; display_name?: string; description?: string; url?: string; token?: string; headers?: Record<string, string>; enabled?: boolean }
const MCP = '/mcp/my-services';
export async function listMyMcpServices(): Promise<MyMcpService[]> { const r = await request<{ services?: MyMcpService[] } | MyMcpService[]>(MCP); return Array.isArray(r.data) ? r.data : r.data?.services ?? []; }
export async function createMyMcpService(body: MyMcpPayload & { name: string; url: string }): Promise<void> { await request(MCP, { method: 'POST', body }); }
export async function updateMyMcpService(id: number, body: MyMcpPayload): Promise<void> { await request(`${MCP}/${id}`, { method: 'PATCH', body }); }
export async function deleteMyMcpService(id: number): Promise<void> { await request(`${MCP}/${id}`, { method: 'DELETE' }); }
export async function syncMyMcpService(id: number): Promise<{ ok?: boolean; tool_count?: number; error?: string }> { const r = await request<{ ok?: boolean; tool_count?: number; error?: string }>(`${MCP}/${id}/sync`, { method: 'POST' }); return r.data ?? {}; }
