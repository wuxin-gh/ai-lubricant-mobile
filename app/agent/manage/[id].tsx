/**
 * Agent 新建/编辑（整页表单）：从 manage 列表点进来，不再列表+底部弹框挤一屏。
 * 路由 id = 'new'（新建）或数字（编辑既有 Agent）。
 * 字段与 Web agent-manager 对齐：基础 / 三槽 Key+模型 / 运行策略 / 高级开关 / SOP 与一级工具只读。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createAgent,
  fetchBuiltinToolsSchema,
  getAgent,
  getAgentSops,
  listChatModels,
  listUsableKeys,
  updateAgent,
  type AgentDef,
  type BuiltinToolSchema,
  type ManagedAgentSop,
  type RuntimeKeyItem,
} from '@/api/agent';
import { ApiError } from '@/api/client';
import { Chip, Collapsible, LabeledInput, SearchableSelect, Segmented, SwitchRow } from '@/components/admin-ui';
import { GlassNav, LoadingView, PrimaryButton } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

const EFFORTS = [{ value: '', label: '默认' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Med' }, { value: 'high', label: 'High' }, { value: 'xhigh', label: 'XHigh' }];

type KeySlot = 'main' | 'subagent' | 'scheduled';

const SLOT_LABEL: Record<KeySlot, string> = { main: '主 Agent', subagent: '子 Agent', scheduled: '定时任务' };

/** 一段分组小标题（页面式表单分区，替代网页弹框的一整列）。 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 13, fontWeight: '800', color: t.tx2, letterSpacing: 0.5, paddingLeft: 2 }}>{title}</Text>
      {children}
    </View>
  );
}

export default function AgentEditScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === 'new';

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [keys, setKeys] = useState<RuntimeKeyItem[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [sops, setSops] = useState<ManagedAgentSop[]>([]);
  const [tools, setTools] = useState<BuiltinToolSchema[]>([]);
  const [keyPicker, setKeyPicker] = useState<KeySlot | null>(null);
  const [modelPicker, setModelPicker] = useState<KeySlot | null>(null);

  // 基础
  const [name, setName] = useState('');
  const [display, setDisplay] = useState('');
  const [desc, setDesc] = useState('');
  const [prompt, setPrompt] = useState('');
  const [turns, setTurns] = useState('80');
  const [workspace, setWorkspace] = useState('agent/workspace');
  const [deniedPatterns, setDeniedPatterns] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [memory, setMemory] = useState(true);
  const [learn, setLearn] = useState(true);
  const [scheduler, setScheduler] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [effort, setEffort] = useState('');
  const [guardian, setGuardian] = useState(false);
  const [guardianInterval, setGuardianInterval] = useState('0');
  const [autonomous, setAutonomous] = useState(false);
  const [retry429, setRetry429] = useState('3');
  const [approvalTimeout, setApprovalTimeout] = useState('86400');
  const [browserCodeRun, setBrowserCodeRun] = useState(false);
  const [teamShared, setTeamShared] = useState(false);
  const [mcpUserId, setMcpUserId] = useState('');

  // Key / 模型 三槽
  const [mainKeyId, setMainKeyId] = useState('');
  const [mainModel, setMainModel] = useState('');
  const [subKeyId, setSubKeyId] = useState('');
  const [subModel, setSubModel] = useState('');
  const [schedKeyId, setSchedKeyId] = useState('');
  const [schedModel, setSchedModel] = useState('');

  const load = useCallback(async () => {
    try {
      const runtimeKeys = await listUsableKeys();
      setKeys(runtimeKeys);
      const a: AgentDef | null = isNew ? null : await getAgent(Number(id)).catch(() => null);
      if (a) {
        setName(a.name || '');
        setDisplay(a.display_name || '');
        setDesc(a.description || '');
        setPrompt(a.system_prompt || '');
        setTurns(String(a.max_turns ?? 80));
        setWorkspace(a.workspace_root || 'agent/workspace');
        setDeniedPatterns((a.denied_patterns ?? []).join(', '));
        setEnabled(a.enabled !== false);
        setMemory(a.memory_enabled !== false);
        setLearn(a.skill_auto_learn !== false);
        setScheduler(!!a.scheduler_enabled);
        setThinking(!!a.thinking_enabled);
        setEffort(a.reasoning_effort || '');
        setGuardian(!!a.guardian_enabled);
        setGuardianInterval(String(a.guardian_interval ?? 0));
        setAutonomous(!!a.autonomous_enabled);
        setRetry429(String(a.llm_retry_429 ?? 3));
        setApprovalTimeout(String(a.approval_timeout_seconds ?? 86400));
        setBrowserCodeRun(!!a.browser_code_run_enabled);
        setTeamShared(!!a.is_team_shared);
        setMcpUserId(a.mcp_user_id ? String(a.mcp_user_id) : '');
        setMainKeyId(a.main_api_key_id ? String(a.main_api_key_id) : '');
        setMainModel(a.main_model || '');
        setSubKeyId(a.subagent_api_key_id ? String(a.subagent_api_key_id) : '');
        setSubModel(a.subagent_model || '');
        setSchedKeyId(a.scheduled_api_key_id ? String(a.scheduled_api_key_id) : '');
        setSchedModel(a.scheduled_model || '');
        const keyId = a.main_api_key_id || runtimeKeys[0]?.id;
        if (keyId) setModels((await listChatModels(keyId).catch(() => [])).map((x) => x.id));
        void getAgentSops(a.id).then(setSops).catch(() => setSops([]));
        void fetchBuiltinToolsSchema().then(setTools).catch(() => setTools([]));
      } else if (runtimeKeys[0]) {
        // 新建默认选第一个可用 Key，方便直接挑模型。
        setMainKeyId(String(runtimeKeys[0].id));
        setModels((await listChatModels(runtimeKeys[0].id).catch(() => [])).map((x) => x.id));
      }
    } catch (e) {
      Alert.alert('加载失败', (e as Error)?.message || '请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => { void load(); }, [load]);

  const slotKey = (slot: KeySlot) => (slot === 'main' ? mainKeyId : slot === 'subagent' ? subKeyId : schedKeyId);
  const slotModel = (slot: KeySlot) => (slot === 'main' ? mainModel : slot === 'subagent' ? subModel : schedModel);
  const setSlotKey = (slot: KeySlot, v: string) => (slot === 'main' ? setMainKeyId(v) : slot === 'subagent' ? setSubKeyId(v) : setSchedKeyId(v));
  const setSlotModel = (slot: KeySlot, v: string) => (slot === 'main' ? setMainModel(v) : slot === 'subagent' ? setSubModel(v) : setSchedModel(v));

  const pickKey = async (slot: KeySlot, keyId: string) => {
    setSlotKey(slot, keyId);
    setSlotModel(slot, '');
    if (keyId) setModels((await listChatModels(Number(keyId)).catch(() => [])).map((x) => x.id));
  };

  const save = async () => {
    if (!name.trim() || !mainKeyId || !mainModel) { Alert.alert('名称、主 Key 和主模型必填'); return; }
    setBusy(true);
    const body = {
      display_name: display.trim(),
      description: desc.trim(),
      system_prompt: prompt,
      max_turns: Math.max(1, Number(turns) || 80),
      enabled,
      memory_enabled: memory,
      skill_auto_learn: learn,
      scheduler_enabled: scheduler,
      workspace_root: workspace.trim() || 'agent/workspace',
      denied_patterns: deniedPatterns.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      guardian_enabled: guardian,
      guardian_interval: Math.max(0, Number(guardianInterval) || 0),
      autonomous_enabled: autonomous,
      thinking_enabled: thinking,
      reasoning_effort: effort,
      llm_retry_429: Math.max(0, Number(retry429) || 0),
      approval_timeout_seconds: Math.max(0, Number(approvalTimeout) || 0),
      browser_code_run_enabled: browserCodeRun,
      is_team_shared: teamShared,
      mcp_user_id: mcpUserId.trim() ? Number(mcpUserId.trim()) : null,
      main_api_key_id: Number(mainKeyId),
      main_model: mainModel,
      subagent_api_key_id: subKeyId ? Number(subKeyId) : null,
      subagent_model: subModel || undefined,
      scheduled_api_key_id: schedKeyId ? Number(schedKeyId) : null,
      scheduled_model: schedModel || undefined,
    };
    try {
      if (isNew) await createAgent({ name: name.trim(), ...body });
      else await updateAgent(Number(id), body);
      // 回列表（列表页重新挂载会刷新）。
      router.back();
    } catch (e) {
      Alert.alert('保存失败', e instanceof ApiError ? e.message : '请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载 Agent…" /><GlassNav title={isNew ? '新增 Agent' : '编辑 Agent'} onBack={() => router.back()} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 64, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 100, gap: 16 }}>
        <Section title="基础">
          <LabeledInput label="内部名称" value={name} onChangeText={setName} disabled={!isNew} hint={isNew ? '创建后不可改' : undefined} />
          <LabeledInput label="显示名称" value={display} onChangeText={setDisplay} />
          <LabeledInput label="描述" value={desc} onChangeText={setDesc} multiline />
          <LabeledInput label="系统提示词" value={prompt} onChangeText={setPrompt} multiline />
        </Section>

        <Section title="Key / 模型">
          {(['main', 'subagent', 'scheduled'] as KeySlot[]).map((slot) => (
            <View key={slot} style={{ gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.3 }}>{SLOT_LABEL[slot]} Key / 模型{slot === 'main' ? '' : '（可选）'}</Text>
              <Pressable onPress={() => setKeyPicker(slot)} style={{ minHeight: 44, borderRadius: 13, backgroundColor: t.bg3, paddingHorizontal: 13, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: slotKey(slot) ? t.tx : t.tx3, fontSize: 12.5 }}>{keys.find((k) => String(k.id) === slotKey(slot))?.name || '选择 API Key'}</Text></View><Text style={{ color: t.tx3, fontSize: 10 }}>更换</Text></Pressable>
              <Pressable onPress={() => setModelPicker(slot)} style={{ minHeight: 44, borderRadius: 13, backgroundColor: t.bg3, paddingHorizontal: 13, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: slotModel(slot) ? t.tx : t.tx3, fontSize: 12.5, fontFamily: 'monospace' }}>{slotModel(slot) || '选择模型'}</Text></View><Text style={{ color: t.tx3, fontSize: 10 }}>更换</Text></Pressable>
            </View>
          ))}
        </Section>

        <Section title="运行策略">
          <LabeledInput label="最大轮数" value={turns} onChangeText={setTurns} keyboardType="numeric" />
          <LabeledInput label="工作区根目录" value={workspace} onChangeText={setWorkspace} />
          <LabeledInput label="禁止访问模式（逗号分隔）" value={deniedPatterns} onChangeText={setDeniedPatterns} placeholder="例如 secret/**, .env" />
          <LabeledInput label="MCP 用户 ID（MCP 主体绑定，可选）" value={mcpUserId} onChangeText={setMcpUserId} keyboardType="numeric" hint="在资源中心的 MCP 用户管理里创建" />
          <SwitchRow label="启用" value={enabled} onValueChange={setEnabled} />
          <SwitchRow label="长期记忆" value={memory} onValueChange={setMemory} />
          <SwitchRow label="自动学习 Skills" value={learn} onValueChange={setLearn} />
          <SwitchRow label="调度器" value={scheduler} onValueChange={setScheduler} />
          <SwitchRow label="思考模式" value={thinking} onValueChange={setThinking} />
          {thinking ? <Segmented label="推理强度" value={effort} options={EFFORTS} onChange={setEffort} /> : null}
        </Section>

        <Section title="高级">
          <SwitchRow label="Guardian" value={guardian} onValueChange={setGuardian} />
          {guardian ? <LabeledInput label="Guardian 检查间隔（秒，0=默认）" value={guardianInterval} onChangeText={setGuardianInterval} keyboardType="numeric" /> : null}
          <SwitchRow label="自主模式" value={autonomous} onValueChange={setAutonomous} />
          <SwitchRow label="浏览器 code_run" value={browserCodeRun} onValueChange={setBrowserCodeRun} hint="开启后浏览器会话执行代码仍需审批" />
          <SwitchRow label="团队共享" value={teamShared} onValueChange={setTeamShared} hint="同团队成员可见可用（仅你能改配置）" />
          <LabeledInput label="429 自动重试次数（0=关闭）" value={retry429} onChangeText={setRetry429} keyboardType="numeric" />
          <LabeledInput label="审批等待上限（秒，0=不过期）" value={approvalTimeout} onChangeText={setApprovalTimeout} keyboardType="numeric" />
        </Section>

        {!isNew ? (
          <Section title="只读信息">
            <Collapsible title={`SOP（${sops.length}）`}>
              {sops.length ? sops.map((s) => (
                <View key={s.id} style={{ paddingVertical: 7, borderTopWidth: 0.5, borderColor: t.line }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: t.tx, fontSize: 12.5, fontWeight: '600', flexShrink: 1 }}>{s.name}</Text>
                    {s.is_builtin ? <Chip text="内置" color={t.tx2} bg={t.bg3} /> : <Chip text="自定义" color={t.acTx} bg={t.acGhost} />}
                    {!s.exists ? <Chip text="未安装" color={t.amber} bg={t.amberGhost} /> : null}
                  </View>
                  {s.description ? <Text numberOfLines={2} style={{ color: t.tx3, fontSize: 11, marginTop: 3 }}>{s.description}</Text> : null}
                </View>
              )) : <Text style={{ color: t.tx3, fontSize: 12 }}>暂无 SOP</Text>}
            </Collapsible>
            <Collapsible title={`一级工具（${tools.length}）`}>
              {tools.map((tool) => (
                <View key={tool.name} style={{ paddingVertical: 7, borderTopWidth: 0.5, borderColor: t.line }}>
                  <Text style={{ color: t.tx, fontSize: 12.5, fontWeight: '600', fontFamily: 'monospace' }}>{tool.name}</Text>
                  {tool.description ? <Text numberOfLines={3} style={{ color: t.tx3, fontSize: 11, lineHeight: 16, marginTop: 3 }}>{tool.description}</Text> : null}
                </View>
              ))}
            </Collapsible>
          </Section>
        ) : null}
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.pad, paddingTop: 10, paddingBottom: insets.bottom + 10, backgroundColor: t.bg, borderTopWidth: 1, borderColor: t.line }}>
        <PrimaryButton label={busy ? '保存中…' : '保存'} icon="check" onPress={() => void save()} disabled={busy} block />
      </View>
      <GlassNav title={isNew ? '新增 Agent' : `编辑 ${display || name || `#${id}`}`} onBack={() => router.back()} />

      <SearchableSelect
        visible={keyPicker !== null}
        title={`${keyPicker ? SLOT_LABEL[keyPicker] : ''} API Key`}
        options={[{ value: '', label: '不绑定' }, ...keys.map((k) => ({ value: String(k.id), label: k.name || k.key_masked, sub: k.key_masked }))]}
        selected={keyPicker ? [slotKey(keyPicker)] : []}
        onChange={(values) => { if (keyPicker) void pickKey(keyPicker, values[0] || ''); setKeyPicker(null); }}
        onClose={() => setKeyPicker(null)}
      />
      <SearchableSelect
        visible={modelPicker !== null}
        title={`${modelPicker ? SLOT_LABEL[modelPicker] : ''} 模型`}
        options={models.map((m) => ({ value: m, label: m }))}
        selected={modelPicker ? [slotModel(modelPicker)] : []}
        onChange={(values) => { if (modelPicker) setSlotModel(modelPicker, values[0] || ''); setModelPicker(null); }}
        onClose={() => setModelPicker(null)}
        emptyText="先选择该槽位的 API Key"
      />
    </View>
  );
}
