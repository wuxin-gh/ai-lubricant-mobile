/**
 * 渠道：复用 Web 管理端 /admin/providers 全套接口。
 *
 * 每个渠道进入详情抽屉，内含配置编辑、模型管理（增删/刷新）、限流策略、
 * 账号管理（增删/开关/清冷却）与健康检查。编辑表单从 /base 真实回填，
 * 不再用「留空=不改」的猜测式覆盖。接口与 Web 管理端共用一套，不新增后端。
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Switch, Text, View } from 'react-native';
import {
  addAdminProviderAccount,
  clearAdminProviderCooldowns,
  createAdminProvider,
  deleteAdminProvider,
  deleteAdminProviderAccount,
  deleteAdminProviderModel,
  getAdminProviderAccounts,
  getAdminProviderBase,
  getAdminProviderLimitPolicy,
  getAdminProviderModels,
  getAdminProviders,
  refreshAdminProviderModels,
  runAdminProviderHealthCheck,
  setAdminProviderAccountEnabled,
  setAdminProviderEnabled,
  updateAdminProvider,
  updateAdminProviderAccount,
  updateAdminProviderLimitPolicy,
  upsertAdminProviderModel,
  type ProviderAccount,
  type ProviderLimitPolicy,
  type ProviderModelEntry,
  type ProviderSummary,
} from '@/api/management';
import {
  AdminScreen,
  AdminSheet,
  Chip,
  Collapsible,
  DetailRow,
  FilterBar,
  LabeledInput,
  SectionCard,
  Segmented,
  SwitchRow,
} from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';

const PROTOCOLS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'responses', label: 'Responses' },
  { value: 'gemini', label: 'Gemini' },
] as const;
type Protocol = (typeof PROTOCOLS)[number]['value'];

/** 各协议默认路径，来源同 Web 管理端 PROTOCOL_DEFAULT_PATHS。 */
const PROTO_PATHS: Record<Protocol, { chat: string; models: string }> = {
  openai: { chat: '/v1/chat/completions', models: '/v1/models' },
  anthropic: { chat: '/v1/messages', models: '/v1/models' },
  responses: { chat: '/v1/responses', models: '/v1/models' },
  gemini: { chat: '', models: '/v1beta/models' },
};

