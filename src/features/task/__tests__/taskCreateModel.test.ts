/**
 * 创建任务纯函数：三档环境语义、资源绑定归并、MCP grants 合成、子 Key 收窄。
 *
 * 这些是手机端创建链路最容易做错的地方（尤其是「全勾 = 不发 active_*」与
 * 「isolated 走 extra.*_ids 而 shared/system 走 active_*」两条），全部在此锁死。
 */
import {
  buildEnvironmentEntries,
  collectionEntryNames,
  toResourceItems,
  buildCreateTaskPayload,
  buildRateLimitPayload,
  defaultDraft,
  grantDraftToPayload,
  mcpBindings,
  resolveTaskIntent,
  resourceBindings,
  validateDraft,
  type BuildPayloadContext,
  type ConfigEntry,
  type CreateTaskDraft,
  type PickerGrant,
  type PickerResource,
} from '../taskCreateModel';

const ctx = (over: Partial<BuildPayloadContext> = {}): BuildPayloadContext => ({
  environmentEntries: { skill: [], plugin: [], mcp: [] },
  mcpPickerResources: [],
  ...over,
});

/** 基础可提交草稿：隔离档 + 节点/Key/内容齐备。 */
const draft = (over: Partial<CreateTaskDraft> = {}): CreateTaskDraft =>
  defaultDraft({ nodeId: 'node-1', parentKeyId: '7', content: '做点事', ...over });

describe('resolveTaskIntent', () => {
  it('maps the four intent × issue-type combinations', () => {
    expect(resolveTaskIntent('analysis', 'bug'))
      .toEqual({ taskType: 'develop', taskRole: 'diagnose', subType: 'diagnose_bug' });
    expect(resolveTaskIntent('analysis', 'requirement'))
      .toEqual({ taskType: 'design', taskRole: 'design', subType: 'generate_design' });
    expect(resolveTaskIntent('analysis', undefined))
      .toEqual({ taskType: 'design', taskRole: 'design', subType: 'generate_design' });
    expect(resolveTaskIntent('fix', 'bug'))
      .toEqual({ taskType: 'develop', taskRole: 'fix', subType: 'fix_bug' });
    expect(resolveTaskIntent('fix', 'requirement'))
      .toEqual({ taskType: 'develop', taskRole: 'develop', subType: 'execute_task' });
  });
});

describe('resourceBindings', () => {
  it('groups collection children into one binding with entries', () => {
    const entries: ConfigEntry[] = [
      { id: 'v2:ref-1::pdf', reference_id: 'ref-1', resource_entry: 'pdf' },
      { id: 'v2:ref-1::slides', reference_id: 'ref-1', resource_entry: 'slides' },
    ];
    expect(resourceBindings(entries)).toEqual([{ reference_id: 'ref-1', entries: ['pdf', 'slides'] }]);
  });

  it('keeps a plain v2 reference as {reference_id} with no entries', () => {
    expect(resourceBindings([{ id: 'v2:ref-2', reference_id: 'ref-2' }]))
      .toEqual([{ reference_id: 'ref-2' }]);
  });

  it('keeps legacy rows on {resource_id} and groups their children', () => {
    const entries: ConfigEntry[] = [
      { id: 'legacy-1', resource_id: 'legacy-1', resource_entry: 'a' },
      { id: 'legacy-1', resource_id: 'legacy-1', resource_entry: 'b' },
      { id: 'legacy-2' },
    ];
    expect(resourceBindings(entries)).toEqual([
      { resource_id: 'legacy-1', entries: ['a', 'b'] },
      { resource_id: 'legacy-2' },
    ]);
  });

  it('drops entries with no usable id', () => {
    expect(resourceBindings([{ name: '' }, {}])).toEqual([]);
  });
});

describe('mcpBindings', () => {
  it('splits service instances from team references', () => {
    expect(mcpBindings([
      { id: 'service:12' },
      { id: 'ref-uuid' },
      { id: 'service:not-a-number' },
    ])).toEqual([{ service_id: 12 }, { resource_id: 'ref-uuid' }]);
  });
});

