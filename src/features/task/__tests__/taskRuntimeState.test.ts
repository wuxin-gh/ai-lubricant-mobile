import type { UserTaskDetail } from '@/api/task';
import { describeTaskRuntimeState } from '../taskRuntimeState';

function task(overrides: Partial<UserTaskDetail> = {}): UserTaskDetail {
  return {
    id: 'task-1',
    kind: 'develop',
    content: '实现功能',
    status: 'pending',
    provider: 'claude',
    ...overrides,
  };
}

describe('describeTaskRuntimeState', () => {
  it('allows input when pending task already has a runtime', () => {
    const state = describeTaskRuntimeState(task({ status: 'pending', node_session_id: 'session-1' }));
    expect(state.canInteract).toBe(true);
    expect(state.placeholder).toContain('输入消息');
  });

  it('disables input while the node is preparing the runtime', () => {
    const state = describeTaskRuntimeState(task({
      node_id: 'node-1',
      runtime_stage: { preparing: true, label: '拉取代码', index: 2, total: 4 },
    }));
    expect(state.canInteract).toBe(false);
    expect(state.preparing).toBe(true);
    expect(state.placeholder).toContain('拉取代码');
    expect(state.placeholder).toContain('2/4');
  });

  it('allows a pending task with node but no runtime to recover by sending', () => {
    const state = describeTaskRuntimeState(task({ node_id: 'node-1', node_session_id: null }));
    expect(state.canStart).toBe(false); // no separate start button
    expect(state.canInteract).toBe(true);
    expect(state.placeholder).toContain('自动恢复');
  });

  it('allows dispatch failure to retry by sending and exposes the reason', () => {
    const state = describeTaskRuntimeState(task({
      status: 'error',
      node_id: 'node-1',
      workspace_state: 'dispatch_failed',
      dispatch_error: '节点离线',
    }));
    expect(state.canRestartAfterError).toBe(false); // no restart button
    expect(state.canInteract).toBe(true);
    expect(state.placeholder).toContain('自动重试');
    expect(state.placeholder).toContain('节点离线');
    expect(state.runtimeActive).toBe(false);
  });

  it('finished task remains interactive; sending represents restart', () => {
    const state = describeTaskRuntimeState(task({
      status: 'finished',
      node_id: 'node-1',
      node_session_id: 'session-1',
    }));
    expect(state.canStart).toBe(false);
    expect(state.runtimeActive).toBe(true);
    expect(state.canInteract).toBe(true);
  });

  it('keeps stop/cancel available while a runtime handle exists', () => {
    const state = describeTaskRuntimeState(task({ status: 'processing', node_session_id: 'session-1' }));
    expect(state.runtimeActive).toBe(true);
    expect(state.canInteract).toBe(true);
  });

  it('explains when the task has no execution node or runtime', () => {
    const state = describeTaskRuntimeState(task({ node_id: null, node_session_id: null }));
    expect(state.canStart).toBe(false);
    expect(state.canInteract).toBe(false);
    expect(state.placeholder).toContain('没有可用的执行节点');
  });
});
