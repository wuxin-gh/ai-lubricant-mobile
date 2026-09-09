/** 添加设备：生成配对码（在设备控制 App 里输入完成配对）。 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mintDevicePairingCodeResource } from '@/api/resources';
import { ApiError } from '@/api/client';
import { LabeledInput, SectionCard } from '@/components/admin-ui';
import { GlassNav, PrimaryButton } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

export default function AddDeviceScreen() {
  const t = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { platform = 'android' } = useLocalSearchParams<{ platform?: string }>();
  const [label, setLabel] = useState(''); const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ code: string; ttl: number } | null>(null);
  const generate = async () => {
    if (busy) return; setBusy(true);
    try { setResult(await mintDevicePairingCodeResource(label.trim() || `${platform} 设备`)); }
    catch (e) { Alert.alert('生成配对码失败', e instanceof ApiError ? e.message : '请稍后重试'); }
    finally { setBusy(false); }
  };
  return <View style={{ flex: 1, backgroundColor: t.bg }}><View style={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 40, gap: 12 }}>
    <Text style={{ color: t.tx3, fontSize: 12.5, lineHeight: 19 }}>在设备控制 App 里输入下方的配对码，设备即与本账号绑定。配对码有时效，过期需重新生成。</Text>
    <SectionCard title="配对码"><LabeledInput label="设备标签（可选）" value={label} onChangeText={setLabel} placeholder={`${platform} 设备`} /></SectionCard>
    {result ? <SectionCard title="生成结果"><Text selectable style={{ color: t.tx, fontSize: 26, fontWeight: '800', letterSpacing: 1.5, textAlign: 'center' }}>{result.code}</Text><Text style={{ color: t.tx3, fontSize: 11.5, textAlign: 'center', marginTop: 6 }}>有效期约 {Math.round(result.ttl / 60)} 分钟</Text></SectionCard> : null}
    <PrimaryButton label={busy ? '生成中…' : '生成配对码'} icon="refresh" onPress={() => void generate()} disabled={busy} block />
    {result ? <PrimaryButton label="复制配对码" onPress={() => { void Clipboard.setStringAsync(result.code); Alert.alert('已复制', result.code); }} block style={{ backgroundColor: t.bg2 }} /> : null}
  </View><GlassNav title={`添加${platform === 'ios' ? 'iOS' : 'Android'} 设备`} onBack={() => router.back()} /></View>;
}
