/**
 * Agent 对话详情：历史回放 + SSE 流式收发 + 审批 / 子 Agent / 附件 / 会话设置。
 */
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAgentConversation } from '@/hooks/useAgentConversation';
import { listAgents, listChatModels, listUsableKeys, type AgentDef, type AgentExecutionMode, type AvailableModel, type RuntimeKeyItem } from '@/api/agent';
import type { ChatMessage } from '@/messages/handler';
import { StreamBlock } from '@/components/StreamBlocks';
import { AdminSheet, SearchableSelect, Segmented } from '@/components/admin-ui';
import { GlassNav, LoadingView, EmptyView, Toast } from '@/components/ui';
import { Icons } from '@/components/Icons';
import { spacing, useTheme } from '@/theme';

const MODE_OPTIONS: readonly { value: AgentExecutionMode; label: string }[] = [
  { value: 'interact', label: '普通 Interact' },
  { value: 'plan', label: '规划 Plan' },
  { value: 'goal', label: '目标 Goal' },
];

const EFFORT_OPTIONS = [
  { value: '', label: '默认' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
];

export default function AgentConversationScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conv = useAgentConversation(id);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<AgentExecutionMode>('interact');
  const [goalObjective, setGoalObjective] = useState('');
  const [goalBudgetMinutes, setGoalBudgetMinutes] = useState('15');
  const [pendingFiles, setPendingFiles] = useState<{ uri: string; name: string; mimeType?: string }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [effortPickerOpen, setEffortPickerOpen] = useState(false);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [keys, setKeys] = useState<RuntimeKeyItem[]>([]);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [apiKeyId, setApiKeyId] = useState<number | null>(null);
  const [model, setModel] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    if (!toast) return;
    const tm = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(tm);
  }, [toast]);

  useEffect(() => {
    if (!conv.conversation) return;
    setModel(conv.conversation.model || '');
    setReasoningEffort(String((conv.conversation as unknown as { reasoning_effort?: string }).reasoning_effort || ''));
  }, [conv.conversation]);

  // 会话设置所需：Agent 定义 + 可用网关 Key/模型（模型切换仍走 conversation.model）。
  useEffect(() => {
    if (!settingsOpen) return;
    void Promise.all([
      listAgents().catch(() => [] as AgentDef[]),
      listUsableKeys().catch(() => [] as RuntimeKeyItem[]),
    ]).then(async ([defs, runtimeKeys]) => {
      setAgents(defs.filter((a) => a.enabled !== false));
      setKeys(runtimeKeys);
      const agent = defs.find((a) => a.id === conv.conversation?.agent_id);
      const key = agent?.main_api_key_id && runtimeKeys.some((k) => k.id === agent.main_api_key_id) ? agent.main_api_key_id : runtimeKeys[0]?.id ?? null;
      setApiKeyId(key);
      if (key) setModels(await listChatModels(key).catch(() => [] as AvailableModel[]));
    });
  }, [conv.conversation?.agent_id, settingsOpen]);

  // 有新消息时滚到底（流式增量会高频触发）。
  const len = conv.messages.length;
  const last = conv.messages[len - 1];
  const lastText = last?.kind === 'agent' ? last.text : undefined;
  useEffect(() => {
    if (!len) return;
    listRef.current?.scrollToEnd({ animated: true });
  }, [len, lastText]);

  const pickFiles = async () => {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    setPendingFiles((prev) => [...prev, ...res.assets.slice(0, Math.max(0, 5 - prev.length)).map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType }))].slice(0, 5));
  };

  const onSubmit = () => {
    const text = draft.trim();
    if ((!text && !pendingFiles.length) || conv.streaming) return;
    if (mode === 'goal' && !goalObjective.trim()) {
      setToast('目标模式请填写目标');
      return;
    }
    const goalConfig = mode === 'goal'
      ? { objective: goalObjective.trim() || text, budget_seconds: Math.max(60, Math.round((Number(goalBudgetMinutes) || 15) * 60)) }
      : undefined;
    const attachments = pendingFiles.length ? pendingFiles : undefined;
    setDraft('');
    setPendingFiles([]);
    conv.send(text, { mode, goalConfig, attachments });
  };

  const renderItem = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isLast = index === conv.messages.length - 1;
    const streamingNow = isLast && conv.streaming && (item.kind === 'agent' || item.kind === 'tool');
    return (
      <View>
        <StreamBlock
          message={item}
          isStreaming={streamingNow}
          onCopy={async (txt) => { await Clipboard.setStringAsync(txt); setToast('已复制'); }}
          onResolveApproval={conv.resolveApproval}
        />
        {item.kind === 'error' ? (
          <Pressable onPress={() => void conv.retryFailed()} disabled={conv.streaming} style={{ alignSelf: 'center', marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: t.acGhost, opacity: conv.streaming ? 0.4 : 1 }}>
            <Icons.refresh size={13} color={t.acTx} sw={2} />
            <Text style={{ color: t.acTx, fontSize: 12, fontWeight: '700' }}>重试失败轮</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  const content = useMemo(() => conv.messages, [conv.messages]);

  if (conv.loading && !conv.messages.length) {
    return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载对话…" /><GlassNav title={conv.conversation?.title || 'Agent 对话'} onBack={() => router.back()} /></View>;
  }
  if (conv.error && !conv.messages.length) {
    return <View style={{ flex: 1, backgroundColor: t.bg }}><EmptyView title="加载失败" subtitle={conv.error} icon="alert" /><GlassNav title="Agent 对话" onBack={() => router.back()} /></View>;
  }

  const currentAgent = agents.find((a) => a.id === conv.conversation?.agent_id);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        ref={listRef}
        data={content}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingTop: insets.top + 64, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 160, gap: 14, flexGrow: 1 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={<EmptyView title="开始与 Agent 对话" subtitle="在下方输入你的问题" icon="sparkle" />}
        keyboardShouldPersistTaps="handled"
      />
      <GlassNav title={conv.conversation?.title || 'Agent 对话'} onBack={() => router.back()} right={(
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={() => setSettingsOpen(true)} hitSlop={8} style={{ padding: 8 }}><Icons.settings size={19} color={t.tx2} sw={2} /></Pressable>
          {conv.streaming ? <Pressable onPress={conv.abort} hitSlop={8} style={{ padding: 8, flexDirection: 'row', alignItems: 'center', gap: 5 }}><Icons.stop size={16} color={t.red} sw={2.2} /><Text style={{ color: t.red, fontSize: 13.5, fontWeight: '700' }}>停止</Text></Pressable> : null}
        </View>
      )} />

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.pad, paddingTop: 8, paddingBottom: insets.bottom + 8, backgroundColor: t.bg, borderTopWidth: 1, borderColor: t.line, gap: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: 'center' }}>
          <Segmented value={mode} options={MODE_OPTIONS} onChange={setMode} />
          {model ? <Pressable onPress={() => setModelPickerOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: t.bg3 }}><Text numberOfLines={1} style={{ maxWidth: 120, color: t.tx2, fontSize: 11, fontFamily: 'monospace' }}>{model}</Text><Icons.chevron size={10} color={t.tx3} /></Pressable> : null}
          {reasoningEffort ? <Pressable onPress={() => setEffortPickerOpen(true)} style={{ paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.acTx, fontSize: 11, fontWeight: '700' }}>{reasoningEffort}</Text></Pressable> : null}
        </ScrollView>
        {mode === 'goal' ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput value={goalObjective} onChangeText={setGoalObjective} placeholder="目标（一句话）" placeholderTextColor={t.tx3} style={{ flex: 1, height: 38, color: t.tx, fontSize: 13.5, paddingHorizontal: 12, borderRadius: 12, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2 }} />
            <TextInput value={goalBudgetMinutes} onChangeText={(v) => setGoalBudgetMinutes(v.replace(/[^0-9]/g, ''))} keyboardType="numeric" placeholder="15" placeholderTextColor={t.tx3} style={{ width: 60, height: 38, color: t.tx, fontSize: 13.5, paddingHorizontal: 10, borderRadius: 12, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2, textAlign: 'center' }} />
            <Text style={{ color: t.tx3, fontSize: 12 }}>分钟</Text>
          </View>
        ) : null}
        {pendingFiles.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {pendingFiles.map((file, i) => <Pressable key={i} onPress={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, height: 28, borderRadius: 9, backgroundColor: t.bg3 }}><Icons.file size={11} color={t.tx2} sw={1.8} /><Text numberOfLines={1} style={{ maxWidth: 130, color: t.tx2, fontSize: 10.5 }}>{file.name}</Text><Icons.plus size={10} color={t.red} sw={2.3} style={{ transform: [{ rotate: '45deg' }] }} /></Pressable>)}
          </ScrollView>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <Pressable onPress={pickFiles} disabled={conv.streaming} style={{ width: 44, height: 44, borderRadius: 99, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2, alignItems: 'center', justifyContent: 'center', opacity: conv.streaming ? 0.4 : 1 }}><Icons.attach size={19} color={t.tx2} sw={1.9} /></Pressable>
          <TextInput value={draft} onChangeText={setDraft} placeholder={conv.streaming ? 'Agent 正在回复…' : '给 Agent 发消息'} placeholderTextColor={t.tx3} editable={!conv.streaming} multiline style={{ flex: 1, minHeight: 40, maxHeight: 120, color: t.tx, fontSize: 15, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2 }} onSubmitEditing={onSubmit} />
          <Pressable onPress={onSubmit} disabled={conv.streaming || (!draft.trim() && !pendingFiles.length)} style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 99, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }, (conv.streaming || (!draft.trim() && !pendingFiles.length)) && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.9 }] }]}>
            {conv.streaming ? <ActivityIndicator color={t.acInk} size="small" /> : <Icons.send size={19} color={t.acInk} sw={2.2} />}
          </Pressable>
        </View>
      </View>

      {toast ? <Toast text={toast} bottom={insets.bottom + 150} /> : null}

      <AdminSheet visible={settingsOpen} title="Agent 对话设置" onClose={() => setSettingsOpen(false)}>
        <Pressable onPress={() => setAgentPickerOpen(true)} style={{ minHeight: 48, borderRadius: 13, backgroundColor: t.bg3, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9 }}><Icons.brain size={16} color={t.tx2} sw={2} /><View style={{ flex: 1 }}><Text style={{ color: t.tx3, fontSize: 11 }}>当前 Agent</Text><Text numberOfLines={1} style={{ color: t.tx, fontWeight: '700', marginTop: 2 }}>{currentAgent?.display_name || currentAgent?.name || `Agent #${conv.conversation?.agent_id || '-'}`}</Text></View><Icons.chevron size={16} color={t.tx3} /></Pressable>
        <Pressable onPress={() => setModelPickerOpen(true)} style={{ minHeight: 48, borderRadius: 13, backgroundColor: t.bg3, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9 }}><Icons.search size={16} color={t.tx2} sw={2} /><View style={{ flex: 1 }}><Text style={{ color: t.tx3, fontSize: 11 }}>会话模型</Text><Text numberOfLines={1} style={{ color: t.tx, fontWeight: '700', marginTop: 2 }}>{model || '默认模型'}</Text></View><Icons.chevron size={16} color={t.tx3} /></Pressable>
        <Pressable onPress={() => setEffortPickerOpen(true)} style={{ minHeight: 48, borderRadius: 13, backgroundColor: t.bg3, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9 }}><Icons.brain size={16} color={t.tx2} sw={2} /><View style={{ flex: 1 }}><Text style={{ color: t.tx3, fontSize: 11 }}>推理强度</Text><Text numberOfLines={1} style={{ color: t.tx, fontWeight: '700', marginTop: 2 }}>{reasoningEffort || '默认'}</Text></View><Icons.chevron size={16} color={t.tx3} /></Pressable>
        <Pressable onPress={() => { setSettingsOpen(false); router.push('/agent/scheduled' as never); }} style={{ minHeight: 48, borderRadius: 13, backgroundColor: t.bg3, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9 }}><Icons.clock size={16} color={t.tx2} sw={2} /><View style={{ flex: 1 }}><Text style={{ color: t.tx, fontWeight: '700' }}>定时任务</Text><Text style={{ color: t.tx3, fontSize: 11, marginTop: 2 }}>Prompt / Script · 运行 · 授权</Text></View><Icons.chevron size={16} color={t.tx3} /></Pressable>
        <Pressable onPress={() => { setSettingsOpen(false); router.push('/agent/manage' as never); }} style={{ minHeight: 48, borderRadius: 13, backgroundColor: t.bg3, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9 }}><Icons.settings size={16} color={t.tx2} sw={2} /><View style={{ flex: 1 }}><Text style={{ color: t.tx, fontWeight: '700' }}>管理 Agent</Text></View><Icons.chevron size={16} color={t.tx3} /></Pressable>
      </AdminSheet>

      <SearchableSelect visible={agentPickerOpen} title="切换 Agent（新建会话）" options={agents.map((a) => ({ value: String(a.id), label: a.display_name || a.name || `Agent #${a.id}`, sub: a.description || a.main_model || undefined }))} selected={conv.conversation?.agent_id ? [String(conv.conversation.agent_id)] : []} onChange={(values) => { const next = Number(values[0]); setAgentPickerOpen(false); setSettingsOpen(false); if (next && next !== conv.conversation?.agent_id) router.push({ pathname: '/agent/new', params: { agentId: String(next) } } as never); }} onClose={() => setAgentPickerOpen(false)} emptyText="暂无可用 Agent" />
      <SearchableSelect visible={modelPickerOpen} title="切换会话模型" options={models.map((m) => ({ value: m.id, label: m.name || m.remark || m.id, sub: m.description || m.id }))} selected={model ? [model] : []} onChange={(values) => { const next = values[0] || ''; setModel(next); if (next) void conv.updateContext({ model: next }); }} onClose={() => setModelPickerOpen(false)} emptyText="没有可用模型" />
      <SearchableSelect visible={effortPickerOpen} title="推理强度" options={EFFORT_OPTIONS} selected={[reasoningEffort]} onChange={(values) => { const next = values[0] || ''; setReasoningEffort(next); void conv.updateContext({ reasoning_effort: next }); }} onClose={() => setEffortPickerOpen(false)} />
    </View>
  );
}
