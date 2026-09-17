/**
 * 创建任务的可提交状态与纯函数（对齐 Web ``canonical-create-task-dialog.tsx`` 的
 * ``submit()`` 与它抽出的纯函数）。
 *
 * 这里刻意**不依赖 React**：三档环境语义（isolated 走任务级安装 / shared、system
 * 走环境激活子集）、资源绑定归并、MCP grants 合成、子 Key 收窄参数，全是手机端最
 * 容易做错的地方，抽成纯函数才能在没有渲染成本的情况下逐个锁死。
 *
 * 服务端契约见 ``user_platform/routes_task.py`` 的 ``CreateTaskReq`` 与
 * ``user_platform/task_service.py`` 的 ``create_task`` / ``_build_session``。
 */
import type { TaskMcpBinding, TaskResourceBinding } from '@/api/task';

export type EnvTier = 'isolated' | 'shared' | 'system';
export type TaskIntent = 'analysis' | 'fix';
export type IssueTaskType = 'requirement' | 'bug';
/** 可用编辑器单选：current=只允许当前客户端；specified=多选；all=继承父级。 */
export type EditorScopeMode = 'current' | 'all' | 'specified';

/** 与 Web ``resolveTaskIntent`` 逐字一致：四种组合映射到既有 task_role/sub_type。 */
export interface TaskIntentMapping {
  taskType: 'develop' | 'design';
  taskRole: 'design' | 'diagnose' | 'develop' | 'fix';
  subType: 'generate_design' | 'diagnose_bug' | 'execute_task' | 'fix_bug';
}

/**
 * 把界面上的「分析 / 修复」意图映射到后端既有的 task_role / sub_type 语义。
 * 不新增后端枚举值：四种组合与 ``project_service._ASSIGN_PLANS`` 完全一致。
 */
export function resolveTaskIntent(
  intent: TaskIntent,
  issueType?: IssueTaskType,
): TaskIntentMapping {
  if (intent === 'analysis') {
    return issueType === 'bug'
      ? { taskType: 'develop', taskRole: 'diagnose', subType: 'diagnose_bug' }
      : { taskType: 'design', taskRole: 'design', subType: 'generate_design' };
  }
  return issueType === 'bug'
    ? { taskType: 'develop', taskRole: 'fix', subType: 'fix_bug' }
    : { taskType: 'develop', taskRole: 'develop', subType: 'execute_task' };
}

/** 勾选列表里的一条资源（对齐 Web ``ConfigEntry``）。 */
export interface ConfigEntry {
  id?: string;
  name?: string;
  display_name?: string;
  description?: string;
  /** 旧表引用 id（走 ``{resource_id}`` 绑定）。 */
  resource_id?: string;
  /** 新表（统一资源池）引用 id（走 ``{reference_id}`` 绑定）。 */
  reference_id?: string;
  /** 集合容器的子项名（与 reference_id/resource_id 同组，归并成 entries）。 */
  resource_entry?: string;
  __badge?: string;
}

/** 展示用的资源卡片条目（比 ConfigEntry 多来源标记）。 */
export interface ResourceItem extends ConfigEntry {
  __source?: string;
}

/**
 * 把平台技能/插件选择归并为服务端绑定（对齐 Web ``resourceBindings``）：
 * - 新表引用子项 → ``{reference_id, entries[]}``，普通新引用 → ``{reference_id}``
 * - 旧表集合子项 → ``{resource_id, entries[]}``，旧普通项 → ``{resource_id}``
 *
 * 同一容器下的子技能必须归并到**一条**绑定里（entries 累积），否则服务端会把
 * 同一个集合展开多次。
 */
