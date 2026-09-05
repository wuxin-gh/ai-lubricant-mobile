/**
 * 秘钥管理 (API Keys)：复用管理端现有列表、创建、编辑、派生子 Key、启停、删除、全局开关接口。
 * 编辑面与 Web 管理端同一套字段：选路策略、10 项限流、渠道/模型黑白名单、总额度、过期时间。
 * 明文 Key 仅在创建/复制响应中显示一次，不写入 AsyncStorage、日志或路由参数。
 */
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, Switch, Text, View } from 'react-native';
import {
  asStringList,
  copyAdminApiKey,
  createAdminApiKey,
  DEFAULT_KEY_SELECTION_STRATEGY,
  deleteAdminApiKey,
  getAdminApiKeys,
  getAdminProviders,
  KEY_SELECTION_STRATEGIES,
  limitValue,
  setAdminApiKeyDisabled,
  setAdminApiKeysEnabled,
  updateAdminApiKey,
  type AdminApiKey,
  type ApiKeyPayload,
} from '@/api/management';
import {
  AdminScreen,
  AdminSheet,
  Chip,
  ChipMultiSelect,
  Collapsible,
  DetailRow,
  LabeledInput,
  SectionCard,
  Segmented,
} from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';

/** 限流字段：后端键 + 展示名 + 读取时的兼容候选键（与 Web 管理端一致）。 */
const RATE_FIELDS = [
  { key: 'requests_per_minute', label: '每分钟请求 (RPM)', aliases: ['requests_per_minute', 'rpm'] },
  { key: 'requests_per_5h', label: '每 5 小时请求', aliases: ['requests_per_5h', 'requests_per_5_hours'] },
  { key: 'requests_per_day', label: '每天请求 (RPD)', aliases: ['requests_per_day', 'rpd'] },
  { key: 'requests_per_week', label: '每周请求 (RPW)', aliases: ['requests_per_week', 'rpw'] },
  { key: 'tokens_per_minute', label: '每分钟 Token (TPM)', aliases: ['tokens_per_minute', 'tpm'] },
  { key: 'tokens_per_day', label: '每天 Token (TPD)', aliases: ['tokens_per_day', 'tpd'] },
  { key: 'tokens_per_week', label: '每周 Token (TPW)', aliases: ['tokens_per_week', 'tpw'] },
  { key: 'concurrent_requests', label: '并发请求', aliases: ['concurrent_requests', 'concurrent'] },
  { key: 'max_ips', label: '最大 IP 数', aliases: ['max_ips'] },
  { key: 'ip_window_seconds', label: 'IP 统计窗口(秒)', aliases: ['ip_window_seconds'] },
] as const;

type RateForm = Record<string, string>;

function maskKey(k?: string): string {
  if (!k) return '—';
  if (k.length <= 10) return k.slice(0, 2) + '••••';
  return `${k.slice(0, 6)}••••${k.slice(-4)}`;
}

