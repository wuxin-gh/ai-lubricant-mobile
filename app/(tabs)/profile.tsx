import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolveAssetUrl } from '@/api/client';
import { checkAppUpdate, downloadAndInstallApk, installedAppVersion, latestAndroidPackage } from '@/updates/appUpdate';
import { useAuth } from '@/auth/AuthContext';
import { Icons } from '@/components/Icons';
import { BigTitle, Card, GlassTop, MonkeyLogo, Row, Toast } from '@/components/ui';
import { ACCENTS, ACCENT_KEYS, spacing, useTheme, useThemePrefs, type Theme, type ThemeMode } from '@/theme';


const THEME_OPTIONS: { k: ThemeMode; label: string }[] = [
  { k: 'system', label: '跟随系统' },
  { k: 'light', label: '浅色' },
  { k: 'dark', label: '深色' },
];

function Appearance({ t }: { t: Theme }) {
  const { mode, accent, setMode, setAccent } = useThemePrefs();
  return (
    <Card style={{ padding: 16 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.5, marginBottom: 12 }}>外观</Text>

      <Text style={{ fontSize: 13.5, fontWeight: '600', color: t.tx, marginBottom: 9 }}>主题</Text>
      <View style={{ flexDirection: 'row', backgroundColor: t.bg3, borderRadius: 12, padding: 3 }}>
        {THEME_OPTIONS.map((o) => {
          const on = mode === o.k;
          return (
            <Pressable key={o.k} onPress={() => setMode(o.k)} style={[{ flex: 1, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.bg2 : 'transparent' }, on && t.shCard]}>
              <Text style={{ fontSize: 13, fontWeight: on ? '700' : '500', color: on ? t.tx : t.tx2 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={{ fontSize: 13.5, fontWeight: '600', color: t.tx, marginTop: 16, marginBottom: 11 }}>点缀色</Text>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        {ACCENT_KEYS.map((k) => {
          const a = ACCENTS[k];
          const on = accent === k;
          return (
            <Pressable key={k} onPress={() => setAccent(k)} style={{ width: 40, height: 40, borderRadius: 99, alignItems: 'center', justifyContent: 'center', borderWidth: on ? 2 : 0, borderColor: a.fill }}>
              <View style={{ width: on ? 30 : 38, height: on ? 30 : 38, borderRadius: 99, backgroundColor: a.fill, alignItems: 'center', justifyContent: 'center' }}>
                {on ? <Icons.check size={16} color={a.ink} sw={2.8} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

// 产品相关入口（Ai Lubricant 智能开发平台）
const ABOUT_LINKS: { icon: string; label: string; sub: string; url: string }[] = [];

function About({ t }: { t: Theme }) {
  // 应用版本 = 原生安装包版本（App 唯一可信的自身版本）。对用户只有「版本」一个概念。
  const appVersion = installedAppVersion();
  const verLine = `v${appVersion}`;
  const open = (url: string) => { void Linking.openURL(url).catch(() => undefined); };
  const [busy, setBusy] = useState<null | 'checking' | 'downloading'>(null);
  const [progress, setProgress] = useState(0);

  // 与节点下载升级同构：问后端拿最新版本 + APK 直链 → 下载 → 校验 sha256 → 调起系统安装。
  // iOS 不自检（装不了自下载的包），只跳 App Store。
  const startDownload = useCallback((version: string, url: string, digest: string) => {
    setBusy('downloading');
    setProgress(0);
    void downloadAndInstallApk(url, digest, (received, total) => {
      if (total > 0) setProgress(Math.round((received / total) * 100));
    }).then((r) => {
      setBusy(null);
      setProgress(0);
      if (!r.ok) Alert.alert('更新失败', r.error || '下载或校验失败，请检查网络后重试。');
      // 成功时系统安装器已弹出，无需再提示。
    });
  }, []);

  const onCheck = useCallback(async () => {
    if (busy) return;
    setBusy('checking');
    const r = await checkAppUpdate();
    setBusy(null);
    if (r.status === 'ios-store') {
      if (!r.storeUrl) { Alert.alert('检查更新', '尚未配置 App Store 地址，请联系管理员。'); return; }
      Alert.alert('检查更新', '请前往 App Store 查看并更新到最新版本。', [
        { text: '稍后', style: 'cancel' },
        { text: '去 App Store', onPress: () => open(r.storeUrl) },
      ]);
      return;
    }
    // error（后端未发布版本/网络异常）视为已是最新，不向用户报错
    if (r.status === 'error' || r.status === 'disabled' || r.status === 'none') {
      Alert.alert('已是最新', `当前已是最新版本 ${verLine}。`);
      return;
    }
    Alert.alert(
      '发现新版本',
      `新版本 v${r.version} 可用${r.notes ? `\n\n${r.notes}` : ''}\n\n将下载安装包并调起系统安装。`,
      [
        { text: '稍后', style: 'cancel' },
        { text: '立即更新', onPress: () => startDownload(r.version, r.downloadUrl, r.digest) },
      ],
    );
  }, [busy, startDownload, verLine]);

  // 「关于」里的下载安装包入口：不比版本，直接取最新 APK 下载安装（重装/降级可用）。
  // 下载走服务端代理（latestAndroidPackage 返回的 url），手机无需直连 GitHub。iOS 无此入口。
  const onDownloadLatest = useCallback(async () => {
    if (busy) return;
    setBusy('checking');
    const pkg = await latestAndroidPackage();
    setBusy(null);
    if (!pkg) {
      Alert.alert('下载安装包', '暂未发布 Android 安装包，请联系管理员。');
      return;
    }
    Alert.alert(
      '下载安装包',
      `将下载 v${pkg.version} 并调起系统安装。${pkg.notes ? `\n\n${pkg.notes}` : ''}`,
      [
        { text: '取消', style: 'cancel' },
        { text: '下载', onPress: () => startDownload(pkg.version, pkg.url, pkg.digest) },
      ],
    );
  }, [busy, startDownload]);
  return (
    <Card style={{ padding: 16 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.5, marginBottom: 13 }}>关于</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={[{ width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: t.dark ? t.bg3 : '#fff' }, t.shCard]}>
          <MonkeyLogo size={36} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: t.tx }}>Ai Lubricant</Text>
          <Text style={{ fontSize: 12.5, color: t.tx3, marginTop: 2 }}>智能开发平台</Text>
        </View>
      </View>
      <View style={{ marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
        {ABOUT_LINKS.map((l, i) => {
          const I = Icons[l.icon] ?? Icons.globe;
          return (
            <Pressable key={l.url} onPress={() => open(l.url)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderColor: t.line }, pressed && { opacity: 0.55 }]}>
              <I size={18} color={t.tx2} sw={1.8} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 14.5, color: t.tx, fontWeight: '500' }}>{l.label}</Text>
                <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx3, fontFamily: 'monospace', marginTop: 1 }}>{l.sub}</Text>
              </View>
              <Icons.arrowRight size={15} color={t.tx3} sw={2} style={{ transform: [{ rotate: '-45deg' }] }} />
            </Pressable>
          );
        })}
        <Pressable onPress={onCheck} disabled={!!busy} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }, pressed && { opacity: 0.55 }]}>
          <Icons.refresh size={18} color={t.tx2} sw={1.8} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14.5, color: t.tx, fontWeight: '500' }}>检查更新</Text>
            <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx3, marginTop: 1 }}>
              {busy === 'checking'
                ? '正在检查…'
                : busy === 'downloading'
                  ? `正在下载安装包… ${progress}%`
                  : `当前版本 ${verLine}`}
            </Text>
          </View>
          {busy ? <ActivityIndicator size="small" color={t.tx3} /> : <Icons.arrowRight size={15} color={t.tx3} sw={2} />}
        </Pressable>
        {Platform.OS === 'android' ? (
          <Pressable onPress={onDownloadLatest} disabled={!!busy} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }, pressed && { opacity: 0.55 }]}>
            <Icons.download size={18} color={t.tx2} sw={1.8} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 14.5, color: t.tx, fontWeight: '500' }}>下载最新安装包</Text>
              <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx3, marginTop: 1 }}>
                服务器代理下载，可不升级直接重装
              </Text>
            </View>
            {busy ? <ActivityIndicator size="small" color={t.tx3} /> : <Icons.arrowRight size={15} color={t.tx3} sw={2} />}
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

