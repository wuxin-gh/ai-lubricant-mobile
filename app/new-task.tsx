/**
 * 创建任务 —— 两步向导（对齐 Web ``canonical-create-task-dialog.tsx``）。
 *
 * 第一步「环境」：选节点 → 选客户端 → 选环境档位 → 管理该环境的资源。
 * 第二步「任务」：意图/权限方式/父 Key/分支/内容/工具/提示词/API Key 高级项。
 *
 * 为什么分两步：环境档位改变的是**动词**而不只是字段值 —— 隔离档的资源是「装进
 * 本次 session」，共用/系统档是「本次激活环境里已有的哪些」。两套语义的控件长得
 * 一样但含义不同，挤在一屏里切换档位会静默改变同一批控件的语义。
 *
 * 所有可提交状态集中在 {@link CreateTaskDraft}，提交时交给纯函数
 * {@link buildCreateTaskPayload} 组装负载 —— 分档语义的正确性由单测保证，这里只
 * 负责取值与渲染。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listNodes, listProjects } from '@/api/client';
import type { Node, Project } from '@/api/types';
import { listAvailableMcp, listRuntimeModelOptions, type AvailableMcpItem } from '@/api/agent';
import {
  listEffectiveResources,
  listMcpAuthorizationOptions,
  listProjectPrompts,
  listReferencesV2,
  type McpAuthorizationResource,
  type ProjectPrompt,
  type ResourceReference,
  type ResourceReferenceV2,
} from '@/api/mcpCenter';
import { createEnvironment, getEnvironment, listEnvironments, type TaskEnvironment } from '@/api/environment';
import { getSystemEnv } from '@/api/systemEnv';
import {
  createUserTask,
  listParentKeys,
  listRepoBranches,
  type ParentKeyItem,
} from '@/api/task';
import { Collapsible, LabeledInput, SearchableSelect, Segmented, type SearchableOption } from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { GlassNav, LoadingView, PrimaryButton, Toast } from '@/components/ui';
import { nodeModeOptions, nodeSystemEnvAllowed, nodeUnusableReason } from '@/features/task/nodeHealth';
import { EnvResourcePanel, type ResourceKind } from '@/features/task/EnvResourcePanel';
import { McpGrantPicker, type PickerParamKind } from '@/features/task/McpGrantPicker';
import { NodePickerSheet } from '@/features/task/NodePickerSheet';
import { ResourceAddSheet } from '@/features/task/ResourceAddSheet';
import {
  buildCreateTaskPayload,
  buildEnvironmentEntries,
  DEFAULT_SELECTION_STRATEGY,
  defaultDraft,
  toResourceItems,
  validateDraft,
  type ConfigEntry,
  type CreateTaskDraft,
  type EnvTier,
  type PickerResource,
  type ReferenceLike,
  type ResourceItem,
} from '@/features/task/taskCreateModel';
import { spacing, useTheme } from '@/theme';

/** 与 Web PROVIDERS 同源（不含 cursor：Web 创建入口未列）。 */
const PROVIDERS = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'codex', label: 'Codex' },
];

const ENV_TIERS: { value: EnvTier; label: string; detail: string }[] = [
  { value: 'isolated', label: '隔离环境', detail: '每次任务一个全新初始环境，任务间互不干扰。' },
  { value: 'shared', label: '共用环境', detail: '跑在命名环境里，依赖与登录态跨任务复用。' },
  { value: 'system', label: '系统内置', detail: '用节点操作者本机已装的工具与配置。' },
];

const SELECTION_STRATEGIES = [
  { value: 'intelligent', label: '智能选择（推荐）' },
  { value: 'fast_intelligent', label: '快速智能选择' },
  { value: 'sequential', label: '顺序（按优先级依次尝试）' },
  { value: 'random_member', label: '成员随机' },
  { value: 'model_random', label: '模型随机' },
  { value: 'random_all', label: '全局随机' },
];

/** 权限方式回落表（节点未上报 capabilities.editors 时用）。与 Web editorModeOptions 同源。 */
function fallbackModeOptions(provider: string): { value: string; label: string }[] {
  switch (provider) {
    case 'codex':
      return [
        { value: '', label: '客户端默认' },
        { value: 'read-only', label: '只读' },
        { value: 'workspace-write', label: '可写工作区' },
        { value: 'danger-full-access', label: '完全访问' },
      ];
    case 'claude':
      return [
        { value: '', label: '客户端默认' },
        { value: 'default', label: '默认（逐次确认）' },
        { value: 'plan', label: '仅计划' },
        { value: 'acceptEdits', label: '自动接受编辑' },
        { value: 'bypassPermissions', label: '跳过权限确认' },
      ];
    case 'opencode':
      return [
        { value: '', label: '客户端默认' },
        { value: 'skip-permissions', label: '跳过权限确认' },
      ];
    default:
      return [{ value: '', label: '客户端默认' }];
  }
}

type Step = 'env' | 'task';

/** 底部选择器种类（一步一个 sheet，避免嵌套弹框）。 */
type PickerKind =
  | 'env' | 'key' | 'models' | 'prompt' | 'branch' | 'mode' | 'strategy';

