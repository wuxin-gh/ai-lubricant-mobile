/** 导入 Skill / 插件（GitHub 仓库 → 服务端识别 → 确认创建引用）。 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createReferenceFromGithub } from '@/api/mcpCenter';
import { ApiError } from '@/api/client';
import { LabeledInput, SectionCard } from '@/components/admin-ui';
import { GlassNav, PrimaryButton } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

export default function McpImportScreen() {
  const t = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { kind = 'skill' } = useLocalSearchParams<{ kind?: 'skill' | 'plugin' }>();
  const [repo, setRepo] = useState(''); const [ref, setRef] = useState('main'); const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return; if (!repo.trim()) { Alert.alert('请填写仓库'); return; }
    setBusy(true);
    try { await createReferenceFromGithub(repo.trim(), ref.trim() || 'main', kind); router.back(); }
    catch (e) { Alert.alert('导入失败', e instanceof ApiError ? e.message : (e as Error)?.message || '请稍后重试'); }
    finally { setBusy(false); }
  };

  return <View style={{ flex: 1, backgroundColor: t.bg }}><View style={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 40, gap: 12 }}><Text style={{ color: t.tx3, fontSize: 12.5, lineHeight: 19 }}>输入 GitHub 仓库（owner/repo）与分支/标签，服务端会识别并创建引用；节点 setup 时按需克隆/取 zip，不复制内容。</Text><SectionCard title="仓库信息"><LabeledInput label="仓库（owner/repo）" value={repo} onChangeText={setRepo} placeholder="octocat/Hello-World" autoCapitalize="none" /><LabeledInput label="分支 / 标签 / commit" value={ref} onChangeText={setRef} placeholder="main" autoCapitalize="none" /></SectionCard><PrimaryButton label={busy ? '导入中…' : `导入${kind === 'skill' ? 'Skill' : '插件'}`} icon="check" onPress={() => void submit()} disabled={busy} block /></View><GlassNav title={`导入${kind === 'skill' ? 'Skill' : '插件'}`} onBack={() => router.back()} /></View>;
}
