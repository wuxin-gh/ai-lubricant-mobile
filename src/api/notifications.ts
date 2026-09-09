/**
 * 手机通知 API：设备注册 / 事件规则 / 通知中心历史。
 * 对应后端 user_platform/routes_notify_devices.py 与 routes_user_notifications.py，
 * 响应是 {code,message,data} 信封（走 client.request）。
 */
import { request } from '@/api/client';

const BASE = '/api/v1/users/notify/devices';

export interface PushDevice {
  id: string;
  device_key: string;
  name: string;
  platform: string;
  push_provider: string;
  token_masked: string;
  app_version: string;
  last_seen_at: string | null;
  enabled: boolean;
  last_error: string;
  created_at: string | null;
}

export interface RegisterResult {
  device: PushDevice;
  channel_id: string;
  defaults_applied: boolean;
}

export interface PushRuleEvent {
  type: string;
  name: string;
  category: string;
  /** 应用内通知（notify_center）开关：on=该事件落通知表，App 打开时能读到。 */
  app_enabled: boolean;
  /** 远程推送目标设备（仅注册了手机后才生效）。 */
  devices: { id: string; name: string; channel_id: string }[];
}

export interface PushRules {
  events: PushRuleEvent[];
  devices: { id: string; name: string; channel_id: string; enabled: boolean }[];
}

export interface UserNotificationItem {
  id: number;
  severity?: string;
  kind?: string;
  title?: string;
  message?: string;
  event_type?: string;
  status?: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

export async function listPushDevices(): Promise<PushDevice[]> {
  const r = await request<PushDevice[]>(BASE);
  return Array.isArray(r.data) ? r.data : [];
}

export async function registerPushDevice(body: {
  device_key: string;
  push_token: string;
  name?: string;
  default_name?: string;
  platform?: string;
  push_provider?: string;
  app_version?: string;
}): Promise<RegisterResult> {
  const r = await request<RegisterResult>(`${BASE}/register`, { method: 'POST', body });
  return r.data as RegisterResult;
}

export async function heartbeatPushDevice(deviceId: string, body: { push_token?: string; app_version?: string }): Promise<void> {
  await request(`${BASE}/${deviceId}/heartbeat`, { method: 'POST', body });
}

export async function updatePushDevice(deviceId: string, body: { name?: string; enabled?: boolean }): Promise<void> {
  await request(`${BASE}/${deviceId}`, { method: 'PATCH', body });
}

export async function deletePushDevice(deviceId: string): Promise<void> {
  await request(`${BASE}/${deviceId}`, { method: 'DELETE' });
}

export async function testPushDevice(deviceId: string): Promise<{ ok: boolean; message?: string }> {
  // 测试推送的信封语义与其它 notify 路由一致：失败时 code=-1 + message。
  const r = await request<{ ok?: boolean }>(`${BASE}/${deviceId}/test`, { method: 'POST' });
  return { ok: r.code === 0, message: r.message };
}

export async function listPushRules(): Promise<PushRules> {
  const r = await request<PushRules>(`${BASE}/rules`);
  return r.data ?? { events: [], devices: [] };
}

/**
 * 保存通知规则。两个映射都可选，只传要改的部分：
 * - app: { 事件类型: bool } —— 应用内通知开关（notify_center 绑定）；
 * - bindings: { 事件类型: [设备 id] } —— 远程推送目标（需已注册手机）。
 */
export async function replacePushRules(payload: { app?: Record<string, boolean>; bindings?: Record<string, string[]> }): Promise<PushRules> {
  const r = await request<PushRules>(`${BASE}/rules`, { method: 'PUT', body: payload });
  return r.data ?? { events: [], devices: [] };
}

/** 未读通知数（App 内轮询用）。 */
export async function fetchUnreadCount(): Promise<number> {
  const r = await request<{ unread_count?: number }>(`/api/v1/users/notifications/unread-count`);
  return r.data?.unread_count ?? 0;
}

/** 全部标记已读。 */
export async function markAllNotificationsRead(): Promise<number> {
  const r = await request<{ updated?: number }>(`/api/v1/users/notifications/read-all`, { method: 'PUT' });
  return r.data?.updated ?? 0;
}

/** 通知中心历史（分页）。 */
export async function listUserNotifications(page = 1, pageSize = 20): Promise<{ items: UserNotificationItem[]; total: number; unread_count: number }> {
  const r = await request<{ items?: UserNotificationItem[]; total?: number; unread_count?: number }>(`/api/v1/users/notifications?page=${page}&page_size=${pageSize}`);
  return {
    items: Array.isArray(r.data?.items) ? r.data.items : [],
    total: r.data?.total ?? 0,
    unread_count: r.data?.unread_count ?? 0,
  };
}