export default function NewTaskScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string; issueId?: string; issueType?: string; content?: string }>();

  const [step, setStep] = useState<Step>('env');
  const [draft, setDraft] = useState<CreateTaskDraft>(() => defaultDraft({
    projectId: params.projectId || '',
    issueId: params.issueId || '',
    issueType: params.issueType === 'bug' ? 'bug' : params.issueType ? 'requirement' : undefined,
    content: params.content || '',
  }));
  const patch = useCallback((next: Partial<CreateTaskDraft>) => setDraft((cur) => ({ ...cur, ...next })), []);

  // ── 加载态 ────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2400); }, []);

  // ── 第一步数据 ────────────────────────────────────────────────────────────
  const [nodes, setNodes] = useState<Node[]>([]);
  const [nodePickerOpen, setNodePickerOpen] = useState(false);
  const [envs, setEnvs] = useState<TaskEnvironment[]>([]);
  const [envResources, setEnvResources] = useState<{ kind: 'skill' | 'mcp' | 'plugin'; resource_id: string; name: string; version: string; state?: 'installed' | 'pending' | 'config' }[]>([]);
  const [systemResources, setSystemResources] = useState<Record<string, { name: string; version: string; description: string; readers: string[]; platform_managed: boolean }[]> | null>(null);
  const [authorizedSkills, setAuthorizedSkills] = useState<ReferenceLike[]>([]);
  const [authorizedPlugins, setAuthorizedPlugins] = useState<ReferenceLike[]>([]);
  const [authorizedMcps, setAuthorizedMcps] = useState<ReferenceLike[]>([]);
  const [mcpPickerResources, setMcpPickerResources] = useState<PickerResource[]>([]);
  const [mcpParamKinds, setMcpParamKinds] = useState<PickerParamKind[]>([]);
  const [envResourceKind, setEnvResourceKind] = useState<ResourceKind>('skill');
  const [addKind, setAddKind] = useState<ResourceKind | null>(null);
  const [newEnvOpen, setNewEnvOpen] = useState(false);
  const [newEnvName, setNewEnvName] = useState('');

  // ── 第二步数据 ────────────────────────────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [parentKeys, setParentKeys] = useState<ParentKeyItem[]>([]);
  const [models, setModels] = useState<{ value: string; label: string }[]>([]);
  const [prompts, setPrompts] = useState<ProjectPrompt[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [picker, setPicker] = useState<PickerKind | null>(null);

  const selectedNode = useMemo(() => nodes.find((n) => n.node_id === draft.nodeId), [nodes, draft.nodeId]);
  const selectedProject = useMemo(() => projects.find((p) => p.id === draft.projectId), [projects, draft.projectId]);
  const systemEnvAllowed = useMemo(() => nodeSystemEnvAllowed(selectedNode), [selectedNode]);
  const anySystemEnvNode = useMemo(
    () => nodes.some((n) => n.node_role !== 'management' && n.node_role !== 'passive_management' && nodeSystemEnvAllowed(n)),
    [nodes],
  );

  // 该节点是否有可用项（含 system 档要求），用于节点行的「无可用节点」提示。
  const usableNodeCount = useMemo(
    () => nodes.filter((n) => !nodeUnusableReason(n, draft.provider, draft.envMode === 'system')).length,
    [nodes, draft.provider, draft.envMode],
  );

  // ── 初次加载 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const [nodeRows, keyRows, projectResult, promptRows, skillRows, pluginRows, mcpRows, v2Skills, v2Plugins, authOptions] = await Promise.all([
          listNodes(),
          listParentKeys(),
          listProjects({ page_size: 100 }),
          listProjectPrompts().catch(() => [] as ProjectPrompt[]),
          listEffectiveResources('skill').catch(() => [] as ResourceReference[]),
          listEffectiveResources('plugin').catch(() => [] as ResourceReference[]),
          listEffectiveResources('mcp').catch(() => [] as ResourceReference[]),
          listReferencesV2('skill').catch(() => []),
          listReferencesV2('plugin').catch(() => []),
          listMcpAuthorizationOptions().catch(() => ({ resources: [] as McpAuthorizationResource[], param_kinds: [] })),
        ]);
        const usableKeys = keyRows.filter((key) => !key.disabled);
        setNodes(nodeRows);
        setParentKeys(usableKeys);
        setProjects(projectResult.projects);
        setPrompts(promptRows.filter((p) => p.enabled !== false));
        // 候选 = 授权可见的旧表引用 + 新表池引用映射行（MCP 不并新表：池引用没有
        // 归属服务，选了也派发不了，服务端 normalize_mcp_bindings 会拒）。
        setAuthorizedSkills([...skillRows, ...v2Skills.map(v2ToReferenceLike)]);
        setAuthorizedPlugins([...pluginRows, ...v2Plugins.map(v2ToReferenceLike)]);
        setAuthorizedMcps(mcpRows);
        setMcpPickerResources([
          ...authOptions.resources.filter((r) => r.resource_kind === 'service').map((r): PickerResource => ({
            resource_kind: r.resource_kind,
            resource_id: r.resource_id,
            resource_type: r.resource_type,
            name: r.name,
            description: r.description,
            tool_count: r.tool_count,
            kind: r.kind,
            stdio: r.stdio,
            required_param: r.required_param,
            source: r.source,
            children: r.children,
          })),
          ...authOptions.resources.filter((r) => r.resource_kind === 'builtin_resource').map((r): PickerResource => ({
            resource_kind: r.resource_kind,
            resource_id: r.resource_id,
            resource_type: r.resource_type,
            name: r.name,
            children: [],
          })),
        ]);
        setMcpParamKinds(authOptions.param_kinds || []);
        setDraft((cur) => ({
          ...cur,
          nodeId: cur.nodeId || (nodeRows.find((n) => !nodeUnusableReason(n, cur.provider))?.node_id ?? ''),
          parentKeyId: cur.parentKeyId || (usableKeys[0] ? String(usableKeys[0].id) : ''),
          projectId: cur.projectId || projectResult.projects[0]?.id || '',
        }));
      } catch (error) {
        Alert.alert('加载失败', (error as Error)?.message || '无法加载任务配置');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 内置服务型 MCP（cdp-bridge / 邮箱 / 设备控制）：作为可直接挂载的服务并入候选。
  useEffect(() => {
    void listAvailableMcp().then(({ builtin, admin, upstream }) => {
      const rows: AvailableMcpItem[] = [...builtin, ...admin, ...upstream];
      if (!rows.length) return;
      setMcpPickerResources((cur) => {
        const known = new Set(cur.filter((r) => r.resource_kind === 'service').map((r) => String(r.resource_id)));
        const additions: PickerResource[] = rows
          .filter((row) => !known.has(String(row.id)))
          .map((row) => ({
            resource_kind: 'service',
            resource_id: row.id,
            resource_type: 'service',
            name: row.display_name || row.name,
            description: row.description,
            tool_count: row.tool_count,
            kind: row.kind,
            stdio: row.kind === 'stdio',
            source: row.source,
          }));
        return additions.length ? [...cur, ...additions] : cur;
      });
    }).catch(() => undefined);
  }, []);

  // 换节点：重取该节点的共用环境（环境归属节点，跨节点不通用），并把不再合法的
  // env_id 收回 —— 带着别的节点的 env_id 派发会被服务端拒。
  useEffect(() => {
    if (!draft.nodeId) { setEnvs([]); return; }
    let active = true;
    void listEnvironments(draft.nodeId).then((rows) => {
      if (!active) return;
      setEnvs(rows);
      setDraft((cur) => {
        const match = rows.find((r) => r.id === cur.envId);
        return match ? cur : { ...cur, envId: '', envName: '' };
      });
    }).catch(() => { if (active) setEnvs([]); });
    return () => { active = false; };
  }, [draft.nodeId]);

  // 系统档在节点不支持时收回隔离档（第一步没选节点时 system 是合法的）。
  useEffect(() => {
    if (draft.envMode === 'system' && draft.nodeId && !systemEnvAllowed) patch({ envMode: 'isolated' });
    if (draft.envMode !== 'shared' && draft.envId) patch({ envId: '', envName: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.envMode, draft.nodeId, systemEnvAllowed, draft.envId]);

  // 共用环境详情 → 环境自带资源卡片。
  useEffect(() => {
    if (draft.envMode !== 'shared' || !draft.envId) { setEnvResources([]); return; }
    let active = true;
    void getEnvironment(draft.envId).then((detail) => {
      if (active) setEnvResources(detail.resources || []);
    }).catch(() => { if (active) setEnvResources([]); });
    return () => { active = false; };
  }, [draft.envMode, draft.envId]);

  // 系统档：拉节点本机清单。切换客户端也重拉（readers 按编辑器归组）。
  useEffect(() => {
    if (draft.envMode !== 'system' || !draft.nodeId || !systemEnvAllowed) { setSystemResources(null); return; }
    let active = true;
    void getSystemEnv(draft.nodeId).then((detail) => {
      if (active) setSystemResources(detail.resources || {});
    }).catch(() => { if (active) setSystemResources(null); });
    return () => { active = false; };
  }, [draft.envMode, draft.nodeId, systemEnvAllowed, draft.provider]);

  // 父 Key → 可用模型（按该 Key 的白/黑名单）。**默认不选**：空 = 不限制。
  useEffect(() => {
    const keyId = Number(draft.parentKeyId);
    if (!keyId) { setModels([]); return; }
    let active = true;
    void listRuntimeModelOptions(keyId).then((options) => {
      if (!active) return;
      setModels(options);
      setDraft((cur) => ({
        ...cur,
        selectedModels: cur.selectedModels.filter((id) => options.some((o) => o.value === id)),
      }));
    }).catch(() => { if (active) setModels([]); });
    return () => { active = false; };
  }, [draft.parentKeyId]);

  // 分支列表：只在「指定已有分支」且项目绑了 Git 身份时拉。
  useEffect(() => {
    const identityId = selectedProject?.git_identity_id;
    const repoFullName = selectedProject?.full_name;
    if (draft.branchMode !== 'existing' || !identityId || !repoFullName) { setBranches([]); return; }
    let active = true;
    void listRepoBranches(identityId, repoFullName)
      .then((names) => { if (active) setBranches(names); })
      .catch(() => { if (active) setBranches([]); });
    return () => { active = false; };
  }, [draft.branchMode, selectedProject?.git_identity_id, selectedProject?.full_name]);

  // 项目 → 仓库地址与 Git 身份随动。
  useEffect(() => {
    setDraft((cur) => ({
      ...cur,
      repoUrl: selectedProject?.repo_url || '',
      gitIdentityId: selectedProject?.git_identity_id || '',
    }));
  }, [selectedProject?.repo_url, selectedProject?.git_identity_id]);

  // ── 派生：环境资源卡片 ────────────────────────────────────────────────────
  // 依赖必须**逐字段**列出，不能传整个 draft：下面那个「补勾选」effect 以
  // environmentEntries 的身份变化为触发条件，若这里跟着 draft 每次变更换新对象，
  // 用户取消勾选后随便改个字段（比如打字）就会把它重新勾上。
  const { envMode, provider: draftProvider, selectedSkills, selectedPlugins, selectedMcps } = draft;
  const environmentEntries = useMemo(() => buildEnvironmentEntries(
    { envMode, provider: draftProvider, selectedSkills, selectedPlugins, selectedMcps },
    {
      allSkillItems: toResourceItems(authorizedSkills),
      allPluginItems: toResourceItems(authorizedPlugins),
      allMcpItems: toResourceItems(authorizedMcps),
      envResources,
      systemResources,
    },
  ), [
    envMode, draftProvider, selectedSkills, selectedPlugins, selectedMcps,
    authorizedSkills, authorizedPlugins, authorizedMcps, envResources, systemResources,
  ]);

  // 勾选状态：隔离档的展示集就是已添加集，全勾；shared/system 默认全勾（= 全激活，
  // 用户取消的保持不动）。换环境/新增资源时把新出现的补进勾选集合。
  const activeResources = useMemo<Record<ResourceKind, Set<string>>>(() => {
    if (draft.envMode === 'isolated') {
      return {
        skill: new Set(environmentEntries.skill.map((i) => String(i.id))),
        plugin: new Set(environmentEntries.plugin.map((i) => String(i.id))),
        mcp: new Set(environmentEntries.mcp.map((i) => String(i.id))),
      };
    }
    return draft.activeResources;
  }, [draft.envMode, draft.activeResources, environmentEntries]);

  useEffect(() => {
    if (draft.envMode === 'isolated') return;
    setDraft((cur) => {
      const next = {
        skill: new Set(cur.activeResources.skill),
        plugin: new Set(cur.activeResources.plugin),
        mcp: new Set(cur.activeResources.mcp),
      };
      let changed = false;
      for (const kind of ['skill', 'plugin', 'mcp'] as const) {
        const known = new Set(environmentEntries[kind].map((item) => String(item.id)));
        for (const id of known) if (!next[kind].has(id)) { next[kind].add(id); changed = true; }
        for (const id of cur.activeResources[kind]) if (!known.has(id)) { next[kind].delete(id); changed = true; }
      }
      return changed ? { ...cur, activeResources: next } : cur;
    });
  }, [environmentEntries, draft.envMode]);

  const toggleActive = useCallback((kind: ResourceKind, id: string) => {
    setDraft((cur) => {
      const next = new Set(cur.activeResources[kind]);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...cur, activeResources: { ...cur.activeResources, [kind]: next } };
    });
  }, []);

  /** 隔离档添加资源：展开出的条目进任务级 selected*。 */
  const addTaskResources = useCallback((kind: ResourceKind, items: ResourceItem[]) => {
    setDraft((cur) => {
      const key = kind === 'skill' ? 'selectedSkills' : kind === 'plugin' ? 'selectedPlugins' : 'selectedMcps';
      const existing = cur[key] as ConfigEntry[];
      let next = existing;
      for (const item of items) {
        const id = String(item.id);
        if (!next.some((e) => String(e.id) === id)) next = [...next, { ...item, id }];
      }
      return next === existing ? cur : { ...cur, [key]: next };
    });
    flash(`已添加 ${items.length} 项（本次任务）`);
  }, [flash]);

  const removeTaskResource = useCallback((kind: ResourceKind, item: ResourceItem) => {
    setDraft((cur) => {
      const key = kind === 'skill' ? 'selectedSkills' : kind === 'plugin' ? 'selectedPlugins' : 'selectedMcps';
      const id = String(item.id);
      return { ...cur, [key]: (cur[key] as ConfigEntry[]).filter((e) => String(e.id) !== id) };
    });
  }, []);

  // ── 提交 ──────────────────────────────────────────────────────────────────
  const submit = async () => {
    const problem = validateDraft(draft);
    if (problem) { Alert.alert(problem); return; }
    setBusy(true);
    try {
      const task = await createUserTask(buildCreateTaskPayload(draft, {
        environmentEntries,
        mcpPickerResources,
      }));
      // 创建接口只等同步校验/落库，节点在后台 clone/装资源/起 runtime。直接进详情页
      // 看「准备中」步骤，避免「已开始运行」的弹窗误导。
      for (const warning of task.env_install_warnings || []) flash(warning);
      router.replace(`/task/${task.id}`);
    } catch (error) {
      Alert.alert('创建失败', (error as Error)?.message || '请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const openStep2 = () => {
    if (!draft.nodeId) { Alert.alert('请选择执行节点'); return; }
    if (draft.envMode === 'shared' && !draft.envId) { Alert.alert('请选择共用环境'); return; }
    setStep('task');
  };

  const back = () => { if (step === 'task') setStep('env'); else router.back(); };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <LoadingView label="加载任务配置…" />
        <GlassNav title="新建任务" onBack={() => router.back()} />
      </View>
    );
  }

  // ── 通用行 ────────────────────────────────────────────────────────────────
  const row = (label: string, value: string, onPress: () => void, hint?: string) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{ minHeight: 52, borderRadius: 14, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, pressed && { opacity: 0.75 }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: t.tx3, fontSize: 11 }}>{label}</Text>
        <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14, fontWeight: '700', marginTop: 2 }}>{value}</Text>
        {hint ? <Text numberOfLines={2} style={{ color: t.tx3, fontSize: 10.5, marginTop: 2 }}>{hint}</Text> : null}
      </View>
      <Icons.chevron size={16} color={t.tx3} />
    </Pressable>
  );

  const sectionTitle = (text: string) => (
    <Text style={{ color: t.tx, fontSize: 15, fontWeight: '800', marginTop: 6 }}>{text}</Text>
  );

  const modeOptions = nodeModeOptions(selectedNode, draft.provider) || fallbackModeOptions(draft.provider);
  const promptOptions: SearchableOption[] = prompts
    .filter((p) => p.providers.length === 0 || p.providers.includes(draft.provider))
    .map((p) => ({ value: p.id, label: p.name, sub: p.scope === 'system' ? '系统提示词' : '我的提示词' }));

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 68, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 120, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <Text style={{ color: t.tx, fontSize: 21, fontWeight: '800' }}>创建开发任务</Text>
          <Text style={{ color: t.tx3, fontSize: 12.5, lineHeight: 18, marginTop: 4 }}>
            第 {step === 'env' ? 1 : 2}/2 步 · {step === 'env' ? '选择执行环境' : '填写任务内容'}
          </Text>
        </View>

        {step === 'env' ? (
          <>
            {sectionTitle('执行环境')}
            {row(
              '执行节点',
              selectedNode ? (selectedNode.node_name || selectedNode.node_id || '') : '选择执行节点',
              () => setNodePickerOpen(true),
              usableNodeCount === 0 ? '当前没有可用节点，点开看每个节点的原因' : `${usableNodeCount} 个可用`,
            )}
            <Segmented
              label="执行客户端"
              value={draft.provider}
              options={PROVIDERS}
              onChange={(value) => patch({ provider: value })}
              hint="决定用哪个 CLI 跑任务；节点需已装该客户端。"
            />
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.3 }}>环境档位</Text>
              {ENV_TIERS.map((tier) => {
                const disabled = tier.value === 'system' && !anySystemEnvNode;
                const on = draft.envMode === tier.value;
                return (
                  <Pressable
                    key={tier.value}
                    disabled={disabled}
                    onPress={() => patch({ envMode: tier.value, ...(tier.value !== 'shared' ? { envId: '', envName: '' } : {}) })}
                    style={({ pressed }) => [{
                      borderRadius: 14, borderWidth: 1.5, borderColor: on ? t.ac : t.line2,
                      backgroundColor: on ? t.acGhost : t.bg2, padding: 12,
                    }, pressed && { opacity: 0.8 }, disabled && { opacity: 0.45 }]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: t.tx, fontSize: 14, fontWeight: '700' }}>{tier.label}</Text>
                      {on ? <Icons.check size={15} color={t.acTx} sw={2.5} /> : null}
                    </View>
                    <Text style={{ color: t.tx3, fontSize: 11.5, lineHeight: 16, marginTop: 3 }}>
                      {disabled ? '无已开启系统环境的节点' : tier.detail}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {draft.envMode === 'shared' ? (
              <>
                {row(
                  '共用环境',
                  envs.find((e) => e.id === draft.envId)?.name || '选择环境',
                  () => setPicker('env'),
                  '环境归属节点，装好的依赖与登录态跨任务复用。',
                )}
                <Pressable
                  onPress={() => { setNewEnvName(''); setNewEnvOpen(true); }}
                  style={({ pressed }) => [{ height: 42, borderRadius: 13, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5 }, pressed && { opacity: 0.75 }]}
                >
                  <Icons.plus size={14} color={t.acTx} sw={2.4} />
                  <Text style={{ color: t.acTx, fontSize: 13, fontWeight: '700' }}>新建环境</Text>
                </Pressable>
              </>
            ) : null}

            {/* 环境资源：三档语义不同，提示文案随之变化。 */}
            {draft.envMode === 'isolated' ? (
              <EnvResourcePanel
                entries={environmentEntries}
                active={activeResources}
                kind={envResourceKind}
                onKindChange={setEnvResourceKind}
                onToggle={() => undefined}
                selectable={false}
                emptyText="本次任务还没有附加资源，点「添加」从资源中心选。"
                addLabel="添加"
                onAdd={() => setAddKind(envResourceKind)}
                onRemove={(item) => removeTaskResource(envResourceKind, item)}
                hint="隔离档：勾选的资源会装进本次任务的一次性环境，任务结束后不保留。"
              />
            ) : draft.envMode === 'shared' && !draft.envId ? (
              <Text style={{ color: t.tx3, fontSize: 12, textAlign: 'center', paddingVertical: 16 }}>
                选择一个共用环境后展示其资源配置。
              </Text>
            ) : draft.envMode === 'system' && !systemEnvAllowed ? (
              <Text style={{ color: t.tx3, fontSize: 12, textAlign: 'center', paddingVertical: 16 }}>
                系统内置档用节点操作者的本机 HOME，请换一个已开启该模式的节点。
              </Text>
            ) : (
              <EnvResourcePanel
                entries={environmentEntries}
                active={activeResources}
                kind={envResourceKind}
                onKindChange={setEnvResourceKind}
                onToggle={(id) => toggleActive(envResourceKind, id)}
                selectable
                emptyText={draft.envMode === 'shared' ? '该环境还没有配置资源。' : '该节点本机还没有可用的资源。'}
                hint={draft.envMode === 'shared'
                  ? '取消勾选 = 本次任务不启用它（环境里的文件不动，其他任务不受影响）。'
                  : '取消勾选 = 本次任务不启用它（不写操作者的本机配置）。'}
              />
            )}
          </>
        ) : (
          <>
            {/* 环境摘要：第一步定了就不再改。 */}
            <View style={{ borderRadius: 14, backgroundColor: t.bg3, padding: 12, gap: 5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: t.tx3, fontSize: 11 }}>环境</Text>
                <Text style={{ color: t.tx, fontSize: 12.5, fontWeight: '700' }}>
                  {ENV_TIERS.find((x) => x.value === draft.envMode)?.label}
                  {draft.envMode === 'shared' && draft.envName ? ` · ${draft.envName}` : ''}
                </Text>
              </View>
              <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11 }}>
                {(selectedNode?.node_name || selectedNode?.node_id || '未选节点')} · {PROVIDERS.find((p) => p.value === draft.provider)?.label}
              </Text>
            </View>

            {sectionTitle('任务')}
            <Segmented
              label="任务意图"
              value={draft.intent}
              options={[{ value: 'analysis' as const, label: '分析' }, { value: 'fix' as const, label: '实现/修复' }]}
              onChange={(value) => patch({ intent: value })}
              hint={draft.intent === 'analysis' ? '分析问题、输出结论或方案' : '修改代码并完成实现'}
            />
            {row('权限方式', modeOptions.find((o) => o.value === draft.mode)?.label || '客户端默认', () => setPicker('mode'),
              nodeModeOptions(selectedNode, draft.provider) ? '来自该节点上报的权限方式。' : '节点未上报，以下为客户端默认选项。')}
            {row('父 API Key', parentKeys.find((k) => String(k.id) === draft.parentKeyId)?.name || '选择父 API Key', () => setPicker('key'),
              '任务会从父 Key 派生一把独立子 Key，额度与过期单独计数。')}

            {selectedProject?.git_identity_id ? (
              <>
                <Segmented
                  label="分支策略"
                  value={draft.branchMode}
                  options={[
                    { value: 'default' as const, label: '跟随默认分支' },
                    { value: 'existing' as const, label: '指定已有分支' },
                    { value: 'auto' as const, label: '自动新建分支' },
                  ]}
                  onChange={(value) => patch({ branchMode: value, ...(value !== 'existing' ? { branch: '' } : {}) })}
                  hint={draft.branchMode === 'auto' ? '首次初始化时从默认分支创建 task/<任务 id>。' : undefined}
                />
                {draft.branchMode === 'existing' ? (
                  branches.length ? row('分支', draft.branch || '选择分支', () => setPicker('branch')) : (
                    <LabeledInput label="分支名" value={draft.branch} onChangeText={(v) => patch({ branch: v })} placeholder="例如 main" hint="未能拉到分支列表，请手动填写。" />
                  )
                ) : null}
              </>
            ) : null}

            {draft.provider === 'codex' ? (
              <LabeledInput
                label="Codex installation_id"
                value={draft.expectedClientId}
                onChangeText={(v) => patch({ expectedClientId: v })}
                placeholder="来自 Codex 客户端 metadata"
                hint="用于把首个请求绑定到本任务。"
              />
            ) : null}

            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.3 }}>任务内容</Text>
              <View style={{ borderRadius: 14, backgroundColor: t.bg2, padding: 13 }}>
                <TextInput
                  value={draft.content}
                  onChangeText={(v) => patch({ content: v })}
                  placeholder="可为空，为空则创建后等待你发第一条消息"
                  placeholderTextColor={t.tx3}
                  multiline
                  style={{ minHeight: 120, color: t.tx, fontSize: 15, lineHeight: 21, textAlignVertical: 'top' }}
                />
              </View>
            </View>

            {/* 工具（MCP）：所有档位都下发。 */}
            <View style={{ borderRadius: 16, backgroundColor: t.bg2, padding: 13, ...t.shCard }}>
              <McpGrantPicker
                grants={draft.mcpGrantDraft}
                onChange={(grants) => patch({ mcpGrantDraft: grants })}
                resources={mcpPickerResources}
                paramKinds={mcpParamKinds}
              />
            </View>

            {row('项目提示词', prompts.find((p) => p.id === draft.promptId)?.name || '不使用', () => setPicker('prompt'),
              '提示词内容会拼在任务正文前面，仅创建时生效。')}
            {row('可用模型', draft.selectedModels.length ? `已选 ${draft.selectedModels.length} 个` : '不限制（继承父 Key）', () => setPicker('models'),
              '不选 = 该 Key 允许的全部模型都可用。')}

            {/* API Key 高级项 */}
            <View style={{ borderRadius: 14, backgroundColor: t.bg2, padding: 13 }}>
              <Collapsible title="高级参数 · API Key 限额">
                <View style={{ gap: 10, paddingTop: 8 }}>
                  <Segmented
                    label="可用编辑器"
                    value={draft.editorMode}
                    options={[
                      { value: 'current' as const, label: '仅当前客户端' },
                      { value: 'specified' as const, label: '指定客户端' },
                      { value: 'all' as const, label: '继承父级' },
                    ]}
                    onChange={(value) => patch({ editorMode: value })}
                  />
                  {draft.editorMode === 'specified' ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                      {PROVIDERS.map((item) => {
                        const on = draft.selectedEditors.includes(item.value);
                        return (
                          <Pressable
                            key={item.value}
                            onPress={() => patch({
                              selectedEditors: on
                                ? draft.selectedEditors.filter((v) => v !== item.value)
                                : [...draft.selectedEditors, item.value],
                            })}
                            style={({ pressed }) => [{ paddingHorizontal: 12, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.ac : t.bg3 }, pressed && { opacity: 0.75 }]}
                          >
                            <Text style={{ fontSize: 11.5, fontWeight: '700', color: on ? t.acInk : t.tx2 }}>{item.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                  {row('选择策略', SELECTION_STRATEGIES.find((s) => s.value === draft.selectionStrategy)?.label || '智能选择', () => setPicker('strategy'))}
                  <LabeledInput label="最大请求次数" value={draft.maxRequests} onChangeText={(v) => patch({ maxRequests: v })} keyboardType="numeric" placeholder="不限制" />
                  <LabeledInput label="最大总 Token" value={draft.maxTotalTokens} onChangeText={(v) => patch({ maxTotalTokens: v })} keyboardType="numeric" placeholder="不限制" />
                  <LabeledInput label="每分钟请求数" value={draft.rateLimit.requests_per_minute || ''} onChangeText={(v) => patch({ rateLimit: { ...draft.rateLimit, requests_per_minute: v } })} keyboardType="numeric" placeholder="不限制" />
                  <LabeledInput label="每日 Token 数" value={draft.rateLimit.tokens_per_day || ''} onChangeText={(v) => patch({ rateLimit: { ...draft.rateLimit, tokens_per_day: v } })} keyboardType="numeric" placeholder="不限制" />
                  <LabeledInput label="过期时间" value={draft.expiresAt} onChangeText={(v) => patch({ expiresAt: v })} placeholder="例如 2026-12-31T18:00:00" hint="无法解析时不设置过期。" />
                </View>
              </Collapsible>
            </View>
          </>
        )}
      </ScrollView>

      {/* 底部操作条 */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.pad, paddingTop: 10, paddingBottom: insets.bottom + 12, backgroundColor: t.bg, flexDirection: 'row', gap: 10 }}>
        {step === 'task' ? (
          <Pressable
            onPress={() => setStep('env')}
            style={({ pressed }) => [{ width: 104, height: 52, borderRadius: 16, borderWidth: 1, borderColor: t.line2, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.75 }]}
          >
            <Text style={{ color: t.tx2, fontSize: 15, fontWeight: '700' }}>返回重选</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <PrimaryButton
            block
            label={step === 'env' ? '下一步' : busy ? '创建中…' : '创建并运行'}
            icon={step === 'env' ? undefined : busy ? undefined : 'plus'}
            disabled={busy || !draft.nodeId || (draft.envMode === 'shared' && !draft.envId)}
            onPress={() => { if (step === 'env') openStep2(); else void submit(); }}
          />
        </View>
      </View>

      <GlassNav title="新建任务" onBack={back} />
      {toast ? <Toast text={toast} bottom={insets.bottom + 116} /> : null}

      {/* ── 选择器 ─────────────────────────────────────────────────────── */}
      <NodePickerSheet
        visible={nodePickerOpen}
        nodes={nodes}
        value={draft.nodeId}
        provider={draft.provider}
        requireSystemEnv={draft.envMode === 'system'}
        onPick={(id) => patch({ nodeId: id })}
        onClose={() => setNodePickerOpen(false)}
      />

      <SearchableSelect
        visible={picker === 'env'}
        title="选择共用环境"
        options={envs.map((env) => ({ value: env.id, label: env.name, sub: env.needs_sync ? '待同步' : undefined }))}
        selected={draft.envId ? [draft.envId] : []}
        onChange={(values) => {
          const id = values[0] || '';
          patch({ envId: id, envName: envs.find((e) => e.id === id)?.name || '' });
        }}
        onClose={() => setPicker(null)}
        emptyText="该节点还没有共用环境，先新建一个"
      />
      <SearchableSelect
        visible={picker === 'key'}
        title="选择父 API Key"
        options={parentKeys.map((key) => ({ value: String(key.id), label: key.name || key.key_masked, sub: `${key.source} · ${key.key_masked}` }))}
        selected={draft.parentKeyId ? [draft.parentKeyId] : []}
        onChange={(values) => patch({ parentKeyId: values[0] || '' })}
        onClose={() => setPicker(null)}
      />
      <SearchableSelect
        visible={picker === 'models'}
        title="选择任务可用模型"
        options={models.map((model) => ({ value: model.value, label: model.label, sub: model.value }))}
        selected={draft.selectedModels}
        onChange={(values) => patch({ selectedModels: values })}
        onClose={() => setPicker(null)}
        multiple
        emptyText="该 Key 没有可用模型"
      />
      <SearchableSelect
        visible={picker === 'prompt'}
        title="选择项目提示词"
        options={[{ value: '', label: '不使用' }, ...promptOptions]}
        selected={[draft.promptId]}
        onChange={(values) => patch({ promptId: values[0] || '' })}
        onClose={() => setPicker(null)}
        emptyText="没有适用于该客户端的提示词"
      />
      <SearchableSelect
        visible={picker === 'branch'}
        title="选择分支"
        options={branches.map((name) => ({ value: name, label: name }))}
        selected={draft.branch ? [draft.branch] : []}
        onChange={(values) => patch({ branch: values[0] || '' })}
        onClose={() => setPicker(null)}
      />
      <SearchableSelect
        visible={picker === 'mode'}
        title="选择权限方式"
        options={modeOptions}
        selected={[draft.mode]}
        onChange={(values) => patch({ mode: values[0] || '' })}
        onClose={() => setPicker(null)}
      />
      <SearchableSelect
        visible={picker === 'strategy'}
        title="选择策略"
        options={SELECTION_STRATEGIES}
        selected={[draft.selectionStrategy]}
        onChange={(values) => patch({ selectionStrategy: values[0] || DEFAULT_SELECTION_STRATEGY })}
        onClose={() => setPicker(null)}
      />

      {addKind ? (
        <ResourceAddSheet
          visible
          title={`添加${addKind === 'skill' ? '技能' : addKind === 'plugin' ? '插件' : ' MCP'}`}
          rows={addKind === 'skill' ? authorizedSkills : addKind === 'plugin' ? authorizedPlugins : authorizedMcps}
          onPick={(items) => addTaskResources(addKind, items)}
          onClose={() => setAddKind(null)}
        />
      ) : null}

      {/* 新建共用环境 */}
      {newEnvOpen ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center', padding: spacing.pad, backgroundColor: 'rgba(0,0,0,0.42)' }}>
          <View style={{ borderRadius: 18, backgroundColor: t.bg2, padding: 18, gap: 12 }}>
            <Text style={{ color: t.tx, fontSize: 17, fontWeight: '800' }}>新建共用环境</Text>
            <LabeledInput label="环境名称" value={newEnvName} onChangeText={setNewEnvName} placeholder="例如 前端环境" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => setNewEnvOpen(false)}
                style={{ flex: 1, height: 46, borderRadius: 14, borderWidth: 1, borderColor: t.line2, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: t.tx2, fontWeight: '700' }}>取消</Text>
              </Pressable>
              <Pressable
                disabled={!newEnvName.trim()}
                onPress={() => {
                  const name = newEnvName.trim();
                  if (!name || !draft.nodeId) return;
                  setNewEnvOpen(false);
                  void createEnvironment({ node_id: draft.nodeId, name })
                    .then((env) => {
                      setEnvs((cur) => [...cur, env]);
                      patch({ envId: env.id, envName: env.name, envMode: 'shared' });
                      flash(`已创建环境「${env.name}」`);
                    })
                    .catch((error) => Alert.alert('创建失败', (error as Error)?.message || '请稍后重试'));
                }}
                style={({ pressed }) => [{ flex: 1, height: 46, borderRadius: 14, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }, (pressed || !newEnvName.trim()) && { opacity: 0.5 }]}
              >
                <Text style={{ color: t.acInk, fontWeight: '800' }}>创建</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** 新表池引用行 → 选择器用的引用形状（market_id 打 ``v2:`` 前缀作标记）。 */
function v2ToReferenceLike(row: ResourceReferenceV2): ReferenceLike {
  const res = row.resource;
  const isCollection = (res.resource_type === 'skills' || res.resource_type === 'plugin')
    && Array.isArray(res.resource_data?.entries) && res.resource_data.entries.length > 0;
  return {
    id: String(row.id),
    name: res.name,
    display_name: row.display_name || res.display_name || res.name,
    version: row.version || res.version,
    description: row.description || res.description,
    market_id: `v2:${row.id}`,
    manifest: isCollection
      ? { type: 'plugin', entries: res.resource_data.entries }
      : {},
  };
}