export function resourceBindings(entries: ConfigEntry[]): TaskResourceBinding[] {
  const grouped = new Map<string, { resource_id?: string; reference_id?: string; entries?: string[] }>();
  for (const entry of entries) {
    const referenceId = String(entry.reference_id || '').trim();
    const entryName = String(entry.resource_entry || '').trim();
    const legacyId = String(entry.resource_id || entry.id || entry.name || '').trim();
    const key = referenceId ? `v2:${referenceId}` : legacyId;
    if (!key) continue;
    const current = grouped.get(key);
    if (current) {
      if (entryName) current.entries = [...(current.entries || []), entryName];
      continue;
    }
    grouped.set(
      key,
      referenceId
        ? { reference_id: referenceId, ...(entryName ? { entries: [entryName] } : {}) }
        : { resource_id: legacyId, ...(entryName ? { entries: [entryName] } : {}) },
    );
  }
  return [...grouped.values()];
}

/** 从选择器条目抽回 id 列表（``service:`` 前缀保留，交给 {@link mcpBindings} 分流）。 */
function selectedIds(entries: ConfigEntry[]): string[] {
  return entries
    .map((entry) => String(entry.resource_id || entry.id || entry.name || ''))
    .filter(Boolean);
}

/**
 * 把已选 MCP 条目映射成服务端绑定（对齐 Web ``mcpBindings``）：
 * ``service:<id>`` → ``{service_id}``（内置服务/实例），其余 → ``{resource_id}``
 * （团队引用，服务端按可见性校验后转成 service_id）。
 */
export function mcpBindings(entries: ConfigEntry[]): TaskMcpBinding[] {
  const out: TaskMcpBinding[] = [];
  for (const id of selectedIds(entries)) {
    if (id.startsWith('service:')) {
      const serviceId = Number(id.slice('service:'.length));
      if (Number.isFinite(serviceId) && serviceId > 0) out.push({ service_id: serviceId });
      continue;
    }
    out.push({ resource_id: id });
  }
  return out;
}

/** {@link buildEnvironmentEntries} 需要的最小草稿切片（只读这几个字段）。 */
export interface EnvEntriesInput {
  envMode: EnvTier;
  provider: string;
  selectedSkills: ConfigEntry[];
  selectedPlugins: ConfigEntry[];
  selectedMcps: ConfigEntry[];
}

/**
 * 环境资源卡片（按档位取自不同真相源，对齐 Web ``environmentEntries`` useMemo）。
 *
 * - ``isolated``：任务级已选集合（初始为空，从资源中心添加后才有）。
 * - ``shared``：环境详情里的配置资源，带 state 徽标。
 * - ``system``：节点本机清单，**按 readers 过滤**——只列所选客户端会加载的资源，
 *   否则会把别的编辑器专属资源也摆出来，跟用户在节点详情里看到的对不上。
 *   readers 为空（旧节点上报不了归属）时不过滤，宁可多显示。
 */
export function buildEnvironmentEntries(
  draft: EnvEntriesInput,
  sources: {
    /** 隔离档的授权候选（旧表 effective + 新表 v2 映射行）。 */
    allSkillItems: ResourceItem[];
    allPluginItems: ResourceItem[];
    allMcpItems: ResourceItem[];
    envResources: EnvResourceLike[] | null;
    systemResources: Record<string, SystemEntryLike[]> | null;
  },
): Record<'skill' | 'plugin' | 'mcp', ResourceItem[]> {
  const out: Record<'skill' | 'plugin' | 'mcp', ResourceItem[]> = { skill: [], plugin: [], mcp: [] };

  if (draft.envMode === 'isolated') {
    // 只显示已添加的任务级资源；清单含旧表授权行 + 新表引用映射行，条目 id 与添加时同源。
    const skillIds = new Set(draft.selectedSkills.map((e) => String(e.id || e.resource_id || '')));
    const pluginIds = new Set(draft.selectedPlugins.map((e) => String(e.id || e.resource_id || '')));
    const mcpIds = new Set(draft.selectedMcps.map((e) => String(e.id || e.resource_id || '')));
    out.skill = sources.allSkillItems.filter((item) => skillIds.has(String(item.id)));
    out.plugin = sources.allPluginItems.filter((item) => pluginIds.has(String(item.id)));
    out.mcp = sources.allMcpItems.filter((item) => mcpIds.has(String(item.id)));
    return out;
  }

  if (draft.envMode === 'shared') {
    for (const entry of sources.envResources || []) {
      const badge = entry.state === 'installed' ? '环境自带'
        : entry.state === 'pending' ? '环境待同步'
          : '环境配置';
      out[entry.kind]?.push({
        id: entry.resource_id,
        name: entry.name,
        display_name: entry.name,
        description: entry.version ? `v${entry.version}` : undefined,
        __badge: badge,
      });
    }
    return out;
  }

  // system：按所选客户端的 readers 过滤。
  for (const [kind, rows] of Object.entries(sources.systemResources || {})) {
    if (kind !== 'skill' && kind !== 'plugin' && kind !== 'mcp') continue;
    for (const entry of rows || []) {
      if (entry.readers.length > 0 && !entry.readers.includes(draft.provider)) continue;
      out[kind].push({
        id: `${kind}:${entry.name}`,
        name: entry.name,
        display_name: entry.name,
        description: entry.version ? `v${entry.version}` : entry.description || undefined,
        __badge: entry.platform_managed ? '平台已装' : '本机已有',
      });
    }
  }
  return out;
}

