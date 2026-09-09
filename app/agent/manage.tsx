/**
 * Agent 管理（列表）：只负责展示与入口——卡片摘要 + 启停；点卡片进入
 * /agent/manage/[id] 编辑页（整页表单，不再列表+弹框挤一屏）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  deleteAgent,
  listAgents,
  toggleAgent,
  type AgentDef,
} from '@/api/agent';
import { ApiError } from '@/api/client';
import { Chip } from '@/components/admin-ui';
import { EmptyView, GlassNav, LoadingView } from '@/components/ui';
import { Icons } from '@/components/Icons';
import { spacing, useTheme } from '@/theme';

export default function AgentManagerScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [rows, setRows] = useState<AgentDef[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setRows(await listAgents());
    } catch (e) {
      Alert.alert('加载失败', (e as Error)?.message || '请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const confirmDelete = (a: AgentDef) => {
    Alert.alert('删除 Agent', `删除“${a.display_name || a.name}”？`, [
      { text: '取消' },
      { text: '删除', style: 'destructive', onPress: () => { void deleteAgent(a.id).then(load).catch((e) => Alert.alert('删除失败', e instanceof ApiError ? e.message : '请稍后重试')); } },
    ]);
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载 Agent…" /><GlassNav title="Agent 管理" onBack={() => router.back()} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 40, gap: 10 }}>
        <Pressable onPress={() => router.push('/agent/manage/new' as never)} style={({ pressed }) => [{ height: 46, borderRadius: 14, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 }, pressed && { opacity: 0.8 }]}>
          <Icons.plus size={18} color={t.acInk} sw={2.4} />
          <Text style={{ color: t.acInk, fontWeight: '700', fontSize: 15 }}>新增 Agent</Text>
        </Pressable>

        {rows.map((a) => (
          <Pressable
            key={a.id}
            onPress={() => router.push(`/agent/manage/${a.id}` as never)}
            style={({ pressed }) => [{ padding: 15, borderRadius: 15, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2, ...t.shCard }, pressed && { opacity: 0.8 }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: t.tx, fontSize: 15, fontWeight: '700', flexShrink: 1 }}>{a.display_name || a.name}</Text>
                  {a.is_team_shared ? <Chip text="团队共享" color={t.acTx} bg={t.acGhost} /> : null}
                  {a.enabled === false ? <Chip text="已停用" color={t.tx3} bg={t.bg4} /> : null}
                </View>
                {a.description ? <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11.5, marginTop: 3 }}>{a.description}</Text> : null}
                <Text style={{ color: t.tx3, fontSize: 10.5, fontFamily: 'monospace', marginTop: 4 }}>{a.main_model || a.model || '未配置模型'}</Text>
                {a.stats ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                    <Text style={{ color: t.tx3, fontSize: 10.5 }}>记忆 {a.stats.insights ?? 0}/{a.stats.facts ?? 0}/{a.stats.skills ?? 0}</Text>
                    <Text style={{ color: t.tx3, fontSize: 10.5 }}>对话 {a.stats.conversations ?? 0}</Text>
                    <Text style={{ color: t.tx3, fontSize: 10.5 }}>定时 {a.stats.scheduled_tasks ?? 0}</Text>
                  </View>
                ) : null}
              </View>
              <Icons.chevron size={17} color={t.tx3} sw={1.8} />
            </View>
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 10 }}>
              <Pressable onPress={() => void toggleAgent(a.id).then(load).catch((e) => Alert.alert('操作失败', e instanceof ApiError ? e.message : '请稍后重试'))} hitSlop={6}>
                <Text style={{ color: t.acTx, fontWeight: '700' }}>{a.enabled === false ? '启用' : '停用'}</Text>
              </Pressable>
              <Pressable onPress={() => router.push({ pathname: '/agent/new', params: { agentId: String(a.id) } } as never)} hitSlop={6}><Text style={{ color: t.acTx, fontWeight: '700' }}>发起对话</Text></Pressable>
              <Pressable onPress={() => router.push('/agent/scheduled' as never)} hitSlop={6}><Text style={{ color: t.acTx, fontWeight: '700' }}>定时任务</Text></Pressable>
              {a.user_id ? <Pressable onPress={() => confirmDelete(a)} hitSlop={6}><Text style={{ color: t.red, fontWeight: '700' }}>删除</Text></Pressable> : null}
            </View>
          </Pressable>
        ))}
        {!rows.length ? <EmptyView title="暂无 Agent" subtitle="创建一个个人 Agent" icon="sparkle" /> : null}
      </ScrollView>
      <GlassNav title="Agent 管理" onBack={() => router.back()} />
    </View>
  );
}
