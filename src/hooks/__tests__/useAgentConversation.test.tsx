/**
 * Agent 会话审批事件流测试：confirmation_required → 审批卡；
 * 重连恢复（listApprovals）→ pending 卡；裁决 → allowed/denied 状态流转。
 *
 * 注：jest.mock 工厂只能引用以 mock 开头的变量。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockResolveApproval = jest.fn();
const mockListApprovals = jest.fn();
let mockSendEventSink: ((ev: Record<string, unknown>) => void) | null = null;

jest.mock('@/api/agent', () => ({
  getAgentConversation: jest.fn(async () => ({
    conversation: { id: 'c1', title: 't', model: 'm', status: 'active' },
    messages: [],
  })),
  listApprovals: (...args: unknown[]) => mockListApprovals(...args),
  resolveApproval: (...args: unknown[]) => mockResolveApproval(...args),
  abortAgentConversation: jest.fn(async () => ({ aborted: true })),
  sendAgentMessage: jest.fn((_convId: string, _content: string, onEvent: (ev: Record<string, unknown>) => void) => {
    mockSendEventSink = onEvent;
    return { done: new Promise<void>(() => undefined), cancel: () => undefined };
  }),
}));

// api/client 提供 ApiError；测试不走网络，给个最小实现。
jest.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(m: string) { super(m); this.name = 'ApiError'; }
  },
}));

// 在 mock 就绪后再加载 hook。
const { useAgentConversation } = require('../useAgentConversation');

function renderHook<T>(hook: () => T): { result: { current: T } } {
  const result: { current: T } = { current: undefined as any };
  function Probe() { result.current = hook(); return null; }
  act(() => { TestRenderer.create(React.createElement(Probe)); });
  return { result };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  jest.clearAllMocks();
  mockSendEventSink = null;
  mockListApprovals.mockResolvedValue([]);
  mockResolveApproval.mockResolvedValue({ ok: true, confirmation_id: 'conf-1', result: 'allow' });
});

it('renders an approval card on confirmation_required and dedupes by confirmation_id', async () => {
  const { result } = renderHook(() => useAgentConversation('c1'));
  await flush();

  act(() => { result.current.send('run something'); });
  expect(mockSendEventSink).not.toBeNull();

  const event = {
    type: 'confirmation_required',
    confirmation_id: 'conf-1',
    tool_name: 'node_shell_exec',
    node_id: 'node-9',
    command: 'rm -rf /tmp/x',
    commands: ['rm -rf /tmp/x'],
    command_hash: 'hash-1',
    message: 'Agent 请求在节点执行命令',
    expires_at: Math.floor(Date.now() / 1000) + 600,
  };
  await act(async () => { mockSendEventSink?.(event); });
  await act(async () => { mockSendEventSink?.(event); });

  const approvals = result.current.messages.filter((m: { kind: string }) => m.kind === 'approval');
  expect(approvals).toHaveLength(1);
  expect(approvals[0]).toMatchObject({ kind: 'approval', approvalId: 'conf-1', state: 'pending', commandHash: 'hash-1' });
  expect(approvals[0].commands).toEqual(['rm -rf /tmp/x']);
  expect(approvals[0].expiresAt).toBeGreaterThan(Date.now());
});

it('resolves an approval to allowed', async () => {
  const { result } = renderHook(() => useAgentConversation('c1'));
  await flush();

  act(() => { result.current.send('go'); });
  await act(async () => {
    mockSendEventSink?.({
      type: 'confirmation_required',
      confirmation_id: 'conf-2',
      command: 'ls',
      command_hash: 'hash-2',
      expires_at: 0,
    });
  });

  await act(async () => { await result.current.resolveApproval('conf-2', 'allow'); });
  expect(mockResolveApproval).toHaveBeenCalledWith('c1', 'conf-2', 'allow', 'hash-2');
  const card = result.current.messages.find((m: { kind: string; approvalId?: string }) => m.kind === 'approval' && m.approvalId === 'conf-2');
  expect(card).toMatchObject({ state: 'allowed' });
});

it('falls back to pending when resolution fails', async () => {
  mockResolveApproval.mockRejectedValue(new Error('boom'));
  const { result } = renderHook(() => useAgentConversation('c1'));
  await flush();

  act(() => { result.current.send('go'); });
  await act(async () => {
    mockSendEventSink?.({
      type: 'confirmation_required',
      confirmation_id: 'conf-3',
      command: 'pwd',
      command_hash: 'hash-3',
      expires_at: 0,
    });
  });

  await act(async () => { await result.current.resolveApproval('conf-3', 'deny'); });
  const card = result.current.messages.find((m: { kind: string; approvalId?: string }) => m.kind === 'approval' && m.approvalId === 'conf-3');
  expect(card).toMatchObject({ state: 'pending' });
  // 非 ApiError（网络异常等）落到统一文案；错误态不为空即视为已向用户反馈。
  expect(result.current.error).toBeTruthy();
});

it('restores pending approvals from listApprovals on reload', async () => {
  mockListApprovals.mockResolvedValue([
    { confirmation_id: 'conf-restored', tool_name: 'node_shell_exec', command: 'whoami', command_hash: 'h', expires_at: 0, resolved: null },
  ]);
  const { result } = renderHook(() => useAgentConversation('c1'));
  // reload 是异步链，多 flush 几轮让它跑完。
  for (let i = 0; i < 5; i++) await flush();
  const restored = result.current.messages.find((m: { kind: string; approvalId?: string }) => m.kind === 'approval' && m.approvalId === 'conf-restored');
  expect(restored).toMatchObject({ state: 'pending' });
  expect(mockListApprovals).toHaveBeenCalledWith('c1');
});

it('keeps locally-resolved approval cards after reload', async () => {
  mockListApprovals.mockResolvedValue([
    { confirmation_id: 'conf-4', command: 'echo hi', command_hash: 'h4', expires_at: 0, resolved: null },
  ]);
  const { result } = renderHook(() => useAgentConversation('c1'));
  for (let i = 0; i < 5; i++) await flush();
  expect(result.current.messages.some((m: { kind: string; approvalId?: string }) => m.kind === 'approval' && m.approvalId === 'conf-4')).toBe(true);

  await act(async () => { await result.current.resolveApproval('conf-4', 'deny'); });

  // reload 后已裁决卡仍在列表里。
  mockListApprovals.mockResolvedValue([]);
  await act(async () => { await result.current.reload(); });
  await flush();
  const card = result.current.messages.find((m: { kind: string; approvalId?: string }) => m.kind === 'approval' && m.approvalId === 'conf-4');
  expect(card).toMatchObject({ state: 'denied' });
});
