import {
  isNodeUsableForTask,
  nodeAvailability,
  nodeHasCapacity,
  nodeHealthOf,
  nodeModeOptions,
  nodeSystemEnvAllowed,
  nodeUnusableReason,
  providerInstalled,
  type Node,
} from '../nodeHealth';

function node(overrides: Partial<Node> = {}): Node {
  return {
    node_id: 'node-1',
    node_name: '工位机-1',
    node_role: 'execution',
    status: 'approved',
    connected: true,
    online: true,
    active_sessions: 0,
    ...overrides,
  };
}

describe('nodeAvailability', () => {
  it('marks approved + online as usable', () => {
    expect(nodeAvailability(node())).toEqual({ liveness: 'online', usable: true, reason: '' });
  });

  it('falls back to connected when online is missing but connected is true', () => {
    // registered connection without a fresh heartbeat verdict — old server response.
    expect(nodeAvailability(node({ online: undefined, connected: true }))).toMatchObject({ liveness: 'online', usable: true });
  });

  it('reports heartbeat timeout when connected but not online', () => {
    expect(nodeAvailability(node({ online: false, connected: true }))).toMatchObject({ liveness: 'heartbeat_timeout', usable: false, reason: '节点心跳超时' });
  });

  it('reports offline when disconnected with a previous heartbeat', () => {
    expect(nodeAvailability(node({ online: false, connected: false, last_heartbeat_at: '2026-09-01' }))).toMatchObject({ liveness: 'offline', reason: '节点离线' });
  });

  it('reports awaiting when never connected', () => {
    expect(nodeAvailability(node({ online: false, connected: false, last_heartbeat_at: '' }))).toMatchObject({ liveness: 'awaiting', reason: '节点待连接' });
  });

  it('treats non-execution / passive nodes as not usable', () => {
    expect(nodeAvailability(node({ node_role: 'management' }))).toMatchObject({ liveness: 'not_execution', reason: '非执行节点' });
    expect(nodeAvailability(node({ is_passive: true }))).toMatchObject({ liveness: 'not_execution' });
  });

  it('blocks pending / revoked / unknown approval states', () => {
    expect(nodeAvailability(node({ status: 'pending' }))).toMatchObject({ liveness: 'offline', reason: '节点待审批' });
    expect(nodeAvailability(node({ status: 'revoked' }))).toMatchObject({ liveness: 'offline', reason: '节点已吊销' });
    expect(nodeAvailability(node({ status: 'unknown' }))).toMatchObject({ liveness: 'unknown', reason: '节点状态未知' });
  });
});

describe('nodeHealthOf', () => {
  const nodes: Node[] = [node(), node({ node_id: 'pending-node', status: 'pending', node_name: '待审机' })];

  it('returns auto for tasks without a bound node', () => {
    expect(nodeHealthOf(null, nodes)).toMatchObject({ state: 'auto', abnormal: false, label: '自动节点' });
    expect(nodeHealthOf('', nodes)).toMatchObject({ state: 'auto' });
  });

  it('flags a missing node as abnormal', () => {
    expect(nodeHealthOf('gone-node', nodes)).toMatchObject({ state: 'missing', abnormal: true, label: '异常 · 节点不存在' });
  });

  it('returns ok for an approved online node', () => {
    expect(nodeHealthOf('node-1', nodes)).toMatchObject({ state: 'ok', abnormal: false, label: '正常' });
  });

  it('returns pending for an unapproved node', () => {
    expect(nodeHealthOf('pending-node', nodes)).toMatchObject({ state: 'pending', abnormal: true, label: '异常 · 节点待审批' });
  });

  it('honors heartbeat health even when approval is fine', () => {
    const offline: Node[] = [node({ node_id: 'n-off', online: false, connected: true })];
    expect(nodeHealthOf('n-off', offline)).toMatchObject({ state: 'heartbeat_timeout', abnormal: true });
  });
});

describe('nodeModeOptions', () => {
  it('returns null when the node reports no editors', () => {
    expect(nodeModeOptions(null, 'claude')).toBeNull();
    expect(nodeModeOptions(node({ capabilities: {} }), 'claude')).toBeNull();
    expect(nodeModeOptions(node({ capabilities: { editors: [] } }), 'claude')).toBeNull();
  });

  it('returns null when the provider has no editor match', () => {
    const n = node({ capabilities: { editors: [{ provider: 'codex', modes: [{ id: 'read-only' }] }] } });
    expect(nodeModeOptions(n, 'claude')).toBeNull();
  });

  it('returns client-default first plus the node-reported modes', () => {
    const n = node({
      capabilities: {
        editors: [
          { provider: 'claude', modes: [{ id: 'plan', label: '仅计划' }, { id: 'acceptEdits' }] },
        ],
      },
    });
    expect(nodeModeOptions(n, 'claude')).toEqual([
      { value: '', label: '客户端默认' },
      { value: 'plan', label: '仅计划' },
      { value: 'acceptEdits', label: 'acceptEdits' },
    ]);
  });

  it('matches the provider case-insensitively', () => {
    const n = node({ capabilities: { editors: [{ provider: 'Codex', modes: [{ id: 'read-only' }] }] } });
    expect(nodeModeOptions(n, 'codex')).not.toBeNull();
  });
});

