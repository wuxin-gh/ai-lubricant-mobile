/** 市场条目详情：manifest 摘要 + 下载/安装信息。 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchMarketManifest, type MarketManifest } from '@/api/mcpCenter';
import { DetailRow, SectionCard } from '@/components/admin-ui';
import { EmptyView, GlassNav, LoadingView } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

export default function MarketDetailScreen() {
  const t = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { module = 'mcp', id = '' } = useLocalSearchParams<{ module?: string; id?: string }>();
  const [manifest, setManifest] = useState<MarketManifest | null>(null); const [loading, setLoading] = useState(true);

  useEffect(() => { void fetchMarketManifest(module as 'mcp' | 'skills' | 'plugins' | 'prompts', id).then(setManifest).finally(() => setLoading(false)); }, [module, id]);

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载市场条目…" /><GlassNav title="市场详情" onBack={() => router.back()} /></View>;
  if (!manifest) return <View style={{ flex: 1, backgroundColor: t.bg }}><EmptyView title="未找到条目" subtitle="该市场项可能已下架或网络异常" icon="alert" /><GlassNav title="市场详情" onBack={() => router.back()} /></View>;

  return <View style={{ flex: 1, backgroundColor: t.bg }}><ScrollView contentContainerStyle={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 40, gap: 12 }}>
    <SectionCard title={manifest.display_name || manifest.name || manifest.id}>
      {manifest.summary ? <Text style={{ color: t.tx2, fontSize: 13, lineHeight: 20 }}>{manifest.summary}</Text> : null}
      {manifest.description ? <Text style={{ color: t.tx3, fontSize: 12, lineHeight: 19, marginTop: 8 }}>{manifest.description}</Text> : null}
    </SectionCard>
    <SectionCard title="元信息">
      <DetailRow label="ID" value={manifest.id} mono />
      <DetailRow label="版本" value={manifest.version || '—'} />
      <DetailRow label="发布者" value={manifest.publisher || '社区'} />
      <DetailRow label="分类" value={manifest.category || '—'} />
      {manifest.tags?.length ? <DetailRow label="标签" value={manifest.tags.join(', ')} /> : null}
    </SectionCard>
    {manifest.source_url ? <SectionCard title="来源"><DetailRow label="仓库" value={manifest.source_url} mono multiline /></SectionCard> : null}
    {manifest.download_url ? <SectionCard title="下载"><DetailRow label="下载地址" value={manifest.download_url} mono multiline />{manifest.digest ? <DetailRow label="校验" value={manifest.digest} mono /> : null}</SectionCard> : null}
  </ScrollView><GlassNav title={manifest.display_name || manifest.name || '市场详情'} onBack={() => router.back()} /></View>;
}
