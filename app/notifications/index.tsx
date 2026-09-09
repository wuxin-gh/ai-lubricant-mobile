/**
 * 通知中心（移动端）。
 * 简单模式（默认）：服务端把任务结束/暂停、节点上线等事件写进通知表，
 * App 打开时轮询读取——无远程推送依赖。事件开关控制「哪些事件进通知表」；
 * 设备列表与按机定向仅在远程推送（Expo/FCM/APNs）启用后出现。
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  deletePushDevice,
  listPushDevices,
  listPushRules,
  listUserNotifications,
  markAllNotificationsRead,
  replacePushRules,
  testPushDevice,
  updatePushDevice,
  type PushDevice,
  type PushRules,
  type UserNotificationItem,
} from '@/api/notifications';
import { ApiError } from '@/api/client';
import { AdminSheet, LabeledInput } from '@/components/admin-ui';
import { EmptyView, GlassNav, LoadingView, PrimaryButton } from '@/components/ui';
import { Icons } from '@/components/Icons';
import { REMOTE_PUSH_ENABLED, currentDeviceId, notificationPermission, requestNotificationPermission } from '@/notifications/push';
import { spacing, useTheme } from '@/theme';

const PAGE_SIZE = 20;

function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  return String(iso).replace('T', ' ').replace(/(\.\d+|Z).*/, '');
}