describe('grantDraftToPayload', () => {
  const resources: PickerResource[] = [
    { resource_kind: 'service', resource_id: 5, resource_type: 'service', name: 'cdp', required_param: 'cdp_client_id' },
    { resource_kind: 'service', resource_id: 6, resource_type: 'service', name: 'mail' },
    { resource_kind: 'builtin_resource', resource_id: 91, resource_type: 'cdp_client', name: 'browser-1' },
  ];

  it('emits {service_id} for service rows', () => {
    const grants: PickerGrant[] = [{ grant_key: 'service', grant_value: '5' }];
    expect(grantDraftToPayload(grants, resources)).toEqual([{ service_id: 5 }]);
  });

  it('folds param rows onto their owning service as param_key/param_values', () => {
    const grants: PickerGrant[] = [
      { grant_key: 'service', grant_value: '5' },
      { grant_key: 'cdp_client_id', grant_value: '91' },
      { grant_key: 'cdp_client_id', grant_value: '92' },
    ];
    expect(grantDraftToPayload(grants, resources)).toEqual([
      { service_id: 5, param_key: 'cdp_client_id', param_values: ['91', '92'] },
    ]);
  });

  it('drops orphan param rows whose owning service was not selected', () => {
    const grants: PickerGrant[] = [
      { grant_key: 'service', grant_value: '6' },
      { grant_key: 'cdp_client_id', grant_value: '91' },
    ];
    expect(grantDraftToPayload(grants, resources)).toEqual([{ service_id: 6 }]);
  });
});

describe('buildRateLimitPayload', () => {
  it('writes only positive values', () => {
    expect(buildRateLimitPayload({ requests_per_minute: '60', tokens_per_day: '0', max_ips: '' }))
      .toEqual({ requests_per_minute: 60 });
  });

  it('writes ip_window_seconds only when max_ips is positive', () => {
    expect(buildRateLimitPayload({ max_ips: '5', ip_window_seconds: '3600' }))
      .toEqual({ max_ips: 5, ip_window_seconds: 3600 });
    expect(buildRateLimitPayload({ max_ips: '0', ip_window_seconds: '3600' })).toEqual({});
  });
});

describe('validateDraft', () => {
  it('accepts an empty content (task waits for the first message)', () => {
    expect(validateDraft(draft({ content: '' }))).toBeNull();
  });

  it('requires node, parent key, and a shared environment id', () => {
    expect(validateDraft(draft({ nodeId: '' }))).toBe('请选择执行节点');
    expect(validateDraft(draft({ parentKeyId: '' }))).toBe('请选择父 API Key');
    expect(validateDraft(draft({ envMode: 'shared' }))).toBe('请选择共用环境');
  });

  it('requires the node to allow the system tier', () => {
    expect(validateDraft(draft({ envMode: 'system', systemEnvAllowed: false })))
      .toBe('该节点未开启系统环境，请换一个节点或改用其他环境');
    expect(validateDraft(draft({ envMode: 'system', systemEnvAllowed: true }))).toBeNull();
  });

  it('requires installation_id and first content for codex', () => {
    expect(validateDraft(draft({ provider: 'codex' }))).toBe('Codex 任务需要 installation_id');
    // 内容为空（默认草稿有内容，这里显式清空）→ 拒绝。
    expect(validateDraft(draft({ provider: 'codex', expectedClientId: 'inst-1', content: '  ' })))
      .toBe('Codex 任务需要填写首条内容');
    expect(validateDraft(draft({ provider: 'codex', expectedClientId: 'inst-1' }))).toBeNull();
  });

  it('requires a branch name when pinning an existing branch', () => {
    expect(validateDraft(draft({ branchMode: 'existing' }))).toBe('选择已有分支时必须填写分支名');
  });
});