/** {@link buildEnvironmentEntries} 需要的环境资源形状（避免循环依赖 api 层）。 */
export interface EnvResourceLike {
  kind: 'skill' | 'mcp' | 'plugin';
  resource_id: string;
  name: string;
  version: string;
  state?: 'installed' | 'pending' | 'config';
}

/** {@link buildEnvironmentEntries} 需要的系统清单条目形状。 */
export interface SystemEntryLike {
  name: string;
  version: string;
  description: string;
  readers: string[];
  platform_managed: boolean;
}

/** 资源引用行（旧表 / 新表映射行共用；见 api/mcpCenter 的 ResourceReference*）。 */
export interface ReferenceLike {
  id: string;
  name: string;
  display_name?: string;
  version?: string;
  description?: string;
  /** 新表映射行打 ``v2:`` 前缀，据此产出 ``{reference_id}`` 绑定。 */
  market_id?: string;
  manifest?: {
    type?: string;
    entries?: { name?: string; path?: string; description?: string; editors?: string[] }[];
  };
}

/**
 * 集合容器的子技能名清单；非容器返回 null。
 *
 * 技能集（``skills``）与插件容器（``plugin``）都按 entries 展开子技能勾选。
 */
export function collectionEntryNames(row: ReferenceLike): string[] | null {
  const manifest = row.manifest;
  if ((manifest?.type !== 'skills' && manifest?.type !== 'plugin')
    || !Array.isArray(manifest.entries) || manifest.entries.length === 0) return null;
  const names = manifest.entries.map((e) => String(e.name || '').trim()).filter(Boolean);
  return names.length ? names : null;
}

/**
 * 引用行 → 选择器/卡片条目（对齐 Web ``toResourceItems``）。
 *
 * 集合容器展开成 N 个子技能子项：新表引用用 ``v2:<refId>::<entryName>``（带
 * ``reference_id``），旧表用 ``<rowId>::<entryName>``（带 ``resource_id``）。
 * 提交时 {@link resourceBindings} 按容器 id 归并回一条带 entries 的绑定。
 */
