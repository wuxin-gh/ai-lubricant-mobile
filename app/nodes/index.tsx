/**
 * 用户侧执行节点（只读）：对齐 Web /console/nodes。
 * 管理节点作为可折叠分组父行（「N 个执行节点」），执行节点为子行；
 * 点执行节点进入详情页。不提供入驻/审批/迁移等管理操作（那是管理端的事）。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listNodes, ApiError } from '@/api/client';
import type { Node } from '@/api/types';
import { Icons } from '@/components/Icons';
import { EmptyView, GlassNav, LoadingView } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

/** 行模型：管理节点（分组头，可折叠）或执行节点（可点进详情）。 */
type Row = { kind: 'header'; node: Node; collapsed: boolean } | { kind: 'exec'; node: Node };

function osOf(node: Node): string {
  const caps = node.capabilities as { os?: string } | undefined;
  return caps?.os || '—';
}
function versionOf(node: Node): string {
  const caps = node.capabilities as { client_version?: string } | undefined;
  return caps?.client_version || '—';
}

export default function UserNodesScreen() {
  const t = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true); setError('');
    try { setNodes(await listNodes()); }
    catch (e) { setError(e instanceof ApiError ? e.message : '加载失败'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(false); }, [load]));

  const rows = React.useMemo<Row[]>(() => {
    const out: Row[] = [];
    const seenGroups = new Set<string>();
    for (const n of nodes) {
      if (n.node_role === 'management' || n.node_role === 'passive_management') {
        if (seenGroups.has(n.node_id || '')) continue;
        seenGroups.add(n.node_id || '');
        out.push({ kind: 'header', node: n, collapsed: collapsedGroups.has(n.node_id || '') });
        continue;
      }
      out.push({ kind: 'exec', node: n });
    }
    // 无归属管理节点（或管理员未分管理节点）时直接平铺执行节点。
    return out;
  }, [nodes, collapsedGroups]);

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载节点…" /><GlassNav title="执行节点" onBack={() => router.back()} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(row, i) => row.node.node_id || `row-${i}`}
        contentContainerStyle={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 40, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={t.ac} />}
        ListEmptyComponent={error ? <EmptyView title="加载失败" subtitle={error} icon="alert" /> : <EmptyView title="暂无可用节点" subtitle="节点由管理员分配给分组后出现在这里" icon="terminal" />}
        renderItem={({ item }) => item.kind === 'header' ? (
          <Pressable
            onPress={() => setCollapsedGroups((prev) => { const next = new Set(prev); const k = item.node.node_id || ''; if (next.has(k)) next.delete(k); else next.add(k); return next; })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 13, borderRadius: 14, backgroundColor: t.bg3, marginTop: 10 }}
          >
            <Icons.server size={17} color={t.tx2} sw={1.9} />
            <Text numberOfLines={1} style={{ flex: 1, color: t.tx, fontSize: 14.5, fontWeight: '700' }}>{item.node.node_name || item.node.node_id}{item.node.display_only ? '（仅归属展示）' : ''}</Text>
            <Text style={{ color: t.tx3, fontSize: 11.5 }}>{nodes.filter((x) => x.manager_node_id === item.node.node_id && x.node_role !== 'management').length} 个执行节点</Text>
            <Icons.chevron size={15} color={t.tx3} style={{ transform: [{ rotate: item.collapsed ? '0deg' : '90deg' }] }} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => router.push(`/nodes/${encodeURIComponent(item.node.node_id || '')}` as never)}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 13, borderRadius: 15, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2, marginTop: 8 }, pressed && { opacity: 0.75 }]}
          >
            <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: item.node.online ? t.ac : t.track }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14, fontWeight: '700' }}>{item.node.node_name || item.node.node_id}</Text>
              <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11, marginTop: 3 }}>{osOf(item.node)} · v{versionOf(item.node)}{item.node.active_sessions != null ? ` · ${item.node.active_sessions} 会话` : ''}</Text>
            </View>
            <Icons.chevron size={16} color={t.tx3} />
          </Pressable>
        )}
      />
      <GlassNav title="执行节点" onBack={() => router.back()} />
    </View>
  );
}
