/** 项目提示词编辑/新建。 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listProjectPrompts, createMyProjectPrompt, updateMyProjectPrompt, deleteMyProjectPrompt, type ProjectPrompt } from '@/api/mcpCenter';
import { ApiError } from '@/api/client';
import { LabeledInput, SectionCard, SwitchRow } from '@/components/admin-ui';
import { EmptyView, GlassNav, LoadingView, PrimaryButton } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

const PROVIDERS = ['claude', 'codex', 'opencode'] as const;

export default function PromptEditScreen() {
  const t = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>(); const isNew = id === 'new';
  const [prompt, setPrompt] = useState<ProjectPrompt | null>(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [name, setName] = useState(''); const [content, setContent] = useState(''); const [providers, setProviders] = useState<string[]>(['claude']); const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    (async () => {
      if (isNew) { setLoading(false); return; }
      try { const list = await listProjectPrompts(); const p = list.find((x) => x.id === id) || null; setPrompt(p); setName(p?.name || ''); setContent(p?.content || ''); setProviders(p?.providers || ['claude']); setEnabled(p?.enabled ?? true); }
      finally { setLoading(false); }
    })();
  }, [id, isNew]);

  const toggleProvider = (p: string) => setProviders((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  const save = async () => {
    if (busy) return; if (!name.trim() || !content.trim()) { Alert.alert('请填写名称和内容'); return; }
    setBusy(true);
    try {
      if (isNew) await createMyProjectPrompt({ name: name.trim(), content, providers, enabled });
      else if (prompt) await updateMyProjectPrompt(prompt.id, { name: name.trim(), content, providers, enabled });
      router.back();
    } catch (e) { Alert.alert('保存失败', e instanceof ApiError ? e.message : '请稍后重试'); } finally { setBusy(false); }
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载…" /><GlassNav title="项目提示词" onBack={() => router.back()} /></View>;
  if (!isNew && !prompt) return <View style={{ flex: 1, backgroundColor: t.bg }}><EmptyView title="未找到提示词" icon="alert" /><GlassNav title="项目提示词" onBack={() => router.back()} /></View>;

  return <View style={{ flex: 1, backgroundColor: t.bg }}><View style={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 90, gap: 12, flex: 1 }}>
    <SectionCard title={isNew ? '新建提示词' : '编辑'}>
      <LabeledInput label="名称" value={name} onChangeText={setName} />
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.3 }}>适用编辑器</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>{PROVIDERS.map((p) => { const on = providers.includes(p); return <PressableChip key={p} on={on} onPress={() => toggleProvider(p)} label={p} />; })}</View>
      </View>
      <LabeledInput label="内容" value={content} onChangeText={setContent} multiline hint="支持模板占位符，详见 Web 端说明" />
      <SwitchRow label="启用" value={enabled} onValueChange={setEnabled} />
    </SectionCard>
    {!isNew && prompt ? <PrimaryButton label="删除提示词" onPress={() => Alert.alert('删除提示词', `删除“${prompt.name}”？`, [{ text: '取消' }, { text: '删除', style: 'destructive', onPress: () => void deleteMyProjectPrompt(prompt.id).then(() => router.back()).catch((e) => Alert.alert('删除失败', e instanceof ApiError ? e.message : '请稍后重试')) }])} block style={{ backgroundColor: t.red }} /> : null}
  </View><View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.pad, paddingTop: 10, paddingBottom: insets.bottom + 10, backgroundColor: t.bg, borderTopWidth: 1, borderColor: t.line }}><PrimaryButton label={busy ? '保存中…' : '保存'} icon="check" onPress={() => void save()} disabled={busy} block /></View><GlassNav title={isNew ? '新建提示词' : prompt?.name || '提示词'} onBack={() => router.back()} /></View>;
}

function PressableChip({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ paddingHorizontal: 12, height: 32, borderRadius: 11, backgroundColor: on ? t.ac : t.bg3, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
      <Text style={{ color: on ? t.acInk : t.tx2, fontSize: 11.5, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}
