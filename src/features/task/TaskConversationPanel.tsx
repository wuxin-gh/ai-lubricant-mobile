/**
 * 任务对话主区：消息流 + 统一输入器。
 *
 * 与 Web task-workspace-chat 对齐：
 * - 输入器持有模式 / 思考等级 / 模型 / 上下文 token / 重启 几个核心控件，不再外挂。
 * - 输入解锁按 hasRuntime + (processing || pending) 而非「status === processing」，
 *   pending 且已就绪（有 node_session_id）即可发送首条消息；准备期显式禁用并提示步骤。
 * - 危险操作（重启/清空/停止）走顶部动作，不与输入器抢空间。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { ApiError } from '@/api/client';
import {
  cancelUserTask,
  listUserTaskEventsHistory,
  sendUserTaskMessage,
  streamTaskEvents,
  type TaskEvent,
  type UserTaskDetail,
  type UserTaskEventRow,
} from '@/api/task';
import { type AvailableModel } from '@/api/agent';
import { MAX_ATTACHMENTS, pickImages, uploadTaskImage, type UploadedAttachment } from '@/api/upload';
import { describeTaskRuntimeState } from '@/features/task/taskRuntimeState';
import {
  classifyTaskEvent,
  collapseErrorEvents,
  displayMessage,
  eventLogicalId,
  foldSubagentItem,
  itemText,
  mergeEventLists,
  normalizedItem,
  planEntriesFromRows,
  settleRunningTools,
  subagentIdOf,
  turnRunningFromHistory,
  type DisplayEvent,
  type SubagentRecord,
} from '@/features/task/taskEventStream';
import { SkillSheet } from '@/components/sheets';
import { StreamBlock } from '@/components/StreamBlocks';
import { MicButton } from '@/components/MicButton';
import { newClientMessageId } from '@/features/task/clientMessageId';
import { useSpeechToText } from '@/speech/useSpeechToText';
import { Ring } from '@/components/ui';
import type { AvailableCommand, ChatMessage } from '@/messages/handler';
import { Icons, Spinner } from '@/components/Icons';
import { spacing, useTheme, type Theme } from '@/theme';

const TASK_DRAFT_KEY = (taskId: string) => `monkeycode:task-draft:${taskId}`;
const QUICK_PROMPTS: { label: string; text: string }[] = [
  { label: '继续', text: '继续' },
  { label: '你决定', text: '你决定' },
  { label: '提交代码', text: '提交代码' },
];

type PendingAttachment = {
  key: string;
  filename: string;
  status: 'uploading' | 'done' | 'error';
  uploaded?: UploadedAttachment;
};

/** 与 Web editorModeOptions 一致的硬编码权限/审批模式。 */
function modeOptionsFor(provider?: string | null): { value: string; label: string }[] {
  switch ((provider || '').toLowerCase()) {
    case 'codex':
      return [
        { value: '', label: '编辑器默认' },
        { value: 'read-only', label: '只读' },
        { value: 'workspace-write', label: '可写工作区' },
        { value: 'danger-full-access', label: '完全访问' },
      ];
    case 'claude':
      return [
        { value: '', label: '编辑器默认' },
        { value: 'default', label: '默认（逐次确认）' },
        { value: 'plan', label: '仅计划' },
        { value: 'acceptEdits', label: '自动接受编辑' },
        { value: 'bypassPermissions', label: '跳过权限确认' },
      ];
    case 'opencode':
      return [
        { value: '', label: '编辑器默认' },
        { value: 'skip-permissions', label: '跳过权限确认' },
      ];
    default:
      return [{ value: '', label: '编辑器默认' }];
  }
}

const EFFORT_OPTIONS = [
  { value: '', label: '思考默认' },
  { value: 'low', label: '思考 Low' },
  { value: 'medium', label: '思考 Med' },
  { value: 'high', label: '思考 High' },
  { value: 'xhigh', label: '思考 XHigh' },
];

interface TaskConversationPanelProps {
  task: UserTaskDetail;
  statsTotalTokens: number;
  models: AvailableModel[];
  modelMaxTokens?: number;
  onResult: () => void;
  onSwitchModel: (modelId: string) => Promise<void>;
  onSwitchMode: (mode: string) => Promise<void>;
  onSwitchReasoningEffort: (effort: '' | 'low' | 'medium' | 'high' | 'xhigh') => Promise<void>;
}

