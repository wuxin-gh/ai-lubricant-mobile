/**
 * Canonical Task 移动工作区。
 *
 * 交互对齐 Web task-detail / task-workspace-chat，而不是把桌面端弹窗机械压进手机：
 * - 顶部紧凑状态与工作区导航；对话是默认主面。
 * - 模型 / 权限模式 / 思考等级 / token / 上下文都在对话输入器里直接可见可切。
 * - 终端 / 文件 / 日志是次级工作区。
 * - 任务信息、Key 与危险操作收进“更多”，不再用绝对定位底栏盖住输入框。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/api/client';
import {
  cancelUserTask,
  deleteUserTask,
  disableUserTaskKey,
  getUserTask,
  getUserTaskStats,
  rotateUserTaskKey,
  stopUserTask,
  switchUserTaskModel,
  updateUserTask,
  type UserTaskDetail,
  type UserTaskStats,
} from '@/api/task';
import { listChatModels, type AvailableModel } from '@/api/agent';
import { useBackgroundPolling } from '@/hooks/useBackgroundPolling';
import { Card, EmptyView, GlassNav, LoadingView, Scrim, Toast } from '@/components/ui';
import { DetailRow } from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { TaskConversationPanel } from '@/features/task/TaskConversationPanel';
import { TaskFilesPanel } from '@/features/task/TaskFilesPanel';
import { TaskResourcePanel } from '@/features/task/TaskResourcePanel';
import { describeTaskRuntimeState } from '@/features/task/taskRuntimeState';
import { formatDateTime, taskDisplayName } from '@/utils/format';
import { spacing, useTheme, type Theme } from '@/theme';

const POLL_INTERVAL = 5000;

type Tab = 'conversation' | 'files';

const STATUS_LABELS: Record<string, string> = {
  pending: '等待中',
  processing: '运行中',
  error: '异常',
  finished: '已完成',
  stopped: '已停止',
};

function taskStateLabel(task: UserTaskDetail): string {
  if (task.workspace_state === 'dispatch_failed') return '派发失败';
  const stage = task.runtime_stage;
  if (stage?.ok === false) return `未启动 · ${stage.label || '准备失败'}`;
  if (stage?.preparing) {
    const step = stage.index && stage.total ? `${stage.index}/${stage.total}` : '';
    return `准备环境${step ? ` · ${step}` : ''} · ${stage.label || ''}`.replace(/ · $/, '');
  }
  if (task.status === 'pending') return task.node_session_id ? '就绪 · 等待输入' : '等待派发';
  if (task.status === 'stopped') return '已停止';
  return STATUS_LABELS[task.status] || task.status || '未知';
}

function formatTokens(n?: number): string {
  if (!n) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function formatTaskDate(value?: string | number | null): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'number') return formatDateTime(value);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export default function TaskWorkspaceScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [task, setTask] = useState<UserTaskDetail | null>(null);
  const [stats, setStats] = useState<UserTaskStats>({ input_tokens: 0, output_tokens: 0, total_tokens: 0, llm_requests: 0 });
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<null | 'start' | 'stop' | 'delete' | 'restart' | 'key' | 'model' | 'mode' | 'effort'>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('conversation');
  const [moreOpen, setMoreOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const busyRef = useRef(false);

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1900);
  }, []);

  const loadDetail = useCallback(async () => {
    if (!id) return null;
    const detail = await getUserTask(id);
    setTask(detail);
    return detail;
  }, [id]);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const detail = await getUserTask(id);
      // Web 以父 Key 的可用范围拉模型；任务子 Key 是运行时凭据，不适合做选择器授权入口。
      const modelKeyId = detail.parent_api_key_id || detail.api_key_id;
      const [nextStats, modelRows] = await Promise.all([
        getUserTaskStats(id).catch(() => ({ input_tokens: 0, output_tokens: 0, total_tokens: 0, llm_requests: 0 }) as UserTaskStats),
        modelKeyId ? listChatModels(Number(modelKeyId)).catch(() => [] as AvailableModel[]) : Promise.resolve([] as AvailableModel[]),
      ]);
      setTask(detail);
      setStats(nextStats);
      setModels(modelRows);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const isRunning = task?.status === 'pending' || task?.status === 'processing';
  useBackgroundPolling(refresh, POLL_INTERVAL, !!id && isRunning && !task?.runtime_stage?.preparing);

  // 准备期拿不到对话 SSE，2 秒轮询准备步骤；就绪/失败即停。
  useEffect(() => {
    if (!task?.runtime_stage?.preparing) return;
    const timer = setInterval(() => { void loadDetail().catch(() => undefined); }, 2000);
    return () => clearInterval(timer);
  }, [loadDetail, task?.runtime_stage?.preparing]);

  const runAction = useCallback(async (label: typeof busy, fn: () => Promise<unknown>, success: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    try {
      await fn();
      flashToast(success);
      await refresh();
    } catch (e) {
      Alert.alert('操作失败', e instanceof ApiError ? e.message : '请稍后重试');
    } finally {
      setBusy(null);
      busyRef.current = false;
    }
  }, [flashToast, refresh]);

  const onStop = useCallback(() => {
    if (!task || busyRef.current) return;
    Alert.alert('停止任务运行时', '任务详情、历史和工作区会保留，之后发送消息即可恢复。', [
      { text: '取消', style: 'cancel' },
      { text: '停止', style: 'destructive', onPress: () => void runAction('stop', () => stopUserTask(task.id), '任务运行时已停止') },
    ]);
  }, [runAction, task]);

  const onDelete = useCallback(() => {
    if (!task || busyRef.current) return;
    Alert.alert('删除任务', `删除「${taskDisplayName(task)}」？将终止运行时并永久删除任务数据，此操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        setBusy('delete');
        try { await deleteUserTask(task.id); router.back(); }
        catch (e) { Alert.alert('删除失败', e instanceof ApiError ? e.message : '请稍后重试'); setBusy(null); }
      } },
    ]);
  }, [router, task]);

  const onRotate = useCallback(async () => {
    if (!task) return;
    await runAction('key', () => rotateUserTaskKey(task.id), 'Task Key 已轮换并下发运行时');
  }, [runAction, task]);

  const onDisable = useCallback(() => {
    if (!task) return;
    Alert.alert('停用 Task Key', '停用后任务运行时将无法继续鉴权，确定继续？', [
      { text: '取消', style: 'cancel' },
      { text: '停用', style: 'destructive', onPress: () => void runAction('key', () => disableUserTaskKey(task.id), 'Task Key 已停用') },
    ]);
  }, [runAction, task]);

  const switchModel = useCallback(async (modelId: string) => {
    // 活跃模型 = models_snapshot 头部（与展示和后端下发同源）；task.model_id 是
    // ProjectTask 绑定 UUID，不代表当前模型，用它去重会拦截所有合法切换。
    if (!task || !modelId || modelId === (task.models?.[0] || '')) return;
    await runAction('model', () => switchUserTaskModel(task.id, modelId), '模型已切换，下一轮消息生效');
  }, [runAction, task]);

  const switchMode = useCallback(async (mode: string) => {
    if (!task || mode === (task.mode || '')) return;
    await runAction('mode', () => updateUserTask(task.id, { mode }), '模式已切换，下一轮消息生效');
  }, [runAction, task]);

  const switchEffort = useCallback(async (effort: '' | 'low' | 'medium' | 'high' | 'xhigh') => {
    if (!task || effort === (task.reasoning_effort || '')) return;
    await runAction('effort', () => updateUserTask(task.id, { reasoning_effort: effort }), '思考等级已切换，下一轮消息生效');
  }, [runAction, task]);

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载任务工作区…" /><GlassNav title="任务工作区" onBack={() => router.back()} /></View>;
  }
  if (error && !task) {
    return <View style={{ flex: 1, backgroundColor: t.bg }}><EmptyView title="加载失败" subtitle={error} icon="alert" /><GlassNav title="任务工作区" onBack={() => router.back()} /></View>;
  }
  if (!task) return null;

  const runtimeState = describeTaskRuntimeState(task);
  const { hasRuntime, runtimeActive } = runtimeState;
  const dispatchFailed = task.workspace_state === 'dispatch_failed';
  // 活跃模型 = models_snapshot 头部；model_id 是 ProjectTask 绑定 UUID，非模型名。
  const currentModel = task.models?.[0] || '';
  const currentModelMeta = models.find((m) => m.id === currentModel);
  // 徽标配色（对齐 Web）：运行中=主色，异常/派发失败=红，准备中=琥珀，
  // 已完成/已停止=次要灰（区别于「等待中」的中性色），等待中=中性。
  const statusTone = dispatchFailed || task.runtime_stage?.ok === false || task.status === 'error'
    ? t.red
    : task.status === 'processing'
      ? t.add
      : task.runtime_stage?.preparing
        ? t.amber
        : task.status === 'finished' || task.status === 'stopped'
          ? t.tx3
          : t.tx2;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* 紧凑状态头：标题与运行态，信息不再散落在概要 tab。 */}
      <View style={{ paddingTop: insets.top + 50, paddingHorizontal: spacing.pad, paddingBottom: 8, backgroundColor: t.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: t.tx, fontSize: 17, fontWeight: '800' }}>{taskDisplayName(task)}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7, marginTop: 5 }}>
              <Text style={{ color: t.tx3, fontSize: 11.5 }}>{task.provider}</Text>
              <View style={{ width: 4, height: 4, borderRadius: 99, backgroundColor: statusTone }} />
              <Text style={{ color: statusTone, fontSize: 11.5, fontWeight: '700' }}>{taskStateLabel(task)}</Text>
              {task.node_id ? <Text numberOfLines={1} style={{ maxWidth: 150, color: t.tx3, fontSize: 10.5, fontFamily: 'monospace' }}>{task.node_id}</Text> : null}
            </View>
          </View>
          <Pressable onPress={() => setMoreOpen(true)} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center' }}>
            <Icons.more size={18} color={t.tx2} sw={2.2} />
          </Pressable>
        </View>
        {task.runtime_stage?.preparing ? (
          <View style={{ marginTop: 8, height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: t.bg4 }}>
            <View style={{ height: 4, backgroundColor: task.runtime_stage.ok === false ? t.red : t.ac, width: `${Math.max(6, ((task.runtime_stage.index ?? 1) / Math.max(1, task.runtime_stage.total ?? 1)) * 100)}%` }} />
          </View>
        ) : null}
      </View>

      {/* 文件从“更多”进入；文件详情页只保留返回对话，不占主页面导航。 */}
      {tab === 'files' ? (
        <View style={{ paddingHorizontal: spacing.pad, paddingBottom: 8 }}>
          <Pressable onPress={() => setTab('conversation')} style={({ pressed }) => [{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, height: 32, borderRadius: 16, backgroundColor: t.bg3 }, pressed && { opacity: 0.7 }]}>
            <Icons.chevron size={13} color={t.tx2} sw={2.2} style={{ transform: [{ rotate: '180deg' }] }} />
            <Text style={{ color: t.tx2, fontSize: 12.5, fontWeight: '700' }}>返回对话</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={{ flex: 1, minHeight: 0 }}>
        {tab === 'conversation' ? (
          <TaskConversationPanel
            task={task}
            statsTotalTokens={stats.total_tokens}
            models={models}
            modelMaxTokens={Number(currentModelMeta?.max_context_tokens) || undefined}
            onResult={() => { void refresh(); }}
            onSwitchModel={switchModel}
            onSwitchMode={switchMode}
            onSwitchReasoningEffort={switchEffort}
          />
        ) : null}
        {tab === 'files' ? <TaskFilesPanel taskId={task.id} /> : null}
      </View>

      <GlassNav title="任务工作区" onBack={() => router.back()} />
      {toast ? <Toast text={toast} bottom={insets.bottom + 16} /> : null}

      {/* 更多：信息 / 配置 / Key / 运行时 / 危险操作，不遮挡主输入器。 */}
      <Modal visible={moreOpen} transparent animationType="slide" onRequestClose={() => setMoreOpen(false)} statusBarTranslucent>
        <Scrim onPress={() => setMoreOpen(false)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '84%', backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 14, ...t.shLift }}>
          <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: t.line2, alignSelf: 'center', marginTop: 10 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8 }}>
            <Text style={{ flex: 1, color: t.tx, fontSize: 16, fontWeight: '800' }}>任务操作</Text>
            <Pressable onPress={() => setMoreOpen(false)} hitSlop={8}><Icons.x size={18} color={t.tx2} sw={2.1} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 8, gap: 9 }}>
            <ActionRow icon="folder" label="工作区文件" sub={hasRuntime ? '查看任务工作目录与改动' : '运行时未就绪'} t={t} disabled={!hasRuntime} onPress={() => { setMoreOpen(false); setTab('files'); }} />
            <ActionRow icon="info" label="任务信息" sub={`${formatTokens(stats.total_tokens)} tokens · ${stats.llm_requests ?? 0} 次模型请求`} t={t} onPress={() => { setMoreOpen(false); setInfoOpen(true); }} />
            <Text style={{ color: t.tx3, fontSize: 11.5, fontWeight: '700', paddingHorizontal: 6, paddingTop: 4 }}>运行期资源配置</Text>
            <View style={{ paddingHorizontal: 4, paddingTop: 2 }}>
              <TaskResourcePanel task={task} onChanged={() => void refresh()} />
            </View>
            {/* 没有独立「重启/开始运行」入口：删除是唯一不可恢复边界，没有运行时
                时直接发送消息会自动恢复。 */}
            {runtimeActive ? <ActionRow icon="stop" label="停止任务运行时" sub="终止运行进程；任务详情、历史与工作区保留，发送消息即可恢复" t={t} tone="warn" disabled={!!busy} onPress={() => { setMoreOpen(false); onStop(); }} /> : null}
            {task.status === 'processing' ? <ActionRow icon="stop" label="取消当前轮次" sub="任务保持运行，可继续发消息" t={t} tone="warn" disabled={!!busy} onPress={() => void runAction('stop', () => cancelUserTask(task.id), '已请求取消当前轮次')} /> : null}
            <ActionRow icon="key" label="轮换 Task Key" sub={task.api_key?.key_masked || '未签发'} t={t} disabled={!!busy || task.api_key?.disabled} onPress={() => void onRotate()} />
            <ActionRow icon="lock" label="停用 Task Key" sub={task.api_key?.disabled ? '已停用' : '停用后运行时无法继续鉴权'} t={t} tone="danger" disabled={!!busy || task.api_key?.disabled} onPress={onDisable} />
            <ActionRow icon="trash" label="删除任务" sub="将终止运行时并永久删除任务数据" t={t} tone="danger" disabled={!!busy} onPress={() => { setMoreOpen(false); onDelete(); }} />
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={infoOpen} transparent animationType="slide" onRequestClose={() => setInfoOpen(false)} statusBarTranslucent>
        <Scrim onPress={() => setInfoOpen(false)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '82%', backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 14, ...t.shLift }}>
          <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: t.line2, alignSelf: 'center', marginTop: 10 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8 }}>
            <Text style={{ flex: 1, color: t.tx, fontSize: 16, fontWeight: '800' }}>任务信息</Text>
            <Pressable onPress={() => setInfoOpen(false)} hitSlop={8}><Icons.x size={18} color={t.tx2} sw={2.1} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 20, gap: 10 }}>
            <Card style={{ paddingHorizontal: 14, paddingVertical: 7 }}>
              <DetailRow label="状态" value={taskStateLabel(task)} color={statusTone} />
              <DetailRow label="工具" value={task.provider} />
              <DetailRow label="模型" value={currentModel || '默认'} mono />
              <DetailRow label="模式" value={task.mode_label || task.mode || '默认'} />
              <DetailRow label="思考等级" value={task.reasoning_effort || '默认'} />
              <DetailRow label="节点" value={task.node_id || '未绑定'} mono />
              <DetailRow label="运行时" value={task.node_session_id || '未启动'} mono />
              {task.env_mode ? <DetailRow label="环境" value={[task.env_mode, task.env_name || task.env_id].filter(Boolean).join(' · ')} /> : null}
              {task.repo_url ? <DetailRow label="仓库" value={task.repo_url} mono multiline /> : null}
              {task.branch ? <DetailRow label="分支" value={task.branch} mono /> : null}
              <DetailRow label="创建时间" value={formatTaskDate(task.created_at)} />
              <DetailRow label="最后活跃" value={formatTaskDate(task.last_active_at)} />
              {task.completed_at ? <DetailRow label="完成时间" value={formatTaskDate(task.completed_at)} /> : null}
            </Card>
            <Card style={{ padding: 14 }}>
              <Text style={{ color: t.tx3, fontSize: 12, fontWeight: '700', marginBottom: 8 }}>用量</Text>
              <Text style={{ color: t.tx, fontSize: 14 }}>{formatTokens(stats.total_tokens)} total · {formatTokens(stats.input_tokens)} input · {formatTokens(stats.output_tokens)} output · {stats.llm_requests ?? 0} requests</Text>
            </Card>
            {task.dispatch_error ? <View style={{ padding: 12, borderRadius: 13, backgroundColor: t.redGhost }}><Text style={{ color: t.red, fontSize: 12.5, lineHeight: 19 }}>派发失败：{task.dispatch_error}</Text></View> : null}
            {task.runtime_stage?.detail ? <View style={{ padding: 12, borderRadius: 13, backgroundColor: task.runtime_stage.ok === false ? t.redGhost : t.bg3 }}><Text style={{ color: task.runtime_stage.ok === false ? t.red : t.tx2, fontSize: 12.5, lineHeight: 19 }}>{task.runtime_stage.label || task.runtime_stage.stage}：{task.runtime_stage.detail}</Text></View> : null}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function ActionRow({ icon, label, sub, t, onPress, disabled, tone }: { icon: string; label: string; sub?: string; t: Theme; onPress: () => void; disabled?: boolean; tone?: 'danger' | 'warn' }) {
  const I = Icons[icon] ?? Icons.dot;
  const color = tone === 'danger' ? t.red : tone === 'warn' ? t.amber : t.tx2;
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 14, backgroundColor: t.bg3, opacity: disabled ? 0.4 : 1 }, pressed && { opacity: 0.7 }]}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.bg4, alignItems: 'center', justifyContent: 'center' }}><I size={17} color={color} sw={1.9} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: tone === 'danger' ? t.red : t.tx, fontSize: 13.5, fontWeight: '700' }}>{label}</Text>
        {sub ? <Text numberOfLines={2} style={{ color: t.tx3, fontSize: 11, lineHeight: 16, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      <Icons.chevron size={14} color={t.tx3} sw={2} />
    </Pressable>
  );
}
