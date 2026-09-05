/**
 * TaskConversationPanel 渲染测试：锁住用户抱怨丢失的核心交互件——
 * 输入框、发送/取消按钮、模型 / 模式 / 思考等级 pill、上下文指示、快捷提示。
 *
 * 项目 Jest 未启用 react-native preset，沿用现有 hook 测试做法：mock RN host 组件后
 * 再 require 真实 TaskConversationPanel。jest.mock 工厂变量须以 mock 开头。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockListHistory = jest.fn(async () => ({ rows: [], next_before: null }));
const mockSendTaskMessage = jest.fn(async () => ({ accepted: true }));
let mockEventSink: ((event: Record<string, unknown>) => void) | null = null;

jest.mock('react-native', () => {
  const ReactImpl = require('react') as typeof React;
  const ScrollView = ReactImpl.forwardRef((props: { children?: React.ReactNode }, ref) => {
    ReactImpl.useImperativeHandle(ref, () => ({ scrollToEnd: () => undefined }));
    return ReactImpl.createElement('ScrollView', null, props.children);
  });
  const FlatList = (props: {
    data?: unknown[];
    renderItem?: (input: { item: unknown; index: number }) => React.ReactNode;
    ListEmptyComponent?: React.ReactNode;
  }) => ReactImpl.createElement(
    'FlatList',
    null,
    ...(props.data?.length && props.renderItem
      ? props.data.map((item, index) => props.renderItem!({ item, index }))
      : [props.ListEmptyComponent]),
  );
  return {
    AppState: { addEventListener: () => ({ remove: () => undefined }) },
    FlatList,
    Modal: 'Modal',
    Pressable: 'Pressable',
    ScrollView,
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
  };
});

jest.mock('@/theme', () => ({
  spacing: { pad: 16 },
  useTheme: () => ({
    bg: '#fff', bg2: '#fafafa', bg3: '#f1f1f1', bg4: '#eee',
    tx: '#111', tx2: '#555', tx3: '#888', line: '#ddd', line2: '#ccc',
    ac: '#246bfe', acInk: '#fff', acTx: '#246bfe', acGhost: '#eef4ff',
    add: '#159947', red: '#d33', redGhost: '#fff0f0', amber: '#b87500',
    shLift: {}, shCard: {},
  }),
}));

jest.mock('@/components/Icons', () => {
  const ReactImpl = require('react') as typeof React;
  const Icon = (props: Record<string, unknown>) => ReactImpl.createElement('Icon', props);
  return { Icons: new Proxy({}, { get: () => Icon }), Spinner: Icon };
});

jest.mock('@/components/StreamBlocks', () => {
  const ReactImpl = require('react') as typeof React;
  return {
    StreamBlock: ({ message, onRetry, retryBusy }: { message: { kind: string; text?: string; title?: string }; onRetry?: () => void; retryBusy?: boolean }) => ReactImpl.createElement(
      'View',
      null,
      ReactImpl.createElement('Text', null, message.text || message.title || message.kind),
      onRetry
        ? ReactImpl.createElement('Pressable', { onPress: onRetry }, ReactImpl.createElement('Text', null, retryBusy ? '重试中…' : '重试这一条'))
        : null,
    ),
  };
});

jest.mock('@/components/ui', () => {
  const ReactImpl = require('react') as typeof React;
  return {
    Ring: (props: Record<string, unknown>) => ReactImpl.createElement('Ring', props),
  };
});

jest.mock('@/components/sheets', () => {
  const ReactImpl = require('react') as typeof React;
  return {
    CopySheet: (props: Record<string, unknown>) => ReactImpl.createElement('CopySheet', props),
    SkillSheet: (props: Record<string, unknown>) => ReactImpl.createElement('SkillSheet', props),
  };
});

jest.mock('@/components/MicButton', () => {
  const ReactImpl = require('react') as typeof React;
  return {
    MicButton: (props: Record<string, unknown>) => ReactImpl.createElement('MicButton', props),
  };
});

jest.mock('@/api/task', () => ({
  cancelUserTask: jest.fn(async () => ({ accepted: true })),
  listUserTaskEventsHistory: (...args: unknown[]) => mockListHistory(...args),
  sendUserTaskMessage: (...args: unknown[]) => mockSendTaskMessage(...args),
  streamTaskEvents: jest.fn((_taskId: string, onEvent: (event: Record<string, unknown>) => void) => {
    mockEventSink = onEvent;
    return { done: new Promise<void>(() => undefined), cancel: () => undefined };
  }),
}));

jest.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(m: string) { super(m); this.name = 'ApiError'; }
  },
}));

jest.mock('@/api/agent', () => ({}));

jest.mock('@/api/upload', () => ({
  MAX_ATTACHMENTS: 3,
  pickImages: jest.fn(async () => []),
  uploadTaskImage: jest.fn(),
}));

jest.mock('@/speech/useSpeechToText', () => ({
  useSpeechToText: () => ({ available: false, status: 'idle', active: false, toggle: () => undefined }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => undefined),
}));

const { TaskConversationPanel } = require('../TaskConversationPanel');

function baseTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    kind: 'develop',
    content: '实现登录页',
    status: 'processing',
    provider: 'claude',
    node_session_id: 'session-1',
    node_id: 'node-1',
    model_id: 'gpt-x',
    models: ['gpt-x'],
    mode: 'default',
    reasoning_effort: '',
    skill_config: [],
    ...overrides,
  };
}

const mockNoop = () => undefined;
const mockNoopAsync = async () => undefined;

function renderPanel(taskOverrides: Record<string, unknown> = {}) {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <TaskConversationPanel
        task={baseTask(taskOverrides)}
        statsTotalTokens={1234}
        models={[{ id: 'gpt-x', name: 'GPT X' }, { id: 'gpt-y', name: 'GPT Y' }]}
        onResult={mockNoop}
        onSwitchModel={mockNoopAsync}
        onSwitchMode={mockNoopAsync}
        onSwitchReasoningEffort={mockNoopAsync}
      />,
    );
  });
  return renderer!;
}

function pressableWithText(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root
    .findAll((node) => node.type === 'Pressable')
    .find((node) => node.findAll((child) => child.type === 'Text' && child.children.join('').includes(text)).length > 0);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEventSink = null;
});

it('renders input, model/mode/reasoning controls, token usage and actions', () => {
  const json = JSON.stringify(renderPanel().toJSON());
  expect(json).toContain('输入消息，发送后任务开始执行');
  expect(json).toContain('gpt-x');
  expect(json).toContain('默认（逐次确认）');
  expect(json).toContain('思考默认');
  expect(json).toContain('1.2K');
  expect(json).toContain('tokens');
  expect(json).toContain('继续');
  expect(json).toContain('你决定');
  expect(json).toContain('提交代码');
});

it('keeps input enabled for ready pending task (first turn)', () => {
  const json = JSON.stringify(renderPanel({ status: 'pending', node_session_id: 'session-1' }).toJSON());
  expect(json).toContain('输入消息，发送后任务开始执行');
  expect(json).toContain('gpt-x');
});

it('shows preparation step instead of an apparently usable input', () => {
  const json = JSON.stringify(renderPanel({
    status: 'pending',
    node_session_id: null,
    node_id: 'node-1',
    runtime_stage: { preparing: true, label: '拉取代码', index: 2, total: 4 },
  }).toJSON());
  expect(json).toContain('拉取代码');
  expect(json).toContain('2/4');
  expect(json).not.toContain('输入消息，发送后任务开始执行');
});

it('renders skill entry when task has available skills', () => {
  const json = JSON.stringify(renderPanel({
    skill_config: [{ name: 'feature-design', description: '功能设计' }],
  }).toJSON());
  expect(json).toContain('技能');
});

it('appends live SSE item events and never dumps lifecycle JSON into the transcript', async () => {
  const renderer = renderPanel();
  // 用户线上遇到的真实帧：agent_turn_started 是生命周期遥测。
  await act(async () => {
    mockEventSink?.({
      kind: 'agent_event',
      session_id: 'session-1',
      seq: 9,
      event_type: 'agent_turn_started',
      item_type: '',
      agent_id: '',
      payload: { v: 1, seq: 1, type: 'agent_turn_started', provider: 'claude' },
    });
  });
  let json = JSON.stringify(renderer.toJSON());
  expect(json).not.toContain('agent_turn_started');
  expect(json).not.toContain('session_id');
  // 轮次开始后要有「正在处理」的等待指示。
  expect(json).toContain('Agent 正在处理');

  // 真正的对话内容走 payload.event.item 的标准化条目。
  await act(async () => {
    mockEventSink?.({
      kind: 'agent_event',
      event_type: 'agent_event',
      item_type: 'agent_message',
      payload: { event: { item: { id: 'm1', type: 'agent_message', text: '开始实现' } } },
    });
  });
  json = JSON.stringify(renderer.toJSON());
  expect(json).toContain('开始实现');

  // 轮次收尾：等待指示熄灭。
  await act(async () => {
    mockEventSink?.({ kind: 'agent_event', event_type: 'agent_turn_completed', payload: { type: 'agent_turn_completed' } });
  });
  json = JSON.stringify(renderer.toJSON());
  expect(json).not.toContain('Agent 正在处理');
  expect(json).toContain('开始实现');

  await act(async () => { mockEventSink?.({ kind: 'result', text: '完成' }); });
  json = JSON.stringify(renderer.toJSON());
  expect(json).toContain('开始实现');
});

it('filters stage rows out of the transcript and renders retry on the errored turn', async () => {
  mockListHistory.mockResolvedValue({
    rows: [
      { seq: 1, kind: 'stage', event_type: 'SESSION_STAGE_RUNTIME_PREFLIGHT', payload: { stage: 'SESSION_STAGE_RUNTIME_PREFLIGHT', label: '检查运行环境' } },
      { seq: 2, kind: 'item', event_type: 'user_input', payload: { item: { id: 'u1', type: 'user_input', text: '请修复登录页' } } },
      { seq: 3, kind: 'item', event_type: 'error', payload: { item: { id: 'e1', type: 'error', text: '编译失败' } } },
      { seq: 4, kind: 'stage', event_type: 'SESSION_STAGE_RUNNING', payload: { stage: 'SESSION_STAGE_RUNNING', label: '运行中' } },
    ],
    next_before: null,
  });
  const renderer = renderPanel();
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });

  const json = JSON.stringify(renderer.toJSON());
  // 准备阶段是诊断信息，不允许以 proto 枚举名出现在首尾。
  expect(json).not.toContain('SESSION_STAGE');
  // 首条任务指令只在对话流里以 user_input 气泡出现，不再有“初始任务”独立卡片。
  expect(json).not.toContain('初始任务');
  expect(json).toContain('请修复登录页');
  expect(json).toContain('编译失败');
  expect(json).toContain('重试这一条');

  // 重试按钮挂在报错那一条上：重发的是它前面最近的 user_input。
  const retryButton = pressableWithText(renderer, '重试这一条');
  expect(retryButton).toBeTruthy();
  await act(async () => { retryButton!.props.onPress(); });
  expect(mockSendTaskMessage).toHaveBeenCalledWith('task-1', '请修复登录页', undefined, 'u1');
});

it('hides the cancel-current-turn button as soon as an error event arrives', async () => {
  const onResult = jest.fn();
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <TaskConversationPanel
        task={baseTask()}
        statsTotalTokens={0}
        models={[{ id: 'gpt-x', name: 'GPT X' }]}
        onResult={onResult}
        onSwitchModel={mockNoopAsync}
        onSwitchMode={mockNoopAsync}
        onSwitchReasoningEffort={mockNoopAsync}
      />,
    );
  });

  const cancelButtons = () => renderer!.root.findAll(
    (node) => node.type === 'Pressable' && node.props.accessibilityLabel === '中止本轮',
  );
  await act(async () => {
    mockEventSink?.({ kind: 'agent_event', event_type: 'agent_turn_started', payload: { type: 'agent_turn_started' } });
  });
  expect(cancelButtons()).toHaveLength(1);

  await act(async () => {
    mockEventSink?.({
      kind: 'item',
      payload: { item: { id: 'e-live', type: 'error', text: '执行失败' } },
    });
  });

  expect(cancelButtons()).toHaveLength(0);
  expect(onResult).toHaveBeenCalledTimes(1);
});

it('shows waiting state and cancel on mount only when the latest message is still in flight', async () => {
  // task.status 保持 processing（任务级状态，轮与轮之间不回退），但上一轮已完成
  // ——页面打开时不该常驻「正在处理/中止本轮」。真值来自 delivery_status。
  mockListHistory.mockResolvedValue({
    rows: [
      { seq: 1, kind: 'item', event_type: 'user_input', delivery_status: 'completed', payload: { item: { id: 'u1', type: 'user_input', text: '第一问' } } },
      { seq: 2, kind: 'item', event_type: 'agent_message', payload: { item: { id: 'm1', type: 'agent_message', text: '第一答' } } },
    ],
    next_before: null,
  });
  const idleRenderer = renderPanel();
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  const idleJson = JSON.stringify(idleRenderer.toJSON());
  expect(idleJson).not.toContain('Agent 正在处理');
  expect(idleRenderer.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === '中止本轮')).toHaveLength(0);

  // 而本轮确实在执行时（最近一条用户消息 delivery_status=running），打开即显示。
  mockListHistory.mockResolvedValue({
    rows: [
      { seq: 1, kind: 'item', event_type: 'user_input', delivery_status: 'completed', payload: { item: { id: 'u1', type: 'user_input', text: '第一问' } } },
      { seq: 3, kind: 'item', event_type: 'user_input', delivery_status: 'running', payload: { item: { id: 'u2', type: 'user_input', text: '第二问' } } },
    ],
    next_before: null,
  });
  const busyRenderer = renderPanel();
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  const busyJson = JSON.stringify(busyRenderer.toJSON());
  expect(busyJson).toContain('Agent 正在处理');
  expect(busyRenderer.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === '中止本轮')).toHaveLength(1);
});

it('never shows processing/cancel on an errored task even if delivery_status is stuck', async () => {
  // 运行时崩溃时 SSE 随之断开、收不到收尾帧，历史里 delivery_status 可能停在
  // running；但任务已终态（error），不能让页面停在「Agent 正在处理」+ 假中止
  // 按钮（对齐 Web 的 if (!canStream) setRunning(false)）。
  mockListHistory.mockResolvedValue({
    rows: [
      { seq: 1, kind: 'item', event_type: 'user_input', delivery_status: 'running', payload: { item: { id: 'u1', type: 'user_input', text: '执行这个' } } },
      { seq: 2, kind: 'item', event_type: 'error', payload: { item: { id: 'e1', type: 'error', text: 'runtime crashed' } } },
    ],
    next_before: null,
  });
  const renderer = renderPanel({ status: 'error', node_session_id: null, node_id: 'node-1' });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  const json = JSON.stringify(renderer.toJSON());
  expect(json).not.toContain('Agent 正在处理');
  expect(renderer.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === '中止本轮')).toHaveLength(0);
  // 错误卡仍在，重试入口仍挂在那条错误上。
  expect(pressableWithText(renderer, '重试这一条')).toBeTruthy();
});

it('swaps the trailing button to stop while running and back to send when idle', async () => {
  // 对齐 Web composer：处理中且没有待发内容 → 按钮位是「中止本轮」；空闲时切回「发送」。
  mockListHistory.mockResolvedValue({
    rows: [
      { seq: 1, kind: 'item', event_type: 'user_input', delivery_status: 'completed', payload: { item: { id: 'u1', type: 'user_input', text: '第一问' } } },
      { seq: 2, kind: 'item', event_type: 'user_input', delivery_status: 'running', payload: { item: { id: 'u2', type: 'user_input', text: '第二问' } } },
    ],
    next_before: null,
  });
  const renderer = renderPanel();
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  // 在跑：按钮位是中止（不是 send/send+stop 两个按钮并列）。
  expect(renderer.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === '中止本轮')).toHaveLength(1);

  // 轮次结束帧：按钮位切回发送，中止消失。
  await act(async () => {
    mockEventSink?.({ kind: 'result', seq: 3, payload: { type: 'result' } });
  });
  expect(renderer.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === '中止本轮')).toHaveLength(0);
});

it('retry without a preceding user input does not invoke a separate restart', async () => {
  mockListHistory.mockResolvedValue({
    rows: [
      { seq: 1, kind: 'stage', event_type: 'SESSION_STAGE_RUNTIME_START', payload: { stage: 'SESSION_STAGE_RUNTIME_START', label: '启动运行环境' } },
      { seq: 2, kind: 'item', event_type: 'error', payload: { item: { id: 'e2', type: 'error', text: 'agent runtime not installed' } } },
    ],
    next_before: null,
  });
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <TaskConversationPanel
        task={baseTask({ status: 'error', node_session_id: null, node_id: 'node-1', workspace_state: 'dispatch_failed', dispatch_error: 'agent runtime not installed' })}
        statsTotalTokens={0}
        models={[{ id: 'gpt-x', name: 'GPT X' }]}
        onResult={mockNoop}
        onSwitchModel={mockNoopAsync}
        onSwitchMode={mockNoopAsync}
        onSwitchReasoningEffort={mockNoopAsync}
      />,
    );
  });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });

  const retryButton = pressableWithText(renderer!, '重试这一条');
  expect(retryButton).toBeTruthy();
  await act(async () => { retryButton!.props.onPress(); });
  // No standalone restart path: recovery only happens when an actual message
  // is sent. With no prior user message there is nothing valid to retry.
  expect(mockSendTaskMessage).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer!.toJSON())).toContain('找不到可重试的上一轮消息');
});
