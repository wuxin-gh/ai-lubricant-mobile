import type { CreateUserTaskPayload, TaskEvent, UserTaskDetail } from '../task';
import { createUserTask, rotateUserTaskKey, streamTaskEvents, userTaskTerminalUrl } from '../task';
import { request } from '../client';

jest.mock('../client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); }
  },
  authHeaders: () => ({ Authorization: 'Basic test' }),
  getBaseUrl: () => 'https://example.test',
  openWebSocket: jest.fn(),
  request: jest.fn(),
}));

const mockedRequest = request as jest.MockedFunction<typeof request>;

describe('canonical task client', () => {
  beforeEach(() => mockedRequest.mockReset());

  it('drops one-time plaintext keys from create responses', async () => {
    mockedRequest.mockResolvedValue({
      code: 0,
      data: {
        id: 'task-1', kind: 'develop', content: 'work', status: 'pending', provider: 'claude',
        api_key: { key_id: 9, key: 'secret-once', key_masked: 'sk-...1234', disabled: false },
      },
    } as any);

    const result = await createUserTask({ content: 'work' });
    expect((result.api_key as any)?.key).toBeUndefined();
    expect(result.api_key?.key_masked).toBe('sk-...1234');
  });

  it('drops one-time plaintext keys from rotate responses', async () => {
    mockedRequest.mockResolvedValue({ code: 0, data: { key: 'secret-once', key_id: 10, key_masked: 'sk-...9999' } } as any);
    const result = await rotateUserTaskKey('task-1');
    expect(result.key).toBeUndefined();
    expect(result.key_masked).toBe('sk-...9999');
  });

  it('builds a secure terminal websocket URL', () => {
    expect(userTaskTerminalUrl('task/a', 'term 1')).toBe(
      'wss://example.test/api/v1/users/tasks/task%2Fa/terminals/connect?terminal_id=term%201',
    );
  });

  it('parses task SSE frames split across chunks', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('event: output\ndata: {"kind":"output","text":"he'),
      encoder.encode('llo"}\n\nevent: result\ndata: {"kind":"result"}\n\n'),
    ];
    const reader = {
      read: jest.fn()
        .mockResolvedValueOnce({ done: false, value: chunks[0] })
        .mockResolvedValueOnce({ done: false, value: chunks[1] })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      cancel: jest.fn().mockResolvedValue(undefined),
    };
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    });
    const events: TaskEvent[] = [];
    const handle = streamTaskEvents('task-1', (event) => events.push(event));
    await handle.done;
    expect(events).toEqual([
      { kind: 'output', text: 'hello' },
      { kind: 'result' },
    ]);
  });
});

// Compile-time guard for the Codex anti-cross-session payload.
const codexPayload: CreateUserTaskPayload = {
  content: 'first turn',
  provider: 'codex',
  cli_name: 'codex',
  expected_client_id: 'installation-1',
  bootstrap_content: 'first turn',
};
const detail: Pick<UserTaskDetail, 'provider'> = { provider: codexPayload.provider! };
void detail;