export default function NotificationsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [rules, setRules] = useState<PushRules | null>(null);
  const [myDeviceId, setMyDeviceId] = useState<string | null>(null);
  const [permGranted, setPermGranted] = useState<boolean | null>(null);
  const [history, setHistory] = useState<UserNotificationItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [markingRead, setMarkingRead] = useState(false);
  // 事件 → 设备选择器（远程推送模式）
  const [pickingEvent, setPickingEvent] = useState<string | null>(null);
  // 设备改名
  const [renaming, setRenaming] = useState<PushDevice | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const [dev, rule, myId] = await Promise.all([
        REMOTE_PUSH_ENABLED ? listPushDevices().catch(() => [] as PushDevice[]) : Promise.resolve([] as PushDevice[]),
        listPushRules().catch(() => null),
        REMOTE_PUSH_ENABLED ? currentDeviceId() : Promise.resolve(null),
      ]);
      setDevices(dev); setRules(rule); setMyDeviceId(myId);
      if (REMOTE_PUSH_ENABLED) {
        const perm = await notificationPermission();
        setPermGranted(perm?.granted ?? null);
      }
      const h = await listUserNotifications(1, PAGE_SIZE).catch(() => ({ items: [], total: 0, unread_count: 0 }));
      setHistory(h.items); setHistoryPage(1); setHasMore(h.items.length >= PAGE_SIZE);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadMoreHistory = async () => {
    if (!hasMore) return;
    const next = historyPage + 1;
    const h = await listUserNotifications(next, PAGE_SIZE).catch(() => ({ items: [], total: 0, unread_count: 0 }));
    if (h.items.length) { setHistory((prev) => [...prev, ...h.items]); setHistoryPage(next); }
    setHasMore(h.items.length >= PAGE_SIZE);
  };

  const askPermission = async () => {
    const perm = await requestNotificationPermission();
    setPermGranted(perm?.granted ?? null);
    if (perm && !perm.granted && !perm.canAskAgain) {
      Alert.alert('通知权限已关闭', '请到系统设置里为 Ai Lubricant 开启通知权限。', [
        { text: '取消' },
        { text: '去设置', onPress: () => { void Linking.openSettings(); } },
      ]);
    }
  };

  /** 应用内通知开关（notify_center 绑定）——简单模式的主控件。 */
  const toggleAppEvent = (eventType: string, on: boolean) => {
    if (!rules) return;
    const app: Record<string, boolean> = {};
    for (const e of rules.events) app[e.type] = e.type === eventType ? on : e.app_enabled;
    void (async () => {
      try { setRules(await replacePushRules({ app })); }
      catch (e) { Alert.alert('保存失败', e instanceof ApiError ? e.message : '请稍后重试'); }
    })();
  };

  /** 事件 → 设备多选（远程推送模式）。 */
  const openPicker = (eventType: string) => setPickingEvent(eventType);
  const toggleDeviceForEvent = (eventType: string, deviceId: string) => {
    if (!rules) return;
    const event = rules.events.find((e) => e.type === eventType);
    if (!event) return;
    const current = event.devices.map((d) => d.id);
    const next = current.includes(deviceId) ? current.filter((x) => x !== deviceId) : [...current, deviceId];
    const bindings: Record<string, string[]> = {};
    for (const e of rules.events) bindings[e.type] = e.type === eventType ? next : e.devices.map((d) => d.id);
    void (async () => {
      try { setRules(await replacePushRules({ bindings })); }
      catch (e) { Alert.alert('保存失败', e instanceof ApiError ? e.message : '请稍后重试'); }
    })();
  };

  const doMarkAllRead = async () => {
    if (markingRead) return;
    setMarkingRead(true);
    try {
      await markAllNotificationsRead();
      setHistory((prev) => prev.map((n) => ({ ...n, status: 'read' })));
    } catch (e) { Alert.alert('操作失败', e instanceof ApiError ? e.message : '请稍后重试'); }
    finally { setMarkingRead(false); }
  };

  const doRename = async () => {
    if (!renaming) return;
    try {
      await updatePushDevice(renaming.id, { name: renameValue.trim() || '我的手机' });
      setRenaming(null);
      await load(true);
    } catch (e) { Alert.alert('保存失败', e instanceof ApiError ? e.message : '请稍后重试'); }
  };

  const confirmDelete = (d: PushDevice) => {
    Alert.alert('移除手机', `移除「${d.name || '这台手机'}」？移除后它将不再收到任何通知。`, [
      { text: '取消' },
      { text: '移除', style: 'destructive', onPress: () => { void deletePushDevice(d.id).then(() => load(true)).catch((e) => Alert.alert('移除失败', e instanceof ApiError ? e.message : '请稍后重试')); } },
    ]);
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载通知…" /><GlassNav title="通知" onBack={() => router.back()} /></View>;

  const myDevice = devices.find((d) => d.id === myDeviceId) || null;
  const pickingEventDetail = pickingEvent ? rules?.events.find((e) => e.type === pickingEvent) : null;
  const hasUnread = history.some((n) => n.status !== 'read');

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 40, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={t.ac} />}>
        {/* 1. 应用内通知说明（+ 远程推送状态，仅启用时显示权限/注册卡） */}
        <View style={{ padding: 16, borderRadius: 16, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2, ...t.shCard, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <Icons.bell size={19} color={t.acTx} sw={1.9} />
            <Text style={{ flex: 1, color: t.tx, fontSize: 15, fontWeight: '800' }}>通知</Text>
          </View>
          <Text style={{ color: t.tx3, fontSize: 12, lineHeight: 18 }}>
            任务结束、任务暂停、节点上线等事件会记录在下方通知列表，打开 App 时自动刷新。开关控制记录哪些事件。
          </Text>
          {REMOTE_PUSH_ENABLED ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 9, backgroundColor: permGranted ? t.acGhost : t.bg3 }}>
                  <Text style={{ color: permGranted ? t.acTx : t.tx3, fontSize: 10.5, fontWeight: '700' }}>{permGranted === null ? '不可用' : permGranted ? '推送权限已开启' : '推送权限未开启'}</Text>
                </View>
              </View>
              {permGranted === false ? (
                <PrimaryButton label="开启推送权限" icon="bell" onPress={() => void askPermission()} block />
              ) : null}
              {myDevice ? (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <PrimaryButton label="发送测试推送" icon="send" onPress={() => { void testPushDevice(myDevice.id).then((r) => { if (!r.ok) Alert.alert('测试失败', r.message || '请稍后重试'); }).catch((e) => Alert.alert('测试失败', e instanceof ApiError ? e.message : '请稍后重试')); }} style={{ flex: 1 }} />
                  <PrimaryButton label={myDevice.enabled ? '停用本机' : '启用本机'} icon={myDevice.enabled ? 'pause' : 'play'} onPress={() => { void updatePushDevice(myDevice.id, { enabled: !myDevice.enabled }).then(() => load(true)).catch((e) => Alert.alert('操作失败', e instanceof ApiError ? e.message : '请稍后重试')); }} style={{ flex: 1, backgroundColor: t.bg3 }} />
                </View>
              ) : null}
              {myDevice?.last_error ? <Text style={{ color: t.red, fontSize: 11 }}>最近错误：{myDevice.last_error}</Text> : null}
            </>
          ) : null}
        </View>

        {/* 2. 我的手机（仅远程推送启用时） */}
        {REMOTE_PUSH_ENABLED ? (
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '800', color: t.tx2, letterSpacing: 0.5, paddingLeft: 2 }}>我的手机（{devices.length}）</Text>
            {devices.length === 0 ? <Text style={{ color: t.tx3, fontSize: 12.5, paddingVertical: 8 }}>还没有注册的手机</Text> : devices.map((d) => (
              <View key={d.id} style={{ padding: 14, borderRadius: 15, backgroundColor: t.bg2, borderWidth: 1, borderColor: d.id === myDeviceId ? t.ac : t.line2, gap: 7 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  {d.platform === 'ios' ? <Icons.apple size={17} color={t.tx2} /> : <Icons.phoneDevice size={17} color={t.tx2} sw={1.9} />}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14, fontWeight: '700', flexShrink: 1 }}>{d.name || '我的手机'}</Text>
                      {d.id === myDeviceId ? <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, backgroundColor: t.acGhost }}><Text style={{ color: t.acTx, fontSize: 9.5, fontWeight: '800' }}>本机</Text></View> : null}
                      {!d.enabled ? <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, backgroundColor: t.bg3 }}><Text style={{ color: t.tx3, fontSize: 9.5, fontWeight: '800' }}>已停用</Text></View> : null}
                    </View>
                    <Text style={{ color: t.tx3, fontSize: 10.5, marginTop: 3 }}>{d.platform || '—'} · {d.app_version || '—'} · 活跃 {fmtTime(d.last_seen_at)}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 15 }}>
                  <Pressable onPress={() => { setRenaming(d); setRenameValue(d.name); }} hitSlop={6}><Text style={{ color: t.acTx, fontWeight: '700', fontSize: 12 }}>改名</Text></Pressable>
                  <Pressable onPress={() => confirmDelete(d)} hitSlop={6}><Text style={{ color: t.red, fontWeight: '700', fontSize: 12 }}>移除</Text></Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* 3. 通知事件开关（应用内；远程推送启用时附设备定向） */}
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '800', color: t.tx2, letterSpacing: 0.5, paddingLeft: 2 }}>通知事件</Text>
          {rules?.events.map((e) => (
            <View key={e.type} style={{ padding: 13, borderRadius: 15, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: t.tx, fontSize: 14, fontWeight: '700' }}>{e.name}</Text>
                  <Text style={{ color: t.tx3, fontSize: 10.5, marginTop: 2 }}>
                    {e.category === 'task' ? '任务' : '节点'}{e.app_enabled ? ' · 记录到通知列表' : ' · 已关闭'}
                    {REMOTE_PUSH_ENABLED && e.devices.length ? ` · 推给 ${e.devices.length} 台手机` : ''}
                  </Text>
                </View>
                {REMOTE_PUSH_ENABLED && devices.length > 0 ? (
                  <Pressable onPress={() => openPicker(e.type)} hitSlop={6} style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 9, backgroundColor: e.devices.length ? t.acGhost : t.bg3 }}>
                    <Text style={{ color: e.devices.length ? t.acTx : t.tx3, fontSize: 10.5, fontWeight: '700' }}>定向</Text>
                  </Pressable>
                ) : null}
                <Switch value={e.app_enabled} onValueChange={(v) => toggleAppEvent(e.type, v)} trackColor={{ false: t.track, true: t.ac }} />
              </View>
            </View>
          ))}
        </View>

        {/* 4. 通知记录 */}
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 2 }}>
            <Text style={{ flex: 1, fontSize: 13, fontWeight: '800', color: t.tx2, letterSpacing: 0.5 }}>通知记录</Text>
            {hasUnread ? (
              <Pressable onPress={() => void doMarkAllRead()} disabled={markingRead} hitSlop={6} style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 9, backgroundColor: t.bg3 }}>
                <Text style={{ color: markingRead ? t.tx3 : t.acTx, fontSize: 11, fontWeight: '700' }}>{markingRead ? '标记中…' : '全部已读'}</Text>
              </Pressable>
            ) : null}
          </View>
          {history.length === 0 ? (
            <EmptyView title="暂无通知" subtitle="任务结束/失败/暂停等事件会出现在这里" icon="mail" />
          ) : (
            <>
              {history.map((n) => {
                const unread = n.status !== 'read';
                return (
                  <Pressable key={n.id} onPress={() => { const route = n.event_type?.startsWith('task') && n.metadata && (n.metadata.task_id as string) ? `/task/${n.metadata.task_id}` : null; if (route) router.push(route as never); }} style={{ padding: 13, borderRadius: 14, backgroundColor: t.bg2, borderWidth: 1, borderColor: unread ? t.line2 : t.line, gap: 5 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: unread ? (n.severity === 'error' || n.severity === 'critical' ? t.red : n.severity === 'warn' ? t.amber : t.ac) : 'transparent' }} />
                      <Text numberOfLines={1} style={{ flex: 1, color: t.tx, fontSize: 13.5, fontWeight: unread ? '800' : '600' }}>{n.title || n.event_type || '通知'}</Text>
                      <Text style={{ color: t.tx3, fontSize: 10 }}>{fmtTime(n.created_at)}</Text>
                    </View>
                    {n.message ? <Text numberOfLines={2} style={{ color: t.tx3, fontSize: 11.5, lineHeight: 17 }}>{n.message}</Text> : null}
                  </Pressable>
                );
              })}
              {hasMore ? (
                <Pressable onPress={() => void loadMoreHistory()} style={{ alignSelf: 'center', paddingHorizontal: 14, height: 32, borderRadius: 16, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: t.tx2, fontSize: 12, fontWeight: '600' }}>加载更多</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>

      {/* 事件 → 设备多选面板（远程推送模式） */}
      <AdminSheet
        visible={pickingEvent !== null && !!pickingEventDetail}
        title={`推送目标 — ${pickingEventDetail?.name || ''}`}
        onClose={() => setPickingEvent(null)}
      >
        <Text style={{ color: t.tx3, fontSize: 12, lineHeight: 18 }}>勾选要接收「{pickingEventDetail?.name}」推送的手机；一个都不选 = 不推送该事件。保存立即生效。</Text>
        {(rules?.devices || []).map((d) => {
          const on = !!pickingEventDetail?.devices.some((x) => x.id === d.id);
          return (
            <Pressable key={d.id} onPress={() => pickingEvent && toggleDeviceForEvent(pickingEvent, d.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 13, backgroundColor: on ? t.acGhost : t.bg3, borderWidth: 1, borderColor: on ? t.ac : 'transparent' }}>
              <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: on ? t.ac : t.line2, backgroundColor: on ? t.ac : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {on ? <Icons.check size={13} color={t.acInk} sw={3} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.tx, fontSize: 14, fontWeight: '700' }}>{d.name || '我的手机'}{d.id === myDeviceId ? '（本机）' : ''}</Text>
                {!d.enabled ? <Text style={{ color: t.tx3, fontSize: 10.5, marginTop: 2 }}>已停用，推送前需先在上方启用</Text> : null}
              </View>
            </Pressable>
          );
        })}
        {(rules?.devices || []).length === 0 ? <Text style={{ color: t.tx3, fontSize: 12.5, paddingVertical: 10, textAlign: 'center' }}>还没有已注册的手机</Text> : null}
      </AdminSheet>

      {/* 设备改名 */}
      <AdminSheet
        visible={renaming !== null}
        title="手机改名"
        onClose={() => setRenaming(null)}
        submitLabel="保存"
        onSubmit={doRename}
      >
        <LabeledInput label="名称" value={renameValue} onChangeText={setRenameValue} placeholder="我的手机" />
      </AdminSheet>

      <GlassNav title="通知" onBack={() => router.back()} />
    </View>
  );
}
