import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { batchDeleteAgentConversations, deleteAgentConversation, listAgentConversationsPage, listAgents, type AgentConversation, type AgentDef } from '@/api/agent';
import { SearchableSelect } from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { BigTitle, EmptyView, GlassNav, LoadingView } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

const SELECTED_AGENT_KEY = 'mc.agent.selectedId';

export default function AgentListScreen() {
  const t = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<AgentConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(false);

  const load = useCallback(async (refresh = false, agentId?: number | null) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const defs = await listAgents().catch(() => [] as AgentDef[]);
      const enabled = defs.filter((agent) => agent.enabled !== false);
      setAgents(enabled);
      const stored = Number(await AsyncStorage.getItem(SELECTED_AGENT_KEY));
      const next = agentId ?? enabled.find((agent) => agent.id === stored)?.id ?? enabled[0]?.id ?? null;
      setSelectedAgentId(next);
      if (next) await AsyncStorage.setItem(SELECTED_AGENT_KEY, String(next)); else await AsyncStorage.removeItem(SELECTED_AGENT_KEY);
      const page = await listAgentConversationsPage({ limit: 20, agentId: next ?? undefined });
      setItems(page.conversations);
      cursorRef.current = page.page.cursor;
      hasMoreRef.current = page.page.has_next_page;
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载 Agent 对话失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(false); }, [load]));

  const loadMore = async () => {
    if (!hasMoreRef.current || !cursorRef.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listAgentConversationsPage({ limit: 20, cursor: cursorRef.current, agentId: selectedAgentId ?? undefined });
      setItems((prev) => [...prev, ...page.conversations]);
      cursorRef.current = page.page.cursor;
      hasMoreRef.current = page.page.has_next_page;
    } catch {
      /* 静默 */
    } finally { setLoadingMore(false); }
  };

  const toggleSelect = (id: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const exitSelecting = () => { setSelecting(false); setSelected(new Set()); };

  const remove = (item: AgentConversation) => {
    Alert.alert('删除对话', `确定删除「${item.title || '新对话'}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try { await deleteAgentConversation(item.id); setItems((prev) => prev.filter((x) => x.id !== item.id)); }
        catch (e) { Alert.alert('删除失败', e instanceof ApiError ? e.message : '请稍后重试'); }
      } },
    ]);
  };

  const batchRemove = () => {
    const ids = [...selected];
    if (!ids.length) return;
    Alert.alert('批量删除', `删除选中的 ${ids.length} 个 Agent 对话？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try { await batchDeleteAgentConversations(ids); exitSelecting(); await load(true, selectedAgentId); }
        catch (e) { Alert.alert('删除失败', e instanceof ApiError ? e.message : '请稍后重试'); }
      } },
    ]);
  };

  if (loading && !items.length) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载 Agent 对话…" /><GlassNav title="Agent" onBack={() => router.back()} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: spacing.pad + 48, paddingHorizontal: spacing.pad, paddingBottom: 40, flexGrow: 1 }}
        refreshing={refreshing}
        onRefresh={() => { void load(true, selectedAgentId); }}
        onEndReached={() => { void loadMore(); }}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={<View><BigTitle title="Agent 对话" sub={selecting ? `已选 ${selected.size} 个` : '让 Agent 帮你分析、实现和处理任务'} /><Pressable onPress={() => setAgentPickerOpen(true)} style={({ pressed }) => [{ marginTop: 12, minHeight: 50, borderRadius: 14, paddingHorizontal: 13, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2, flexDirection: 'row', alignItems: 'center', gap: 10 }, pressed && { opacity: 0.75 }]}><View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}><Icons.brain size={18} color={t.acTx} sw={1.9} /></View><View style={{ flex: 1 }}><Text style={{ color: t.tx3, fontSize: 11 }}>当前 Agent</Text><Text numberOfLines={1} style={{ color: t.tx, fontSize: 14.5, fontWeight: '700', marginTop: 2 }}>{agents.find((agent) => agent.id === selectedAgentId)?.display_name || agents.find((agent) => agent.id === selectedAgentId)?.name || '暂无可用 Agent'}</Text></View><Icons.chevron size={16} color={t.tx3} /></Pressable></View>}
        renderItem={({ item }) => {
          const checked = selected.has(item.id);
          return (
            <Pressable
              onPress={() => selecting ? toggleSelect(item.id) : router.push(`/agent/${item.id}` as never)}
              onLongPress={() => { if (!selecting) { setSelecting(true); toggleSelect(item.id); } else remove(item); }}
              style={({ pressed }) => [{ marginTop: spacing.gap, padding: 16, borderRadius: 16, backgroundColor: checked ? t.acGhost : t.bg2, borderWidth: 1, borderColor: checked ? t.ac : t.line2, ...t.shCard }, pressed && { opacity: 0.75 }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}><Icons.sparkle size={21} color={t.acTx} sw={1.9} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: t.tx, fontSize: 15, fontWeight: '700' }}>{item.title || '新对话'}</Text>
                  <Text numberOfLines={1} style={{ marginTop: 4, color: t.tx3, fontSize: 11.5 }}>{item.model || '默认模型'}</Text>
                </View>
                {selecting ? <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: checked ? t.ac : t.line2, backgroundColor: checked ? t.ac : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{checked ? <Icons.check size={13} color={t.acInk} sw={3} /> : null}</View> : <Icons.chevron size={17} color={t.tx3} sw={1.8} />}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={error ? <View style={{ flex: 1, minHeight: 260 }}><EmptyView title="加载失败" subtitle={error} icon="alert" /></View> : <View style={{ flex: 1, minHeight: 260 }}><EmptyView title="还没有 Agent 对话" subtitle="点击右上角新建一个对话" icon="sparkle" /></View>}
        ListFooterComponent={loadingMore ? <Text style={{ textAlign: 'center', color: t.tx3, fontSize: 12, paddingVertical: 14 }}>加载中…</Text> : null}
      />
      <GlassNav
        title="Agent"
        onBack={() => router.back()}
        right={selecting ? <View style={{ flexDirection: 'row', alignItems: 'center' }}><Pressable onPress={batchRemove} disabled={!selected.size} hitSlop={8} style={{ padding: 8, opacity: selected.size ? 1 : 0.4 }}><Icons.trash size={20} color={t.red} sw={2} /></Pressable><Pressable onPress={exitSelecting} hitSlop={8} style={{ padding: 8 }}><Text style={{ color: t.acTx, fontSize: 13.5, fontWeight: '700' }}>完成</Text></Pressable></View> : <View style={{ flexDirection: 'row', alignItems: 'center' }}><Pressable onPress={() => router.push('/agent/manage' as never)} hitSlop={8} style={{ padding: 8 }}><Icons.settings size={19} color={t.tx2} sw={2} /></Pressable><Pressable onPress={() => router.push({ pathname: '/agent/new', params: selectedAgentId ? { agentId: String(selectedAgentId) } : {} } as never)} hitSlop={8} style={{ padding: 8 }}><Icons.plus size={21} color={t.acTx} sw={2.2} /></Pressable></View>}
      />
      <SearchableSelect visible={agentPickerOpen} title="选择 Agent" options={agents.map((agent) => ({ value: String(agent.id), label: agent.display_name || agent.name || `Agent #${agent.id}`, sub: agent.description || agent.main_model || undefined, keywords: `${agent.name || ''} ${agent.main_model || ''}` }))} selected={selectedAgentId ? [String(selectedAgentId)] : []} onChange={(values) => { const next = Number(values[0]); setSelectedAgentId(next || null); if (next) { void AsyncStorage.setItem(SELECTED_AGENT_KEY, String(next)); void load(true, next); } }} onClose={() => setAgentPickerOpen(false)} emptyText="暂无可用 Agent" />
    </View>
  );
}
