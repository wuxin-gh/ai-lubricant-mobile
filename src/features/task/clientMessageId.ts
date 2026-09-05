/**
 * 端到端消息幂等键。
 *
 * 每条用户消息在发送前生成一个稳定 ID，贯穿 POST body → 服务端 mc_task_events
 * 行（client_message_id 列 + 部分唯一约束）→ 节点/runtime 的同 ID 去重。同 ID
 * 的重复请求（超时重试、网络重放、双击发送）服务端只投递一次。
 *
 * 优先用平台的 crypto.randomUUID（Hermes / Expo 55 已内置）；不可用时退化为
 * 时间戳 + 随机串 —— 对幂等键而言只需要「同一次发送重试时保持不变」，全局
 * 唯一性由前缀 + 随机位保证足够。
 */
export function newClientMessageId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
