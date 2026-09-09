import { nodeAvailability, nodeHealthOf, nodeModeOptions, type Node } from '../nodeHealth';

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