describe('buildCreateTaskPayload — isolated tier', () => {
  it('omits env_mode and sends task-level resource bindings via extra', () => {
    const payload = buildCreateTaskPayload(draft({
      envMode: 'isolated',
      selectedSkills: [{ id: 'v2:ref-1::pdf', reference_id: 'ref-1', resource_entry: 'pdf' }],
      selectedPlugins: [{ id: 'pl-1', resource_id: 'pl-1' }],
      selectedMcps: [{ id: 'service:9' }],
    }), ctx());

    expect(payload.env_mode).toBeUndefined();
    expect(payload.env_id).toBeUndefined();
    expect(payload.active_skills).toBeUndefined();
    expect(payload.extra).toEqual({
      skill_ids: [{ reference_id: 'ref-1', entries: ['pdf'] }],
      plugin_ids: [{ resource_id: 'pl-1' }],
    });
    expect(payload.mcp_config).toEqual([{ service_id: 9 }]);
  });

  it('omits extra entirely when nothing is selected', () => {
    expect(buildCreateTaskPayload(draft(), ctx()).extra).toBeUndefined();
  });
});

describe('buildCreateTaskPayload — shared tier', () => {
  const envEntries = {
    skill: [
      { id: 'env-s1', name: 'skill-one' },
      { id: 'env-s2', name: 'skill-two' },
    ],
    plugin: [{ id: 'env-p1', name: 'plugin-one' }],
    mcp: [{ id: 'mcp-ref-1', name: 'team-mcp' }],
  };

  it('sends env_mode/env_id and NO task-level ids', () => {
    const payload = buildCreateTaskPayload(draft({
      envMode: 'shared',
      envId: 'env-1',
      envName: '我的环境',
      selectedSkills: [{ id: 'should-be-ignored' }],
    }), ctx({ environmentEntries: envEntries }));

    expect(payload.env_mode).toBe('shared');
    expect(payload.env_id).toBe('env-1');
    expect(payload.env_name).toBe('我的环境');
    expect(payload.extra?.skill_ids).toBeUndefined();
  });

  it('omits active_skills when EVERY env skill is checked (= activate all)', () => {
    const payload = buildCreateTaskPayload(draft({
      envMode: 'shared',
      envId: 'env-1',
      activeResources: {
        skill: new Set(['env-s1', 'env-s2']),
        plugin: new Set(['env-p1']),
        mcp: new Set(),
      },
    }), ctx({ environmentEntries: envEntries }));

    // 关键边界：全勾必须省略，发全量列表语义不同。
    expect(payload.active_skills).toBeUndefined();
    expect(payload.active_plugins).toBeUndefined();
  });

  it('sends only the checked names when a subset is checked', () => {
    const payload = buildCreateTaskPayload(draft({
      envMode: 'shared',
      envId: 'env-1',
      activeResources: { skill: new Set(['env-s2']), plugin: new Set(['env-p1']), mcp: new Set() },
    }), ctx({ environmentEntries: envEntries }));

    expect(payload.active_skills).toEqual(['skill-two']);
    expect(payload.active_plugins).toBeUndefined();
  });

  it('sends checked env MCPs as {resource_id} references', () => {
    const payload = buildCreateTaskPayload(draft({
      envMode: 'shared',
      envId: 'env-1',
      activeResources: { skill: new Set(), plugin: new Set(), mcp: new Set(['mcp-ref-1']) },
    }), ctx({ environmentEntries: envEntries }));

    expect(payload.mcp_config).toEqual([{ resource_id: 'mcp-ref-1' }]);
  });

  it('never emits active_* when the env has no entries of that kind', () => {
    const payload = buildCreateTaskPayload(draft({ envMode: 'shared', envId: 'env-1' }), ctx());
    expect(payload.active_skills).toBeUndefined();
    expect(payload.active_plugins).toBeUndefined();
  });
});

describe('buildCreateTaskPayload — system tier', () => {
  it('sends env_mode=system with the activation subset and no env MCP refs', () => {
    const payload = buildCreateTaskPayload(draft({
      envMode: 'system',
      systemEnvAllowed: true,
      activeResources: {
        skill: new Set(['sys-s2']),
        plugin: new Set(),
        mcp: new Set(['sys-m1']),
      },
    }), ctx({
      environmentEntries: {
        skill: [{ id: 'sys-s1', name: 'a' }, { id: 'sys-s2', name: 'b' }],
        plugin: [],
        mcp: [{ id: 'sys-m1', name: 'local-mcp' }],
      },
    }));

    expect(payload.env_mode).toBe('system');
    expect(payload.env_id).toBeUndefined();
    expect(payload.active_skills).toEqual(['b']);
    // 系统档不下发环境 MCP 引用：平台不写操作者本机配置，本机已有的自动生效。
    expect(payload.mcp_config).toBeUndefined();
  });
});