export function toResourceItems(rows: ReferenceLike[]): ResourceItem[] {
  const items: ResourceItem[] = [];
  for (const row of rows) {
    const isV2 = String(row.market_id || '').startsWith('v2:');
    const entries = Array.isArray(row.manifest?.entries) ? row.manifest!.entries! : [];
    const isContainer = (row.manifest?.type === 'skills' || row.manifest?.type === 'plugin')
      && entries.length > 0;

    if (isContainer) {
      for (const entry of entries) {
        const entryName = String(entry.name || '').trim();
        if (!entryName) continue;
        items.push({
          id: isV2 ? `v2:${row.id}::${entryName}` : `${row.id}::${entryName}`,
          name: entryName,
          display_name: `${row.name}/${entryName}`,
          description: entry.description || undefined,
          ...(isV2 ? { reference_id: row.id } : { resource_id: row.id }),
          resource_entry: entryName,
          __badge: `插件 · ${row.name}`,
        });
      }
      continue;
    }

    items.push(isV2
      ? {
        id: `v2:${row.id}`,
        name: row.name,
        display_name: row.display_name || row.name,
        description: row.description,
        reference_id: row.id,
      }
      : {
        id: row.id,
        name: row.name,
        display_name: row.display_name || row.name,
        description: row.version ? `v${row.version}` : undefined,
        resource_id: row.id,
      });
  }
  return items;
}

/** 授权草稿里的一行（对齐 Web ``PickerGrant``）。 */
export interface PickerGrant {
  grant_key: string;
  grant_value: string;
}/** 可授权的 MCP 服务或内置实例（对齐 Web ``PickerResource``）。 */
export interface PickerResource {
  resource_kind: string;
  resource_id: number;
  resource_type: string;
  name: string;
  description?: string;
  tool_count?: number;
  kind?: string;
  stdio?: boolean;
  /** 工具类服务的实例参数名（cdp_client_id 等）；非空 = 需再勾实例。 */
  required_param?: string;
  source?: string;
  children?: { child_kind: string; child_id: number; name: string }[];
}

/**
 * 添加式选择器的授权草稿 → mcp_config 负载（对齐 Web ``grantDraftToPayload``）。
 *
 * service 行 → ``{service_id}``；工具类的 param 行按 grant_key 归属到对应服务条目
 * → ``{service_id, param_key, param_values}``（实例收窄，空 = 默认全量）。param 行
 * 找不到归属服务时跳过（孤儿行）。
 */
export function grantDraftToPayload(
  draft: PickerGrant[],
  resources: PickerResource[],
): Extract<TaskMcpBinding, { service_id: number }>[] {
  const serviceById = new Map<string, PickerResource>();
  for (const r of resources) {
    if (r.resource_kind === 'service') serviceById.set(String(r.resource_id), r);
  }
  // param_key → 绑定该 param 的服务条目（一 param_key 只属一个内置服务）。
  const paramKeyToService = new Map<string, PickerResource>();
  for (const svc of serviceById.values()) {
    const key = (svc.required_param || '').trim();
    if (key) paramKeyToService.set(key, svc);
  }
  type ServiceEntry = Extract<TaskMcpBinding, { service_id: number }>;
  const out: ServiceEntry[] = [];
  const entryByServiceId = new Map<string, ServiceEntry>();
  for (const g of draft) {
    if (g.grant_key === 'service') {
      const entry: ServiceEntry = { service_id: Number(g.grant_value) };
      entryByServiceId.set(g.grant_value, entry);
      out.push(entry);
      continue;
    }
    const svc = paramKeyToService.get(g.grant_key);
    if (!svc) continue;
    const entry = entryByServiceId.get(String(svc.resource_id));
    if (!entry) continue;
    const values = entry.param_values || [];
    values.push(g.grant_value);
    entry.param_key = g.grant_key;
    entry.param_values = values;
  }
  return out;
}

/** 速率限制字段定义（key=写入 rate_limit 的字段名）。与 Web api-key-fields 同源。 */
const RATE_LIMIT_FIELDS = [
  'requests_per_minute',
  'tokens_per_minute',
  'requests_per_5h',
  'tokens_per_day',
  'requests_per_day',
  'tokens_per_week',
  'requests_per_week',
  'concurrent_requests',
  'max_ips',
] as const;

export type RateLimitState = Partial<Record<(typeof RATE_LIMIT_FIELDS)[number] | 'ip_window_seconds', string>>;