describe('providerInstalled', () => {
  it('passes when no provider is asked for', () => {
    expect(providerInstalled(node({ capabilities: {} }), undefined)).toBe(true);
  });

  it('matches capabilities.editors[].provider case-insensitively', () => {
    const n = node({ capabilities: { editors: [{ provider: 'Codex' }] } });
    expect(providerInstalled(n, 'codex')).toBe(true);
    expect(providerInstalled(n, 'claude')).toBe(false);
  });

  it('falls back to the comma-separated providers string', () => {
    const n = node({ capabilities: { providers: 'claude, opencode' } });
    expect(providerInstalled(n, 'opencode')).toBe(true);
    expect(providerInstalled(n, 'codex')).toBe(false);
  });

  it('falls back to editor_version_<provider>', () => {
    const n = node({ capabilities: { editor_version_claude: '1.2.3' } });
    expect(providerInstalled(n, 'claude')).toBe(true);
    expect(providerInstalled(n, 'codex')).toBe(false);
  });

  it('does not filter when the node reports no ownership info at all', () => {
    // 老节点上报不了归属：宁可让用户选，也不要让列表整段消失。
    expect(providerInstalled(node({ capabilities: {} }), 'codex')).toBe(true);
  });
});

describe('nodeSystemEnvAllowed', () => {
  it('requires the capability bit to be the string "true"', () => {
    expect(nodeSystemEnvAllowed(node({ capabilities: { system_env: 'true' } }))).toBe(true);
    expect(nodeSystemEnvAllowed(node({ capabilities: { system_env: 'false' } }))).toBe(false);
    expect(nodeSystemEnvAllowed(node({ capabilities: {} }))).toBe(false);
    expect(nodeSystemEnvAllowed(null)).toBe(false);
  });
});

describe('nodeHasCapacity', () => {
  it('is unlimited when max_sessions is absent or zero', () => {
    expect(nodeHasCapacity(node({ active_sessions: 99 }))).toBe(true);
    expect(nodeHasCapacity(node({ capacity: { max_sessions: 0 }, active_sessions: 99 }))).toBe(true);
  });

  it('compares occupancy against the configured limit', () => {
    expect(nodeHasCapacity(node({ capacity: { max_sessions: 3 }, active_sessions: 2 }))).toBe(true);
    expect(nodeHasCapacity(node({ capacity: { max_sessions: 3 }, active_sessions: 3 }))).toBe(false);
  });
});

describe('nodeUnusableReason', () => {
  it('returns empty for an online node with room', () => {
    expect(nodeUnusableReason(node())).toBe('');
    expect(isNodeUsableForTask(node())).toBe(true);
  });

  it('reports liveness before capacity', () => {
    const offline = node({ online: false, connected: false, last_heartbeat_at: 'x', active_sessions: 9, capacity: { max_sessions: 1 } });
    expect(nodeUnusableReason(offline)).toBe('节点离线');
  });

  it('reports capacity before the system-env requirement', () => {
    const full = node({ capacity: { max_sessions: 1 }, active_sessions: 1, capabilities: {} });
    expect(nodeUnusableReason(full, 'claude', true)).toBe('容量已满');
  });

  it('reports the missing system env before a missing editor', () => {
    const n = node({ capabilities: { editors: [] } });
    expect(nodeUnusableReason(n, 'codex', true)).toBe('未开启系统环境');
  });

  it('reports the editor that is not installed', () => {
    const n = node({ capabilities: { editors: [{ provider: 'claude' }] } });
    expect(nodeUnusableReason(n, 'codex')).toBe('未安装 Codex');
    expect(nodeUnusableReason(n, 'opencode')).toBe('未安装 OpenCode');
    expect(nodeUnusableReason(n, 'claude')).toBe('');
  });

  it('marks non-execution nodes unusable', () => {
    expect(nodeUnusableReason(node({ node_role: 'management' }))).toBe('非执行节点');
    expect(isNodeUsableForTask(node({ node_role: 'management' }))).toBe(false);
  });
});