describe('buildCreateTaskPayload — sub-key narrowing', () => {
  it('omits models when none is selected (= unrestricted)', () => {
    const payload = buildCreateTaskPayload(draft({ selectedModels: [] }), ctx());
    expect(payload.models).toBeUndefined();
    expect((payload as Record<string, unknown>).model_whitelist).toBeUndefined();
  });

  it('sends models when a subset is selected', () => {
    expect(buildCreateTaskPayload(draft({ selectedModels: ['gpt-x'] }), ctx()).models).toEqual(['gpt-x']);
  });

  it('maps the editor scope to editor_provider_whitelist', () => {
    expect(buildCreateTaskPayload(draft({ provider: 'claude', editorMode: 'current' }), ctx())
      .editor_provider_whitelist).toEqual(['claude']);
    expect(buildCreateTaskPayload(draft({ editorMode: 'specified', selectedEditors: ['claude', 'codex'] }), ctx())
      .editor_provider_whitelist).toEqual(['claude', 'codex']);
    expect(buildCreateTaskPayload(draft({ editorMode: 'all' }), ctx())
      .editor_provider_whitelist).toBeUndefined();
  });

  it('omits the default selection strategy but sends an explicit one', () => {
    expect(buildCreateTaskPayload(draft(), ctx()).selection_strategy).toBeUndefined();
    expect(buildCreateTaskPayload(draft({ selectionStrategy: 'sequential' }), ctx())
      .selection_strategy).toBe('sequential');
  });
});

describe('buildCreateTaskPayload — repo, project and codex', () => {
  it('sends branch_mode and only includes branch for the existing mode', () => {
    expect(buildCreateTaskPayload(draft({ repoUrl: 'https://x/y', branchMode: 'auto', branch: 'main' }), ctx()).repo)
      .toEqual({ repo_url: 'https://x/y', branch_mode: 'auto' });
    expect(buildCreateTaskPayload(draft({ repoUrl: 'https://x/y', branchMode: 'existing', branch: ' dev ' }), ctx()).repo)
      .toEqual({ repo_url: 'https://x/y', branch_mode: 'existing', branch: 'dev' });
  });

  it('omits repo when there is no repo url', () => {
    expect(buildCreateTaskPayload(draft(), ctx()).repo).toBeUndefined();
  });

  it('carries project, issue and git identity through', () => {
    const payload = buildCreateTaskPayload(draft({
      projectId: 'p-1', issueId: 'i-1', issueType: 'bug', gitIdentityId: 'gi-1',
      // issue 入口的默认意图是「分析」（与 Web setIntent(issueId ? "analysis" : "fix") 一致）。
    }), ctx());
    expect(payload.extra).toEqual({ project_id: 'p-1', issue_id: 'i-1' });
    expect(payload.git_identity_id).toBe('gi-1');
    expect(payload.sub_type).toBe('diagnose_bug');
  });

  it('defaults the intent from the entry point: analysis for issues, fix otherwise', () => {
    expect(defaultDraft().intent).toBe('fix');
    expect(defaultDraft({ issueId: 'i-1' }).intent).toBe('analysis');
    // bug 型 issue + 显式 fix 意图 → fix_bug。
    expect(buildCreateTaskPayload(
      draft({ issueId: 'i-1', issueType: 'bug', intent: 'fix' }), ctx(),
    ).sub_type).toBe('fix_bug');
  });

  it('sends the codex bootstrap fields', () => {
    const payload = buildCreateTaskPayload(draft({
      provider: 'codex', expectedClientId: ' inst-1 ', content: '  hello  ',
    }), ctx());
    expect(payload.expected_client_id).toBe('inst-1');
    expect(payload.bootstrap_content).toBe('hello');
    expect(payload.content).toBe('hello');
  });
});