/** 速率限制草稿 → 负载（对齐 Web ``buildRateLimitPayload``）：>0 才写。 */
export function buildRateLimitPayload(state: RateLimitState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of RATE_LIMIT_FIELDS) {
    const raw = Number(state[key]);
    if (Number.isFinite(raw) && raw > 0) out[key] = raw;
  }
  // IP 刷新区间只在 max_ips>0 时才有意义。
  const ips = Number(state.max_ips);
  const window = Number(state.ip_window_seconds);
  if (Number.isFinite(ips) && ips > 0 && Number.isFinite(window) && window > 0) {
    out.ip_window_seconds = window;
  }
  return out;
}

/** 创建任务草稿：两步向导共用的全部可提交状态。 */
export interface CreateTaskDraft {
  // ── 第一步：环境 ──────────────────────────────────────────────────────────
  nodeId: string;
  provider: string;
  envMode: EnvTier;
  envId: string;
  envName: string;
  /** 环境档 = shared/system 时，该节点是否开启了系统环境（system 档提交前校验）。 */
  systemEnvAllowed: boolean;
  // 隔离档：任务级资源选择（装进本次 session）。
  selectedSkills: ConfigEntry[];
  selectedPlugins: ConfigEntry[];
  selectedMcps: ConfigEntry[];
  /** 所有档位都下发：内置服务 + 实例绑定（第一步「工具」选择器）。 */
  mcpGrantDraft: PickerGrant[];
  // shared/system 档：环境自带资源的激活子集（按环境卡片 id）。
  activeResources: Record<'skill' | 'plugin' | 'mcp', Set<string>>;

  // ── 第二步：任务 ──────────────────────────────────────────────────────────
  content: string;
  intent: TaskIntent;
  mode: string;
  parentKeyId: string;
  /** 可用模型。**空 = 不限制**（服务端同源写子 Key model_whitelist）。 */
  selectedModels: string[];
  editorMode: EditorScopeMode;
  selectedEditors: string[];
  rateLimit: RateLimitState;
  maxRequests: string;
  maxTotalTokens: string;
  expiresAt: string;
  selectionStrategy: string;
  promptId: string;
  /** Codex 专用：来自客户端 metadata 的 installation_id。 */
  expectedClientId: string;

  // ── 项目 / 仓库 ───────────────────────────────────────────────────────────
  projectId: string;
  gitIdentityId: string;
  repoUrl: string;
  branchMode: 'default' | 'existing' | 'auto';
  branch: string;

  // ── 路由参数 ──────────────────────────────────────────────────────────────
  issueId: string;
  issueType?: IssueTaskType;
}

/** 选择策略默认值（省略=服务端默认 intelligent，不必下发）。 */
export const DEFAULT_SELECTION_STRATEGY = 'intelligent';
export const DEFAULT_EDITOR_MODE: EditorScopeMode = 'current';

/** 新建草稿：默认值与 Web 弹框一致（provider=claude、intent=fix、模型不选）。 */
export function defaultDraft(overrides: Partial<CreateTaskDraft> = {}): CreateTaskDraft {
  return {
    nodeId: '',
    provider: 'claude',
    envMode: 'isolated',
    envId: '',
    envName: '',
    systemEnvAllowed: false,
    selectedSkills: [],
    selectedPlugins: [],
    selectedMcps: [],
    mcpGrantDraft: [],
    activeResources: { skill: new Set(), plugin: new Set(), mcp: new Set() },
    content: '',
    intent: overrides.issueId ? 'analysis' : 'fix',
    mode: '',
    parentKeyId: '',
    selectedModels: [],
    editorMode: DEFAULT_EDITOR_MODE,
    selectedEditors: [],
    rateLimit: {},
    maxRequests: '',
    maxTotalTokens: '',
    expiresAt: '',
    selectionStrategy: DEFAULT_SELECTION_STRATEGY,
    promptId: '',
    expectedClientId: '',
    projectId: '',
    gitIdentityId: '',
    repoUrl: '',
    branchMode: 'default',
    branch: '',
    issueId: '',
    ...overrides,
  };
}

