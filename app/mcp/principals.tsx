/** MCP 用户（principal）管理 + 新建 MCP 服务入口。 */
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listMcpPrincipals, createMcpPrincipal, deleteMcpPrincipal, rotateMcpPrincipalToken, updateMcpPrincipal, type McpPrincipal } from '@/api/mcpCenter';
import { ApiError } from '@/api/client';
import { AdminSheet, LabeledInput, SwitchRow } from '@/components/admin-ui';
import { EmptyView, GlassNav, LoadingView, PrimaryButton } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

export default function McpPrincipalsScreen() {
  const t = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const [rows, setRows] = useState<McpPrincipal[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false); const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [enabled, setEnabled] = useState(true);

  const load = async () => { try { setRows(await listMcpPrincipals()); } catch (e) { Alert.alert('加载失败', e instanceof ApiError ? e.message : '请稍后重试'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);

  const openNew = () => { setName(''); setDesc(''); setEnabled(true); setEditOpen(true); };
  const create = async () => { if (busy) return; if (!name.trim()) { Alert.alert('请填写名称'); return; } setBusy(true); try { await createMcpPrincipal({ name: name.trim(), description: desc.trim(), enabled }); setEditOpen(false); await load(); } catch (e) { Alert.alert('创建失败', e instanceof ApiError ? e.message : '请稍后重试'); } finally { setBusy(false); } };
  const showToken = (token: string) => Alert.alert('Token（仅显示一次）', `${token}\n\n请复制保存。`, [{ text: '复制', onPress: () => void Clipboard.setStringAsync(token) }, { text: '我已保存' }]);

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载 MCP 用户…" /><GlassNav title="MCP 用户" onBack={() => router.back()} /></View>;

  return <View style={{ flex: 1, backgroundColor: t.bg }}><FlatList data={rows} keyExtractor={(r) => String(r.id)} contentContainerStyle={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 40, flexGrow: 1 }} ListHeaderComponent={<View style={{ gap: 12, marginBottom: 4 }}><PrimaryButton label="新增 MCP 主体" icon="plus" onPress={openNew} block /><PrimaryButton label="新增个人 MCP 服务" icon="cube" onPress={() => router.push('/mcp/service/new' as never)} block style={{ backgroundColor: t.bg2 }} /></View>} ItemSeparatorComponent={() => <View style={{ height: 10 }} />} renderItem={({ item }) => <View style={{ padding: 15, borderRadius: 16, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: t.tx, fontSize: 14.5, fontWeight: '700' }}>{item.name}</Text>{item.description ? <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11.5, marginTop: 3 }}>{item.description}</Text> : null}<Text style={{ color: t.tx3, fontSize: 10.5, marginTop: 4 }}>Token {item.token_hint || '—'} · {item.enabled ? '已启用' : '已停用'}</Text></View><Pressable onPress={() => void toggle(item)} hitSlop={6}><Text style={{ color: t.acTx, fontWeight: '700', fontSize: 12 }}>{item.enabled ? '停用' : '启用'}</Text></Pressable></View><View style={{ flexDirection: 'row', gap: 16, marginTop: 10 }}><Pressable onPress={() => void rotateMcpPrincipalToken(item.id).then((r) => { if (r.token) showToken(r.token); }).catch((e) => Alert.alert('轮换失败', e instanceof ApiError ? e.message : '请稍后重试'))} hitSlop={6}><Text style={{ color: t.acTx, fontWeight: '700', fontSize: 12 }}>轮换 Token</Text></Pressable><Pressable onPress={() => Alert.alert('删除主体', `删除“${item.name}”？`, [{ text: '取消' }, { text: '删除', style: 'destructive', onPress: () => void deleteMcpPrincipal(item.id).then(load).catch((e) => Alert.alert('删除失败', e instanceof ApiError ? e.message : '请稍后重试')) }])} hitSlop={6}><Text style={{ color: t.red, fontWeight: '700', fontSize: 12 }}>删除</Text></Pressable></View></View>} ListEmptyComponent={<EmptyView title="暂无 MCP 主体" subtitle="创建主体以绑定服务与资源" icon="cube" />} /><GlassNav title="MCP 用户" onBack={() => router.back()} /><AdminSheet visible={editOpen} title="新增 MCP 主体" onClose={() => setEditOpen(false)} submitLabel="创建" onSubmit={create} submitting={busy}><LabeledInput label="名称" value={name} onChangeText={setName} /><LabeledInput label="描述" value={desc} onChangeText={setDesc} multiline /><SwitchRow label="启用" value={enabled} onValueChange={setEnabled} /></AdminSheet></View>;

  function toggle(item: McpPrincipal) { void updateMcpPrincipal(item.id, { enabled: !item.enabled }).then(load).catch((e) => Alert.alert('操作失败', e instanceof ApiError ? e.message : '请稍后重试')); }
}