const VIEW_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '启用中' },
  { value: 'disabled', label: '已停用' },
  { value: 'problem', label: '异常' },
] as const;
type ViewFilter = (typeof VIEW_FILTERS)[number]['value'];

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
const ACCOUNT_STATE_LABEL: Record<string, string> = {
  disabled: '已禁用',
  frozen: '永久冻结',
  cooling: '冷却中',
  model_frozen: '部分模型冻结',
  auth_failed: '认证失败',
  checking: '待检查',
  available: '可用',
};
const num = (s: string): number | undefined => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export default function ChannelsScreen() {
  const t = useTheme();
  const [rows, setRows] = useState<ProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [view, setView] = useState<ViewFilter>('all');

  // 创建
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cRemark, setCRemark] = useState('');
  const [cProto, setCProto] = useState<Protocol>('openai');
  const [cBase, setCBase] = useState('');
  const [cChat, setCChat] = useState(PROTO_PATHS.openai.chat);
  const [cModelsPath, setCModelsPath] = useState(PROTO_PATHS.openai.models);
  const [cKey, setCKey] = useState('');
  const [cModels, setCModels] = useState('');
  const [cAutoUpdate, setCAutoUpdate] = useState(false);
  const [creating, setCreating] = useState(false);

  // 详情抽屉
  const [sel, setSel] = useState<ProviderSummary | null>(null);
  const [base, setBase] = useState<Record<string, unknown>>({});
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [pModels, setPModels] = useState<ProviderModelEntry[]>([]);
  const [policy, setPolicy] = useState<ProviderLimitPolicy>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);

  // 详情内的编辑字段
  const [eRemark, setERemark] = useState('');
  const [eBase, setEBase] = useState('');
  const [eChat, setEChat] = useState('');
  const [eProtocol, setEProtocol] = useState<Protocol>('openai');
  const [eUpstreamStream, setEUpstreamStream] = useState(true);
  const [eClientPreset, setEClientPreset] = useState('');
  const [eSystemType, setESystemType] = useState('');
  const [eModelsPath, setEModelsPath] = useState('');
  const [eTimeout, setETimeout] = useState('');
  const [eRetry, setERetry] = useState('');
  const [eAutoUpdate, setEAutoUpdate] = useState(false);
  const [ePriority, setEPriority] = useState('');
  const [eWeight, setEWeight] = useState('');

  // 限流字段
  const [lEnabled, setLEnabled] = useState(true);
  const [lRpm, setLRpm] = useState('');
  const [lTpm, setLTpm] = useState('');
  const [lModelTpm, setLModelTpm] = useState('');
  const [lConcurrent, setLConcurrent] = useState('');

  // 新增账号 / 新增模型
  const [acctKey, setAcctKey] = useState('');
  const [acctUser, setAcctUser] = useState('');
  const [acctEdit, setAcctEdit] = useState<ProviderAccount | null>(null);
  const [acctProxy, setAcctProxy] = useState('');
  const [acctPrice, setAcctPrice] = useState('');
  const [acctRpd, setAcctRpd] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newModelAlias, setNewModelAlias] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setRows(await getAdminProviders()); }
    catch (e) { setError((e as Error)?.message || '加载失败'); }
  }, []);

  React.useEffect(() => { setLoading(true); void load().finally(() => setLoading(false)); }, [load]);

  const visible = rows.filter((x) => {
    if (view === 'enabled') return x.enabled;
    if (view === 'disabled') return !x.enabled;
    if (view === 'problem') return (x.auth_failed_account_count ?? 0) > 0 || (x.cooldown_account_count ?? 0) > 0;
    return true;
  });

  const toggle = (row: ProviderSummary) => {
    const next = !row.enabled;
    Alert.alert(next ? '启用渠道' : '停用渠道', `确定要${next ? '启用' : '停用'}“${row.name}”吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '确定', style: next ? 'default' : 'destructive', onPress: async () => {
        setBusyId(row.id);
        try {
          await setAdminProviderEnabled(row.id, next);
          setRows((old) => old.map((x) => x.id === row.id ? { ...x, enabled: next } : x));
        } catch (e) { Alert.alert('操作失败', (e as Error)?.message || '请稍后重试'); }
        finally { setBusyId(null); }
      } },
    ]);
  };

  // ── 创建 ──
  const openCreate = () => {
    setCName(''); setCRemark(''); setCProto('openai'); setCBase('');
    setCChat(PROTO_PATHS.openai.chat); setCModelsPath(PROTO_PATHS.openai.models);
    setCKey(''); setCModels(''); setCAutoUpdate(false);
    setCreateOpen(true);
  };

  const onProtoChange = (p: Protocol) => {
    setCProto(p);
    // 仅当当前值为空或是某协议默认值时才套用新协议默认，避免覆盖用户自定义。
    const chats = Object.values(PROTO_PATHS).map((x) => x.chat);
    const modelPaths = Object.values(PROTO_PATHS).map((x) => x.models);
    if (!cChat.trim() || chats.includes(cChat.trim())) setCChat(PROTO_PATHS[p].chat);
    if (!cModelsPath.trim() || modelPaths.includes(cModelsPath.trim())) setCModelsPath(PROTO_PATHS[p].models);
  };

  const submitCreate = useCallback(async () => {
    if (!cName.trim() || !cBase.trim() || creating) return;
    setCreating(true);
    try {
      const models = cModels.split(',').map((x) => x.trim()).filter(Boolean);
      await createAdminProvider({
        name: cName.trim(),
        remark: cRemark.trim() || undefined,
        protocol: cProto,
        base_url: cBase.trim(),
        chat_path: cChat.trim() || undefined,
        models_path: cModelsPath.trim() || undefined,
        auto_update_models: cAutoUpdate,
        enabled: true,
        accounts: cKey.trim() ? [{ api_key: cKey.trim() }] : undefined,
        models: models.length ? models : undefined,
      });
      setCreateOpen(false);
      await load();
    } catch (e) { Alert.alert('创建失败', (e as Error)?.message || '请稍后重试'); }
    finally { setCreating(false); }
  }, [cAutoUpdate, cBase, cChat, cKey, cModels, cModelsPath, cName, cProto, cRemark, creating, load]);

  // ── 详情 ──
  const openDetail = useCallback(async (row: ProviderSummary) => {
    setSel(row);
    setDetailLoading(true);
    setAcctKey(''); setAcctUser(''); setNewModel(''); setNewModelAlias('');
    try {
      const [b, accs, mods, pol] = await Promise.all([
        getAdminProviderBase(row.id).catch(() => ({} as Record<string, unknown>)),
        getAdminProviderAccounts(row.id).catch(() => [] as ProviderAccount[]),
        getAdminProviderModels(row.id).catch(() => [] as ProviderModelEntry[]),
        getAdminProviderLimitPolicy(row.id).catch(() => ({} as ProviderLimitPolicy)),
      ]);
      setBase(b); setAccounts(accs); setPModels(mods); setPolicy(pol);
      setERemark(str(b.remark ?? row.remark));
      setEBase(str(b.base_url));
      const protocolRows = Array.isArray(b.chat_protocols) ? b.chat_protocols as Record<string, unknown>[] : [];
      const primary = protocolRows.find((item) => item.enabled !== false) || protocolRows[0];
      setEProtocol((str(primary?.protocol || b.protocol || row.protocol || 'openai') as Protocol));
      setEChat(str(primary?.path || b.chat_path));
      setEUpstreamStream(primary?.upstream_stream !== false);
      setEClientPreset(str(primary?.client_preset));
      setESystemType(str(primary?.system_type));
      setEModelsPath(str(b.models_path));
      setETimeout(str(b.timeout));
      setERetry(str(b.retry_count));
      setEAutoUpdate(!!b.auto_update_models);
      setEPriority(str(b.account_priority));
      setEWeight(str(b.account_weight));
      setLEnabled(pol.enabled !== false);
      setLRpm(pol.account_rpm ? String(pol.account_rpm) : '');
      setLTpm(pol.account_tpm ? String(pol.account_tpm) : '');
      setLModelTpm(pol.model_tpm ? String(pol.model_tpm) : '');
      setLConcurrent(pol.account_concurrent ? String(pol.account_concurrent) : '');
    } finally { setDetailLoading(false); }
  }, []);

  const refreshDetail = useCallback(async () => {
    if (!sel) return;
    const [accs, mods] = await Promise.all([
      getAdminProviderAccounts(sel.id).catch(() => accounts),
      getAdminProviderModels(sel.id).catch(() => pModels),
    ]);
    setAccounts(accs); setPModels(mods);
    await load();
  }, [accounts, load, pModels, sel]);

  const saveConfig = useCallback(async () => {
    if (!sel || detailBusy) return;
    setDetailBusy(true);
    try {
      const payload: Record<string, unknown> = {
        remark: eRemark.trim(),
        auto_update_models: eAutoUpdate,
      };
      if (eBase.trim()) payload.base_url = eBase.trim();
      if (eChat.trim()) payload.chat_path = eChat.trim();
      payload.protocol = eProtocol;
      payload.chat_protocols = [{ protocol: eProtocol, path: eChat.trim() || PROTO_PATHS[eProtocol].chat, enabled: true, upstream_stream: eUpstreamStream, ...(eClientPreset.trim() ? { client_preset: eClientPreset.trim() } : {}), ...(eSystemType.trim() ? { system_type: eSystemType.trim() } : {}) }];
      if (eModelsPath.trim()) payload.models_path = eModelsPath.trim();
      const to = num(eTimeout); if (to !== undefined) payload.timeout = to;
      const rt = num(eRetry); if (rt !== undefined) payload.retry_count = rt;
      const pr = num(ePriority); if (pr !== undefined) payload.account_priority = pr;
      const wt = num(eWeight); if (wt !== undefined) payload.account_weight = wt;
      await updateAdminProvider(sel.id, payload);
      Alert.alert('已保存', '渠道配置已更新。');
      await load();
    } catch (e) { Alert.alert('保存失败', (e as Error)?.message || '请稍后重试'); }
    finally { setDetailBusy(false); }
  }, [detailBusy, eAutoUpdate, eBase, eChat, eClientPreset, eModelsPath, ePriority, eProtocol, eRemark, eRetry, eSystemType, eTimeout, eUpstreamStream, eWeight, load, sel]);

  const savePolicy = useCallback(async () => {
    if (!sel || detailBusy) return;
    setDetailBusy(true);
    try {
      await updateAdminProviderLimitPolicy(sel.id, {
        name: policy.name || 'default',
        enabled: lEnabled,
        account_rpm: num(lRpm) ?? 0,
        account_tpm: num(lTpm) ?? 0,
        model_tpm: num(lModelTpm) ?? 0,
        account_concurrent: num(lConcurrent) ?? 0,
        // 冷却/冻结规则结构复杂，移动端不编辑，原样回传避免被重置。
        cooldown_policy: policy.cooldown_policy,
        freeze_policy: policy.freeze_policy,
      });
      Alert.alert('已保存', '限流策略已更新并热生效。');
      setPolicy(await getAdminProviderLimitPolicy(sel.id).catch(() => policy));
    } catch (e) { Alert.alert('保存失败', (e as Error)?.message || '请稍后重试'); }
    finally { setDetailBusy(false); }
  }, [detailBusy, lConcurrent, lEnabled, lModelTpm, lRpm, lTpm, policy, sel]);

  const health = useCallback(async () => {
    if (!sel) return;
    setDetailBusy(true);
    try {
      const r = await runAdminProviderHealthCheck(sel.id) as { ok?: boolean; accounts?: Array<{ username?: string; ok?: boolean; error?: string }> };
      const accs = r.accounts ?? [];
      const okN = accs.filter((a) => a.ok).length;
      const failed = accs.filter((a) => !a.ok);
      Alert.alert(
        '健康检查',
        accs.length
          ? `通过 ${okN}/${accs.length}${failed.length ? `\n\n${failed.map((a) => `${a.username || '—'}: ${a.error || '失败'}`).join('\n')}` : ''}`
          : (r.ok ? '通过' : '无可用账号'),
      );
      await refreshDetail();
    } catch (e) { Alert.alert('检查失败', (e as Error)?.message || '请稍后重试'); }
    finally { setDetailBusy(false); }
  }, [refreshDetail, sel]);

  const clearCooldowns = useCallback(async () => {
    if (!sel) return;
    setDetailBusy(true);
    try {
      const r = await clearAdminProviderCooldowns(sel.id);
      Alert.alert('已清除', `共清除 ${r.cleared ?? 0} 条冻结/冷却记录。`);
      await refreshDetail();
    } catch (e) { Alert.alert('操作失败', (e as Error)?.message || '请稍后重试'); }
    finally { setDetailBusy(false); }
  }, [refreshDetail, sel]);

  const refreshModels = useCallback(async () => {
    if (!sel) return;
    setDetailBusy(true);
    try {
      await refreshAdminProviderModels(sel.id);
      setPModels(await getAdminProviderModels(sel.id).catch(() => pModels));
      await load();
      Alert.alert('已刷新', '已从上游重新拉取模型列表。');
    } catch (e) { Alert.alert('刷新失败', (e as Error)?.message || '请稍后重试'); }
    finally { setDetailBusy(false); }
  }, [load, pModels, sel]);

  const addModel = useCallback(async () => {
    if (!sel || !newModel.trim() || detailBusy) return;
    setDetailBusy(true);
    try {
      await upsertAdminProviderModel(sel.id, {
        upstream_model_id: newModel.trim(),
        model_id: newModelAlias.trim() || newModel.trim(),
      });
      setNewModel(''); setNewModelAlias('');
      setPModels(await getAdminProviderModels(sel.id));
      await load();
    } catch (e) { Alert.alert('新增失败', (e as Error)?.message || '请稍后重试'); }
    finally { setDetailBusy(false); }
  }, [detailBusy, load, newModel, newModelAlias, sel]);

  const removeModel = (m: ProviderModelEntry) => {
    if (!sel) return;
    Alert.alert('删除模型', `确定从渠道移除“${m.upstream_model_id}”？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try {
          await deleteAdminProviderModel(sel.id, m.upstream_model_id);
          setPModels((old) => old.filter((x) => x.upstream_model_id !== m.upstream_model_id));
          await load();
        } catch (e) { Alert.alert('删除失败', (e as Error)?.message || '请稍后重试'); }
      } },
    ]);
  };

  const addAccount = useCallback(async () => {
    if (!sel || !acctKey.trim() || detailBusy) return;
    setDetailBusy(true);
    try {
      await addAdminProviderAccount(sel.id, { api_key: acctKey.trim(), username: acctUser.trim() || undefined });
      setAcctKey(''); setAcctUser('');
      setAccounts(await getAdminProviderAccounts(sel.id));
      await load();
    } catch (e) { Alert.alert('新增失败', (e as Error)?.message || '请稍后重试'); }
    finally { setDetailBusy(false); }
  }, [acctKey, acctUser, detailBusy, load, sel]);

  const openAccountEdit = (acct: ProviderAccount) => { setAcctEdit(acct); setAcctUser(acct.username || ''); setAcctKey(''); setAcctProxy(str(acct.proxy)); setAcctPrice(str(acct.price_remark)); setAcctRpd(str(acct.rpd_limit)); };
  const saveAccountEdit = async () => { if (!sel || !acctEdit?.username) return; setDetailBusy(true); try { await updateAdminProviderAccount(sel.id, acctEdit.username, { username: acctUser.trim() || acctEdit.username, ...(acctKey.trim() ? { api_key: acctKey.trim() } : {}), proxy: acctProxy.trim() || null, price_remark: acctPrice.trim(), rpd_limit: num(acctRpd) ?? 0, switch: acctEdit.enabled !== false }); setAcctEdit(null); setAccounts(await getAdminProviderAccounts(sel.id)); } catch (e) { Alert.alert('编辑失败', (e as Error)?.message || '请稍后重试'); } finally { setDetailBusy(false); } };

  const toggleAccount = (acct: ProviderAccount) => {
    if (!sel || !acct.username) return;
    const next = !(acct.switch !== false && acct.enabled !== false);
    void (async () => {
      try {
        await setAdminProviderAccountEnabled(sel.id, acct.username!, next);
        setAccounts((old) => old.map((a) => a.username === acct.username ? { ...a, enabled: next, switch: next } : a));
      } catch (e) { Alert.alert('操作失败', (e as Error)?.message || '请稍后重试'); }
    })();
  };

  const removeAccount = (acct: ProviderAccount) => {
    if (!sel || !acct.username) return;
    Alert.alert('删除账号', `确定删除账号“${acct.username}”？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try {
          await deleteAdminProviderAccount(sel.id, acct.username!);
          setAccounts((old) => old.filter((a) => a.username !== acct.username));
          await load();
        } catch (e) { Alert.alert('删除失败', (e as Error)?.message || '请稍后重试'); }
      } },
    ]);
  };

  const removeProvider = () => {
    if (!sel) return;
    const row = sel;
    Alert.alert('删除渠道', `确定永久删除渠道“${row.name}”？其下所有账号配置将被清除。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try { await deleteAdminProvider(row.id); setSel(null); await load(); }
        catch (e) { Alert.alert('删除失败', (e as Error)?.message || '请稍后重试'); }
      } },
    ]);
  };

  return (
    <>
      <AdminScreen active="channels" loading={loading} error={error} onRetry={() => { setLoading(true); void load().finally(() => setLoading(false)); }} onRefresh={load}>
        <FilterBar value={view} options={VIEW_FILTERS} onChange={setView} />

        <Pressable onPress={openCreate} style={({ pressed }) => [{ height: 46, borderRadius: 15, backgroundColor: t.ac, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, pressed && { opacity: 0.75 }]}>
          <Icons.plus size={17} color={t.acInk} sw={2.2} /><Text style={{ color: t.acInk, fontSize: 14, fontWeight: '700' }}>新增渠道</Text>
        </Pressable>

        <SectionCard title={`渠道 (${visible.length}/${rows.length})`}>
          {visible.map((row, i) => (
            <View key={row.id} style={{ paddingVertical: 12, borderTopWidth: i === 0 ? 0 : 0.5, borderColor: t.line }}>
              <Pressable onPress={() => void openDetail(row)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 11 }, pressed && { opacity: 0.65 }]}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: row.enabled ? t.acGhost : t.bg3, alignItems: 'center', justifyContent: 'center' }}>
                  <Icons.git size={19} color={row.enabled ? t.acTx : t.tx3} sw={1.9} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14, fontWeight: '700' }}>{row.name}</Text>
                  <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11.5, marginTop: 2 }}>{row.protocol || row.type || '渠道'} · {row.enabled_account_count ?? 0}/{row.account_count ?? 0} 账号可用</Text>
                  {row.remark ? <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11, marginTop: 2 }}>{row.remark}</Text> : null}
                </View>
                <Switch value={row.enabled} disabled={busyId === row.id} onValueChange={() => toggle(row)} trackColor={{ false: t.track, true: t.ac }} />
              </Pressable>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9, marginLeft: 51 }}>
                <Chip text={`模型 ${row.models?.length ?? 0}`} />
                {(row.auth_failed_account_count ?? 0) > 0 ? <Chip text={`认证失败 ${row.auth_failed_account_count}`} color={t.red} bg={t.redGhost} /> : null}
                {(row.cooldown_account_count ?? 0) > 0 ? <Chip text={`冷却 ${row.cooldown_account_count}`} color={t.amber} bg={t.amberGhost} /> : null}
                {(row.requesting_account_count ?? 0) > 0 ? <Chip text={`请求中 ${row.requesting_account_count}`} color={t.acTx} bg={t.acGhost} /> : null}
              </View>
            </View>
          ))}
          {!visible.length ? <Text style={{ color: t.tx3, fontSize: 12.5 }}>{rows.length ? '没有符合筛选条件的渠道' : '暂无渠道'}</Text> : null}
        </SectionCard>
      </AdminScreen>

      {/* 创建渠道 */}
      <AdminSheet visible={createOpen} title="新增自定义渠道" onClose={() => setCreateOpen(false)} submitLabel={creating ? '创建中…' : '创建'} submitting={creating} onSubmit={submitCreate} submitDisabled={!cName.trim() || !cBase.trim()}>
        <LabeledInput label="名称" value={cName} onChangeText={setCName} placeholder="如 MyOpenAI" hint="创建后不可修改" />
        <LabeledInput label="备注（可选）" value={cRemark} onChangeText={setCRemark} placeholder="渠道用途说明" />
        <Segmented label="协议" value={cProto} options={PROTOCOLS} onChange={onProtoChange} hint="切换协议会自动套用默认路径" />
        <LabeledInput label="Base URL" value={cBase} onChangeText={setCBase} placeholder="https://api.example.com" keyboardType="url" />
        <LabeledInput label="Chat Path" value={cChat} onChangeText={setCChat} placeholder="/v1/chat/completions" hint={cProto === 'gemini' ? 'Gemini 按 {model}:generateContent 动态拼接，留空即可' : '留空使用协议默认'} />
        <LabeledInput label="Models Path" value={cModelsPath} onChangeText={setCModelsPath} placeholder="/v1/models" />
        <LabeledInput label="API Key（首个账号）" value={cKey} onChangeText={setCKey} placeholder="sk-..." secureTextEntry />
        <LabeledInput label="模型列表（可选）" value={cModels} onChangeText={setCModels} placeholder="gpt-4o, gpt-4o-mini" hint="逗号分隔；留空可稍后从上游刷新" multiline />
        <SwitchRow label="自动更新模型" value={cAutoUpdate} onValueChange={setCAutoUpdate} hint="定期从上游同步模型列表" />
      </AdminSheet>

      {/* 渠道详情 */}
      <AdminSheet visible={!!sel} title={sel?.name ?? ''} onClose={() => setSel(null)}>
        {detailLoading ? <ActivityIndicator color={t.ac} style={{ marginVertical: 40 }} /> : sel ? (
          <View>
            <DetailRow label="状态" value={sel.enabled ? '启用中' : '已停用'} color={sel.enabled ? t.add : t.tx3} />
            <DetailRow label="类型" value={`${sel.protocol || '—'} · ${sel.type === 'builtin' ? '内置' : '自定义'}`} />
            <DetailRow label="账号" value={`${sel.enabled_account_count ?? 0}/${sel.account_count ?? 0} 可用`} />
            <DetailRow label="Base URL" value={str(base.base_url)} mono multiline />

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <ActionBtn label="健康检查" icon="refresh" onPress={health} busy={detailBusy} />
              <ActionBtn label="清除冷却" icon="play" onPress={clearCooldowns} busy={detailBusy} />
            </View>

            <Collapsible title="配置" defaultOpen>
              <View style={{ gap: 10 }}>
                <LabeledInput label="备注" value={eRemark} onChangeText={setERemark} placeholder="渠道用途说明" />
                <LabeledInput label="Base URL" value={eBase} onChangeText={setEBase} placeholder="https://api.example.com" keyboardType="url" />
                <Segmented label="聊天协议" value={eProtocol} options={PROTOCOLS} onChange={(p) => { setEProtocol(p); if (!eChat.trim()) setEChat(PROTO_PATHS[p].chat); }} />
                <LabeledInput label="协议路径" value={eChat} onChangeText={setEChat} placeholder="/v1/chat/completions" />
                <SwitchRow label="上游流式响应" value={eUpstreamStream} onValueChange={setEUpstreamStream} />
                <LabeledInput label="客户端预设" value={eClientPreset} onChangeText={setEClientPreset} placeholder="可选" />
                {eProtocol === 'anthropic' ? <LabeledInput label="System 类型" value={eSystemType} onChangeText={setESystemType} placeholder="可选" /> : null}
                <LabeledInput label="Models Path" value={eModelsPath} onChangeText={setEModelsPath} placeholder="/v1/models" />
                <LabeledInput label="超时（秒）" value={eTimeout} onChangeText={setETimeout} placeholder="如 300" keyboardType="numeric" />
                <LabeledInput label="重试次数" value={eRetry} onChangeText={setERetry} placeholder="如 2" keyboardType="numeric" />
                <LabeledInput label="账号优先级" value={ePriority} onChangeText={setEPriority} placeholder="数字越小越优先" keyboardType="numeric" />
                <LabeledInput label="账号权重" value={eWeight} onChangeText={setEWeight} placeholder="加权随机用" keyboardType="numeric" />
                <SwitchRow label="自动更新模型" value={eAutoUpdate} onValueChange={setEAutoUpdate} />
                <Text style={{ color: t.tx3, fontSize: 11 }}>渠道名称不可修改。</Text>
                <SaveBtn label="保存配置" onPress={saveConfig} busy={detailBusy} />
              </View>
            </Collapsible>

            <Collapsible title={`模型 (${pModels.length})`}>
              <View style={{ gap: 8 }}>
                <Pressable onPress={refreshModels} disabled={detailBusy} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 }, pressed && { opacity: 0.6 }]}>
                  <Icons.refresh size={15} color={t.acTx} sw={2} />
                  <Text style={{ color: t.acTx, fontSize: 12.5, fontWeight: '700' }}>从上游刷新模型</Text>
                </Pressable>
                {pModels.map((m, i) => (
                  <View key={m.upstream_model_id || i} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, borderTopWidth: 0.5, borderColor: t.line }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: 12.5, color: t.tx, fontWeight: '600', fontFamily: 'monospace' }}>{m.upstream_model_id}</Text>
                      {m.model_id && m.model_id !== m.upstream_model_id ? <Text numberOfLines={1} style={{ fontSize: 10.5, color: t.tx3, marginTop: 2 }}>对外 {m.model_id}</Text> : null}
                    </View>
                    <Pressable onPress={() => removeModel(m)} hitSlop={8} style={{ padding: 5 }}><Icons.trash size={15} color={t.red} sw={1.9} /></Pressable>
                  </View>
                ))}
                {!pModels.length ? <Text style={{ color: t.tx3, fontSize: 12 }}>暂无模型，可手动添加或从上游刷新</Text> : null}
                <View style={{ gap: 8, borderTopWidth: 0.5, borderColor: t.line, paddingTop: 10 }}>
                  <LabeledInput label="上游模型 ID" value={newModel} onChangeText={setNewModel} placeholder="如 gpt-4o" />
                  <LabeledInput label="对外模型 ID（可选）" value={newModelAlias} onChangeText={setNewModelAlias} placeholder="留空同上游" />
                  <SaveBtn label="添加模型" onPress={addModel} busy={detailBusy} disabled={!newModel.trim()} />
                </View>
              </View>
            </Collapsible>

            <Collapsible title="限流策略">
              <View style={{ gap: 10 }}>
                <SwitchRow label="启用限流" value={lEnabled} onValueChange={setLEnabled} hint="关闭后四项数值限额一律按不限处理" />
                <LabeledInput label="单账号 RPM" value={lRpm} onChangeText={setLRpm} placeholder="0 表示不限" keyboardType="numeric" />
                <LabeledInput label="单账号 TPM" value={lTpm} onChangeText={setLTpm} placeholder="0 表示不限" keyboardType="numeric" />
                <LabeledInput label="单模型 TPM" value={lModelTpm} onChangeText={setLModelTpm} placeholder="0 表示不限" keyboardType="numeric" />
                <LabeledInput label="单账号并发" value={lConcurrent} onChangeText={setLConcurrent} placeholder="0 表示不限" keyboardType="numeric" />
                <Text style={{ color: t.tx3, fontSize: 11, lineHeight: 16 }}>冷却与冻结规则结构复杂，移动端不编辑，保存时原样保留现有配置。</Text>
                <SaveBtn label="保存限流策略" onPress={savePolicy} busy={detailBusy} />
              </View>
            </Collapsible>

            <Collapsible title={`账号 (${accounts.length})`}>
              <View style={{ gap: 8 }}>
                {accounts.map((acct, i) => (
                  <View key={acct.username ?? i} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 0.5, borderColor: t.line }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: '600', color: t.tx, fontFamily: 'monospace' }}>{acct.username || '—'}</Text>
                      {acct.state ? <Text style={{ fontSize: 10.5, color: t.tx3, marginTop: 2 }}>{ACCOUNT_STATE_LABEL[acct.state] ?? acct.state}</Text> : (acct.status ? <Text style={{ fontSize: 10.5, color: t.tx3, marginTop: 2 }}>{acct.status}</Text> : null)}
                      {acct.last_error ? <Text numberOfLines={2} style={{ fontSize: 10.5, color: t.red, marginTop: 2 }}>{acct.last_error}</Text> : null}
                    </View>
                    <Pressable onPress={() => openAccountEdit(acct)} hitSlop={8} style={{ padding: 5 }}><Icons.edit size={15} color={t.acTx} sw={1.9} /></Pressable>
                    <Switch value={acct.switch !== false && acct.enabled !== false} onValueChange={() => toggleAccount(acct)} trackColor={{ false: t.track, true: t.ac }} />
                    <Pressable onPress={() => removeAccount(acct)} hitSlop={8} style={{ padding: 5 }}><Icons.trash size={15} color={t.red} sw={1.9} /></Pressable>
                  </View>
                ))}
                {!accounts.length ? <Text style={{ color: t.tx3, fontSize: 12 }}>暂无账号</Text> : null}
                <View style={{ gap: 8, borderTopWidth: 0.5, borderColor: t.line, paddingTop: 10 }}>
                  <LabeledInput label="API Key" value={acctKey} onChangeText={setAcctKey} placeholder="sk-..." secureTextEntry />
                  <LabeledInput label="用户名（可选）" value={acctUser} onChangeText={setAcctUser} placeholder="多账号区分用" />
                  <SaveBtn label="添加账号" onPress={addAccount} busy={detailBusy} disabled={!acctKey.trim()} />
                </View>
              </View>
            </Collapsible>

            <Pressable onPress={removeProvider} style={({ pressed }) => [{ height: 44, borderRadius: 13, backgroundColor: t.redGhost, alignItems: 'center', justifyContent: 'center', marginTop: 14 }, pressed && { opacity: 0.7 }]}>
              <Text style={{ color: t.red, fontWeight: '700', fontSize: 13.5 }}>删除此渠道</Text>
            </Pressable>
          </View>
        ) : null}
      </AdminSheet>
      <AdminSheet visible={!!acctEdit} title={`编辑账号 · ${acctEdit?.username || ''}`} onClose={() => setAcctEdit(null)} submitLabel="保存账号" onSubmit={saveAccountEdit} submitting={detailBusy}><LabeledInput label="用户名" value={acctUser} onChangeText={setAcctUser} /><LabeledInput label="API Key / 密码" value={acctKey} onChangeText={setAcctKey} secureTextEntry hint="留空保留原凭据" /><LabeledInput label="代理" value={acctProxy} onChangeText={setAcctProxy} placeholder="留空不使用代理" /><LabeledInput label="价格备注" value={acctPrice} onChangeText={setAcctPrice} /><LabeledInput label="每日请求上限 RPD" value={acctRpd} onChangeText={setAcctRpd} keyboardType="numeric" placeholder="0 表示不限" /></AdminSheet>
    </>
  );
}

function ActionBtn({ label, icon, onPress, busy }: { label: string; icon: 'refresh' | 'play'; onPress: () => void; busy?: boolean }) {
  const t = useTheme();
  const I = Icons[icon] ?? Icons.refresh;
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [{ flex: 1, height: 40, borderRadius: 12, backgroundColor: t.bg3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, (pressed || busy) && { opacity: 0.6 }]}>
      {busy ? <ActivityIndicator size="small" color={t.tx2} /> : <I size={15} color={t.tx2} sw={1.9} />}
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: t.tx2 }}>{label}</Text>
    </Pressable>
  );
}

function SaveBtn({ label, onPress, busy, disabled }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={busy || disabled} style={({ pressed }) => [{ height: 42, borderRadius: 13, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }, (pressed || busy || disabled) && { opacity: 0.6 }]}>
      {busy ? <ActivityIndicator color={t.acInk} /> : <Text style={{ color: t.acInk, fontWeight: '700', fontSize: 13 }}>{label}</Text>}
    </Pressable>
  );
}
