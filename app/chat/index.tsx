/**
 * 聊天会话列表：分页加载 + 多选删除 + 单条删除。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { batchDeleteChatConversations, deleteChatConversation } from '@/api/agent';
import { useChatList } from '@/hooks/useChatConversation';
import { Icons } from '@/components/Icons';
import { BigTitle, EmptyView, GlassNav, LoadingView } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

export default function ChatListScreen() {
  const t = useTheme();
  const router = useRouter();
  const { items, loading, error, reload, hasMore, loadingMore, loadMore } = useChatList();
  const [refreshing, setRefreshing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void reload().finally(() => setRefreshing(false));
  }, [reload]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelecting = () => { setSelecting(false); setSelected(new Set()); };

  const confirmBatchDelete = () => {
    const ids = [...selected];
    if (!ids.length) return;
    Alert.alert('批量删除', `删除选中的 ${ids.length} 个对话？此操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try { await batchDeleteChatConversations(ids); exitSelecting(); void reload(); }
        catch (e) { Alert.alert('删除失败', e instanceof ApiError ? e.message : '请稍后重试'); }
      } },
    ]);
  };

  const remove = (id: string, title?: string) => {
    Alert.alert('删除对话', `确定删除「${title || '新对话'}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try { await deleteChatConversation(id); void reload(); }
        catch (e) { Alert.alert('删除失败', e instanceof ApiError ? e.message : '请稍后重试'); }
      } },
    ]);
  };

  if (loading && !items.length) {
    return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载聊天…" /><GlassNav title="聊天" onBack={() => router.back()} /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: spacing.pad + 48, paddingHorizontal: spacing.pad, paddingBottom: 40, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.ac} />}
        onEndReached={() => { if (hasMore && !loadingMore) void loadMore(); }}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={<BigTitle title="聊天" sub={selecting ? `已选 ${selected.size} 个 · 点右上角完成` : '直接与模型对话，不跑 Agent 工具'} />}
        ListEmptyComponent={error ? <View style={{ flex: 1, minHeight: 260 }}><EmptyView title="加载失败" subtitle={error} icon="alert" /></View> : <View style={{ flex: 1, minHeight: 260 }}><EmptyView title="还没有聊天" subtitle="点击右上角新建一个对话" icon="mail" /></View>}
        renderItem={({ item }) => {
          const checked = selected.has(item.id);
          return (
            <Pressable
              onPress={() => (selecting ? toggleSelect(item.id) : router.push(`/chat/${item.id}` as never))}
              onLongPress={() => { if (!selecting) { setSelecting(true); toggleSelect(item.id); } else remove(item.id, item.title); }}
              style={({ pressed }) => [{ marginTop: spacing.gap, padding: 16, borderRadius: 16, backgroundColor: checked ? t.acGhost : t.bg2, borderWidth: 1, borderColor: checked ? t.ac : t.line2, ...t.shCard }, pressed && { opacity: 0.75 }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}><Icons.mail size={20} color={t.acTx} sw={1.9} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: t.tx, fontSize: 15, fontWeight: '700' }}>{item.title || '新对话'}</Text>
                  <Text numberOfLines={1} style={{ marginTop: 4, color: t.tx3, fontSize: 11.5 }}>{item.model || '默认模型'}</Text>
                </View>
                {selecting
                  ? <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: checked ? t.ac : t.line2, backgroundColor: checked ? t.ac : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{checked ? <Icons.check size={13} color={t.acInk} sw={3} /> : null}</View>
                  : <Icons.chevron size={17} color={t.tx3} sw={1.8} />}
              </View>
            </Pressable>
          );
        }}
        ListFooterComponent={loadingMore ? <Text style={{ textAlign: 'center', color: t.tx3, fontSize: 12, paddingVertical: 14 }}>加载中…</Text> : null}
      />
      <GlassNav
        title="聊天"
        onBack={() => router.back()}
        right={
          selecting ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable onPress={confirmBatchDelete} disabled={!selected.size} hitSlop={8} style={{ padding: 8, opacity: selected.size ? 1 : 0.4 }}>
                <Icons.trash size={20} color={t.red} sw={2} />
              </Pressable>
              <Pressable onPress={exitSelecting} hitSlop={8} style={{ padding: 8 }}>
                <Text style={{ color: t.acTx, fontSize: 13.5, fontWeight: '700' }}>完成</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => router.push('/chat/new' as never)} hitSlop={8} style={{ padding: 8 }}><Icons.plus size={21} color={t.acTx} sw={2.2} /></Pressable>
          )
        }
      />
    </View>
  );
}
