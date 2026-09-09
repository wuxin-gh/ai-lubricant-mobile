/** Android / iOS 控制设备详情。 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listDeviceResources, revokeDevice, type DeviceResource } from '@/api/resources';
import { ApiError } from '@/api/client';
import { SectionCard, DetailRow } from '@/components/admin-ui';
import { EmptyView, GlassNav, LoadingView, PrimaryButton } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

export default function DeviceDetailScreen() {
  const t = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string; platform?: string }>();
  const [device, setDevice] = useState<DeviceResource | null>(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  useEffect(() => { void listDeviceResources().then((rows) => setDevice(rows.find((x) => String(x.id) === id) || null)).finally(() => setLoading(false)); }, [id]);
  const revoke = () => { if (!device || busy) return; Alert.alert('解除配对', '解除后设备需要重新配对才能使用。', [{ text: '取消' }, { text: '解除配对', style: 'destructive', onPress: async () => { setBusy(true); try { await revokeDevice(device.id); router.back(); } catch (e) { Alert.alert('操作失败', e instanceof ApiError ? e.message : '请稍后重试'); } finally { setBusy(false); } } }]); };
  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载设备…" /><GlassNav title="设备详情" onBack={() => router.back()} /></View>;
  if (!device) return <View style={{ flex: 1, backgroundColor: t.bg }}><EmptyView title="未找到设备" icon="alert" /><GlassNav title="设备详情" onBack={() => router.back()} /></View>;
  return <View style={{ flex: 1, backgroundColor: t.bg }}><ScrollView contentContainerStyle={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 40, gap: 12 }}><SectionCard title="设备信息"><DetailRow label="平台" value={String(device.platform || '—')} /><DetailRow label="名称" value={device.name || device.model || '—'} /><DetailRow label="设备 ID" value={device.device_id || '—'} mono /><DetailRow label="状态" value={device.revoked ? '已解除配对' : device.online ? '在线' : '离线'} /><DetailRow label="App 版本" value={device.app_version || '—'} />{device.platform === 'android' ? <DetailRow label="无障碍" value={device.accessibility_enabled === false ? '未开启' : '已开启'} /> : null}{device.last_error ? <DetailRow label="最近错误" value={device.last_error} multiline /> : null}</SectionCard><PrimaryButton label="解除配对" onPress={revoke} disabled={busy || !!device.revoked} block style={{ backgroundColor: t.red }} /></ScrollView><GlassNav title={device.name || '设备详情'} onBack={() => router.back()} /></View>;
}
