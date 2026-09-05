/**
 * 任务运行时交互状态的纯逻辑判定（从 TaskConversationPanel 抽出以便单测锁住语义）。
 *
 * 与 Web task-workspace-chat 对齐：删除是唯一不可恢复边界；只要任务仍存在且有
 * 执行节点，输入框就可发送。node_session_id 缺失 / finished / stopped / error
 * 都由 send_task_message 自动恢复 runtime；只有真实准备期与无节点禁用输入。
 */
import type { UserTaskDetail } from '@/api/task';

export interface TaskRuntimeState {
  hasRuntime: boolean;
  preparing: boolean;
  canInteract: boolean;
  /** 兼容旧调用方：恢复不再需要独立 start 按钮，始终为 false。 */
  canStart: boolean;
  /** 停止/取消只有活跃句柄时有意义。 */
  runtimeActive: boolean;
  dispatchFailed: boolean;
  /** 兼容旧调用方：恢复不再需要独立 restart 按钮，始终为 false。 */
  canRestartAfterError: boolean;
  placeholder: string;
  /**
   * 没有对话内容时的解释卡（对齐 Web task-workspace-chat 的 blocked 空态）：
   * 用户只关心「现在是什么状态、为什么、接下来怎么办」。移动端的恢复统一走
   * 发送消息（无独立重试按钮），所以文案指向「发送消息即可…」而不是给动作。
   */
  blocked?: { title: string; reason: string };
}

export function describeTaskRuntimeState(task: UserTaskDetail): TaskRuntimeState {
  const hasRuntime = !!task.node_session_id;
  const hasNode = !!task.node_id;
  const preparing = !!task.runtime_stage?.preparing;
  const dispatchFailed = task.workspace_state === 'dispatch_failed';
  const canInteract = (hasNode || hasRuntime) && !preparing;
  const canStart = false;
  const canRestartAfterError = false;
  const runtimeActive = hasRuntime;

  let placeholder: string;
  if (preparing) {
    placeholder = `正在${task.runtime_stage?.label || '准备运行环境'}（${task.runtime_stage?.index ?? ''}${task.runtime_stage?.total ? `/${task.runtime_stage.total}` : ''}），准备好后即可开始对话`;
  } else if (task.status === 'stopped') {
    placeholder = '任务已停止，发送消息即可继续';
  } else if (task.status === 'finished') {
    placeholder = '发送新消息，在同一工作区继续';
  } else if (hasRuntime) {
    placeholder = '输入消息，发送后任务开始执行';
  } else if (!hasNode) {
    placeholder = '任务没有可用的执行节点';
  } else if (dispatchFailed && task.dispatch_error) {
    placeholder = `上次运行失败：${task.dispatch_error}；发送消息会自动重试`;
  } else {
    placeholder = '输入消息，发送后任务会自动恢复';
  }

  // 空对话的解释卡。终态（stopped/finished/error）有历史时不显示——调用方只在
  // 没有任何消息时用它；准备失败/派发失败是还没跑起来的空任务，必须能说清楚。
  let blocked: { title: string; reason: string } | undefined;
  if (preparing) {
    const step = task.runtime_stage?.index && task.runtime_stage?.total ? `（第 ${task.runtime_stage.index}/${task.runtime_stage.total} 步）` : '';
    blocked = {
      title: `正在准备运行环境${step}`,
      reason: task.runtime_stage?.detail || `${task.runtime_stage?.label || '准备中'}…准备好后即可开始对话。`,
    };
  } else if (task.runtime_stage?.ok === false) {
    blocked = {
      title: `环境准备失败 · ${task.runtime_stage?.label || '未知步骤'}`,
      reason: task.runtime_stage?.detail || task.dispatch_error || '未返回具体原因。修复后发送消息即可重试。',
    };
  } else if (dispatchFailed) {
    blocked = {
      title: '任务没能运行起来',
      reason: task.dispatch_error
        ? `${task.dispatch_error}${hasNode ? '；发送消息会自动重试' : '；当前无法自动重试，请联系管理员处理节点'}`
        : '派发失败，请稍后重试。',
    };
  } else if (task.status === 'stopped') {
    blocked = {
      title: '任务已停止',
      reason: hasNode ? '运行时已释放，工作区与对话都保留。发送消息即可继续。' : '任务没有可用的执行节点，请联系管理员。',
    };
  } else if (task.status === 'finished') {
    blocked = {
      title: '任务已完成',
      reason: hasNode ? '本轮对话已结束。发送新消息可在同一工作区继续。' : '本轮对话已结束；任务没有可用的执行节点，无法继续。',
    };
  } else if (task.status === 'error') {
    blocked = {
      title: '任务异常',
      reason: task.dispatch_error || '运行时报错，未返回具体原因。发送消息即可重试。',
    };
  } else if (!hasRuntime && !hasNode) {
    blocked = { title: '任务没有可用的执行节点', reason: '请联系管理员为任务分配执行节点。' };
  } else if (!hasRuntime && hasNode) {
    blocked = { title: '任务还没开始', reason: '发送第一条消息即可开始运行。' };
  }

  return { hasRuntime, preparing, canInteract, canStart, runtimeActive, dispatchFailed, canRestartAfterError, placeholder, blocked };
}
