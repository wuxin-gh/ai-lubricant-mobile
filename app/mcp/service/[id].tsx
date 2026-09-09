/** MCP 个人服务编辑/新增（页面表单，非底部弹框）。 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createMyMcpService, listMyMcpServices, syncMyMcpService, updateMyMcpService, deleteMyMcpService, type MyMcpService } from '@/api/resources';
import { ApiError } from '@/api/client';
import { LabeledInput, SectionCard, SwitchRow } from '@/components/admin-ui';
import { EmptyView, GlassNav, LoadingView, PrimaryButton } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

export default function McpServiceEditScreen() {
  const t = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>(); const isNew = id === 'new';
  const [svc, setSvc] = useState<MyMcpService | null>(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [name, setName] = useState(''); const [display, setDisplay] = useState(''); const [desc, setDesc] = useState('');
  const [url, setUrl] = useState(''); const [token, setToken] = useState(''); const [headers, setHeaders] = useState('{}'); const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    (async () => {
      if (isNew) { setLoading(false); return; }
      try { const list = await listMyMcpServices(); const s = list.find((x) => String(x.id) === String(id)) || null; setSvc(s); setName(s?.name || ''); setDisplay(s?.display_name || ''); setDesc(s?.description || ''); setUrl(s?.url || ''); setHeaders(JSON.stringify(s?.headers || {}, null, 2)); setEnabled(s?.enabled ?? true); }
      finally { setLoading(false); }
    })();
  }, [id, isNew]);

  const save = async () => {
    if (busy) return; if (!name.trim() || !url.trim()) { Alert.alert('名称和 SSE URL 必填'); return; }
    let parsed: Record<string, string>; try { parsed = headers.trim() ? JSON.parse(headers) : {}; } catch { Alert.alert('Headers 必须是 JSON 对象'); return; }
    setBusy(true);
    try {
      const body = { display_name: display.trim(), description: desc.trim(), url: url.trim(), enabled, headers: parsed, ...(token.trim() ? { token: token.trim() } : {}) };
      if (isNew) await createMyMcpService({ ...body, name: name.trim(), url: url.trim() });
      else if (svc) await updateMyMcpService(svc.id, body);
      router.back();
    } catch (e) { Alert.alert('保存失败', e instanceof ApiError ? e.message : '请稍后重试'); } finally { setBusy(false); }
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载…" /><GlassNav title="MCP 服务" onBack={() => router.back()} /></View>;
  if (!isNew && !svc) return <View style={{ flex: 1, backgroundColor: t.bg }}><EmptyView title="未找到服务" icon="alert" /><GlassNav title="MCP 服务" onBack={() => router.back()} /></View>;

  return <View style={{ flex: 1, backgroundColor: t.bg }}><ScrollView contentContainerStyle={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 100, gap: 12 }}>
    {!isNew && svc ? <SectionCard title="运行状态"><Text style={{ color: svc.runtime_status === 'error' ? t.red : t.tx3, fontSize: 12.5 }}>{svc.runtime_status || '未同步'} · {svc.tool_count || 0} 个工具</Text>{svc.runtime_last_error ? <Text style={{ color: t.red, fontSize: 11, marginTop: 4 }}>{svc.runtime_last_error}</Text> : null}<View style={{ flexDirection: 'row', gap: 14, marginTop: 8 }}><PrimaryButton label="同步工具" onPress={() => void syncMyMcpService(svc.id).then((r) => Alert.alert(r.ok ? '同步完成' : '同步失败', r.ok ? `发现 ${r.tool_count || 0} 个工具` : r.error || '未知错误')).catch((e) => Alert.alert('同步失败', e instanceof ApiError ? e.message : '请稍后重试'))} /></View></SectionCard> : null}
    <SectionCard title={isNew ? '新建 MCP 服务' : '设置'}>
      <LabeledInput label="名称" value={name} onChangeText={setName} disabled={!isNew} hint={isNew ? '创建后不可改' : undefined} />
      <LabeledInput label="显示名" value={display} onChangeText={setDisplay} />
      <LabeledInput label="描述" value={desc} onChangeText={setDesc} multiline />
      <LabeledInput label="SSE URL" value={url} onChangeText={setUrl} autoCapitalize="none" />
      <LabeledInput label="Bearer Token" value={token} onChangeText={setToken} secureTextEntry hint={svc?.has_token ? '留空保留现有 Token' : '可选'} />
      <LabeledInput label="自定义 Headers JSON" value={headers} onChangeText={setHeaders} multiline autoCapitalize="none" />
      <SwitchRow label="启用" value={enabled} onValueChange={setEnabled} />
    </SectionCard>
    {!isNew && svc ? <View>
      <PrimaryButton label="删除服务" onPress={() => Alert.alert('删除 MCP', `删除“${svc.display_name || svc.name}”？`, [{ text: '取消' }, { text: '删除', style: 'destructive', onPress: () => void deleteMyMcpService(svc.id).then(() => router.back()).catch((e) => Alert.alert('删除失败', e instanceof ApiError ? e.message : '请稍后重试')) }])} block style={{ backgroundColor: t.red }} />
      {svc.tools?.length ? <SectionCard title={`工具（${svc.tools.length}）`}>{svc.tools.map((x) => <Text key={x.name} numberOfLines={1} style={{ color: t.tx2, fontSize: 11.5, fontFamily: 'monospace', paddingVertical: 2 }}>{x.name}</Text>)}</SectionCard> : null}
    </View> : null}
  </ScrollView><View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.pad, paddingTop: 10, paddingBottom: insets.bottom + 10, backgroundColor: t.bg, borderTopWidth: 1, borderColor: t.line }}><PrimaryButton label={busy ? '保存中…' : '保存'} icon="check" onPress={() => void save()} disabled={busy} block /></View><GlassNav title={isNew ? '新增 MCP 服务' : svc?.display_name || svc?.name || 'MCP 服务'} onBack={() => router.back()} /></View>;
}
