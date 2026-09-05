/**
 * 聊天会话 hook 测试：失败轮重试（软删 + 重发，不重复 user 轮）、
 * usage 解析回填、附件 data_url 组装为 content parts。
 *
 * 注：jest.mock 工厂只能引用以 mock 开头的变量。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockAppendChatMessage = jest.fn(async () => ({ id: 1 }));
const mockDeleteChatMessage = jest.fn(async () => ({ deleted: true }));
const mockGetChatConversationMeta = jest.fn(async () => ({
  id: 'c1', title: 't', model: 'm', status: 'active', chat_settings: {},
}));
const mockListMessagesPage = jest.fn(async () => ({ messages: [], page: { next_cursor: null, has_more: false } }));
const mockListConversationsPage = jest.fn(async () => ({ items: [], page: { next_cursor: null, has_next_page: false } }));
let mockOnDelta: ((text: string) => void) | undefined;
let mockOnUsage: ((usage: Record<string, unknown>) => void) | undefined;
let mockRejectDone: ((reason: Error) => void) | null = null;

jest.mock('@/api/agent', () => ({
  appendChatMessage: (...args: unknown[]) => mockAppendChatMessage(...args),
  deleteChatMessage: (...args: unknown[]) => mockDeleteChatMessage(...args),
  getChatConversationMeta: (...args: unknown[]) => mockGetChatConversationMeta(...args),
  listChatConversationMessagesPage: (...args: unknown[]) => mockListMessagesPage(...args),
  listChatConversationsPage: (...args: unknown[]) => mockListConversationsPage(...args),
  updateChatConversation: jest.fn(async () => ({ id: 'c1' })),
  uploadChatConversationAttachment: jest.fn(async () => ({ path: 'p', filename: 'a.png', size: 1, mime: 'image/png', data_url: 'data:image/png;base64,x' })),
  listChatModels: jest.fn(async () => []),
  listUsableKeys: jest.fn(async () => []),
  chatSendStream: jest.fn((_payload: unknown, onDelta: (t: string) => void, onUsage?: (u: Record<string, unknown>) => void) => {
    mockOnDelta = onDelta;
    mockOnUsage = onUsage;
    return { done: new Promise<void>((_, reject) => { mockRejectDone = reject; }), cancel: () => undefined };
  }),
  chatSendOnce: jest.fn(),
  createChatConversation: jest.fn(async () => ({ id: 'c1' })),
}));

jest.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(m: string) { super(m); this.name = 'ApiError'; }
  },
}));

const { useChatConversation } = require('../useChatConversation');

function renderHook<T>(hook: () => T): { result: { current: T } } {
  const result: { current: T } = { current: undefined as any };
  function Probe() { result.current = hook(); return null; }
  act(() => { TestRenderer.create(React.createElement(Probe)); });
  return { result };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  jest.clearAllMocks();
  mockOnDelta = undefined;
  mockOnUsage = undefined;
  mockRejectDone = null;
});

it('retry resends last user turn without duplicating it', async () => {
  // 历史里最后一条 user 后跟 error assistant（带 remoteId）。
  mockListMessagesPage.mockResolvedValue({
    messages: [
      { id: 10, role: 'user', content: '帮我看看' },
      { id: 11, role: 'assistant', content: '', status: 'error', error: 'boom' },
    ],
    page: { next_cursor: null, has_more: false },
  });
  const { result } = renderHook(() => useChatConversation('c1', { apiKeyId: 1, model: 'm' }));
  for (let i = 0; i < 5; i++) await flush();

  act(() => { result.current.retry(); });
  await flush();

  // 软删了历史 error 消息。
  expect(mockDeleteChatMessage).toHaveBeenCalledWith('c1', 11);
  // messages：user + 新的空 assistant 占位（error 块被截掉）。
  const kinds = result.current.messages.map((m: { kind: string }) => m.kind);
  expect(kinds).toEqual(['user', 'agent']);
  // 重发的请求里 user 只出现一次（历史里的那条，不再追加）。
  const payload = (jest.requireMock('@/api/agent').chatSendStream as jest.Mock).mock.calls.at(-1)?.[0];
  const userTurns = payload.messages.filter((m: { role: string }) => m.role === 'user');
  expect(userTurns).toHaveLength(1);
  expect(userTurns[0].content).toBe('帮我看看');
});

it('streams usage onto the assistant message', async () => {
  mockListMessagesPage.mockResolvedValue({ messages: [], page: { next_cursor: null, has_more: false } });
  const { result } = renderHook(() => useChatConversation('c1', { apiKeyId: 1, model: 'm' }));
  for (let i = 0; i < 5; i++) await flush();

  act(() => { result.current.send('hello'); });
  await flush();
  expect(result.current.messages.at(-1)?.kind).toBe('agent');

  await act(async () => {
    mockOnDelta?.('hi');
    mockOnUsage?.({ prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 });
  });
  const last = result.current.messages.at(-1) as { kind: string; text: string; meta?: { usage?: { total_tokens?: number } } };
  expect(last.text).toBe('hi');
  expect(last.meta?.usage?.total_tokens).toBe(8);
});
