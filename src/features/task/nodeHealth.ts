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

/** 该节点是否开启了系统内置环境（env_mode=system 需要节点上报此能力位）。 */
export function nodeSystemEnvAllowed(node: Node | null | undefined): boolean {
  const caps = node?.capabilities as { system_env?: unknown } | undefined;
  return String(caps?.system_env ?? '') === 'true';
}

/**
 * 该编辑器（provider）是否已在节点上装好。未传 provider 时不做此过滤。
 *
 * 与 Web ``nodeEditorVersions`` 同口径，三种信号任一在场即视为「节点能上报归属」，
 * 此时严格按归属判定（不在列表里 = 未装）：
 *  1. ``capabilities.editors[].provider``（节点注册探测的结构化上报，权威来源）
 *  2. ``capabilities.providers``（逗号分隔串，老节点）
 *  3. ``capabilities.editor_version_<provider>``
 * 三种信号**全都缺失**才回落到「不拦」—— 老节点上报不了归属，宁可让用户选、由
 * 服务端在派发时拒绝，也不要让可选列表整段消失。
 */
export function providerInstalled(node: Node | null | undefined, provider?: string | null): boolean {
  const wanted = (provider || '').toLowerCase();
  if (!wanted) return true;
  const caps = (node?.capabilities || {}) as Record<string, unknown>;

  const editors = caps.editors;
  const hasEditors = Array.isArray(editors) && editors.length > 0;
  const providersStr = String(caps.providers || '').trim();
  const hasAnyVersion = Object.keys(caps).some(
    (key) => key.startsWith('editor_version_') && String(caps[key] || '').trim(),
  );

  // 节点完全没有归属信息：不拦（老节点兼容）。
  if (!hasEditors && !providersStr && !hasAnyVersion) return true;

  if (hasEditors && (editors as NodeEditorCap[]).some(
    (entry) => (entry?.provider || '').toLowerCase() === wanted,
  )) return true;
  if (providersStr && providersStr.split(',').some((item) => item.trim().toLowerCase() === wanted)) return true;
  if (String(caps[`editor_version_${wanted}`] || '').trim()) return true;
  return false;
}

/**
 * 节点是否还有容量跑新任务。容量未配置（max_sessions 缺省/0）= 不限。
 * 与 Web ``isNodeUsable`` 同口径：只有配了上限才按占用判定。
 */
export function nodeHasCapacity(node: Node): boolean {
  const maxSessions = node.capacity?.max_sessions || 0;
  if (maxSessions <= 0) return true;
  return (node.active_sessions || 0) < maxSessions;
}

/**
 * 执行节点为什么不可作为任务目标。返回空串表示可选。
 *
 * 顺序与 Web ``unusableReason`` 一致：审批/心跳 → 容量 → 系统环境要求 →
 * 该客户端是否已装。前面的原因优先，所以离线节点不会显示成「未安装 Codex」。
 */
export function nodeUnusableReason(
  node: Node,
  provider?: string | null,
  requireSystemEnv = false,
): string {
  const availability = nodeAvailability(node);
  if (!availability.usable) return availability.reason;
  if (!nodeHasCapacity(node)) return '容量已满';
  if (requireSystemEnv && !nodeSystemEnvAllowed(node)) return '未开启系统环境';
  if (!providerInstalled(node, provider)) {
    const label = provider === 'codex' ? 'Codex' : provider === 'opencode' ? 'OpenCode' : 'Claude';
    return `未安装 ${label}`;
  }
  return '';
}

/** 该节点能否作为任务目标（`nodeUnusableReason` 为空即可以）。 */
export function isNodeUsableForTask(
  node: Node,
  provider?: string | null,
  requireSystemEnv = false,
): boolean {
  return nodeUnusableReason(node, provider, requireSystemEnv) === '';
}
