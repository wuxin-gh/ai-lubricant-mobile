/**
 * 绑定节点的健康状况与权限模式选项（对齐 Web ``api/nodes.ts`` 的
 * ``nodeAvailability`` / ``editorNodeHealth`` 与 ``editorClient.ts`` 的
 * ``nodeModeOptions``）。
 *
 * 任务行只记 ``node_id`` 快照，节点被删除/吊销/掉线后任务行不会自动更新，
 * 所以要在展示侧按用户可见的节点列表（``GET /api/v1/teams/my-nodes``）实时
 * 对账：状态判定复用 {@link nodeAvailability}（审批状态与心跳在线分开判定），
 * 不再把「连接存在」当成在线。
 */
import type { Node } from '@/api/types';

export type NodeLiveness =
  | 'online'
  | 'awaiting'
  | 'heartbeat_timeout'
  | 'offline'
  | 'not_execution'
  | 'unknown';

export interface NodeAvailability {
  liveness: NodeLiveness;
  usable: boolean;
  reason: string;
}

/** 审批 + 心跳在线判定。与 Web ``nodeAvailability`` 同口径。 */
export function nodeAvailability(node: Node): NodeAvailability {
  if ((node.node_role || 'execution') !== 'execution' || node.is_passive) {
    return { liveness: 'not_execution', usable: false, reason: '非执行节点' };
  }
  if (node.status === 'pending') return { liveness: 'offline', usable: false, reason: '节点待审批' };
  if (node.status === 'revoked') return { liveness: 'offline', usable: false, reason: '节点已吊销' };
  if (node.status !== 'approved') return { liveness: 'unknown', usable: false, reason: '节点状态未知' };

  // `online` 是服务端心跳结论；老响应缺字段时回退 `connected`。
  if (node.online ?? node.connected) return { liveness: 'online', usable: true, reason: '' };
  if (node.connected) return { liveness: 'heartbeat_timeout', usable: false, reason: '节点心跳超时' };
  if (node.last_heartbeat_at) return { liveness: 'offline', usable: false, reason: '节点离线' };
  return { liveness: 'awaiting', usable: false, reason: '节点待连接' };
}

export type NodeHealthState =
  | 'ok'
  | 'auto'
  | 'missing'
  | 'offline'
  | 'heartbeat_timeout'
  | 'awaiting'
  | 'pending'
  | 'revoked';

export interface NodeHealth {
  state: NodeHealthState;
  /** 命中的节点；``missing`` / ``auto`` 时为 null。 */
  node: Node | null;
  /** 是否异常（列表/详情用来决定是否红色告警）。 */
  abnormal: boolean;
  /** 异常原因短语，如「节点不存在」「节点离线」；正常时为空串。 */
  reason: string;
  /** 直接可展示的状态文案：异常时为「异常 · 节点离线」，正常时为「正常」/「自动节点」。 */
  label: string;
}

/**
 * 按任务绑定的 ``node_id`` 在用户可见节点列表里对账，得出展示用的节点健康状态。
 * 与 Web ``editorNodeHealth`` 同口径，保证两处对同一个 ``pending`` 给出相同说法。
 */
export function nodeHealthOf(nodeId: string | null | undefined, nodes: Node[]): NodeHealth {
  if (!nodeId) return { state: 'auto', node: null, abnormal: false, reason: '', label: '自动节点' };

  const node = nodes.find((item) => item.node_id === nodeId) || null;
  if (!node) return { state: 'missing', node: null, abnormal: true, reason: '节点不存在', label: '异常 · 节点不存在' };
  if (node.status === 'revoked') return { state: 'revoked', node, abnormal: true, reason: '节点已吊销', label: '异常 · 节点已吊销' };
  if (node.status === 'pending') return { state: 'pending', node, abnormal: true, reason: '节点待审批', label: '异常 · 节点待审批' };
  if (node.status !== 'approved') return { state: 'offline', node, abnormal: true, reason: '节点状态未知', label: '异常 · 节点状态未知' };

  const { liveness, reason } = nodeAvailability(node);
  if (liveness === 'online') return { state: 'ok', node, abnormal: false, reason: '', label: '正常' };
  if (liveness === 'heartbeat_timeout') return { state: 'heartbeat_timeout', node, abnormal: true, reason, label: `异常 · ${reason}` };
  if (liveness === 'awaiting') return { state: 'awaiting', node, abnormal: true, reason, label: `异常 · ${reason}` };
  return { state: 'offline', node, abnormal: true, reason: reason || '节点离线', label: `异常 · ${reason || '节点离线'}` };
}

export interface ModeOption {
  value: string;
  label: string;
}

interface NodeEditorModes {
  id?: string;
  label?: string;
}

interface NodeEditorCap {
  provider?: string;
  modes?: NodeEditorModes[];
}

/**
 * 权限方式选项来自节点在注册握手时上报的 ``capabilities.editors``（Go 客户端
 * 探测每个 CLI 的 ``--help``/``agent list`` 得到）。返回该节点为指定 provider
 * 实际支持的 modes；节点未上报 editors 或该 provider 无匹配时返回 ``null``，
 * 调用方回落到硬编码的 {@link modeOptionsFor}（与 Web ``nodeModeOptions`` 同源）。
 *
 * 第一个元素始终是空值「客户端默认」，与硬编码列表一致。
 */
export function nodeModeOptions(node: Node | null | undefined, provider?: string | null): ModeOption[] | null {
  const caps = (node?.capabilities as { editors?: NodeEditorCap[] } | undefined)?.editors;
  if (!Array.isArray(caps) || caps.length === 0) return null;
  const match = caps.find((editor) => (editor?.provider || '').toLowerCase() === (provider || '').toLowerCase());
  if (!match || !Array.isArray(match.modes) || match.modes.length === 0) return null;
  return [
    { value: '', label: '客户端默认' },
    ...match.modes.map((mode) => ({ value: String(mode.id || ''), label: mode.label || String(mode.id || '') })),
  ];
}