describe('buildCreateTaskPayload — optional knobs', () => {
  it('converts the expiry text to unix seconds and drops an unparseable value', () => {
    const parsed = buildCreateTaskPayload(draft({ expiresAt: '2026-12-31T18:00:00' }), ctx());
    expect(parsed.expires_at).toBe(new Date('2026-12-31T18:00:00').getTime() / 1000);
    expect(buildCreateTaskPayload(draft({ expiresAt: '不是日期' }), ctx()).expires_at).toBeUndefined();
  });

  it('sends usage_limit, rate_limit, prompt_id and mode when set', () => {
    const payload = buildCreateTaskPayload(draft({
      maxRequests: '10', maxTotalTokens: '1000', rateLimit: { requests_per_minute: '5' },
      promptId: 'prompt-1', mode: 'plan',
    }), ctx());
    expect(payload.usage_limit).toEqual({ max_requests: 10, max_total_tokens: 1000 });
    expect(payload.rate_limit).toEqual({ requests_per_minute: 5 });
    expect(payload.prompt_id).toBe('prompt-1');
    expect(payload.mode).toBe('plan');
  });
});

describe('collectionEntryNames', () => {
  it('returns the sub-skill names for a skills/plugin container', () => {
    expect(collectionEntryNames({
      id: 'r1', name: 'pack',
      manifest: { type: 'plugin', entries: [{ name: 'pdf' }, { name: ' ' }, { name: 'slides' }] },
    })).toEqual(['pdf', 'slides']);
  });

  it('returns null for a plain resource or an empty container', () => {
    expect(collectionEntryNames({ id: 'r1', name: 'x' })).toBeNull();
    expect(collectionEntryNames({ id: 'r1', name: 'x', manifest: { type: 'skill' } })).toBeNull();
    expect(collectionEntryNames({ id: 'r1', name: 'x', manifest: { type: 'plugin', entries: [] } })).toBeNull();
  });
});

describe('toResourceItems', () => {
  it('expands a v2 collection into sub-skill items bound by reference_id', () => {
    const items = toResourceItems([{
      id: 'ref-1', name: 'pack', market_id: 'v2:ref-1',
      manifest: { type: 'plugin', entries: [{ name: 'pdf', description: 'PDF 处理' }] },
    }]);
    expect(items).toEqual([{
      id: 'v2:ref-1::pdf',
      name: 'pdf',
      display_name: 'pack/pdf',
      description: 'PDF 处理',
      reference_id: 'ref-1',
      resource_entry: 'pdf',
      __badge: '插件 · pack',
    }]);
  });

  it('expands a legacy collection into items bound by resource_id', () => {
    const items = toResourceItems([{
      id: 'legacy-1', name: 'legacy-pack',
      manifest: { type: 'skills', entries: [{ name: 'a' }] },
    }]);
    expect(items[0]).toMatchObject({ id: 'legacy-1::a', resource_id: 'legacy-1', resource_entry: 'a' });
  });

  it('maps a plain v2 reference to a single item', () => {
    expect(toResourceItems([{ id: 'ref-2', name: 'solo', market_id: 'v2:ref-2' }]))
      .toEqual([{ id: 'v2:ref-2', name: 'solo', display_name: 'solo', description: undefined, reference_id: 'ref-2' }]);
  });

  it('maps a plain legacy reference with its version badge text', () => {
    expect(toResourceItems([{ id: 'legacy-2', name: 'solo', version: '1.2' }]))
      .toEqual([{ id: 'legacy-2', name: 'solo', display_name: 'solo', description: 'v1.2', resource_id: 'legacy-2' }]);
  });

  it('round-trips: expansion then binding gives back one entry-filtered binding', () => {
    const items = toResourceItems([{
      id: 'ref-1', name: 'pack', market_id: 'v2:ref-1',
      manifest: { type: 'plugin', entries: [{ name: 'pdf' }, { name: 'slides' }] },
    }]);
    // 只勾 pdf 一个子技能。
    expect(resourceBindings(items.filter((i) => i.resource_entry === 'pdf')))
      .toEqual([{ reference_id: 'ref-1', entries: ['pdf'] }]);
  });
});

