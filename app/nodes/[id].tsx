/** 节点详情（只读）：概览（身份/状态/机器信息/调度容量/心跳）。环境面板与终端后续版本提供。 */
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listNodes } from '@/api/client';
import type { Node } from '@/api/types';
import { Chip, DetailRow, SectionCard } from '@/components/admin-ui';
import { EmptyView, GlassNav, LoadingView } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

function fmtBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let v = bytes; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
function fmtTime(iso?: string): string { return iso ? iso.replace('T', ' ').replace(/(\.\d+|Z).*/, '') : '—'; }

export default function NodeDetailScreen() {
  const t = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { id = '' } = useLocalSearchParams<{ id?: string }>();
  const [node, setNode] = useState<Node | null>(null); const [loading, setLoading] = useState(true);

  useEffect(() => { void listNodes().then((rows) => setNode(rows.find((x) => x.node_id === decodeURIComponent(id)) || null)).finally(() => setLoading(false)); }, [id]);

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载节点…" /><GlassNav title="节点详情" onBack={() => router.back()} /></View>;
  if (!node) return <View style={{ flex: 1, backgroundColor: t.bg }}><EmptyView title="未找到节点" icon="alert" /><GlassNav title="节点详情" onBack={() => router.back()} /></View>;

  const caps = (node.capabilities || {}) as Record<string, unknown>;
  const cpus = caps.cpus as string[] | undefined; const memory = Number(caps.memory) || 0; const docker = caps.docker as Record<string, unknown> | boolean | undefined;
  const editors = Array.isArray(caps.editors) ? (caps.editors as string[]) : [];
  const networks = Array.isArray(caps.networks) ? (caps.networks as { name?: string; address?: string }[]) : [];

  return <View style={{ flex: 1, backgroundColor: t.bg }}><ScrollView contentContainerStyle={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 40, gap: 12 }}>
    <SectionCard title="概览">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Text style={{ color: t.tx, fontSize: 17, fontWeight: '800', flexShrink: 1 }}>{node.node_name || node.node_id}</Text>
        <Chip text={node.online ? '在线' : '离线'} color={node.online ? t.acTx : t.tx3} bg={node.online ? t.acGhost : t.bg4} />
        <Chip text={node.node_role === 'management' ? '管理' : '执行'} color={t.tx2} bg={t.bg3} />
      </View>
      <Pressable onPress={() => { void Clipboard.setStringAsync(node.node_id || ''); Alert.alert('已复制', node.node_id || ''); }}><DetailRow label="节点 ID" value={`${(node.node_id || '—').slice(0, 18)}…（点击复制）`} mono /></Pressable>
      <DetailRow label="状态" value={node.status || 'unknown'} />
      <DetailRow label="启动方式" value={node.startup_method || '—'} />
      <DetailRow label="最近心跳" value={fmtTime(node.last_heartbeat_at)} />
      {node.active_sessions != null ? <DetailRow label="活动会话" value={`${node.active_sessions}${node.capacity?.max_sessions ? ` / ${node.capacity.max_sessions}` : ''}`} /> : null}
      {node.editor_occupancy != null ? <DetailRow label="编辑器占用" value={String(node.editor_occupancy)} /> : null}
    </SectionCard>

    <SectionCard title="机器信息">
      <DetailRow label="系统" value={String(caps.os || '—')} />
      <DetailRow label="架构" value={String(caps.arch || '—')} />
      <DetailRow label="CPU" value={cpus?.length ? `${cpus.length} 核` : String(caps.cpu || '—')} />
      <DetailRow label="内存" value={memory > 0 ? fmtBytes(memory) : '—'} />
      <DetailRow label="客户端版本" value={String(caps.client_version || '—')} />
      {docker ? <DetailRow label="Docker" value={typeof docker === 'boolean' ? '可用' : String((docker as { version?: string }).version || '可用')} /> : null}
    </SectionCard>

    {editors.length ? <SectionCard title="支持的编辑器">{editors.map((e) => <Text key={e} style={{ color: t.tx2, fontSize: 12.5, fontFamily: 'monospace', paddingVertical: 2 }}>{e}</Text>)}</SectionCard> : null}
    {networks.length ? <SectionCard title="网络">{networks.slice(0, 6).map((n, i) => <DetailRow key={i} label={n.name || `网卡 ${i + 1}`} value={n.address || '—'} mono />)}</SectionCard> : null}
    {node.capacity ? <SectionCard title="调度容量"><DetailRow label="最大会话" value={node.capacity.max_sessions ?? '不限'} /><DetailRow label="CPU 总量" value={node.capacity.cpu_total ?? '不限'} /><DetailRow label="内存总量" value={node.capacity.memory_total ? fmtBytes(node.capacity.memory_total) : '不限'} /></SectionCard> : null}
    <Text style={{ color: t.tx3, fontSize: 11, textAlign: 'center', marginTop: 4 }}>环境面板与终端将在后续版本提供</Text>
  </ScrollView><GlassNav title={node.node_name || '节点详情'} onBack={() => router.back()} /></View>;
}
