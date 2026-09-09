/** 我的工具：对齐 Web /console/my-tools。
 * 一级页只放四类工具的摘要列表；详情、编辑、配对、邮件查询均下钻到独立页面。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  listCdpClients,
  listDeviceResources,
  listMailServices,
  type CdpClientResource,
  type DeviceResource,
  type MailServiceResource,
} from '@/api/resources';
import { ApiError } from '@/api/client';
import { Icons } from '@/components/Icons';
import { EmptyView, GlassNav, LoadingView, PrimaryButton } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

const TABS = [
  { value: 'cdp', label: '浏览器', icon: 'globe' },
  { value: 'mail', label: '邮箱', icon: 'mail' },
  { value: 'android', label: 'Android 控制', icon: 'phoneDevice' },
  { value: 'ios', label: 'iOS 控制', icon: 'apple' },
] as const;
type Tab = (typeof TABS)[number]['value'];
type RowItem = { id: string; title: string; sub: string; status: string; online: boolean; icon: string; route: string };

export default function ResourcesScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('cdp');
  const [clients, setClients] = useState<CdpClientResource[]>([]);
  const [mails, setMails] = useState<MailServiceResource[]>([]);
  const [devices, setDevices] = useState<DeviceResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      // 三个一级资源列表互不依赖，并行加载；某一类后端不可用不拖垮另外两类。
      const [c, m, d] = await Promise.all([
        listCdpClients().catch(() => [] as CdpClientResource[]),
        listMailServices().catch(() => [] as MailServiceResource[]),
        listDeviceResources().catch(() => [] as DeviceResource[]),
      ]);
      setClients(c); setMails(m); setDevices(d);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo<RowItem[]>(() => {
    if (tab === 'cdp') return clients.map((c) => ({
      id: String(c.id), title: c.name || `客户端 #${c.id}`,
      sub: `${c.pages?.length || 0} 个网页 · Token ${c.token_hint || '已撤销'}`,
      status: c.enabled === false ? '已停用' : c.connected ? '在线' : '离线', online: c.enabled !== false && !!c.connected,
      icon: 'globe', route: `/resources/cdp/${c.id}`,
    }));
    if (tab === 'mail') return mails.map((m) => ({
      id: String(m.resource_id || m.id), title: m.display_name || m.username || `服务 #${m.resource_id}`,
      sub: `${m.mailbox_type || '邮箱'} · ${m.username || '未配置用户名'} · ${m.addresses?.length || 0} 个地址`,
      status: m.enabled === false ? '已停用' : '已启用', online: m.enabled !== false,
      icon: 'mail', route: `/resources/mail/${m.resource_id || m.id}`,
    }));
    const platform = tab;
    return devices.filter((d) => String(d.platform || '').toLowerCase() === platform).map((d) => ({
      id: String(d.id), title: d.name || d.model || d.device_id || `${platform === 'ios' ? 'iOS' : 'Android'} 设备 #${d.id}`,
      sub: [d.model, d.app_version ? `App v${d.app_version}` : '', d.accessibility_enabled === false && platform === 'android' ? '无障碍未开启' : ''].filter(Boolean).join(' · ') || String(d.device_id || ''),
      status: d.revoked ? '已解除配对' : d.online ? '在线' : '离线', online: !d.revoked && !!d.online,
      icon: platform === 'ios' ? 'apple' : 'phoneDevice', route: `/resources/device/${d.id}`,
    }));
  }, [clients, devices, mails, tab]);

  const add = () => {
    if (tab === 'cdp') router.push('/resources/cdp/new' as never);
    else if (tab === 'mail') router.push('/resources/mail/new' as never);
    else router.push({ pathname: '/resources/device/new', params: { platform: tab } } as never);
  };
  const noun = tab === 'cdp' ? '浏览器' : tab === 'mail' ? '邮箱服务' : tab === 'android' ? 'Android 设备' : 'iOS 设备';

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载我的工具…" /><GlassNav title="我的工具" onBack={() => router.back()} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 40, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={t.ac} />}
        ListHeaderComponent={(
          <View style={{ gap: 12, marginBottom: 2 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
              {TABS.map((item) => {
                const on = tab === item.value; const I = Icons[item.icon];
                return (
                  <Pressable key={item.value} onPress={() => setTab(item.value)} style={({ pressed }) => [{ height: 36, paddingHorizontal: 13, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: on ? t.ac : t.bg2, borderWidth: on ? 0 : 1, borderColor: t.line2 }, pressed && { opacity: 0.75 }]}>
                    <I size={15} color={on ? t.acInk : t.tx2} sw={2} />
                    <Text style={{ color: on ? t.acInk : t.tx2, fontSize: 12.5, fontWeight: '700' }}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <PrimaryButton label={`添加${noun}`} icon="plus" onPress={add} block />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => {
          const I = Icons[item.icon];
          return (
            <Pressable onPress={() => router.push(item.route as never)} style={({ pressed }) => [{ padding: 15, borderRadius: 16, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2, flexDirection: 'row', alignItems: 'center', gap: 12, ...t.shCard }, pressed && { opacity: 0.78 }]}>
              <View style={{ width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.acGhost }}><I size={21} color={t.acTx} sw={1.9} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text numberOfLines={1} style={{ flex: 1, color: t.tx, fontSize: 15, fontWeight: '700' }}>{item.title}</Text>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9, backgroundColor: item.online ? t.acGhost : t.bg3 }}><Text style={{ color: item.online ? t.acTx : t.tx3, fontSize: 10.5, fontWeight: '700' }}>{item.status}</Text></View>
                </View>
                <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11.5, marginTop: 4 }}>{item.sub}</Text>
              </View>
              <Icons.chevron size={17} color={t.tx3} sw={1.8} />
            </Pressable>
          );
        }}
        ListEmptyComponent={error ? <EmptyView title="加载失败" subtitle={error} icon="alert" /> : <EmptyView title={`暂无${noun}`} subtitle={`点上方按钮添加${noun}`} icon={tab === 'mail' ? 'mail' : 'sparkle'} />}
      />
      <GlassNav title="我的工具" onBack={() => router.back()} />
    </View>
  );
}
