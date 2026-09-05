/** 自定义模型与模型元数据：复用 /admin/model-routing、/admin/model-groups 与 metadata 接口。 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import {
  createAdminModelGroup, deleteAdminModelGroup, deleteAdminModelMetadata,
  getAdminModelMetadata, getAdminModelRouting,
  updateAdminModelGroup, updateAdminModelMetadata,
  type ModelMetadataEntry, type ModelMetadataResponse, type ModelMetadataUpdateBody, type ModelRoutingResponse,
} from '@/api/management';
import { AdminScreen, AdminSheet, Chip, FilterBar, LabeledInput, SearchableSelect, SectionCard, Segmented, StatCard, SwitchRow } from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';

const VIEWS = [{ value: 'groups', label: '自定义模型' }, { value: 'metadata', label: '模型元数据' }] as const;
type ViewMode = (typeof VIEWS)[number]['value'];

interface Scheme { id: string; name: string; models: string[]; provider_whitelist: string[]; provider_blacklist: string[]; is_backup: boolean }
interface GroupDraft { originalName: string; name: string; remark: string; enabled: boolean; aliases: string[]; response_model: string; metadata_model: string; backup_model_group: string; schemes: Scheme[]; active_scheme: string }

export default function ModelsScreen() {
  const t = useTheme();
  const [view, setView] = useState<ViewMode>('groups');
  const [metadata, setMetadata] = useState<ModelMetadataResponse | null>(null);
  const [routing, setRouting] = useState<ModelRoutingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<GroupDraft | null>(null);
  const [schemeId, setSchemeId] = useState('');
  const [selecting, setSelecting] = useState<'models' | 'allow' | 'deny' | null>(null);
  const [metaEdit, setMetaEdit] = useState<{ id: string; data?: ModelMetadataEntry } | null>(null);
  const [fName, setFName] = useState(''); const [fOwned, setFOwned] = useState(''); const [fCtx, setFCtx] = useState(''); const [fMax, setFMax] = useState(''); const [fInput, setFInput] = useState(''); const [fOutput, setFOutput] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { const [m, r] = await Promise.all([getAdminModelMetadata(), getAdminModelRouting()]); setMetadata(m); setRouting(r); }
    catch (e) { setError((e as Error)?.message || '加载失败'); }
  }, []);
  React.useEffect(() => { setLoading(true); void load().finally(() => setLoading(false)); }, [load]);

  const groups = routing?.model_groups?.groups ?? {};
  const groupRows = useMemo(() => Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)), [groups]);
  const providers = routing?.providers ?? [];
  const providerTags = useMemo(() => Array.from(new Set(providers.flatMap((provider) => provider.tags ?? []).map((tag) => tag.trim()).filter(Boolean))).sort(), [providers]);
  const modelOptions = useMemo(() => (routing?.models ?? []).filter((x) => x.type !== 'model_group').map(modelName).filter(Boolean), [routing]);
  const metaRows = useMemo(() => { const map = new Map((metadata?.models ?? []).map((m) => [m.model_id || m.id || '', m])); return (metadata?.runtime_models ?? []).map((r) => ({ ...r, display: r.metadata ?? map.get(r.model_id) })).sort((a, b) => a.model_id.localeCompare(b.model_id)); }, [metadata]);

  const openGroup = (name?: string, raw?: Record<string, unknown>) => { const next = groupFromRaw(name, raw); setSchemeId(next.active_scheme || next.schemes[0]?.id || ''); setGroup(next); };
  const patchGroup = (p: Partial<GroupDraft>) => setGroup((g) => g ? { ...g, ...p } : g);
  const patchScheme = (p: Partial<Scheme>) => setGroup((g) => g ? { ...g, schemes: g.schemes.map((s) => s.id === schemeId ? { ...s, ...p } : s) } : g);
  const activeScheme = group?.schemes.find((scheme) => scheme.id === schemeId) ?? group?.schemes[0];

  const saveGroup = useCallback(async () => {
    if (!group || busy) return;
    if (!group.name.trim()) { Alert.alert('名称不能为空'); return; }
    const schemes = group.schemes.map(cleanScheme);
    const active = schemes.find((s) => s.id === group.active_scheme) ?? schemes[0];
    if (!active?.models.length) { Alert.alert('启用方案至少需要一个模型'); return; }
    const payload = { name: group.name.trim(), remark: group.remark.trim(), enabled: group.enabled, aliases: group.aliases, models: active.models, provider_whitelist: active.provider_whitelist, provider_blacklist: active.provider_blacklist, backup_model_group: group.backup_model_group || null, response_model: group.response_model, metadata_model: group.metadata_model || null, schemes, active_scheme: active.id };
    setBusy(true);
    try { if (group.originalName) await updateAdminModelGroup(group.originalName, payload); else await createAdminModelGroup(payload); setGroup(null); await load(); }
    catch (e) { Alert.alert('保存失败', (e as Error)?.message || '请稍后重试'); }
    finally { setBusy(false); }
  }, [busy, group, load]);

  const removeGroup = (name: string) => Alert.alert('删除自定义模型', `确定删除“${name}”？`, [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void deleteAdminModelGroup(name).then(load).catch((e) => Alert.alert('删除失败', (e as Error)?.message || '请稍后重试')) }]);

  const openMeta = (id: string, m?: ModelMetadataEntry) => { setMetaEdit({ id, data: m }); setFName(m?.name ?? ''); setFOwned(m?.owned_by ?? ''); setFCtx(String(m?.max_context_tokens ?? '')); setFMax(String(m?.max_tokens ?? '')); setFInput((m?.input_modalities ?? []).join(', ')); setFOutput((m?.output_modalities ?? []).join(', ')); };
  const saveMeta = useCallback(async () => { if (!metaEdit || busy) return; const body: ModelMetadataUpdateBody = { name: fName.trim() || undefined, owned_by: fOwned.trim() || undefined, input_modalities: list(fInput), output_modalities: list(fOutput) }; const ctx = Number(fCtx); const max = Number(fMax); if (ctx > 0) body.max_context_tokens = ctx; if (max > 0) body.max_tokens = max; setBusy(true); try { await updateAdminModelMetadata(metaEdit.id, body); setMetaEdit(null); await load(); } catch (e) { Alert.alert('保存失败', (e as Error)?.message || '请稍后重试'); } finally { setBusy(false); } }, [busy, fCtx, fInput, fMax, fName, fOutput, fOwned, load, metaEdit]);

  return <>
    <AdminScreen active="models" loading={loading} error={error} onRetry={load} onRefresh={load}>
      <FilterBar value={view} options={VIEWS} onChange={setView} />
      {view === 'groups' ? <>
        <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><StatCard label="自定义模型" value={groupRows.length} /></View><View style={{ flex: 1 }}><StatCard label="已启用" value={groupRows.filter(([, x]) => x.enabled !== false).length} /></View></View>
        <Pressable onPress={() => openGroup()} style={({ pressed }) => [{ height: 44, borderRadius: 14, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 }, pressed && { opacity: 0.75 }]}><Icons.plus size={17} color="#fff" sw={2.2} /><Text style={{ color: '#fff', fontWeight: '700' }}>新增自定义模型</Text></Pressable>
        <SectionCard title={`路由组 (${groupRows.length})`}>{groupRows.map(([name, raw], i) => { const d = groupFromRaw(name, raw); const active = d.schemes.find((s) => s.id === d.active_scheme) ?? d.schemes[0]; return <View key={name} style={{ paddingVertical: 11, borderTopWidth: i ? 0.5 : 0, borderColor: t.line }}><View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}><View style={{ flex: 1 }}><Text style={{ color: t.tx, fontWeight: '700', fontFamily: 'monospace' }}>{name}</Text><Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 3 }}>{d.remark || '未设置备注'} · {active.models.length} 个成员 · {d.schemes.length} 套方案</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>{active.models.slice(0, 4).map((m) => <Chip key={m} text={m} />)}{active.models.length > 4 ? <Chip text={`+${active.models.length - 4}`} /> : null}</View></View><Chip text={d.enabled ? '启用' : '禁用'} color={d.enabled ? t.add : t.tx3} bg={t.bg3} /></View><View style={{ flexDirection: 'row', gap: 16, marginTop: 9 }}><Action text="详情编辑" onPress={() => openGroup(name, raw)} /><Action text="删除" color={t.red} onPress={() => removeGroup(name)} /></View></View>; })}{!groupRows.length ? <Text style={{ color: t.tx3 }}>暂无自定义模型</Text> : null}</SectionCard>
      </> : <>
        <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><StatCard label="运行时模型" value={metadata?.summary?.runtime_model_count ?? metaRows.length} /></View><View style={{ flex: 1 }}><StatCard label="缺少元数据" value={metadata?.summary?.missing_metadata_count ?? metaRows.filter((r) => !r.has_metadata).length} tone="warn" /></View></View>
        <SectionCard title={`模型 (${metaRows.length})`}>{metaRows.map((r, i) => <View key={r.model_id} style={{ paddingVertical: 11, borderTopWidth: i ? 0.5 : 0, borderColor: t.line }}><View style={{ flexDirection: 'row', gap: 9 }}><View style={{ flex: 1 }}><Text style={{ color: t.tx, fontWeight: '700', fontFamily: 'monospace' }}>{r.model_id}</Text><Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 3 }}>{r.display?.name || '未配置名称'} · {(r.providers ?? []).join(', ') || '无渠道'}</Text></View><Chip text={r.available ? '可用' : '不可用'} color={r.available ? t.add : t.amber} bg={t.bg3} /></View><View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}><Action text={r.has_metadata ? '编辑' : '配置'} onPress={() => openMeta(r.model_id, r.display)} />{r.has_metadata ? <Action text="清除元数据" color={t.red} onPress={() => Alert.alert('清除元数据', `清除 ${r.model_id} 的展示信息？`, [{ text: '取消' }, { text: '清除', style: 'destructive', onPress: () => void deleteAdminModelMetadata(r.model_id).then(load) }])} /> : null}</View></View>)}</SectionCard>
      </>}
    </AdminScreen>

    <AdminSheet visible={!!group} title={group?.originalName ? '编辑自定义模型' : '新增自定义模型'} onClose={() => setGroup(null)} submitLabel={busy ? '保存中…' : '保存'} submitting={busy} onSubmit={saveGroup}>{group && activeScheme ? <>
      <LabeledInput label="自定义模型 ID" value={group.name} onChangeText={(v) => patchGroup({ name: v })} placeholder="如 coding-best" /><LabeledInput label="显示备注" value={group.remark} onChangeText={(v) => patchGroup({ remark: v })} /><SwitchRow label="启用" value={group.enabled} onValueChange={(v) => patchGroup({ enabled: v })} />
      <LabeledInput label="别名" value={group.aliases.join(', ')} onChangeText={(v) => patchGroup({ aliases: list(v) })} hint="逗号分隔" /><LabeledInput label="响应模型名" value={group.response_model} onChangeText={(v) => patchGroup({ response_model: v })} /><LabeledInput label="元数据模型" value={group.metadata_model} onChangeText={(v) => patchGroup({ metadata_model: v })} placeholder="留空取成员最小值" />
      <Segmented label="当前方案" value={schemeId} options={group.schemes.map((s, i) => ({ value: s.id, label: s.name || `方案 ${i + 1}` }))} onChange={setSchemeId} />
      <View style={{ flexDirection: 'row', gap: 10 }}><Pressable onPress={() => { const id = `s-${Date.now().toString(36)}-${group.schemes.length}`; patchGroup({ schemes: [...group.schemes, { id, name: `方案${group.schemes.length + 1}`, models: [], provider_whitelist: [], provider_blacklist: [], is_backup: true }] }); setSchemeId(id); }} style={{ flex: 1, height: 38, borderRadius: 11, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.tx2, fontWeight: '700' }}>新增方案</Text></Pressable>{group.schemes.length > 1 ? <Pressable onPress={() => { const left = group.schemes.filter((s) => s.id !== activeScheme.id); patchGroup({ schemes: left, active_scheme: group.active_scheme === activeScheme.id ? left[0].id : group.active_scheme }); setSchemeId(left[0].id); }} style={{ flex: 1, height: 38, borderRadius: 11, backgroundColor: t.redGhost, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.red, fontWeight: '700' }}>删除方案</Text></Pressable> : null}</View>
      <LabeledInput label="方案名称" value={activeScheme.name} onChangeText={(v) => patchScheme({ name: v })} /><SwitchRow label="设为当前启用方案" value={group.active_scheme === activeScheme.id} onValueChange={(v) => v && patchGroup({ active_scheme: activeScheme.id })} /><SwitchRow label="备用方案" value={activeScheme.is_backup} onValueChange={(v) => patchScheme({ is_backup: v })} />
      <SelectRow label="成员模型" value={activeScheme.models.length ? `已选择 ${activeScheme.models.length} 个` : '搜索并选择模型'} onPress={() => setSelecting('models')} />
      <SelectRow label="渠道标签白名单" value={activeScheme.provider_whitelist.length ? `已选择 ${activeScheme.provider_whitelist.length} 个` : '不限'} onPress={() => setSelecting('allow')} />
      <SelectRow label="渠道标签黑名单" value={activeScheme.provider_blacklist.length ? `已选择 ${activeScheme.provider_blacklist.length} 个` : '无'} onPress={() => setSelecting('deny')} />
      <Segmented label="备用自定义模型" value={group.backup_model_group} options={[{ value: '', label: '无' }, ...Object.keys(groups).filter((x) => x !== group.originalName).map((x) => ({ value: x, label: x }))]} onChange={(v) => patchGroup({ backup_model_group: v })} />
    </> : null}</AdminSheet>

    <SearchableSelect visible={!!selecting && !!activeScheme} title={selecting === 'models' ? '选择成员模型' : selecting === 'allow' ? '选择渠道标签白名单' : '选择渠道标签黑名单'} options={selecting === 'models' ? modelOptions.map((m) => ({ value: m, label: m })) : providerTags.map((tag) => ({ value: tag, label: tag, sub: `${providers.filter((provider) => (provider.tags ?? []).includes(tag)).length} 个渠道` }))} selected={activeScheme ? (selecting === 'models' ? activeScheme.models : selecting === 'allow' ? activeScheme.provider_whitelist : activeScheme.provider_blacklist) : []} onChange={(values) => { if (selecting === 'models') patchScheme({ models: values }); else if (selecting === 'allow') patchScheme({ provider_whitelist: values }); else patchScheme({ provider_blacklist: values }); }} onClose={() => setSelecting(null)} multiple emptyText={selecting === 'models' ? '暂无可用模型' : activeScheme?.models.length ? '所选模型没有匹配渠道' : '请先选择成员模型'} />

    <AdminSheet visible={!!metaEdit} title={`模型元数据 · ${metaEdit?.id || ''}`} onClose={() => setMetaEdit(null)} submitLabel={busy ? '保存中…' : '保存'} submitting={busy} onSubmit={saveMeta}><LabeledInput label="显示名称" value={fName} onChangeText={setFName} /><LabeledInput label="厂商" value={fOwned} onChangeText={setFOwned} /><LabeledInput label="最大上下文" value={fCtx} onChangeText={setFCtx} keyboardType="numeric" /><LabeledInput label="最大输出" value={fMax} onChangeText={setFMax} keyboardType="numeric" /><LabeledInput label="输入模态" value={fInput} onChangeText={setFInput} hint="逗号分隔" /><LabeledInput label="输出模态" value={fOutput} onChangeText={setFOutput} hint="逗号分隔" /></AdminSheet>
  </>;
}

function SelectRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) { const t = useTheme(); return <Pressable onPress={onPress} style={({ pressed }) => [{ minHeight: 46, borderRadius: 13, backgroundColor: t.bg3, paddingHorizontal: 13, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 8 }, pressed && { opacity: 0.7 }]}><View style={{ flex: 1 }}><Text style={{ color: t.tx3, fontSize: 11 }}>{label}</Text><Text numberOfLines={1} style={{ color: t.tx, fontSize: 13.5, fontWeight: '700', marginTop: 2 }}>{value}</Text></View><Icons.search size={16} color={t.acTx} sw={2} /></Pressable>; }
function Action({ text, onPress, color }: { text: string; onPress: () => void; color?: string }) { const t = useTheme(); return <Pressable onPress={onPress}><Text style={{ color: color || t.acTx, fontSize: 12, fontWeight: '700' }}>{text}</Text></Pressable>; }
function list(v: unknown): string[] { if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean); if (typeof v === 'string') { try { const x = JSON.parse(v); if (Array.isArray(x)) return list(x); } catch {} return v.split(',').map((x) => x.trim()).filter(Boolean); } return []; }
function modelName(x: Record<string, unknown>): string { return String(x.model_id || x.id || x.name || x.upstream_model_id || ''); }
function cleanScheme(s: Scheme): Scheme { return { ...s, name: s.name.trim(), models: list(s.models), provider_whitelist: list(s.provider_whitelist), provider_blacklist: list(s.provider_blacklist), is_backup: !!s.is_backup }; }
function groupFromRaw(name?: string, raw?: Record<string, unknown>): GroupDraft { const topModels = list(raw?.models); const rawSchemes = Array.isArray(raw?.schemes) ? raw!.schemes as Record<string, unknown>[] : []; const schemes = rawSchemes.length ? rawSchemes.map((s, i) => ({ id: String(s.id || `legacy-${i}`), name: String(s.name || ''), models: list(s.models), provider_whitelist: list(s.provider_whitelist), provider_blacklist: list(s.provider_blacklist), is_backup: s.is_backup === true })) : [{ id: 'legacy-0', name: '默认方案', models: topModels, provider_whitelist: list(raw?.provider_whitelist), provider_blacklist: list(raw?.provider_blacklist), is_backup: false }]; const active = String(raw?.active_scheme || schemes[0].id); return { originalName: name || '', name: String(raw?.name || name || ''), remark: String(raw?.remark || ''), enabled: raw?.enabled !== false, aliases: list(raw?.aliases), response_model: String(raw?.response_model || ''), metadata_model: String(raw?.metadata_model || ''), backup_model_group: String(raw?.backup_model_group || raw?.backup_group || ''), schemes, active_scheme: schemes.some((s) => s.id === active) ? active : schemes[0].id }; }
