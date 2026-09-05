import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listNodes, listProjects } from '@/api/client';
import { listRuntimeModelOptions } from '@/api/agent';
import {
  createUserTask,
  listAuthorizedResources,
  listParentKeys,
  type AuthorizedResource,
  type GatewayModelOption,
  type ParentKeyItem,
  type TaskProvider,
  type TaskResourceKind,
} from '@/api/task';
import type { Node, Project } from '@/api/types';
import { Collapsible, LabeledInput, SearchableSelect, Segmented } from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { GlassNav, LoadingView, PrimaryButton } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

type Intent = 'analysis' | 'fix';
type Picker = 'project' | 'provider' | 'node' | 'key' | 'models' | 'skills' | 'mcps' | 'plugins';

const PROVIDERS: Array<{ value: TaskProvider; label: string }> = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'cursor', label: 'Cursor CLI (ACP)' },
];

function isUsableNode(node: Node): boolean {
  return !!node.node_id
    && node.connected === true
    && node.is_passive !== true
    && node.node_role !== 'management'
    && node.node_role !== 'passive_management'
    && (node.active_sessions ?? 0) === 0;
}

export default function NewTaskScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string; issueId?: string; issueType?: string; content?: string }>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [parentKeys, setParentKeys] = useState<ParentKeyItem[]>([]);
  const [models, setModels] = useState<GatewayModelOption[]>([]);
  const [skills, setSkills] = useState<AuthorizedResource[]>([]);
  const [mcps, setMcps] = useState<AuthorizedResource[]>([]);
  const [plugins, setPlugins] = useState<AuthorizedResource[]>([]);
  const [projectId, setProjectId] = useState(params.projectId || '');
  const [provider, setProvider] = useState<TaskProvider>('opencode');
  const [nodeId, setNodeId] = useState('');
  const [parentKeyId, setParentKeyId] = useState('');
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedMcps, setSelectedMcps] = useState<string[]>([]);
  const [selectedPlugins, setSelectedPlugins] = useState<string[]>([]);
  const [intent, setIntent] = useState<Intent>('analysis');
  const [content, setContent] = useState(params.content || '');
  const [expectedClientId, setExpectedClientId] = useState('');
  const [maxRequests, setMaxRequests] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [picker, setPicker] = useState<Picker | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([
      listProjects({ page_size: 100 }),
      listNodes(),
      listParentKeys(),
      listAuthorizedResources('skill'),
      listAuthorizedResources('mcp'),
      listAuthorizedResources('plugin'),
    ]).then(([projectResult, nodeRows, keyRows, skillRows, mcpRows, pluginRows]) => {
      const usableNodes = nodeRows.filter(isUsableNode)
      const usableKeys = keyRows.filter((key) => !key.disabled)
      setProjects(projectResult.projects)
      setNodes(usableNodes)
      setNodeId(usableNodes[0]?.node_id || '')
      setParentKeys(usableKeys)
      setParentKeyId(usableKeys[0] ? String(usableKeys[0].id) : '')
      setSkills(skillRows)
      setMcps(mcpRows)
      setPlugins(pluginRows)
      if (!params.projectId && projectResult.projects[0]?.id) setProjectId(projectResult.projects[0].id)
    }).catch((error) => {
      Alert.alert('加载失败', (error as Error)?.message || '无法加载任务配置');
    }).finally(() => setLoading(false));
  }, [params.projectId]);

  useEffect(() => {
    if (!parentKeyId) {
      setModels([]);
      setSelectedModels([]);
      return;
    }
    let active = true;
    setModels([]);
    setSelectedModels([]);
    void listRuntimeModelOptions(Number(parentKeyId))
      .then((options) => {
        if (!active) return;
        const rows = options.map((item) => ({ value: item.value, label: item.label }));
        setModels(rows);
        setSelectedModels(rows[0] ? [rows[0].value] : []);
      })
      .catch(() => { if (active) setModels([]); });
    return () => { active = false; };
  }, [parentKeyId]);

  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId), [projectId, projects]);
  const selectedNode = useMemo(() => nodes.find((node) => node.node_id === nodeId), [nodeId, nodes]);
  const selectedKey = useMemo(() => parentKeys.find((key) => String(key.id) === parentKeyId), [parentKeyId, parentKeys]);

  const submit = async () => {
    const prompt = content.trim();
    if (!nodeId) return Alert.alert('请选择可用执行节点');
    if (!parentKeyId) return Alert.alert('请选择父 API Key');
    if (!prompt) return Alert.alert('请输入任务内容');
    if (provider === 'codex' && !expectedClientId.trim()) return Alert.alert('Codex 任务需要 installation_id');
    setBusy(true);
    try {
      const issueType = String(params.issueType || '');
      const isBug = issueType === 'bug';
      const mapping = intent === 'analysis'
        ? (isBug ? { task_type: 'develop', task_role: 'diagnose', sub_type: 'diagnose_bug' } : { task_type: 'design', task_role: 'design', sub_type: 'generate_design' })
        : (isBug ? { task_type: 'develop', task_role: 'fix', sub_type: 'fix_bug' } : { task_type: 'develop', task_role: 'develop', sub_type: 'execute_task' });
      const task = await createUserTask({
        content: prompt,
        provider,
        cli_name: provider,
        node_id: nodeId,
        parent_api_key_id: Number(parentKeyId),
        ...(selectedModels.length ? { models: selectedModels } : {}),
        ...((maxRequests || maxTokens) ? {
          usage_limit: {
            ...(maxRequests ? { max_requests: Number(maxRequests) } : {}),
            ...(maxTokens ? { max_total_tokens: Number(maxTokens) } : {}),
          },
        } : {}),
        ...(expiresAt ? { expires_at: new Date(expiresAt).getTime() / 1000 } : {}),
        ...(provider === 'codex' ? {
          expected_client_id: expectedClientId.trim(),
          bootstrap_content: prompt,
        } : {}),
        ...mapping,
        ...(selectedProject?.repo_url ? { repo: { repo_url: selectedProject.repo_url } } : {}),
        ...((projectId || params.issueId || selectedSkills.length || selectedPlugins.length) ? {
          extra: {
            ...(projectId ? { project_id: projectId } : {}),
            ...(params.issueId ? { issue_id: params.issueId } : {}),
            ...(selectedSkills.length ? { skill_ids: selectedSkills } : {}),
            ...(selectedPlugins.length ? { plugin_ids: selectedPlugins } : {}),
          },
        } : {}),
        ...(selectedMcps.length ? { mcp_config: selectedMcps.map((id) => ({ resource_id: id })) } : {}),
      });
      // 创建接口只等待同步校验/落库，节点在后台做 clone、资源下载和 runtime
      // 启动。直接进详情页看「准备中」步骤，避免一个声称“已开始运行”的弹窗
      // 在实际仍下载 Skill/插件/MCP 时误导用户。
      router.replace(`/task/${task.id}`);
    } catch (error) {
      Alert.alert('创建失败', (error as Error)?.message || '请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载任务配置…" /><GlassNav title="新建任务" onBack={() => router.back()} /></View>;
  }

  const row = (label: string, value: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={({ pressed }) => [{ minHeight: 52, borderRadius: 14, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, pressed && { opacity: 0.75 }]}>
      <Icons.search size={17} color={t.acTx} sw={2} />
      <View style={{ flex: 1 }}><Text style={{ color: t.tx3, fontSize: 11 }}>{label}</Text><Text numberOfLines={1} style={{ color: t.tx, fontSize: 14, fontWeight: '700', marginTop: 2 }}>{value}</Text></View>
      <Icons.chevron size={16} color={t.tx3} />
    </Pressable>
  );

  return <View style={{ flex: 1, backgroundColor: t.bg }}>
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 68, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 110, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: t.tx, fontSize: 21, fontWeight: '800' }}>创建开发任务</Text>
      <Text style={{ color: t.tx3, fontSize: 12.5, lineHeight: 18 }}>任务直接绑定执行节点，并使用独立的 Task API Key 与工作区。</Text>
      {row('项目（可选）', selectedProject?.name || '不关联项目', () => setPicker('project'))}
      {row('执行工具', PROVIDERS.find((item) => item.value === provider)?.label || provider, () => setPicker('provider'))}
      {row('执行节点', selectedNode?.node_name || selectedNode?.node_id || '没有空闲执行节点', () => setPicker('node'))}
      {row('父 API Key', selectedKey?.name || selectedKey?.key_masked || '选择可用父 Key', () => setPicker('key'))}
      <Segmented label="任务意图" value={intent} options={[{ value: 'analysis', label: '分析' }, { value: 'fix', label: '实现/修复' }]} onChange={setIntent} hint={intent === 'analysis' ? '分析问题、输出结论或方案' : '修改代码并完成实现'} />
      {row('可用模型（多选）', selectedModels.length ? `${selectedModels[0]}${selectedModels.length > 1 ? ` 等 ${selectedModels.length} 个` : ''}` : '使用默认模型', () => setPicker('models'))}
      {row('技能（可选）', selectedSkills.length ? `已选 ${selectedSkills.length} 个` : '不附加技能', () => setPicker('skills'))}
      {row('MCP（可选）', selectedMcps.length ? `已选 ${selectedMcps.length} 个` : '不附加 MCP', () => setPicker('mcps'))}
      {row('插件（可选）', selectedPlugins.length ? `已选 ${selectedPlugins.length} 个` : '不附加插件', () => setPicker('plugins'))}
      <View style={{ borderRadius: 14, backgroundColor: t.bg2, padding: 13 }}><TextInput value={content} onChangeText={setContent} placeholder="本次任务要处理的内容" placeholderTextColor={t.tx3} multiline style={{ minHeight: 120, color: t.tx, fontSize: 15, lineHeight: 21, textAlignVertical: 'top' }} /></View>
      {provider === 'codex' ? <LabeledInput label="Codex installation_id" value={expectedClientId} onChangeText={setExpectedClientId} placeholder="来自 Codex 请求 metadata" /> : null}
      <View style={{ borderRadius: 14, backgroundColor: t.bg2, padding: 13 }}><Collapsible title="高级参数 · API Key 限额"><View style={{ gap: 10, paddingTop: 8 }}><LabeledInput label="最大请求次数" value={maxRequests} onChangeText={setMaxRequests} keyboardType="numeric" placeholder="不限制" /><LabeledInput label="最大总 Token" value={maxTokens} onChangeText={setMaxTokens} keyboardType="numeric" placeholder="不限制" /><LabeledInput label="过期时间" value={expiresAt} onChangeText={setExpiresAt} placeholder="例如 2026-12-31 18:00" /></View></Collapsible></View>
    </ScrollView>
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.pad, paddingTop: 10, paddingBottom: insets.bottom + 12, backgroundColor: t.bg }}><PrimaryButton block label={busy ? '创建中…' : '创建任务'} icon={busy ? undefined : 'plus'} disabled={busy || !nodeId || !parentKeyId || !content.trim() || (provider === 'codex' && !expectedClientId.trim())} onPress={() => void submit()} /></View>
    <GlassNav title="新建任务" onBack={() => router.back()} />
    <SearchableSelect visible={picker === 'project'} title="选择项目" options={[{ value: '', label: '不关联项目' }, ...projects.filter((project) => project.id).map((project) => ({ value: project.id!, label: project.name || project.id!, sub: project.repo_url }))]} selected={[projectId]} onChange={(values) => setProjectId(values[0] || '')} onClose={() => setPicker(null)} />
    <SearchableSelect visible={picker === 'provider'} title="选择执行工具" options={PROVIDERS.map((item) => ({ value: item.value, label: item.label }))} selected={[provider]} onChange={(values) => setProvider((values[0] || 'opencode') as TaskProvider)} onClose={() => setPicker(null)} />
    <SearchableSelect visible={picker === 'node'} title="选择空闲执行节点" options={nodes.map((node) => ({ value: node.node_id!, label: node.node_name || node.node_id!, sub: `${node.node_role || 'execution'} · 在线` }))} selected={nodeId ? [nodeId] : []} onChange={(values) => setNodeId(values[0] || '')} onClose={() => setPicker(null)} emptyText="没有在线且空闲的执行节点" />
    <SearchableSelect visible={picker === 'key'} title="选择父 API Key" options={parentKeys.map((key) => ({ value: String(key.id), label: key.name || key.key_masked, sub: `${key.source} · ${key.key_masked}` }))} selected={parentKeyId ? [parentKeyId] : []} onChange={(values) => setParentKeyId(values[0] || '')} onClose={() => setPicker(null)} />
    <SearchableSelect visible={picker === 'models'} title="选择任务可用模型" options={models.map((model) => ({ value: model.value, label: model.label, sub: model.value }))} selected={selectedModels} onChange={setSelectedModels} onClose={() => setPicker(null)} multiple />
    <SearchableSelect visible={picker === 'skills'} title="选择已授权技能" options={skills.map((skill) => ({ value: skill.id, label: skill.display_name || skill.name, sub: skill.version ? `v${skill.version}` : undefined }))} selected={selectedSkills} onChange={setSelectedSkills} onClose={() => setPicker(null)} multiple emptyText="没有已授权的技能" />
    <SearchableSelect visible={picker === 'mcps'} title="选择已授权 MCP" options={mcps.map((mcp) => ({ value: mcp.id, label: mcp.display_name || mcp.name, sub: mcp.status || undefined }))} selected={selectedMcps} onChange={setSelectedMcps} onClose={() => setPicker(null)} multiple emptyText="没有已授权的 MCP" />
    <SearchableSelect visible={picker === 'plugins'} title="选择已授权插件" options={plugins.map((plugin) => ({ value: plugin.id, label: plugin.display_name || plugin.name, sub: plugin.version ? `v${plugin.version}` : undefined }))} selected={selectedPlugins} onChange={setSelectedPlugins} onClose={() => setPicker(null)} multiple emptyText="没有已授权的插件" />
  </View>;
}
