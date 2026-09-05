import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { createAgentConversation, listAgents, type AgentDef } from '@/api/agent';
import { ApiError } from '@/api/client';
import { Icons } from '@/components/Icons';
import { LabeledInput } from '@/components/admin-ui';
import { GlassNav, LoadingView } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

export default function NewAgentConversationScreen() {
  const t = useTheme();
  const router = useRouter();
  const { agentId } = useLocalSearchParams<{ agentId?: string }>();
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<AgentDef | null>(null);
  const [title, setTitle] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const list = await listAgents();
        const enabled = list.filter((a) => a.enabled !== false);
        setAgents(enabled);
        const stored = await AsyncStorage.getItem('mc.agent.selectedId');
        const selected = enabled.find((a) => String(a.id) === agentId) || enabled.find((a) => String(a.id) === stored) || enabled[0];
        if (selected) { setPicked(selected); await AsyncStorage.setItem('mc.agent.selectedId', String(selected.id)); }
      } catch {
        /* 忽略：没有可用 Agent 时仍允许建空对话 */
      } finally {
        setLoading(false);
      }
    })();
  }, [agentId]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const conv = await createAgentConversation({
        title: title.trim() || undefined,
        agent_id: picked?.id ?? null,
      });
      if (!conv) throw new ApiError('创建失败');
      router.replace(`/agent/${conv.id}` as never);
    } catch (e) {
      Alert.alert('创建失败', e instanceof ApiError ? e.message : '请稍后重试');
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: spacing.pad + 56, paddingHorizontal: spacing.pad, paddingBottom: 40, gap: 16 }}>
        <Text style={{ color: t.tx, fontSize: 22, fontWeight: '800' }}>新 Agent 对话</Text>
        <Text style={{ color: t.tx3, fontSize: 13, marginTop: -8 }}>选择一个 Agent 并起个标题（可选）</Text>

        <LabeledInput label="对话标题" value={title} onChangeText={setTitle} placeholder="可选，留空自动命名" />

        {loading ? <LoadingView label="加载 Agent…" /> : (
          <View style={{ gap: 8 }}>
            {agents.map((a) => {
              const on = picked?.id === a.id;
              return (
                <Pressable key={a.id} onPress={() => { setPicked(a); void AsyncStorage.setItem('mc.agent.selectedId', String(a.id)); }} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 14, borderWidth: 1.5, borderColor: on ? t.ac : t.line2, backgroundColor: on ? t.acGhost : t.bg2 }, pressed && { opacity: 0.8 }]}>
                  <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: on ? t.ac : t.bg4, alignItems: 'center', justifyContent: 'center' }}><Icons.sparkle size={18} color={on ? t.acInk : t.tx2} sw={2} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: t.tx, fontSize: 15, fontWeight: '700' }}>{a.display_name || a.name || `Agent #${a.id}`}</Text>
                    {a.main_model ? <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11.5, marginTop: 2 }}>{a.main_model}</Text> : null}
                  </View>
                  {on ? <Icons.check size={18} color={t.acTx} sw={2.4} /> : null}
                </Pressable>
              );
            })}
            {agents.length === 0 ? <Text style={{ color: t.tx3, fontSize: 13, paddingVertical: 12, textAlign: 'center' }}>暂无可用 Agent，将以默认配置建对话</Text> : null}
          </View>
        )}
      </ScrollView>
      <View style={{ paddingHorizontal: spacing.pad, paddingBottom: 24, paddingTop: 8 }}>
        <Pressable onPress={create} disabled={busy} style={({ pressed }) => [{ height: 52, borderRadius: 16, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, busy && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]}>
          {busy ? <ActivityIndicator color={t.acInk} /> : <Icons.arrowRight size={18} color={t.acInk} sw={2.4} />}
          <Text style={{ color: t.acInk, fontSize: 16, fontWeight: '800' }}>{busy ? '创建中…' : '创建对话'}</Text>
        </Pressable>
      </View>
      <GlassNav title="新建 Agent 对话" onBack={() => router.back()} />
    </View>
  );
}