/** {@link buildCreateTaskPayload} 需要的、不属于草稿的派生输入。 */
export interface BuildPayloadContext {
  /** 环境资源卡片（按档位来自环境详情 / 系统清单 / 任务级选择）。 */
  environmentEntries: Record<'skill' | 'plugin' | 'mcp', ResourceItem[]>;
  /** 第一步「工具」选择器的候选（把 param 行归属回服务需要它）。 */
  mcpPickerResources: PickerResource[];
}

/** 提交前校验。返回 null 表示可提交，否则是给用户看的错误文案。 */
export function validateDraft(draft: CreateTaskDraft): string | null {
  if (!draft.nodeId) return '请选择执行节点';
  if (!draft.parentKeyId) return '请选择父 API Key';
  if (draft.envMode === 'shared' && !draft.envId) return '请选择共用环境';
  if (draft.envMode === 'system' && !draft.systemEnvAllowed) {
    return '该节点未开启系统环境，请换一个节点或改用其他环境';
  }
  // Codex 需要预注册客户端实例 + 首条内容，否则网关无法把首个请求绑定到本任务。
  if (draft.provider === 'codex' && !draft.expectedClientId.trim()) return 'Codex 任务需要 installation_id';
  if (draft.provider === 'codex' && !draft.content.trim()) return 'Codex 任务需要填写首条内容';
  if (draft.branchMode === 'existing' && !draft.branch.trim()) return '选择已有分支时必须填写分支名';
  return null;
}

/**
 * 草稿 → 创建任务负载（对齐 Web ``submit()``）。**内容可为空**：为空则建一个等待
 * 用户输入的任务，第一条消息在详情页发。
 *
 * 三档环境的分流是本函数的核心，务必对照测试看：
 * - ``isolated``（默认）：勾选资源走任务级安装 → ``extra.skill_ids``/``plugin_ids``，
 *   且**不发** ``env_mode``。
 * - ``shared``：资源已在环境里，只发**激活子集** ``active_skills``/``active_plugins``；
 *   环境里勾选的 MCP 以 ``{resource_id}`` 引用下发。
 * - ``system``：同 shared 的激活子集；MCP 只下发工具选择器（平台不写操作者本机
 *   配置，本机已有的自动生效）。
 */