describe('buildEnvironmentEntries', () => {
  const sources = {
    allSkillItems: [{ id: 's1', name: 's-one' }, { id: 's2', name: 's-two' }],
    allPluginItems: [{ id: 'p1', name: 'p-one' }],
    allMcpItems: [{ id: 'm1', name: 'm-one' }],
    envResources: [
      { kind: 'skill' as const, resource_id: 'es1', name: 'env-skill', version: '2', state: 'installed' as const },
      { kind: 'mcp' as const, resource_id: 'em1', name: 'env-mcp', version: '', state: 'pending' as const },
    ],
    systemResources: {
      skill: [
        { name: 'claude-only', version: '1', description: '', readers: ['claude'], platform_managed: true },
        { name: 'codex-only', version: '1', description: '', readers: ['codex'], platform_managed: false },
        { name: 'shared-skill', version: '', description: 'd', readers: [], platform_managed: true },
      ],
      plugin: [],
      mcp: [],
    },
  };

  it('isolated: shows only the task-level selection', () => {
    const entries = buildEnvironmentEntries(
      defaultDraft({ envMode: 'isolated', selectedSkills: [{ id: 's2' }] }),
      sources,
    );
    expect(entries.skill.map((i) => i.id)).toEqual(['s2']);
    expect(entries.plugin).toEqual([]);
  });

  it('shared: maps the environment resources with state badges', () => {
    const entries = buildEnvironmentEntries(defaultDraft({ envMode: 'shared' }), sources);
    expect(entries.skill).toEqual([{
      id: 'es1', name: 'env-skill', display_name: 'env-skill', description: 'v2', __badge: '环境自带',
    }]);
    expect(entries.mcp[0].__badge).toBe('环境待同步');
  });

  it('system: filters by the selected client readers, keeping unattributed entries', () => {
    const claude = buildEnvironmentEntries(defaultDraft({ envMode: 'system', provider: 'claude' }), sources);
    expect(claude.skill.map((i) => i.name)).toEqual(['claude-only', 'shared-skill']);

    const codex = buildEnvironmentEntries(defaultDraft({ envMode: 'system', provider: 'codex' }), sources);
    expect(codex.skill.map((i) => i.name)).toEqual(['codex-only', 'shared-skill']);
  });

  it('system: prefixes card ids with the kind and marks platform-managed entries', () => {
    const entries = buildEnvironmentEntries(defaultDraft({ envMode: 'system', provider: 'claude' }), sources);
    expect(entries.skill[0]).toMatchObject({ id: 'skill:claude-only', __badge: '平台已装' });
    expect(entries.skill[1]).toMatchObject({ id: 'skill:shared-skill', __badge: '平台已装' });
  });
});

describe('buildEnvironmentEntries — reference stability contract', () => {
  // 调用方（new-task 向导）以本函数的返回身份变化为「补勾选」的触发条件。
  // 若它对同一批输入返回新数组，用户取消勾选后随便改个字段就会被重新勾上。
  it('is a pure function of the listed inputs (same inputs -> same shape)', () => {
    const input = { envMode: 'shared' as const, provider: 'claude', selectedSkills: [], selectedPlugins: [], selectedMcps: [] };
    const sources = {
      allSkillItems: [], allPluginItems: [], allMcpItems: [],
      envResources: [{ kind: 'skill' as const, resource_id: 'e1', name: 'x', version: '1', state: 'installed' as const }],
      systemResources: null,
    };
    const first = buildEnvironmentEntries(input, sources);
    const second = buildEnvironmentEntries({ ...input }, sources);
    expect(second).toEqual(first);
    // 且只读切片里的字段：传一个不含其他 draft 字段的对象也不报错（类型即契约）。
    expect(first.skill.map((i) => i.id)).toEqual(['e1']);
  });
});