function maskUserId(id: string): string {
  const v = id.trim();
  if (v.length <= 16) return v;
  return `${v.slice(0, 8)}...${v.slice(-6)}`;
}

export default function ProfileScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isAdmin, logout, refreshUser, setMode } = useAuth();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      refreshUser().catch(() => undefined).finally(() => { if (active) setBusy(false); });
      return () => { active = false; };
    }, [refreshUser]),
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1900);
  }, []);

  const copy = useCallback(async (text: string, msg: string) => {
    await Clipboard.setStringAsync(text);
    showToast(msg);
  }, [showToast]);

  const onLogout = () => {
    Alert.alert('退出登录', '确定要退出当前账号吗？', [
      { text: '取消', style: 'cancel' },
      // 退出后导航交给根布局鉴权守卫（authenticated 变 false 自动回登录页），避免二次跳转/卸载后 setState
      { text: '退出', style: 'destructive', onPress: async () => { setBusy(true); await logout(); } },
    ]);
  };

  const name = user?.name || user?.username || user?.email || '用户';
  const email = user?.email || '';
  const avatarUrl = resolveAssetUrl(user?.avatar_url || user?.avatar);
  useEffect(() => { setAvatarBroken(false); }, [avatarUrl]);
  useEffect(() => {
    if (email) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshUser().catch(() => undefined);
    });
    return () => sub.remove();
  }, [email, refreshUser]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 116 }}
        onScroll={(e) => { const y = e.nativeEvent.contentOffset.y; setCollapsed((c) => (c !== y > 26 ? y > 26 : c)); }}
        scrollEventThrottle={16}
      >
        <BigTitle title="我的" />

        <View style={{ paddingHorizontal: spacing.pad, paddingTop: 12, gap: spacing.gap }}>
          {/* identity */}
          <Card style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={[{ width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: avatarUrl && !avatarBroken ? t.ac : t.dark ? t.bg3 : '#fff' }, t.shCard]}>
              {avatarUrl && !avatarBroken
                ? <Image source={{ uri: avatarUrl }} onError={() => setAvatarBroken(true)} style={{ width: 60, height: 60, borderRadius: 18 }} />
                : <MonkeyLogo size={52} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 18, fontWeight: '800', color: t.tx }}>{name}</Text>
              <View style={{ marginTop: 7, gap: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <Icons.mail size={13} color={t.tx3} sw={1.8} />
                  <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: t.tx3, fontWeight: '500' }}>{email || '未绑定邮箱'}</Text>
                </View>
                {user?.id ? (
                  <Pressable onPress={() => copy(user.id!, '用户 ID 已复制')} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start' }, pressed && { opacity: 0.55 }]}>
                    <Icons.copy size={13} color={t.tx3} sw={1.8} />
                    <Text style={{ fontSize: 12.5, color: t.tx3, fontFamily: 'monospace' }}>{maskUserId(user.id)}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </Card>

          {/* 代码仓库与模型管理入口 */}
          <Card style={{ paddingTop: 14, paddingBottom: 2 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.5, paddingHorizontal: 16, marginBottom: 2 }}>集成</Text>
            <Row icon="git" label="Git 账号" value="绑定代码仓库凭证" onPress={() => router.push('/git-identities')} />
            <Row icon="cube" label="工具与配置" value="内置工具与个人 MCP 服务" divider onPress={() => router.push('/resources' as never)} />
          </Card>

          {/* 外观：主题 + 点缀色 */}
          <Appearance t={t} />

          {/* 关于：产品信息 + 官网/文档/开源仓库 */}
          <About t={t} />

          {/* 管理入口只对 role=admin 显示；后端仍会对每个管理接口做最终权限校验。 */}
          {isAdmin ? (
            <Pressable
              onPress={() => { setMode('admin'); router.replace('/management' as never); }}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 15, borderRadius: 18, backgroundColor: t.ac }, t.shCard, pressed && { opacity: 0.7 }]}
            >
              <Icons.crown size={19} color={t.acTx} sw={1.9} />
              <Text style={{ color: t.acTx, fontSize: 15.5, fontWeight: '700' }}>切换到管理端</Text>
            </Pressable>
          ) : null}

          {/* logout */}
          <Pressable onPress={onLogout} disabled={busy} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 15, borderRadius: 18, backgroundColor: t.bg2 }, t.shCard, pressed && { opacity: 0.7 }]}>
            <Icons.logout size={19} color={t.red} sw={1.9} />
            <Text style={{ color: t.red, fontSize: 15.5, fontWeight: '600' }}>退出登录</Text>
          </Pressable>

          <Text style={{ textAlign: 'center', color: t.tx3, fontSize: 12, marginTop: 4 }}>Building with Ai Lubricant</Text>
        </View>
      </ScrollView>

      <GlassTop title="我的" collapsed={collapsed} />
      {toast ? <Toast text={toast} bottom={insets.bottom + 116} /> : null}
    </View>
  );
}
