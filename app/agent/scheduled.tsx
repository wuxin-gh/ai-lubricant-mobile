/**
 * Agent 定时任务：Prompt / Script CRUD、启停、立即运行、脚本授权。
 * 对齐 Web ScheduledTasksDialog，移动端用独立页面承载。
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  approveScheduledTaskScript,
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTask,
  listAgents,
  listScheduledTasks,
  runScheduledTaskNow,
  toggleScheduledTask,
  updateScheduledTask,
  type AgentDef,
  type ScheduledTaskDetail,
  type ScheduledTaskKind,
  type ScheduledTaskListItem,
  type ScheduledTaskOnError,
  type ScheduledTaskScriptType,
} from '@/api/agent';
import { ApiError } from '@/api/client';
import { AdminSheet, LabeledInput, SearchableSelect, Segmented, SwitchRow } from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { EmptyView, GlassNav, LoadingView } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

const KINDS: readonly { value: ScheduledTaskKind; label: string }[] = [{ value: 'prompt', label: 'Prompt' }, { value: 'script', label: 'Script' }];
const SCRIPT_TYPES: readonly { value: ScheduledTaskScriptType; label: string }[] = [{ value: 'python', label: 'Python' }, { value: 'powershell', label: 'PowerShell' }];
const ON_ERROR: readonly { value: ScheduledTaskOnError; label: string }[] = [
  { value: 'none', label: '不处理' },
  { value: 'diagnose', label: 'AI 诊断' },
  { value: 'diagnose_fix_retry', label: '诊断/修复/重试' },
];

export default function AgentScheduledTasksScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [rows, setRows] = useState<ScheduledTaskListItem[]>([]);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<ScheduledTaskDetail | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [agentPicker, setAgentPicker] = useState(false);

  const [name, setName] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [kind, setKind] = useState<ScheduledTaskKind>('prompt');
  const [agentId, setAgentId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [script, setScript] = useState('');
  const [scriptType, setScriptType] = useState<ScheduledTaskScriptType>('python');
  const [scriptTimeout, setScriptTimeout] = useState('300');
  const [onError, setOnError] = useState<ScheduledTaskOnError>('none');
  const [allowFix, setAllowFix] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [background, setBackground] = useState('');

  const load = useCallback(async () => {
    try {
      const [tasks, defs] = await Promise.all([listScheduledTasks(), listAgents().catch(() => [] as AgentDef[])]);
      setRows(tasks);
      setAgents(defs.filter((a) => a.enabled !== false));
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载定时任务失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setEdit(null); setName(''); setCron('0 9 * * *'); setKind('prompt'); setAgentId(agents[0] ? String(agents[0].id) : ''); setPrompt(''); setScript(''); setScriptType('python'); setScriptTimeout('300'); setOnError('none'); setAllowFix(false); setEnabled(true); setBackground('');
  };

  const openEdit = async (row: ScheduledTaskListItem) => {
    setBusy(true);
    try {
      const detail = await getScheduledTask(row.id);
      setEdit(detail);
      setName(detail.name || ''); setCron(detail.cron_expression || ''); setKind(detail.task_kind || 'prompt'); setAgentId(detail.agent_id ? String(detail.agent_id) : ''); setPrompt(detail.task_prompt || ''); setScript(detail.script_code || ''); setScriptType(detail.script_type || 'python'); setScriptTimeout(String(detail.script_timeout || 300)); setOnError(detail.on_error || 'none'); setAllowFix(!!detail.allow_ai_script_fix); setEnabled(detail.enabled !== false); setBackground(detail.background || '');
    } catch (e) { Alert.alert('加载失败', e instanceof ApiError ? e.message : '请稍后重试'); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (busy) return;
    if (!name.trim() || !cron.trim()) { Alert.alert('请填写名称和 Cron 表达式'); return; }
    if (kind === 'prompt' && !prompt.trim()) { Alert.alert('请填写任务 Prompt'); return; }
    if (kind === 'script' && !script.trim()) { Alert.alert('请填写脚本'); return; }
    setBusy(true);
    try {
      const payload = {
        name: name.trim(), cron_expression: cron.trim(), enabled,
        task_kind: kind, agent_id: agentId ? Number(agentId) : null,
        task_prompt: kind === 'prompt' ? prompt.trim() : undefined,
        script_code: kind === 'script' ? script : undefined,
        script_type: kind === 'script' ? scriptType : undefined,
        script_timeout: kind === 'script' ? Math.max(10, Number(scriptTimeout) || 300) : undefined,
        background: background.trim() || undefined,
        on_error: kind === 'script' ? onError : undefined,
        allow_ai_script_fix: kind === 'script' ? allowFix : undefined,
      };
      if (edit) await updateScheduledTask(edit.id, payload);
      else {
        const created = await createScheduledTask(payload);
        if (created.needs_approval) Alert.alert('创建成功', '脚本任务需授权后才会执行，请在列表中点“授权脚本”。');
      }
      setEdit(undefined);
      await load();
    } catch (e) { Alert.alert('保存失败', e instanceof ApiError ? e.message : '请稍后重试'); }
    finally { setBusy(false); }
  };

  const run = async (row: ScheduledTaskListItem, action: 'run' | 'toggle' | 'approve') => {
    setBusy(true);
    try {
      if (action === 'run') await runScheduledTaskNow(row.id);
      else if (action === 'toggle') await toggleScheduledTask(row.id);
      else await approveScheduledTaskScript(row.id);
      await load();
      Alert.alert(action === 'run' ? '已触发' : action === 'approve' ? '脚本已授权' : '状态已更新');
    } catch (e) { Alert.alert('操作失败', e instanceof ApiError ? e.message : '请稍后重试'); }
    finally { setBusy(false); }
  };

  const remove = (row: ScheduledTaskListItem) => {
    Alert.alert('删除定时任务', `确定删除「${row.name}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try { await deleteScheduledTask(row.id); await load(); }
        catch (e) { Alert.alert('删除失败', e instanceof ApiError ? e.message : '请稍后重试'); }
      } },
    ]);
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载定时任务…" /><GlassNav title="定时任务" onBack={() => router.back()} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 66, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 40, gap: 10 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={t.ac} />}>
        {error && !rows.length ? <EmptyView title="加载失败" subtitle={error} icon="alert" /> : null}
        {!rows.length && !error ? <EmptyView title="还没有定时任务" subtitle="点右上角 + 创建 Prompt 或 Script 任务" icon="clock" /> : null}
        {rows.map((row) => {
          const needsApproval = row.task_kind === 'script' && !row.approved_hash;
          return (
            <Pressable key={row.id} onPress={() => void openEdit(row)} style={({ pressed }) => [{ padding: 14, borderRadius: 16, backgroundColor: t.bg2, borderWidth: 1, borderColor: needsApproval ? t.amber : t.line2, ...t.shCard }, pressed && { opacity: 0.72 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: row.task_kind === 'script' ? t.amberGhost : t.acGhost, alignItems: 'center', justifyContent: 'center' }}><Icons.clock size={18} color={row.task_kind === 'script' ? t.amber : t.acTx} sw={1.9} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14.5, fontWeight: '700' }}>{row.name}</Text>
                  <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11, marginTop: 3, fontFamily: 'monospace' }}>{row.cron_expression} · {row.task_kind}{row.next_run_at ? ` · 下次 ${new Date(row.next_run_at).toLocaleString()}` : ''}</Text>
                </View>
                <Text style={{ color: row.enabled ? t.add : t.tx3, fontSize: 11.5, fontWeight: '700' }}>{row.enabled ? '启用' : '停用'}</Text>
              </View>
              {row.last_result ? <Text numberOfLines={2} style={{ color: row.last_exit_code ? t.red : t.tx3, fontSize: 11.5, lineHeight: 17, marginTop: 9 }}>{row.last_result}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
                <Pressable onPress={() => void run(row, 'run')} disabled={busy}><Text style={{ color: t.acTx, fontSize: 12, fontWeight: '700' }}>立即运行</Text></Pressable>
                <Pressable onPress={() => void run(row, 'toggle')} disabled={busy}><Text style={{ color: t.acTx, fontSize: 12, fontWeight: '700' }}>{row.enabled ? '停用' : '启用'}</Text></Pressable>
                {needsApproval ? <Pressable onPress={() => void run(row, 'approve')} disabled={busy}><Text style={{ color: t.amber, fontSize: 12, fontWeight: '700' }}>授权脚本</Text></Pressable> : null}
                <Pressable onPress={() => remove(row)} disabled={busy}><Text style={{ color: t.red, fontSize: 12, fontWeight: '700' }}>删除</Text></Pressable>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <GlassNav title="定时任务" onBack={() => router.back()} right={<Pressable onPress={openCreate} hitSlop={8} style={{ padding: 8 }}><Icons.plus size={21} color={t.acTx} sw={2.2} /></Pressable>} />

      <AdminSheet visible={edit !== undefined} title={edit ? '编辑定时任务' : '新建定时任务'} onClose={() => setEdit(undefined)} submitLabel={busy ? '保存中…' : '保存'} onSubmit={save} submitting={busy}>
        <Segmented label="任务类型" value={kind} options={KINDS} onChange={setKind} />
        <LabeledInput label="名称" value={name} onChangeText={setName} placeholder="例如：每日代码巡检" />
        <LabeledInput label="Cron 表达式" value={cron} onChangeText={setCron} placeholder="0 9 * * *" hint="5 段 Cron：分 时 日 月 周" />
        <Pressable onPress={() => setAgentPicker(true)} style={{ minHeight: 46, borderRadius: 13, backgroundColor: t.bg3, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ flex: 1 }}><Text style={{ color: t.tx3, fontSize: 11 }}>Agent</Text><Text numberOfLines={1} style={{ color: t.tx, fontWeight: '700', marginTop: 2 }}>{agents.find((a) => String(a.id) === agentId)?.display_name || agents.find((a) => String(a.id) === agentId)?.name || '使用默认 Agent'}</Text></View><Icons.chevron size={15} color={t.tx3} /></Pressable>
        {kind === 'prompt' ? <LabeledInput label="任务 Prompt" value={prompt} onChangeText={setPrompt} multiline placeholder="到点后交给 Agent 的任务…" /> : <>
          <Segmented label="脚本类型" value={scriptType} options={SCRIPT_TYPES} onChange={setScriptType} />
          <LabeledInput label="脚本代码" value={script} onChangeText={setScript} multiline placeholder={scriptType === 'python' ? 'print("hello")' : 'Write-Output "hello"'} />
          <LabeledInput label="超时（秒）" value={scriptTimeout} onChangeText={setScriptTimeout} keyboardType="numeric" />
          <Segmented label="出错处理" value={onError} options={ON_ERROR} onChange={setOnError} />
          <SwitchRow label="允许 AI 修复脚本" value={allowFix} onValueChange={setAllowFix} />
        </>}
        <LabeledInput label="背景说明" value={background} onChangeText={setBackground} multiline placeholder="供 AI 诊断时参考（可选）" />
        <SwitchRow label="启用" value={enabled} onValueChange={setEnabled} />
        {edit?.task_kind === 'script' && !edit.approved_hash ? <Text style={{ color: t.amber, fontSize: 11.5, lineHeight: 17 }}>脚本修改后需重新授权，未授权任务不会执行。</Text> : null}
      </AdminSheet>

      <SearchableSelect visible={agentPicker} title="选择 Agent" options={[{ value: '', label: '使用默认 Agent' }, ...agents.map((a) => ({ value: String(a.id), label: a.display_name || a.name || `Agent #${a.id}`, sub: a.description }))]} selected={[agentId]} onChange={(values) => setAgentId(values[0] || '')} onClose={() => setAgentPicker(false)} />
    </View>
  );
}