export function buildCreateTaskPayload(draft: CreateTaskDraft, ctx: BuildPayloadContext) {
  const text = draft.content.trim();
  const mapping = resolveTaskIntent(draft.intent, draft.issueType);
  const isIsolated = draft.envMode === 'isolated';

  // 隔离档：勾选的资源走任务级安装（装进本次 session）。
  const skillIds = isIsolated ? resourceBindings(draft.selectedSkills) : [];
  const pluginIds = isIsolated ? resourceBindings(draft.selectedPlugins) : [];

  // shared/system 档：任务只发「本次激活子集」。全勾 = 不发（节点默认全激活），
  // 部分勾 = 只发勾选的名字（与节点侧 activeSkillNames 的枚举名一致）。
  // 注意空列表**不可表达**「一个都不用」，故全勾必须省略而非发全量。
  const activeNames = (kind: 'skill' | 'plugin'): string[] | undefined => {
    if (isIsolated) return undefined;
    const all = ctx.environmentEntries[kind];
    if (all.length === 0) return undefined;
    const kept = all
      .filter((item) => draft.activeResources[kind].has(String(item.id)))
      .map((item) => String(item.name));
    return kept.length < all.length ? kept : undefined;
  };
  const activeSkills = activeNames('skill');
  const activePlugins = activeNames('plugin');

  // 工具（内置服务 + 实例绑定）在所有档位下发；隔离档还合并任务级 MCP 引用，
  // shared 档合并环境里勾选的 MCP 引用。
  const toolEntries = grantDraftToPayload(draft.mcpGrantDraft, ctx.mcpPickerResources);
  const isolatedMcpRefs = isIsolated ? mcpBindings(draft.selectedMcps) : [];
  const sharedMcpRefs = draft.envMode === 'shared'
    ? ctx.environmentEntries.mcp
      .filter((item) => draft.activeResources.mcp.has(String(item.id)))
      .map((item) => ({ resource_id: String(item.id) }))
    : [];
  const mcpEntries = [...toolEntries, ...isolatedMcpRefs, ...sharedMcpRefs];

  // 可用编辑器单选 → editor_provider_whitelist：current=只允许当前客户端；
  // specified=多选；all=不发（继承父级）。
  const editorWhitelist: string[] | undefined =
    draft.editorMode === 'current' ? [draft.provider]
      : draft.editorMode === 'specified' ? draft.selectedEditors
        : undefined;
  const rateLimitPayload = buildRateLimitPayload(draft.rateLimit);
  const expiresAtSeconds = draft.expiresAt ? new Date(draft.expiresAt).getTime() / 1000 : undefined;

  const extra = {
    ...(draft.projectId ? { project_id: draft.projectId } : {}),
    ...(draft.issueId ? { issue_id: draft.issueId } : {}),
    ...(skillIds.length ? { skill_ids: skillIds } : {}),
    ...(pluginIds.length ? { plugin_ids: pluginIds } : {}),
  };

  return {
    content: text,
    node_id: draft.nodeId,
    provider: draft.provider as never,
    cli_name: draft.provider as never,
    parent_api_key_id: Number(draft.parentKeyId),
    // isolated 不下发（节点默认）；shared 带 env_id；system 仅在节点开启时下发。
    ...(draft.envMode === 'shared' && draft.envId
      ? { env_mode: 'shared' as const, env_id: draft.envId, env_name: draft.envName }
      : {}),
    ...(draft.envMode === 'system' && draft.systemEnvAllowed ? { env_mode: 'system' as const } : {}),
    ...(activeSkills ? { active_skills: activeSkills } : {}),
    ...(activePlugins ? { active_plugins: activePlugins } : {}),
    // 可用模型：空 = 不限制（服务端同源写 models_snapshot 与子 Key model_whitelist）。
    ...(draft.selectedModels.length ? { models: draft.selectedModels } : {}),
    ...(draft.mode ? { mode: draft.mode } : {}),
    ...((draft.maxRequests || draft.maxTotalTokens) ? {
      usage_limit: {
        ...(draft.maxRequests ? { max_requests: Number(draft.maxRequests) } : {}),
        ...(draft.maxTotalTokens ? { max_total_tokens: Number(draft.maxTotalTokens) } : {}),
      },
    } : {}),
    ...(Object.keys(rateLimitPayload).length ? { rate_limit: rateLimitPayload } : {}),
    ...(editorWhitelist ? { editor_provider_whitelist: editorWhitelist } : {}),
    ...(draft.selectionStrategy && draft.selectionStrategy !== DEFAULT_SELECTION_STRATEGY
      ? { selection_strategy: draft.selectionStrategy } : {}),
    ...(Number.isFinite(expiresAtSeconds) ? { expires_at: expiresAtSeconds } : {}),
    ...(draft.promptId ? { prompt_id: draft.promptId } : {}),
    ...(draft.gitIdentityId ? { git_identity_id: draft.gitIdentityId } : {}),
    ...(draft.repoUrl ? {
      repo: {
        repo_url: draft.repoUrl,
        branch_mode: draft.branchMode,
        ...(draft.branchMode === 'existing' && draft.branch.trim() ? { branch: draft.branch.trim() } : {}),
      },
    } : {}),
    ...(Object.keys(extra).length ? { extra } : {}),
    ...(mcpEntries.length ? { mcp_config: mcpEntries } : {}),
    task_type: mapping.taskType,
    sub_type: mapping.subType,
    task_role: mapping.taskRole,
    ...(draft.provider === 'codex' ? {
      expected_client_id: draft.expectedClientId.trim(),
      bootstrap_content: text,
    } : {}),
  };
}