export function TaskConversationPanel({
  task,
  statsTotalTokens,
  models,
  modelMaxTokens,
  onResult,
  onSwitchModel,
  onSwitchMode,
  onSwitchReasoningEffort,
}: TaskConversationPanelProps) {
  const t = useTheme();
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  // 「本轮是否在跑」不能用 mc_tasks.status——那是任务级状态：发过一次消息就停在
  // processing，直到运行时退出，轮与轮之间不回 pending。轮次真值是用户消息行的
  // delivery_status（agent_turn_* 帧推进、历史接口带回）加上实时 SSE 帧。
  // 先按 false 渲染，历史加载后由 turnRunningFromHistory 校正。
  const [turnRunning, setTurnRunning] = useState(false);
  const [historyDone, setHistoryDone] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<AvailableCommand[]>([]);
  const [contextUsage, setContextUsage] = useState<{ used: number; size: number } | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modePickerOpen, setModePickerOpen] = useState(false);
  const [effortPickerOpen, setEffortPickerOpen] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // 执行计划条目（todo_list 帧，与 Web PlanStepsBlock 同源）。空数组 = 当前无计划。
  const [plan, setPlan] = useState<{ content: string; status: string }[]>([]);
  const seenSeqs = useRef<Set<number>>(new Set());
  // 实时 SSE 一旦报告过轮次状态（started/completed/result/error），它就是最新事实；
  // 初始历史请求晚于它返回时不得用 delivery_status 把状态覆盖回旧值。
  const turnStateFromLive = useRef(false);
  const streamRef = useRef<{ cancel: () => void } | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Restore the per-task draft (survives app restart). Saved on message change
  // with a small debounce so typing doesn't thrash AsyncStorage.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(TASK_DRAFT_KEY(task.id));
        if (active && saved) setMessage(saved);
      } catch { /* draft is best-effort */ }
    })();
    return () => { active = false; };
  }, [task.id]);

  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMessageChange = useCallback((text: string) => {
    setMessage(text);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      AsyncStorage.setItem(TASK_DRAFT_KEY(task.id), text).catch(() => undefined);
    }, 400);
  }, [task.id]);

  const onSpeechText = useCallback((text: string) => {
    setMessage((current) => (current ? `${current} ${text}` : text));
  }, []);
  const onSpeechError = useCallback((msg: string) => { setError(msg); }, []);
  const speech = useSpeechToText({ onText: onSpeechText, onError: onSpeechError });

  useEffect(() => {
    const commands = (task.skill_config || []).flatMap((item) => {
      const name = String(item.name || item.command || '').replace(/^\//, '').trim();
      if (!name) return [];
      return [{ name, description: typeof item.description === 'string' ? item.description : undefined }];
    });
    setAvailableSkills(commands);
  }, [task.skill_config]);

  const copyAll = useCallback(async (text: string) => {
    try { await Clipboard.setStringAsync(text); } catch { /* ignore */ }
  }, []);

  const appendEvent = useCallback((event: TaskEvent) => {
    const raw = event as Record<string, unknown>;
    // 帧的含义由 classifyTaskEvent 判定（与 Web 同一套）：只有带标准化 item 的
    // 才是对话内容，agent_turn_started 这类生命周期帧只驱动「正在处理」状态。
    const effect = classifyTaskEvent(raw);
    if (effect.running !== undefined) {
      setTurnRunning(effect.running);
      turnStateFromLive.current = true;
    }
    if (effect.usage) setContextUsage(effect.usage);
    if (effect.error) setError(effect.error);
    if (effect.plan) setPlan(effect.plan);
    if (effect.terminal) onResult(); // 立即回拉任务状态，错误后不残留“中止本轮”按钮。

    const seq = typeof raw.seq === 'number' ? raw.seq : undefined;
    const additions: DisplayEvent[] = [];
    if (effect.item) {
      additions.push({
        id: `live-${String(effect.item.id || seq || Date.now())}`,
        kind: String(effect.item.type || event.kind),
        text: itemText(effect.item),
        time: Date.now(),
        payload: { item: effect.item },
        eventType: String(effect.item.type || ''),
      });
    }
    if (effect.system) {
      additions.push({ id: `sys-${seq ?? Date.now()}`, kind: 'system', text: effect.system, time: Date.now() });
    }

    if (!additions.length && !effect.settleTools && !effect.subagent) return;
    setEvents((current) => {
      // 子 Agent 条目折进各自的卡（首见即插入，后续原地累积），不与历史走
      // mergeEventLists 的按条目去重——卡是聚合视图，按 subagent_id 合并。
      let next = current;
      if (effect.subagent) {
        const { id, item } = effect.subagent;
        const entryId = `subagent-entry-${id}`;
        const idx = current.findIndex((candidate) => candidate.id === entryId);
        if (idx === -1) {
          next = [...current, {
            id: entryId,
            kind: 'subagent',
            text: '',
            time: Date.now(),
            payload: { subagent: foldSubagentItem(undefined, item, id) },
          }];
        } else {
          const existing = current[idx];
          const prev = (existing.payload?.subagent as SubagentRecord | undefined);
          const updated = [...current];
          updated[idx] = { ...existing, payload: { subagent: foldSubagentItem(prev, item, id) } };
          next = updated;
        }
      }
      if (additions.length) next = mergeEventLists(next, additions);
      return effect.settleTools ? settleRunningTools(next) : next;
    });
  }, [onResult]);

  const displayHistoryRows = useCallback((rows: UserTaskEventRow[]) => {
    // 准备阶段行不进消息流；子 Agent 条目按 id 折进各自的卡，并在首见位置
    // 留一张入口（与 Web reduceItems 同构），而不是混进主对话当普通消息。
    const out: DisplayEvent[] = [];
    const subagentIndex = new Map<string, number>();
    for (const row of rows) {
      if (row.kind === 'stage' || String(row.event_type || '').startsWith('SESSION_STAGE_')) continue;
      if (seenSeqs.current.has(row.seq)) continue;
      seenSeqs.current.add(row.seq);
      const item = normalizedItem(row.payload);
      if (!item) continue;
      const itemType = String(item.type || row.event_type || '').toLowerCase();
      if (itemType === 'todo_list') continue; // 计划条由 planEntriesFromRows 单独驱动
      const subId = subagentIdOf(row, item);
      if (subId) {
        const idx = subagentIndex.get(subId);
        if (idx == null) {
          subagentIndex.set(subId, out.length);
          out.push({ id: `subagent-entry-${subId}`, kind: 'subagent', text: '', time: 0, seq: row.seq, payload: { subagent: foldSubagentItem(undefined, item, subId) } });
        } else {
          const existing = out[idx];
          const prev = existing.payload?.subagent as SubagentRecord | undefined;
          out[idx] = { ...existing, payload: { subagent: foldSubagentItem(prev, item, subId) } };
        }
        continue;
      }
      out.push({ id: `h-${row.seq}`, kind: row.kind, text: itemText(item), time: 0, seq: row.seq, payload: row.payload, eventType: row.event_type });
    }
    return out;
  }, []);

  // Load the latest persisted events once on mount. Older rows are pulled via
  // the exclusive ``next_before`` cursor so reconnect/history pagination does
  // not duplicate messages.
  useEffect(() => {
    let active = true;
    setHistoryDone(false);
    setNextBefore(null);
    setEvents([]);
    setPlan([]);
    setTurnRunning(false);
    turnStateFromLive.current = false;
    seenSeqs.current = new Set();
    (async () => {
      try {
        const page = await listUserTaskEventsHistory(task.id, undefined, 50);
        if (!active) return;
        const history = displayHistoryRows(page.rows || []);
        // 计划条以历史里最后一条 todo_list 恢复（翻页只拿更早的行，不回写计划）。
        const planEntries = planEntriesFromRows(page.rows || []);
        if (planEntries) setPlan(planEntries);
        // 「本轮是否在跑」以最近一条用户消息的 delivery_status 为准——
        // 打开页面时如果上一轮还在执行，这里就能直接亮起等待/中止。
        // 但若实时 SSE 已先报了轮次状态，以实时为准，不用历史覆盖。
        if (!turnStateFromLive.current) {
          setTurnRunning(turnRunningFromHistory(page.rows || []));
        }
        // 历史请求与实时 SSE 并行；同一逻辑项（item id）历史与实时只保留一份，
        // 且完成帧（running→done）按 id 原地合并，不追加重复卡片。
        setEvents((current) => mergeEventLists(history, current));
        setNextBefore(page.next_before ?? null);
      } catch {
        // 历史是 best-effort；失败时保留已经收到的实时事件。
      } finally {
        if (active) setHistoryDone(true);
      }
    })();
    return () => { active = false; };
  }, [displayHistoryRows, task.id]);

  const loadOlder = useCallback(async () => {
    if (!nextBefore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await listUserTaskEventsHistory(task.id, nextBefore, 50);
      const older = displayHistoryRows(page.rows || []);
      setEvents((current) => mergeEventLists(older, current));
      setNextBefore(page.next_before ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载历史失败');
    } finally {
      setLoadingOlder(false);
    }
  }, [displayHistoryRows, loadingOlder, nextBefore, task.id]);

  // 「有活跃运行时可跟流」是 SSE 连接与轮次在途的共同门禁（对齐 Web canStream）。
  const canStream = !!task.node_session_id && !task.runtime_stage?.preparing
    && (task.status === 'pending' || task.status === 'processing');
  // 轮次在途只在 canStream 时成立：终态任务（error/stopped/finished，runtime 已
  // 退出）或没有运行时句柄时，历史推导出的在途状态必须视为已结束。运行时崩溃
  // 时 task_finalize 只把任务置 error、不推进消息投递状态，历史里 delivery_status
  // 会停在 running——用推导而不是一次性 effect 清态，历史晚到、状态翻转都能生效，
  // 否则页面会永远停在「Agent 正在处理」并挂着一个假的中止按钮。
  const turnLive = turnRunning && canStream;

  // Connect one SSE while the runtime is live. Pause on background, reconnect
  // on foreground (the route's refresh re-reads detail/stats/logs separately).
  useEffect(() => {
    if (!canStream) return;
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      const handle = streamTaskEvents(task.id, (event) => { if (active) appendEvent(event); });
      streamRef.current = handle;
      handle.done.catch((err) => {
        if (active && !(err instanceof ApiError && err.status === 409)) {
          setError(err instanceof Error ? err.message : '任务事件连接失败');
        }
      });
    };
    open();

    const onAppState = (state: string) => {
      if (state === 'active') {
        streamRef.current?.cancel();
        reconnectTimer = setTimeout(() => { if (active) open(); }, 200);
      } else {
        streamRef.current?.cancel();
        streamRef.current = null;
      }
    };
    const sub = AppState.addEventListener('change', onAppState);

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      streamRef.current?.cancel();
      streamRef.current = null;
      sub.remove();
    };
  }, [appendEvent, canStream, task.id]);

  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }); }, [events]);

  // 运行时是否就绪可交互：与 Web 对齐——有运行时句柄且状态可收消息即放开输入，
  // 而不是只有 processing 才允许。pending + node_session_id = 就绪待首条消息。
  const runtime = describeTaskRuntimeState(task);
  const { canInteract } = runtime;

  const inputPlaceholder = runtime.placeholder;
  // 错误去重出口：provider 回显的同文本普通气泡升级成错误卡、重复错误帧丢弃
  // （与 Web collapseErrorDuplicates 同一出口语义，历史∪实时合并后统一套用）。
  const visibleEvents = useMemo(() => collapseErrorEvents(events), [events]);

  const submit = async () => {
    const text = message.trim();
    const readyAttachments = attachments.flatMap((item) => item.status === 'done' && item.uploaded ? [item.uploaded] : []);
    if (!text && !readyAttachments.length) return;
    if (attachments.some((item) => item.status === 'uploading')) {
      setError('附件仍在上传，请稍候');
      return;
    }
    setSending(true);
    try {
      // 端到端幂等键：乐观气泡与持久化行共用同一 ID（回放 mapper 直接用 item.id），
      // 刷新后按 ID 合并只显示一条。
      const clientMessageId = newClientMessageId();
      await sendUserTaskMessage(task.id, text, readyAttachments, clientMessageId);
      // 发送可能自动恢复/替换 runtime 句柄；回拉详情后父组件用新句柄重连 SSE。
      onResult();
      setTurnRunning(true);
      setMessage('');
      setAttachments([]);
      AsyncStorage.removeItem(TASK_DRAFT_KEY(task.id)).catch(() => undefined);
      const displayText = [text, ...readyAttachments.map((a) => `📎 ${a.filename}`)].filter(Boolean).join('\n');
      setEvents((current) => [...current, { id: clientMessageId, kind: 'user', text: displayText, time: Date.now() }]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error)?.message || '发送失败');
    } finally {
      setSending(false);
    }
  };

  const addAttachments = useCallback(async () => {
    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) { setError(`最多添加 ${MAX_ATTACHMENTS} 张图片`); return; }
    try {
      const picked = await pickImages(remaining);
      for (const image of picked) {
        const key = `${Date.now()}-${image.name}-${Math.random()}`;
        setAttachments((current) => [...current, { key, filename: image.name, status: 'uploading' }]);
        void uploadTaskImage(task.id, image).then((uploaded) => {
          setAttachments((current) => current.map((item) => item.key === key ? { ...item, filename: uploaded.filename, status: 'done', uploaded } : item));
        }).catch((e) => {
          setAttachments((current) => current.map((item) => item.key === key ? { ...item, status: 'error' } : item));
          setError(e instanceof Error ? e.message : '附件上传失败');
        });
      }
    } catch (e) { setError(e instanceof Error ? e.message : '选择图片失败'); }
  }, [attachments.length, task.id]);

  const sendQuick = useCallback((text: string) => {
    if (sending || !canInteract) return;
    void (async () => {
      setSending(true);
      try {
        const clientMessageId = newClientMessageId();
        await sendUserTaskMessage(task.id, text, undefined, clientMessageId);
        onResult();
        setTurnRunning(true);
        setEvents((current) => [...current, { id: clientMessageId, kind: 'user', text, time: Date.now() }]);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : '发送失败');
      } finally {
        setSending(false);
      }
    })();
  }, [canInteract, onResult, sending, task.id]);

  const pickSkill = useCallback((name: string) => {
    setSkillPickerOpen(false);
    onMessageChange(`/${name} `);
  }, [onMessageChange]);

  const retryEvent = useCallback(async (errorEvent: DisplayEvent, index: number) => {
    if (retryingId) return;
    const retryId = eventLogicalId(errorEvent);
    setRetryingId(retryId);
    setError('');
    try {
      let previousUser: Extract<ChatMessage, { kind: 'user' }> | null = null;
      let previousEvent: DisplayEvent | null = null;
      for (let i = index - 1; i >= 0; i--) {
        const candidate = displayMessage(visibleEvents[i]);
        if (candidate?.kind === 'user') {
          previousUser = candidate;
          previousEvent = visibleEvents[i];
          break;
        }
      }

      if (previousUser?.text.trim()) {
        const item = normalizedItem(previousEvent?.payload);
        const rawAttachments = Array.isArray(item?.attachments) ? item.attachments : [];
        const retryAttachments = rawAttachments.flatMap((raw) => {
          if (!raw || typeof raw !== 'object') return [];
          const row = raw as Record<string, unknown>;
          const url = typeof row.url === 'string' ? row.url : '';
          return url ? [{ url, filename: typeof row.filename === 'string' ? row.filename : 'attachment' }] : [];
        });
        // 同 ID 重试：复用原消息的幂等键，服务端按 failed → pending 重新入队，
        // runtime 缺失时发送接口自动恢复，不需要先点/调 restart。
        await sendUserTaskMessage(
          task.id,
          previousUser.text,
          retryAttachments.length ? retryAttachments : undefined,
          previousUser.id,
        );
        setTurnRunning(true);
      } else {
        setError('找不到可重试的上一轮消息');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '重试失败，请稍后再试');
    } finally {
      setRetryingId(null);
    }
  }, [retryingId, task.id, visibleEvents]);

  const cancelTurn = useCallback(async () => {
    // 点击后立即隐藏，避免异常/终态下残留一个没有意义的“停止”按钮；失败再恢复状态。
    setTurnRunning(false);
    try {
      await cancelUserTask(task.id);
      onResult();
    } catch (e) {
      setTurnRunning(true);
      setError(e instanceof ApiError ? e.message : '中止本轮失败');
    }
  }, [onResult, task.id]);

  // 活跃模型 = models_snapshot 头部；model_id 是 ProjectTask 绑定 UUID，非模型名。
  const currentModel = task.models?.[0] || '默认模型';
  const modeOpts = useMemo(() => modeOptionsFor(task.provider), [task.provider]);
  const currentMode = task.mode_label || task.mode || '默认模式';
  const currentEffort = task.reasoning_effort || '';

  const inputDisabled = !canInteract || sending;
  const hasReadyAttachment = attachments.some((item) => item.status === 'done' && item.uploaded);
  const attachmentUploading = attachments.some((item) => item.status === 'uploading');
  const canSubmit = canInteract && !sending && !attachmentUploading && (!!message.trim() || hasReadyAttachment);
  const ctxSize = contextUsage?.size ?? 0;
  const ctxUsed = contextUsage?.used ?? 0;

  return (
    <View style={{ flex: 1 }}>
      {/* 流/发送错误横幅：可关闭，不与消息流抢滚动位置（对齐 Web 的 streamError banner）。 */}
      {error ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: spacing.pad, marginBottom: 6, borderWidth: 1, borderColor: t.red, backgroundColor: t.redGhost, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 8 }}>
          <Icons.alert size={14} color={t.red} sw={2.1} />
          <Text style={{ flex: 1, color: t.red, fontSize: 11.5, lineHeight: 16 }}>{error}</Text>
          <Pressable onPress={() => setError('')} hitSlop={6} style={{ marginTop: 1 }}>
            <Icons.x size={13} color={t.red} sw={2.1} />
          </Pressable>
        </View>
      ) : null}
      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingHorizontal: spacing.pad, paddingTop: 12, paddingBottom: 12, gap: 9 }}>
        {nextBefore ? (
          <Pressable onPress={() => void loadOlder()} disabled={loadingOlder} style={{ alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12, backgroundColor: t.bg3, opacity: loadingOlder ? 0.6 : 1 }}>
            <Text style={{ color: t.acTx, fontSize: 12, fontWeight: '700' }}>{loadingOlder ? '加载中…' : '加载更早记录'}</Text>
          </Pressable>
        ) : null}
        {/* 首条任务指令不是特殊块：创建时后端已把它作为第一条 user_input 推进会话，
            历史回放天然带出，这里直接以用户气泡渲染（与 Web 一致），不再额外钉一张卡。 */}
        {events.length === 0 && historyDone ? (
          runtime.blocked ? (
            <BlockedCard title={runtime.blocked.title} reason={runtime.blocked.reason} t={t} />
          ) : (
            <Text style={{ color: t.tx3, fontSize: 12, textAlign: 'center', paddingTop: 16 }}>{canInteract ? '等待首条消息' : '该任务还没有对话'}</Text>
          )
        ) : null}
        {visibleEvents.map((event, index) => {
          const message = displayMessage(event);
          // 遥测/生命周期行解码不出消息卡：跳过而不是渲染原始 JSON。
          if (!message) return null;
          const retryForError = message.kind === 'error' ? () => void retryEvent(event, index) : undefined;
          return (
            <StreamBlock
              key={event.id}
              message={message}
              onCopy={copyAll}
              onRetry={retryForError}
              retryBusy={retryingId === eventLogicalId(event)}
            />
          );
        })}
        {/* 执行计划条：todo_list 推进的条目，可展开看每步状态（对齐 Web PlanStepsBlock）。 */}
        {plan.length ? <PlanStrip entries={plan} running={turnLive && canInteract} t={t} /> : null}
        {/* 发送后的等待指示：轮次开始（agent_turn_started / item 推进）亮起，
            轮次结束（result / agent_turn_completed / error）熄灭；任务进入终态
            （canStream=false）时即使历史投递状态停在 running 也不再亮。 */}
        {turnLive && canInteract ? (
          <View accessibilityLabel="Agent 正在处理" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 6 }}>
            <Spinner size={15} color={t.acTx} sw={2.2} />
            <Text style={{ color: t.tx3, fontSize: 12 }}>Agent 正在处理…</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* 输入器：模型 / 模式 / 思考等级 / token / 上下文 一线到位 */}
      <View style={{ paddingTop: 6, paddingHorizontal: spacing.pad, paddingBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          {availableSkills.length ? (
            <Pressable onPress={() => setSkillPickerOpen(true)} disabled={inputDisabled} style={pillStyle(t, inputDisabled)}>
              <Icons.brain size={11} color={t.acTx} sw={2.2} />
              <Text style={pillTextStyle(t, t.acTx)}>技能</Text>
            </Pressable>
          ) : null}
          {QUICK_PROMPTS.map((p) => (
            <Pressable key={p.label} onPress={() => sendQuick(p.text)} disabled={inputDisabled} style={({ pressed }) => [pillStyle(t, inputDisabled), pressed && { opacity: 0.7 }]}>
              <Text style={pillTextStyle(t, t.acTx)}>{p.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* 第二行：模式 / 思考 / 模型 / token / 上下文 / 重启 —— 输入器内联控件 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingTop: 7, gap: 7, alignItems: 'center' }}>
          <Pressable onPress={() => setModePickerOpen(true)} disabled={!canInteract} style={({ pressed }) => [pillStyle(t, !canInteract), pressed && { opacity: 0.7 }]}>
            <Icons.lock size={11} color={t.tx2} sw={2.2} />
            <Text style={pillTextStyle(t, t.tx2)} numberOfLines={1}>{currentMode}</Text>
          </Pressable>
          <Pressable onPress={() => setEffortPickerOpen(true)} disabled={!canInteract} style={({ pressed }) => [pillStyle(t, !canInteract), pressed && { opacity: 0.7 }]}>
            <Icons.brain size={11} color={t.tx2} sw={2.2} />
            <Text style={pillTextStyle(t, t.tx2)} numberOfLines={1}>{EFFORT_OPTIONS.find((o) => o.value === currentEffort)?.label || '思考默认'}</Text>
          </Pressable>
          <Pressable onPress={() => setModelPickerOpen(true)} disabled={!canInteract} style={({ pressed }) => [pillStyle(t, !canInteract), pressed && { opacity: 0.7 }]}>
            <Icons.cube size={11} color={t.tx2} sw={2.2} />
            <Text style={pillTextStyle(t, t.tx2)} numberOfLines={1}>{currentModel}</Text>
          </Pressable>
          {statsTotalTokens > 0 ? <Text style={{ color: t.tx3, fontSize: 11, paddingHorizontal: 2 }} numberOfLines={1}>{formatTokens(statsTotalTokens)} tokens</Text> : null}
          {(ctxSize > 0 || modelMaxTokens) ? <ContextChip used={ctxUsed} size={ctxSize || modelMaxTokens || 0} t={t} /> : null}
        </ScrollView>

        {attachments.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingTop: 7, gap: 7 }}>
            {attachments.map((item) => (
              <View key={item.key} style={{ minHeight: 28, maxWidth: 180, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, borderRadius: 10, backgroundColor: item.status === 'error' ? t.redGhost : t.bg3 }}>
                <Text numberOfLines={1} style={{ flexShrink: 1, color: item.status === 'error' ? t.red : t.tx2, fontSize: 11.5 }}>{item.status === 'uploading' ? '上传中 · ' : item.status === 'error' ? '失败 · ' : '已就绪 · '}{item.filename}</Text>
                <Pressable onPress={() => setAttachments((current) => current.filter((candidate) => candidate.key !== item.key))}><Icons.x size={13} color={t.tx3} sw={2} /></Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: spacing.pad, paddingBottom: 10, paddingTop: 4 }}>
        <Pressable onPress={() => void addAttachments()} disabled={inputDisabled || attachments.length >= MAX_ATTACHMENTS} style={{ width: 40, minHeight: 44, borderRadius: 13, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center', opacity: (attachments.length >= MAX_ATTACHMENTS) ? 0.4 : inputDisabled ? 0.4 : 1 }}><Icons.plus size={18} color={t.acTx} sw={2.2} /></Pressable>
        <TextInput
          value={message}
          onChangeText={onMessageChange}
          editable={canInteract && !sending}
          placeholder={inputPlaceholder}
          placeholderTextColor={t.tx3}
          multiline
          style={{ flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: t.bg3, color: t.tx, fontSize: 14 }}
        />
        {speech.available ? <MicButton status={speech.status} active={speech.active} onPress={speech.toggle} disabled={inputDisabled} /> : null}
        {/* 按钮位按状态切换（对齐 Web composer）：本轮在跑且没有待发内容 →
            「中止本轮」（只打断当前轮次，不是删除/终结任务）；输入了内容或
            附件就绪 → 保持「发送」（追加消息由后端按幂等键 + runtime 排队）；
            非在跑恒为发送。终态任务（turnLive=false）不会出现中止。 */}
        {turnLive && canInteract && !message.trim() && !hasReadyAttachment ? (
          <Pressable accessibilityLabel="中止本轮" onPress={() => void cancelTurn()} style={({ pressed }) => [{ width: 48, minHeight: 44, borderRadius: 13, backgroundColor: t.amber, alignItems: 'center', justifyContent: 'center' }, pressed && { transform: [{ scale: 0.96 }] }]}>
            <Icons.stop size={18} color="#fff" sw={2.2} />
          </Pressable>
        ) : (
          <Pressable disabled={!canSubmit} onPress={() => void submit()} style={({ pressed }) => [{ width: 48, minHeight: 44, borderRadius: 13, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }, !canSubmit && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.96 }] }]}>
            {sending ? <Icons.refresh size={18} color={t.acInk} sw={2.3} /> : <Icons.arrowRight size={18} color={t.acInk} sw={2.3} />}
          </Pressable>
        )}
      </View>

      <SkillSheet visible={skillPickerOpen} commands={availableSkills} onPick={pickSkill} onClose={() => setSkillPickerOpen(false)} />
      <PickerSheet
        visible={modelPickerOpen}
        title="切换模型（下一轮生效）"
        options={models.map((m) => ({ value: m.id, label: m.name || m.remark || m.id }))}
        selected={currentModel}
        t={t}
        onPick={(id) => { setModelPickerOpen(false); void onSwitchModel(id); }}
        onClose={() => setModelPickerOpen(false)}
      />
      <PickerSheet
        visible={modePickerOpen}
        title="权限 / 审批方式（下一轮生效）"
        options={modeOpts}
        selected={task.mode || ''}
        t={t}
        onPick={(v) => { setModePickerOpen(false); void onSwitchMode(v); }}
        onClose={() => setModePickerOpen(false)}
      />
      <PickerSheet
        visible={effortPickerOpen}
        title="思考等级（下一轮生效）"
        options={EFFORT_OPTIONS}
        selected={currentEffort}
        t={t}
        onPick={(v) => { setEffortPickerOpen(false); void onSwitchReasoningEffort(v as '' | 'low' | 'medium' | 'high' | 'xhigh'); }}
        onClose={() => setEffortPickerOpen(false)}
      />
    </View>
  );
}

function formatTokens(n?: number): string {
  if (!n) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function pillStyle(t: Theme, disabled: boolean): ViewStyle {
  return { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: t.bg3, opacity: disabled ? 0.4 : 1 };
}
function pillTextStyle(_t: Theme, color: string): TextStyle {
  return { color, fontSize: 11.5, fontWeight: '600', maxWidth: 120 };
}

function ContextChip({ used, size, t }: { used: number; size: number; t: Theme }) {
  const ratio = size > 0 ? used / size : 0;
  const color = ratio > 0.85 ? t.red : ratio > 0.7 ? t.amber : t.tx3;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Ring value={Math.min(1, ratio)} size={14} sw={2.6} color={color} />
      <Text style={{ color, fontSize: 11 }} numberOfLines={1}>{Math.round(ratio * 100)}%</Text>
    </View>
  );
}

/** 执行计划条：todo_list 推进的条目，收起时只占一行，展开看每步状态（对齐 Web PlanStepsBlock）。 */
function PlanStrip({ entries, running, t }: { entries: { content: string; status: string }[]; running: boolean; t: Theme }) {
  const [open, setOpen] = useState(false);
  const done = entries.filter((entry) => entry.status === 'completed' || entry.status === 'done').length;
  return (
    <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 13, backgroundColor: t.bg2, overflow: 'hidden' }}>
      <Pressable onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 }}>
        <Icons.tasks size={14} color={t.acTx} sw={2} />
        <Text style={{ flex: 1, color: t.tx, fontSize: 12.5, fontWeight: '700' }}>执行计划</Text>
        <Text style={{ color: t.tx3, fontSize: 11 }}>{done}/{entries.length}</Text>
        {running ? <Spinner size={12} color={t.acTx} sw={2} /> : null}
        <Icons.chevron size={12} color={t.tx3} sw={2} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
      </Pressable>
      {open ? entries.map((entry, index) => {
        const completed = entry.status === 'completed' || entry.status === 'done';
        const inProgress = entry.status === 'in_progress' || entry.status === 'running';
        return (
          <View key={`${index}-${entry.content}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
            {completed ? (
              <Icons.check size={13} color={t.add} sw={2.3} />
            ) : inProgress ? (
              <Spinner size={12} color={t.acTx} sw={2} />
            ) : (
              <View style={{ width: 13, height: 13, borderRadius: 7, borderWidth: 1.6, borderColor: t.tx3, marginTop: 1 }} />
            )}
            <Text style={{ flex: 1, color: completed ? t.tx3 : t.tx2, fontSize: 12, lineHeight: 17 }}>{entry.content}</Text>
          </View>
        );
      }) : null}
    </View>
  );
}

/** 空对话解释卡：对齐 Web task-workspace-chat 的 blocked 空态——说清现在是什么状态、
 *  为什么、接下来怎么办；移动端的恢复统一走发送消息，不放独立重试按钮。 */
function BlockedCard({ title, reason, t }: { title: string; reason: string; t: Theme }) {
  return (
    <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 13, backgroundColor: t.bg2, padding: 13, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icons.info size={14} color={t.tx2} sw={2} />
        <Text style={{ flex: 1, color: t.tx, fontSize: 13, fontWeight: '700' }}>{title}</Text>
      </View>
      {reason ? <Text style={{ color: t.tx2, fontSize: 12, lineHeight: 18 }}>{reason}</Text> : null}
    </View>
  );
}

/** 底部弹出单选 sheet（模型 / 模式 / 思考等级共用）。 */
function PickerSheet({ visible, title, options, selected, t, onPick, onClose }: {
  visible: boolean;
  title: string;
  options: { value: string; label: string }[];
  selected: string;
  t: Theme;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  useEffect(() => { if (visible) setQ(''); }, [visible]);
  const rows = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()) || o.value.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '78%', backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 20, ...t.shLift }}>
        <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: t.line2, alignSelf: 'center', marginTop: 10 }} />
        <Text style={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8, fontSize: 15, fontWeight: '700', color: t.tx }}>{title}</Text>
        <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, height: 38, borderRadius: 12, backgroundColor: t.bg3 }}>
            <Icons.search size={15} color={t.tx3} sw={2} />
            <TextInput value={q} onChangeText={setQ} placeholder="搜索" placeholderTextColor={t.tx3} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, color: t.tx, fontSize: 13 }} />
          </View>
        </View>
        <FlatList
          keyboardShouldPersistTaps="handled"
          data={rows}
          keyExtractor={(o) => o.value || '__default__'}
          style={{ maxHeight: 360 }}
          contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 8 }}
          ListEmptyComponent={<Text style={{ color: t.tx3, padding: 20, textAlign: 'center' }}>没有匹配项</Text>}
          renderItem={({ item }) => {
            const on = item.value === selected;
            return (
              <Pressable onPress={() => onPick(item.value)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12, backgroundColor: on ? t.acGhost : 'transparent' }, pressed && { backgroundColor: t.bg3 }]}>
                <Text style={{ flex: 1, color: on ? t.acTx : t.tx, fontSize: 13.5, fontWeight: on ? '700' : '500' }}>{item.label}</Text>
                {on ? <Icons.check size={16} color={t.acTx} sw={2.4} /> : null}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}
