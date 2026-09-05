import {
  classifyTaskEvent,
  collapseErrorEvents,
  displayMessage,
  eventLogicalId,
  foldSubagentItem,
  itemTitle,
  itemToMessage,
  mergeEventLists,
  planEntriesFromRows,
  settleRunningTools,
  turnRunningFromHistory,
  type DisplayEvent,
  type SubagentRecord,
} from '../taskEventStream';

describe('taskEventStream', () => {
  it('treats agent_turn_started as state only instead of a chat message', () => {
    const raw = {
      kind: 'agent_event',
      session_id: 'session-1',
      seq: 9,
      event_type: 'agent_turn_started',
      item_type: '',
      agent_id: '',
      payload: { v: 1, seq: 1, type: 'agent_turn_started', provider: 'claude' },
    };

    expect(classifyTaskEvent(raw)).toEqual({ running: true });
    const event: DisplayEvent = {
      id: 'raw-turn-started',
      kind: 'agent_event',
      text: JSON.stringify(raw),
      time: 0,
      payload: raw,
      eventType: 'agent_turn_started',
    };
    // 即使调用方误把原始 JSON 塞进 text，渲染层也拒绝把无 item 的遥测帧当消息。
    expect(displayMessage(event)).toBeNull();
  });

  it('routes sub-agent items into their own card instead of the main transcript', () => {
    const effect = classifyTaskEvent({
      kind: 'agent_event',
      event_type: 'agent_event',
      item_type: 'agent_message',
      subagent_id: 'call_child',
      payload: {
        item: { id: 'child-1', type: 'agent_message', text: 'child result', agent_name: '调研员', task: '调研方案' },
        subagent_id: 'call_child',
      },
    });
    // 非根条目不进主对话（没有 item），折进 subagent 卡（与 Web reduceItems 同构）。
    expect(effect).toMatchObject({
      running: true,
      subagent: {
        id: 'call_child',
        item: { id: 'child-1', type: 'agent_message', text: 'child result' },
      },
    });
    expect(effect.item).toBeUndefined();

    expect(classifyTaskEvent({
      kind: 'agent_event',
      event_type: 'agent_event',
      item_type: 'agent_message',
      subagent_id: '',
      payload: {
        item: { id: 'root-1', type: 'agent_message', text: 'root result' },
        subagent_id: '',
      },
    })).toMatchObject({
      running: true,
      item: { id: 'root-1', type: 'agent_message', text: 'root result' },
    });
  });

  it('folds sub-agent items into one record: text accumulates, streaming growth replaces', () => {
    const child = { id: 'call_child', type: 'agent_message', text: '第一段结论' };
    let record = foldSubagentItem(undefined, child, 'call_child');
    expect(record).toMatchObject({ id: 'call_child', name: '子 Agent call_chi', content: '第一段结论', status: 'running' });

    record = foldSubagentItem(record, { id: 'child-2', type: 'agent_message', text: '第二段结论' }, 'call_child');
    expect(record.content).toBe('第一段结论\n第二段结论');

    // 同一条目流式增长：替换最后一段，不叠加。
    record = foldSubagentItem(record, { id: 'child-2', type: 'agent_message', text: '第二段结论（更新）' }, 'call_child');
    expect(record.content).toBe('第一段结论\n第二段结论（更新）');

    // agent_name/task 补齐后不被后续空值冲掉。
    record = foldSubagentItem(record, { id: 'child-2', type: 'agent_message', text: '第二段结论（更新）', agent_name: '调研员', task: '调研备选方案' }, 'call_child');
    expect(record).toMatchObject({ name: '调研员', task: '调研备选方案' });
  });

  it('tracks sub-agent tool calls by name with running → done progression', () => {
    let record: SubagentRecord = foldSubagentItem(undefined, { id: 't1', type: 'tool_call', title: 'Read', input: { file_path: 'a.ts' }, status: 'running' }, 'call_child');
    expect(record.tools).toEqual([{ name: 'Read', status: 'running' }]);

    record = foldSubagentItem(record, { id: 't1', type: 'tool_call', title: 'Read', output: 'ok', status: 'done' }, 'call_child');
    expect(record.tools).toEqual([{ name: 'Read', status: 'done' }]);

    // 同名工具的再一次调用：追加一条在跑的，不复活已完成条目。
    record = foldSubagentItem(record, { id: 't2', type: 'tool_call', title: 'Read', input: { file_path: 'b.ts' }, status: 'running' }, 'call_child');
    expect(record.tools).toEqual([{ name: 'Read', status: 'done' }, { name: 'Read', status: 'running' }]);
  });

  it('settles running sub-agents and their tools when the turn completes', () => {
    const entry: DisplayEvent = {
      id: 'subagent-entry-call_child',
      kind: 'subagent',
      text: '',
      time: 0,
      payload: {
        subagent: foldSubagentItem(undefined, { id: 't1', type: 'tool_call', title: 'Bash', input: { command: 'npm test' }, status: 'running' }, 'call_child'),
      },
    };
    const settled = settleRunningTools([entry]);
    const sub = (settled[0].payload?.subagent ?? {}) as SubagentRecord;
    expect(sub.status).toBe('done');
    expect(sub.tools).toEqual([{ name: 'Bash', status: 'done' }]);

    // 已完成的子 Agent 不再被触碰。
    expect(settleRunningTools(settled)).toEqual(settled);
  });

  it('merges history and live copies of one sub-agent without losing content', () => {
    const historyEntry: DisplayEvent = {
      id: 'subagent-entry-call_child',
      kind: 'subagent',
      text: '',
      time: 0,
      payload: {
        subagent: foldSubagentItem(
          foldSubagentItem(undefined, { id: 'c1', type: 'agent_message', text: '历史第一段' }, 'call_child'),
          { id: 't1', type: 'tool_call', title: 'Read', status: 'done' },
          'call_child',
        ),
      },
    };
    const liveEntry: DisplayEvent = {
      id: 'subagent-entry-call_child',
      kind: 'subagent',
      text: '',
      time: 1,
      payload: {
        subagent: foldSubagentItem(
          foldSubagentItem(undefined, { id: 'c1', type: 'agent_message', text: '历史第一段' }, 'call_child'),
          { id: 'c2', type: 'agent_message', text: '实时新段落' },
          'call_child',
        ),
      },
    };
    const [merged] = mergeEventLists([historyEntry], [liveEntry]);
    const sub = (merged.payload?.subagent ?? {}) as SubagentRecord;
    // 内容取更完整的一边（live 多一段），工具按名合并且 done 优先。
    expect(sub.content).toBe('历史第一段\n实时新段落');
    expect(sub.tools).toEqual([{ name: 'Read', status: 'done' }]);
    expect(sub.status).toBe('running');
    expect(merged.id).toBe('subagent-entry-call_child');
  });

  it('keys sub-agent entries by subagent id and renders them as subagent cards', () => {
    const entry: DisplayEvent = {
      id: 'subagent-entry-call_child',
      kind: 'subagent',
      text: '',
      time: 0,
      payload: {
        subagent: foldSubagentItem(undefined, { id: 'c1', type: 'agent_message', text: '结论', agent_name: '调研员', task: '调研' }, 'call_child'),
      },
    };
    expect(eventLogicalId(entry)).toBe('subagent:call_child');
    expect(displayMessage(entry)).toMatchObject({
      kind: 'subagent',
      subagentId: 'call_child',
      name: '调研员',
      task: '调研',
      status: 'running',
      text: '结论',
    });
  });

  it('turns todo_list items into plan entries instead of dropping them', () => {
    const effect = classifyTaskEvent({
      kind: 'agent_event',
      event_type: 'agent_event',
      item_type: 'todo_list',
      payload: {
        item: {
          id: 'todo-1',
          type: 'todo_list',
          items: [
            { content: '梳理登录流程', status: 'completed' },
            { content: '实现登录页', status: 'in_progress' },
            { content: '补测试' },
          ],
        },
      },
    });
    expect(effect).toMatchObject({
      plan: [
        { content: '梳理登录流程', status: 'completed' },
        { content: '实现登录页', status: 'in_progress' },
        { content: '补测试', status: 'pending' },
      ],
    });
    expect(effect.item).toBeUndefined();

    // 历史行恢复：取最后一条 todo_list（最新计划）。
    expect(planEntriesFromRows([
      { payload: { item: { id: 'todo-0', type: 'todo_list', items: [{ content: '旧计划', status: 'pending' }] } } },
      { payload: { item: { id: 'todo-1', type: 'todo_list', items: [{ content: '新计划', status: 'in_progress' }] } } },
    ])).toEqual([{ content: '新计划', status: 'in_progress' }]);
    expect(planEntriesFromRows([{ payload: { item: { id: 'm1', type: 'agent_message', text: 'hi' } } }])).toBeNull();
  });

  it('collapses the provider echo and the runtime error frame into one error card', () => {
    // provider 先把上游错误文本当普通 assistant 消息回显，运行时错误帧随后重复；
    // 全渲染就成了「一条普通气泡 + 一张重试卡」。同文本气泡被原位升级成错误卡。
    const bubble: DisplayEvent = {
      id: 'live-m1', kind: 'item', text: '', time: 0,
      payload: { item: { id: 'm1', type: 'agent_message', text: 'API Error: 429' } },
    };
    const frame: DisplayEvent = {
      id: 'live-error-2', kind: 'error', text: '', time: 1,
      payload: { item: { id: 'error-2', type: 'error', text: 'API Error: 429' } },
    };
    const collapsed = collapseErrorEvents([bubble, frame]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].id).toBe('live-error-2');
    expect(displayMessage(collapsed[0])).toMatchObject({ kind: 'error', text: 'API Error: 429' });
  });

  it('keeps only the first card when the same failure arrives from history and live', () => {
    const persisted: DisplayEvent = {
      id: 'h-5', kind: 'item', text: '', time: 0, seq: 5,
      payload: { item: { id: 'err-1', type: 'error', text: '模型调用失败' } },
    };
    const liveTwin: DisplayEvent = {
      id: 'live-error-6', kind: 'error', text: '', time: 1, seq: 6,
      payload: { item: { id: 'error-6', type: 'error', text: '模型调用失败' } },
    };
    const collapsed = collapseErrorEvents([persisted, liveTwin]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].id).toBe('h-5');
  });

  it('keeps a new turn error even when an earlier turn reported the same text', () => {
    const turn1Error: DisplayEvent = {
      id: 'e-1', kind: 'item', text: '', time: 0,
      payload: { item: { id: 'e1', type: 'error', text: '上游 5xx' } },
    };
    const nextTurn: DisplayEvent = { id: 'u-2', kind: 'user', text: '再试一次', time: 1 };
    const turn2Error: DisplayEvent = {
      id: 'e-2', kind: 'item', text: '', time: 2,
      payload: { item: { id: 'e2', type: 'error', text: '上游 5xx' } },
    };
    // 逐轮重置：新一轮用户消息之后的错误与上一轮无关，不折叠。
    expect(collapseErrorEvents([turn1Error, nextTurn, turn2Error])).toHaveLength(3);
  });

  it('ends the loading state and settles running tools on turn completion', () => {
    expect(classifyTaskEvent({
      kind: 'agent_event',
      event_type: 'agent_turn_completed',
      payload: { type: 'agent_turn_completed' },
    })).toEqual({ running: false, settleTools: true });

    const runningTool: DisplayEvent = {
      id: 'tool-1',
      kind: 'item',
      text: '',
      time: 0,
      payload: { item: { id: 'tool-1', type: 'tool_call', title: 'Read', input: { file_path: 'README.md' }, status: 'running' } },
    };
    const settled = settleRunningTools([runningTool]);
    expect(displayMessage(settled[0])).toMatchObject({ kind: 'tool', title: 'Read', status: 'completed' });
  });

  it('decodes nested live items and preserves the real tool name', () => {
    const effect = classifyTaskEvent({
      kind: 'agent_event',
      event_type: 'agent_event',
      item_type: 'tool_call',
      payload: {
        event: {
          item: {
            id: 'tool-read',
            type: 'tool_call',
            title: 'Read',
            input: { file_path: 'src/index.ts' },
            status: 'running',
          },
        },
      },
    });

    expect(effect.running).toBe(true);
    expect(effect.item).toMatchObject({ id: 'tool-read', title: 'Read' });
    expect(itemToMessage(effect.item!, 'fallback')).toMatchObject({
      kind: 'tool',
      title: 'Read',
      toolKind: 'read',
      status: 'in_progress',
      rawInput: { file_path: 'src/index.ts' },
    });
  });

  it('derives useful names for Codex tool item variants', () => {
    expect(itemToMessage({ id: 'cmd', type: 'command_execution', command: 'npm test', status: 'in_progress' }, 'x')).toMatchObject({
      title: 'npm test',
      toolKind: 'execute',
    });
    expect(itemToMessage({ id: 'mcp', type: 'mcp_tool_call', server: 'github', tool: 'search_code' }, 'x')).toMatchObject({
      title: 'github/search_code',
    });
    expect(itemToMessage({ id: 'search', type: 'web_search', query: 'Expo SSE' }, 'x')).toMatchObject({
      title: 'Expo SSE',
      toolKind: 'fetch',
    });
  });

  it('merges sparse tool completion frames without losing title and input', () => {
    const started: DisplayEvent = {
      id: 'start',
      kind: 'item',
      text: '',
      time: 0,
      payload: { item: { id: 'tool-1', type: 'tool_call', title: 'Bash', input: { command: 'npm test' }, status: 'running' } },
    };
    const completed: DisplayEvent = {
      id: 'done',
      kind: 'item',
      text: 'ok',
      time: 1,
      payload: { item: { id: 'tool-1', type: 'tool_call', output: 'ok', status: 'done' } },
    };

    const [merged] = mergeEventLists([started], [completed]);
    expect(displayMessage(merged)).toMatchObject({
      kind: 'tool',
      title: 'Bash',
      toolKind: 'execute',
      status: 'completed',
      rawInput: { command: 'npm test' },
      rawOutput: 'ok',
    });
  });

  it('turns a top-level runtime error into a retryable error item', () => {
    const effect = classifyTaskEvent({
      kind: 'error',
      seq: 12,
      payload: { message: '模型调用失败' },
    });
    expect(effect).toMatchObject({ running: false, settleTools: true, terminal: true, error: '模型调用失败' });
    expect(itemToMessage(effect.item!, 'fallback')).toMatchObject({ kind: 'error', text: '模型调用失败' });
  });

  it('never shows the raw protocol type as a tool name', () => {
    // 历史行如果只回放了稀疏完成帧（title 被抹掉的旧行），兜底必须是可读文案，
    // 而不是 item_to_message 协议里的类型名 tool_call。
    expect(itemTitle({ id: 't', type: 'tool_call', output: 'ok', status: 'done' })).toBe('工具调用');
    expect(itemTitle({ id: 't', type: 'tool_call', title: 'mcp__github__search_code' })).toBe('mcp__github__search_code');
  });

  it('ends the turn on input_status cancelled/failed', () => {
    expect(classifyTaskEvent({
      kind: 'agent_event',
      event_type: 'input_status',
      payload: { messageId: 'm1', status: 'cancelled' },
    })).toMatchObject({ running: false, settleTools: true });
    // received 只是投递 ACK，本轮还没开始——不驱动「正在处理」。
    expect(classifyTaskEvent({
      kind: 'agent_event',
      event_type: 'input_status',
      payload: { messageId: 'm1', status: 'received' },
    })).toEqual({});
  });

  it('derives the in-flight turn from the latest user message delivery_status', () => {
    // mc_tasks.status 在轮与轮之间停在 processing，不能当轮次状态；
    // 真值是最近一条用户消息行的 delivery_status。
    expect(turnRunningFromHistory([
      { delivery_status: 'pending' },
      { delivery_status: 'completed' },
    ])).toBe(false);
    expect(turnRunningFromHistory([
      { delivery_status: null },
      { delivery_status: 'completed' },
      { delivery_status: 'running' },
    ])).toBe(true);
    expect(turnRunningFromHistory([{ delivery_status: null }])).toBe(false);
    expect(turnRunningFromHistory([])).toBe(false);
  });

  it('treats a turn as done when its delivery_status is stuck but an error closed it', () => {
    // provider 侧 429 失败（真实案例 e51008d0）：运行时进程没退出、task_finalize
    // 不触发，delivery_status 永远停在 received，但 error 帧已经在对话里收过尾。
    // 历史回放不重放 agent_turn_*，所以只能从 item 流本身读「已出 error」。
    expect(turnRunningFromHistory([
      { delivery_status: 'received', event_type: 'item', payload: { item: { type: 'user_input', text: '查一下' } } },
      { delivery_status: null, event_type: 'item', payload: { item: { type: 'agent_message', text: 'API Error: 429' } } },
      { delivery_status: null, event_type: 'error', payload: { item: { type: 'error', text: 'API Error: 429' } } },
      { delivery_status: null, event_type: 'stage' },
    ])).toBe(false);
    // 同样卡在 received，但没有 error 收尾 → 仍在途（不能误杀真正在跑的轮次）。
    expect(turnRunningFromHistory([
      { delivery_status: 'received', event_type: 'item', payload: { item: { type: 'user_input' } } },
      { delivery_status: null, event_type: 'item', payload: { item: { type: 'agent_message', text: '正在执行' } } },
    ])).toBe(true);
    // error 属于上一轮：新一轮 user_input 之后又出 error 前，仍按新轮投递状态判定。
    expect(turnRunningFromHistory([
      { delivery_status: 'running', event_type: 'item', payload: { item: { type: 'user_input' } } },
      { delivery_status: null, event_type: 'error', payload: { item: { type: 'error' } } },
      { delivery_status: 'running', event_type: 'item', payload: { item: { type: 'user_input' } } },
      { delivery_status: null, event_type: 'item', payload: { item: { type: 'agent_message' } } },
    ])).toBe(true);
  });
});
