/**
 * 任务工作区中的 Agent 对话入口。
 *
 * 后端当前没有 task_id ↔ conversation_id 的可靠绑定字段，因此这里不制造隐式一对一关系：
 * 展示当前用户已有会话供选择，并提供以任务标题新建会话的入口。选择后进入复用的 Agent
 * 详情页；消息历史与 SSE 流仍完全由服务端 conversation API 管理。
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { createAgentConversation, listAgentConversations, type AgentConversation as Conversation } from '@/api/agent';
import { Icons } from '@/components/Icons';
import { EmptyView } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

export function AgentConversation({ taskId, projectId }: { taskId: string; projectId?: string }) {
  const t = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await listAgentConversations());
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载 Agent 对话失败');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const conv = await createAgentConversation({ title: `任务 ${taskId.slice(0, 8)}` });
      router.push(`/agent/${conv.id}` as never);
    } catch (e) {
      Alert.alert('创建失败', e instanceof ApiError ? e.message : '请稍后重试');
    } finally {
      setCreating(false);
    }
  }, [creating, router, taskId]);

  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.ac} /></View>;

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.pad, paddingTop: 14, paddingBottom: 100, gap: 10 }}>
      <View style={{ padding: 13, borderRadius: 14, backgroundColor: t.amberGhost }}>
        <Text style={{ color: t.amber, fontSize: 12, lineHeight: 18 }}>
          当前后端未保存任务与 Agent 会话的绑定关系，请选择已有会话或新建。不会自动关联错误的会话。
        </Text>
      </View>
      <Pressable onPress={create} disabled={creating} style={({ pressed }) => [{ height: 48, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: t.ac }, (pressed || creating) && { opacity: 0.7 }]}>
        {creating ? <ActivityIndicator size="small" color={t.acInk} /> : <Icons.plus size={17} color={t.acInk} sw={2.1} />}
        <Text style={{ color: t.acInk, fontSize: 14, fontWeight: '700' }}>{creating ? '创建中…' : '为此任务新建 Agent 对话'}</Text>
      </Pressable>
      {error && !rows.length ? <EmptyView title="加载失败" subtitle={error} icon="alert" /> : null}
      {rows.map((row) => (
        <Pressable key={row.id} onPress={() => router.push(`/agent/${row.id}` as never)} style={({ pressed }) => [{ padding: 14, borderRadius: 15, backgroundColor: t.bg2, flexDirection: 'row', alignItems: 'center', gap: 11, ...t.shCard }, pressed && { opacity: 0.72 }]}>
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}>
            <Icons.sparkle size={18} color={t.acTx} sw={1.9} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14, fontWeight: '700' }}>{row.title || '新对话'}</Text>
            <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11.5, marginTop: 3 }}>{row.model || '默认模型'}{row.status ? ` · ${row.status}` : ''}</Text>
          </View>
          <Icons.chevron size={16} color={t.tx3} sw={1.9} />
        </Pressable>
      ))}
      {!error && !rows.length ? <EmptyView title="还没有 Agent 对话" subtitle="点击上方按钮创建" icon="sparkle" /> : null}
    </ScrollView>
  );
}