function fmtDate(epoch?: number | null): string {
  if (!epoch) return '永不过期';
  const d = new Date(epoch * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** yyyy-MM-dd → epoch 秒（当日 23:59:59 本地）；非法/空返回 null。 */
function dateInputToEpoch(s: string): number | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
}

function epochToDateInput(epoch?: number | null): string {
  if (!epoch) return '';
  const d = new Date(epoch * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ApiKeysScreen() {
  const t = useTheme();
  const [enabled, setEnabled] = useState(true);
  const [rows, setRows] = useState<AdminApiKey[]>([]);
  const [providerTags, setProviderTags] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [oneTimeKey, setOneTimeKey] = useState<AdminApiKey | null>(null);
  const [detail, setDetail] = useState<AdminApiKey | null>(null);

  // 表单：新建 / 编辑 / 派生子 Key 三种模式共用
  const [formOpen, setFormOpen] = useState(false);
  const [mode, setMode] = useState<'create' | 'edit' | 'copy'>('create');
  const [target, setTarget] = useState<AdminApiKey | null>(null);
  const [name, setName] = useState('');
  const [strategy, setStrategy] = useState<string>(DEFAULT_KEY_SELECTION_STRATEGY);
  const [rate, setRate] = useState<RateForm>({});
  const [maxReq, setMaxReq] = useState('');
  const [maxTok, setMaxTok] = useState('');
  const [expires, setExpires] = useState('');
  const [pWhite, setPWhite] = useState<string[]>([]);
  const [pBlack, setPBlack] = useState<string[]>([]);
  const [mWhite, setMWhite] = useState<string[]>([]);
  const [mBlack, setMBlack] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [r, provs] = await Promise.all([getAdminApiKeys(), getAdminProviders().catch(() => [])]);
      setEnabled(r.enabled); setRows(r.keys);
      setProviderTags(Array.from(new Set(provs.flatMap((p) => p.tags ?? []).map((tag) => tag.trim()).filter(Boolean))).sort());
      setModels(Array.from(new Set(provs.flatMap((p) => p.models ?? []))).sort());
    } catch (e) { setError((e as Error)?.message || '加载失败'); }
  }, []);

  React.useEffect(() => { void load().finally(() => setLoading(false)); }, [load]);

  const toggle = (row: AdminApiKey) => {
    const next = !row.disabled;
    Alert.alert(next ? '停用密钥' : '启用密钥', `确定要${next ? '停用' : '启用'}“${row.name}”吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '确定', onPress: async () => {
        setBusyId(row.id);
        try {
          await setAdminApiKeyDisabled(row.id, next);
          setRows((old) => old.map((x) => x.id === row.id ? { ...x, disabled: next } : x));
        } catch (e) { Alert.alert('操作失败', (e as Error)?.message || '请稍后重试'); }
        finally { setBusyId(null); }
      } },
    ]);
  };

  const toggleGlobal = () => {
    const next = !enabled;
    Alert.alert(next ? '开启 API Key 认证' : '关闭 API Key 认证', next ? '开启后所有请求必须携带有效 Key。' : '关闭后所有请求不再校验 Key，任何客户端均可直接调用。', [
      { text: '取消', style: 'cancel' },
      { text: next ? '开启' : '关闭', style: next ? 'default' : 'destructive', onPress: async () => {
        try { await setAdminApiKeysEnabled(next); setEnabled(next); }
        catch (e) { Alert.alert('操作失败', (e as Error)?.message || '请稍后重试'); }
      } },
    ]);
  };

  const copyKey = async (row: AdminApiKey) => {
    if (!row.key) return;
    await Clipboard.setStringAsync(row.key);
    Alert.alert('已复制', '密钥已复制到剪贴板，请注意安全。');
  };

  const resetForm = () => {
    setName(''); setStrategy(DEFAULT_KEY_SELECTION_STRATEGY); setRate({});
    setMaxReq(''); setMaxTok(''); setExpires('');
    setPWhite([]); setPBlack([]); setMWhite([]); setMBlack([]);
  };

  const fillFrom = (row: AdminApiKey) => {
    const rl = (row.rate_limit ?? {}) as Record<string, unknown>;
    const next: RateForm = {};
    RATE_FIELDS.forEach((f) => {
      const v = limitValue(rl, [...f.aliases]);
      if (v) next[f.key] = String(v);
    });
    setRate(next);
    setStrategy(row.selection_strategy || DEFAULT_KEY_SELECTION_STRATEGY);
    const ul = (row.usage_limit ?? {}) as Record<string, unknown>;
    setMaxReq(limitValue(ul, ['max_requests'])?.toString() ?? '');
    setMaxTok(limitValue(ul, ['max_total_tokens'])?.toString() ?? '');
    setExpires(epochToDateInput(row.expires_at));
    setPWhite(asStringList(row.provider_whitelist));
    setPBlack(asStringList(row.provider_blacklist));
    setMWhite(asStringList(row.model_whitelist));
    setMBlack(asStringList(row.model_blacklist));
  };

  const openCreate = () => { setMode('create'); setTarget(null); resetForm(); setFormOpen(true); };
  const openEdit = (row: AdminApiKey) => { setMode('edit'); setTarget(row); setName(row.name); fillFrom(row); setFormOpen(true); };
  const openCopy = (row: AdminApiKey) => { setMode('copy'); setTarget(row); setName(`${row.name} 副本`); fillFrom(row); setFormOpen(true); };

  const buildPayload = useCallback((): ApiKeyPayload => {
    const rateLimit: Record<string, number> = {};
    RATE_FIELDS.forEach((f) => {
      const n = parseInt(rate[f.key] ?? '', 10);
      if (Number.isFinite(n) && n > 0) rateLimit[f.key] = n;
    });
    const usageLimit: Record<string, number> = {};
    const mr = parseInt(maxReq, 10); if (mr > 0) usageLimit.max_requests = mr;
    const mt = parseInt(maxTok, 10); if (mt > 0) usageLimit.max_total_tokens = mt;
    return {
      name: name.trim(),
      rate_limit: rateLimit,
      usage_limit: usageLimit,
      provider_whitelist: pWhite,
      provider_blacklist: pBlack,
      model_whitelist: mWhite,
      model_blacklist: mBlack,
      selection_strategy: strategy || DEFAULT_KEY_SELECTION_STRATEGY,
      expires_at: expires.trim() ? dateInputToEpoch(expires) : null,
    };
  }, [expires, mBlack, mWhite, maxReq, maxTok, name, pBlack, pWhite, rate, strategy]);

  const submitForm = useCallback(async () => {
    if (!name.trim() || saving) return;
    if (expires.trim() && dateInputToEpoch(expires) === null) {
      Alert.alert('日期格式错误', '过期时间请按 YYYY-MM-DD 填写，留空表示永不过期。');
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      if (mode === 'edit' && target) {
        await updateAdminApiKey(target.id, payload as unknown as Record<string, unknown>);
        setFormOpen(false);
      } else if (mode === 'copy' && target) {
        const child = await copyAdminApiKey(target.id, payload);
        if (!child) throw new Error('后端未返回子 Key');
        setFormOpen(false); setOneTimeKey(child);
      } else {
        const row = await createAdminApiKey(payload);
        if (!row) throw new Error('后端未返回新 Key');
        setFormOpen(false); setOneTimeKey(row);
      }
      await load();
    } catch (e) { Alert.alert('保存失败', (e as Error)?.message || '请稍后重试'); }
    finally { setSaving(false); }
  }, [buildPayload, expires, load, mode, name, saving, target]);

  const remove = (row: AdminApiKey) => {
    Alert.alert('删除密钥', `确定永久删除“${row.name}”？使用它的客户端将立即失效。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        setBusyId(row.id);
        try { await deleteAdminApiKey(row.id); setRows((old) => old.filter((x) => x.id !== row.id)); }
        catch (e) { Alert.alert('删除失败', (e as Error)?.message || '请稍后重试'); }
        finally { setBusyId(null); }
      } },
    ]);
  };

  const setRateField = (k: string, v: string) => setRate((r) => ({ ...r, [k]: v }));
  const toggleIn = (list: string[], set: (v: string[]) => void) => (v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const activeCount = rows.filter((r) => !r.disabled).length;
  const formTitle = mode === 'edit' ? `编辑 · ${target?.name ?? ''}` : mode === 'copy' ? `派生子 Key · ${target?.name ?? ''}` : '新建 API Key';

  return (
    <>
      <AdminScreen active="api-keys" loading={loading} error={error} onRetry={() => { setLoading(true); void load().finally(() => setLoading(false)); }} onRefresh={load}>
        <Pressable onPress={toggleGlobal} style={({ pressed }) => [{ backgroundColor: t.bg2, borderRadius: 16, padding: 14, ...t.shCard }, pressed && { opacity: 0.7 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 13.5, fontWeight: '700', color: t.tx }}>API Key 认证</Text>
              <Text style={{ fontSize: 11.5, color: t.tx3, marginTop: 3 }}>{enabled ? `已开启 · ${activeCount}/${rows.length} 个 Key 启用中` : '已关闭：不校验 Key'}</Text>
            </View>
            <Switch value={enabled} trackColor={{ false: t.track, true: t.ac }} />
          </View>
        </Pressable>

        <Pressable onPress={openCreate} style={({ pressed }) => [{ height: 46, borderRadius: 15, backgroundColor: t.ac, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, pressed && { opacity: 0.75 }]}>
          <Icons.plus size={17} color={t.acInk} sw={2.2} /><Text style={{ color: t.acInk, fontSize: 14, fontWeight: '700' }}>新建 API Key</Text>
        </Pressable>

        <SectionCard title={`Key 列表 (${rows.length})`}>
          {rows.map((row, i) => {
            const pw = asStringList(row.provider_whitelist);
            const mw = asStringList(row.model_whitelist);
            const rl = (row.rate_limit ?? {}) as Record<string, unknown>;
            const rpm = limitValue(rl, ['requests_per_minute', 'rpm']);
            const strat = KEY_SELECTION_STRATEGIES.find((s) => s.value === (row.selection_strategy || DEFAULT_KEY_SELECTION_STRATEGY));
            return (
              <View key={row.id} style={{ paddingVertical: 11, borderTopWidth: i === 0 ? 0 : 0.5, borderColor: t.line }}>
                <Pressable onPress={() => setDetail(row)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 11 }, pressed && { opacity: 0.65 }]}>
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: row.disabled ? t.bg3 : t.acGhost, alignItems: 'center', justifyContent: 'center' }}>
                    <Icons.lock size={18} color={row.disabled ? t.tx3 : t.acTx} sw={1.9} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14, fontWeight: '700' }}>{row.name}</Text>
                    <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11, marginTop: 2 }}>{row.disabled ? '已停用' : '启用中'}{row.parent_id ? ' · 子 Key' : ''}{row.editor_name ? ` · ${row.editor_name}` : ''} · {fmtDate(row.expires_at)}</Text>
                  </View>
                  <Switch value={!row.disabled} disabled={busyId === row.id} onValueChange={() => toggle(row)} trackColor={{ false: t.track, true: t.ac }} />
                </Pressable>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: 49, marginTop: 8 }}>
                  <Chip text={strat?.label ?? row.selection_strategy ?? '默认策略'} color={t.acTx} bg={t.acGhost} />
                  {rpm ? <Chip text={`RPM ${rpm}`} /> : null}
                  {pw.length ? <Chip text={`渠道标签白名单 ${pw.length}`} /> : null}
                  {mw.length ? <Chip text={`模型白名单 ${mw.length}`} /> : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginLeft: 49, marginTop: 9 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'monospace', fontSize: 12, color: revealed[row.id] ? t.tx : t.tx3 }}>{revealed[row.id] ? (row.key || '—') : maskKey(row.key)}</Text>
                  <Pressable onPress={() => setRevealed((r) => ({ ...r, [row.id]: !r[row.id] }))} hitSlop={8} style={{ padding: 5 }}>{revealed[row.id] ? <Icons.eyeOff size={15} color={t.tx2} sw={1.9} /> : <Icons.eye size={15} color={t.tx2} sw={1.9} />}</Pressable>
                  <Pressable onPress={() => void copyKey(row)} hitSlop={8} style={{ padding: 5 }}><Icons.copy size={15} color={t.tx2} sw={1.9} /></Pressable>
                  <Pressable onPress={() => openEdit(row)} hitSlop={8} style={{ padding: 5 }}><Icons.edit size={15} color={t.tx2} sw={1.9} /></Pressable>
                  {!row.parent_id ? <Pressable onPress={() => openCopy(row)} hitSlop={8} style={{ padding: 5 }}><Icons.branch size={15} color={t.tx2} sw={1.9} /></Pressable> : null}
                  <Pressable onPress={() => remove(row)} hitSlop={8} style={{ padding: 5 }}><Icons.trash size={15} color={t.red} sw={1.9} /></Pressable>
                </View>
              </View>
            );
          })}
          {!rows.length ? <Text style={{ color: t.tx3, fontSize: 12.5 }}>暂无 API Key</Text> : null}
        </SectionCard>
      </AdminScreen>

      {/* 新建 / 编辑 / 派生 */}
      <AdminSheet visible={formOpen} title={formTitle} onClose={() => setFormOpen(false)} submitLabel={saving ? '保存中…' : '保存'} submitting={saving} onSubmit={submitForm} submitDisabled={!name.trim()}>
        <LabeledInput label="名称" value={name} onChangeText={setName} placeholder="Key 名称" />
        <Segmented label="选路策略" value={strategy} options={KEY_SELECTION_STRATEGIES} onChange={setStrategy} />
        <LabeledInput label="过期时间" value={expires} onChangeText={setExpires} placeholder="YYYY-MM-DD" hint="留空表示永不过期" />

        <Collapsible title={`限流配置（已设 ${RATE_FIELDS.filter((f) => parseInt(rate[f.key] ?? '', 10) > 0).length} 项）`}>
          <View style={{ gap: 10 }}>
            {RATE_FIELDS.map((f) => (
              <LabeledInput key={f.key} label={f.label} value={rate[f.key] ?? ''} onChangeText={(v) => setRateField(f.key, v)} placeholder="留空表示不限" keyboardType="numeric" />
            ))}
          </View>
        </Collapsible>

        <Collapsible title="总额度上限">
          <View style={{ gap: 10 }}>
            <LabeledInput label="最大请求数" value={maxReq} onChangeText={setMaxReq} placeholder="留空表示不限" keyboardType="numeric" />
            <LabeledInput label="最大总 Token" value={maxTok} onChangeText={setMaxTok} placeholder="留空表示不限" keyboardType="numeric" />
          </View>
        </Collapsible>

        <Collapsible title={`渠道范围（白 ${pWhite.length} / 黑 ${pBlack.length}）`}>
          <View style={{ gap: 12 }}>
            <ChipMultiSelect label="渠道标签白名单" options={providerTags} selected={pWhite} onToggle={toggleIn(pWhite, setPWhite)} hint="留空表示不限渠道" emptyText="暂无渠道，先在「渠道」页创建" />
            <ChipMultiSelect label="渠道标签黑名单" options={providerTags} selected={pBlack} onToggle={toggleIn(pBlack, setPBlack)} emptyText="暂无渠道" />
          </View>
        </Collapsible>

        <Collapsible title={`模型范围（白 ${mWhite.length} / 黑 ${mBlack.length}）`}>
          <View style={{ gap: 12 }}>
            <ChipMultiSelect label="模型白名单" options={models} selected={mWhite} onToggle={toggleIn(mWhite, setMWhite)} hint="留空表示不限模型" emptyText="渠道暂无模型" />
            <ChipMultiSelect label="模型黑名单" options={models} selected={mBlack} onToggle={toggleIn(mBlack, setMBlack)} emptyText="渠道暂无模型" />
          </View>
        </Collapsible>

        {mode === 'copy' ? <Text style={{ color: t.amber, fontSize: 11.5, lineHeight: 17 }}>子 Key 权限必须落在父 Key 范围内，越权后端会拒绝。</Text> : null}
      </AdminSheet>

      {/* 详情 */}
      <AdminSheet visible={!!detail} title={detail?.name ?? ''} onClose={() => setDetail(null)}>
        {detail ? (() => {
          const rl = (detail.rate_limit ?? {}) as Record<string, unknown>;
          const ul = (detail.usage_limit ?? {}) as Record<string, unknown>;
          const setRates = RATE_FIELDS.map((f) => ({ f, v: limitValue(rl, [...f.aliases]) })).filter((x) => x.v);
          const pw = asStringList(detail.provider_whitelist); const pb = asStringList(detail.provider_blacklist);
          const mw = asStringList(detail.model_whitelist); const mb = asStringList(detail.model_blacklist);
          return (
            <View>
              <DetailRow label="状态" value={detail.disabled ? '已停用' : '启用中'} color={detail.disabled ? t.red : t.add} />
              <DetailRow label="Key" value={maskKey(detail.key)} mono />
              <DetailRow label="选路策略" value={KEY_SELECTION_STRATEGIES.find((s) => s.value === (detail.selection_strategy || DEFAULT_KEY_SELECTION_STRATEGY))?.label} />
              <DetailRow label="过期时间" value={fmtDate(detail.expires_at)} />
              {detail.parent_id ? <DetailRow label="父 Key" value={`#${detail.parent_id}`} /> : null}
              {detail.editor_name ? <DetailRow label="所属编辑器" value={detail.editor_name} /> : null}
              <DetailRow label="最大请求数" value={limitValue(ul, ['max_requests']) ?? '不限'} />
              <DetailRow label="最大总 Token" value={limitValue(ul, ['max_total_tokens']) ?? '不限'} />
              {setRates.length ? setRates.map(({ f, v }) => <DetailRow key={f.key} label={f.label} value={v} />) : <DetailRow label="限流" value="未设置" />}
              <DetailRow label="渠道标签白名单" value={pw.length ? pw.join(', ') : '不限'} multiline />
              <DetailRow label="渠道标签黑名单" value={pb.length ? pb.join(', ') : '无'} multiline />
              <DetailRow label="模型白名单" value={mw.length ? mw.join(', ') : '不限'} multiline />
              <DetailRow label="模型黑名单" value={mb.length ? mb.join(', ') : '无'} multiline />
              <Pressable onPress={() => { const d = detail; setDetail(null); openEdit(d); }} style={({ pressed }) => [{ height: 44, borderRadius: 13, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center', marginTop: 12 }, pressed && { opacity: 0.7 }]}>
                <Text style={{ color: t.tx, fontWeight: '700', fontSize: 13.5 }}>编辑此 Key</Text>
              </Pressable>
            </View>
          );
        })() : null}
      </AdminSheet>

      <Modal visible={!!oneTimeKey} transparent animationType="fade" onRequestClose={() => setOneTimeKey(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 26 }}>
          <View style={{ backgroundColor: t.bg2, borderRadius: 22, padding: 20, gap: 12 }}>
            <Text style={{ color: t.tx, fontSize: 18, fontWeight: '800' }}>请立即保存此 Key</Text>
            <Text style={{ color: t.amber, fontSize: 12, lineHeight: 18 }}>明文仅显示这一次，关闭后无法再次查看。</Text>
            <Text selectable style={{ backgroundColor: t.termBg, color: t.termTx, borderRadius: 12, padding: 13, fontFamily: 'monospace', fontSize: 12 }}>{oneTimeKey?.key || '—'}</Text>
            <Pressable onPress={() => oneTimeKey && void copyKey(oneTimeKey)} style={{ height: 44, borderRadius: 13, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.acInk, fontWeight: '700' }}>复制 Key</Text></Pressable>
            <Pressable onPress={() => setOneTimeKey(null)} style={{ height: 40, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.tx2, fontWeight: '600' }}>我已保存</Text></Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
