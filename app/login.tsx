/**
 * 登录页（精简版）。
 *
 * 只保留最基本的三项：服务器域名、账号、密码。移除了 Apple / 手机号 / 抖音 /
 * GitHub 等第三方登录、协议勾选与隐藏的服务器设置入口——私有化部署只需要
 * 「填域名 + 账号密码」即可登录。服务器地址支持局域网 UDP 广播扫描自动发现
 * （mobile/src/native/lanDiscover.ts）。
 */
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import { ApiError, DEFAULT_BASE_URL } from '@/api/client';
import { prefetchCaptcha } from '@/api/captcha';
import { useAuth } from '@/auth/AuthContext';
import { Icons } from '@/components/Icons';
import { MonkeyLogo } from '@/components/ui';
import { discoverLanServers, type LanServer } from '@/native/lanDiscover';
import { useTheme } from '@/theme';

const norm = (u: string) => u.trim().replace(/\/+$/, '');

export default function LoginScreen() {
  const t = useTheme();
  const { login, savedEmail, savedPassword, baseUrl, updateBaseUrl, setMode, needsPortalChoice } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [server, setServer] = useState(baseUrl || DEFAULT_BASE_URL);
  const [email, setEmail] = useState(savedEmail);
  const [password, setPassword] = useState(savedPassword);
  const [showPwd, setShowPwd] = useState(false);
  // 新安装默认不保存密码；已有 SecureStore 密码表示旧用户此前已选择/迁移保存。
  const [rememberPassword, setRememberPassword] = useState(!!savedPassword);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [focused, setFocused] = useState<string | null>(null);
  // 局域网扫描：状态 + 结果弹层（mobile/src/native/lanDiscover.ts）
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<LanServer[] | null>(null);
  // 管理员登录后选门户：由 AuthContext.needsPortalChoice 驱动，选中后 setMode() 同时清掉该标记。

  const pickMode = (m: 'user' | 'admin') => {
    setMode(m);
    router.replace((m === 'admin' ? '/management' : '/(tabs)/tasks') as never);
  };

  // 挂载即预取验证码：用户填账号密码期间后台拉挑战 + 算完 PoW（约 20 万次哈希），
  // 点登录时直接复用——把验证码两步请求和计算成本藏进输入时间，登录按钮不再卡几秒。
  // 目标地址变也重新预取（挑战按一次性消费，且不同后端实例的挑战不可共用）。
  useEffect(() => { prefetchCaptcha(norm(server)); }, [server]);

  // 视觉常量（与原设计一致，仅精简结构）
  const pageBg = '#F6F7F3';
  const heroGreen = '#1FA855';
  const heroGreen2 = '#1A9C50';
  const sheetBg = '#FFFFFF';
  const fieldBg = '#F4F5F1';
  const fieldBorder = '#E7E8E2';
  const inputText = '#262A27';
  const darkText = '#17181A';
  const iconIdle = '#A9AFA6';
  const loginShadow = { shadowColor: '#143C23', shadowOffset: { width: 0, height: 24 }, shadowOpacity: 0.28, shadowRadius: 25, elevation: 4 };
  const primaryShadow = { shadowColor: heroGreen2, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.35, shadowRadius: 13, elevation: 3 };

  const focusProps = (name: string) => ({ onFocus: () => setFocused(name), onBlur: () => setFocused((f) => (f === name ? null : f)) });
  const fieldFrameStyle = (name: string) => ({
    height: 54,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 11,
    paddingHorizontal: 16,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: focused === name ? heroGreen : fieldBorder,
    backgroundColor: focused === name ? sheetBg : fieldBg,
  });
  const inputStyle = { flex: 1, minWidth: 0, color: inputText, fontSize: 15.5, fontWeight: '600' as const, paddingVertical: 0 };
  const onSubmit = async () => {
    setError('');
    const target = norm(server);
    if (!target) { setError('请输入服务器域名'); return; }
    if (!/^https?:\/\//i.test(target)) { setError('服务器域名需以 http:// 或 https:// 开头'); return; }
    if (!email.trim() || !password.trim()) { setError('请输入账号和密码'); return; }

    setBusy(true);
    setPhase('正在登录…');
    try {
      // 先切换后端地址，再用它登录（login 内部会用 targetBaseUrl 取验证码）
      if (target !== norm(baseUrl)) await updateBaseUrl(target);
      await login(email, password, target, rememberPassword);
      // 普通用户由根布局清栈；管理员的 needsPortalChoice 会暂停导航并弹出门户选择。
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error)?.message || '登录失败，请重试');
    } finally {
      setBusy(false);
      setPhase('');
    }
  };

  // 局域网扫描：UDP 广播 + 收应答（详见 lan_discovery.py / docs/lan-discovery.md）。
  // iOS 首次扫描触发本地网络权限弹窗，本次调用往往已超时 → 零结果时自动补扫一次；
  // 仍为零再提示「去 设置 > 本地网络 开启」。
  const onScan = async (isRetry = false) => {
    if (scanning || busy) return;
    setError('');
    setScanning(true);
    try {
      const servers = await discoverLanServers();
      if (servers.length === 0 && !isRetry && Platform.OS === 'ios') {
        setScanning(false);
        await onScan(true); // 首次大概率在等权限弹窗，自动补扫一轮
        return;
      }
      if (servers.length === 0) {
        setError(
          Platform.OS === 'ios'
            ? '未发现局域网服务器，请确认手机与服务器在同一 Wi-Fi；若已拒绝本地网络权限，请到 设置 > 隐私与安全 > 本地网络 开启后重试'
            : '未发现局域网服务器，请确认手机与服务器在同一 Wi-Fi，或手动输入地址',
        );
        return;
      }
      if (servers.length === 1) {
        setServer(servers[0].url);
      } else {
        setScanResults(servers); // 多台弹列表让用户挑
      }
    } catch (e) {
      setError((e as Error)?.message || '局域网扫描失败');
    } finally {
      setScanning(false);
    }
  };

  const pickServer = (s: LanServer) => {
    setServer(s.url);
    setScanResults(null);
  };

  const HeroBackground = (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 336, borderBottomLeftRadius: 44, borderBottomRightRadius: 44, overflow: 'hidden' }}>
      <Svg width="100%" height="100%" viewBox="0 0 390 336" preserveAspectRatio="none">
        <Defs>
          <SvgLinearGradient id="heroGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#2ED06B" />
            <Stop offset="1" stopColor="#12904A" />
          </SvgLinearGradient>
        </Defs>
        <Rect x={0} y={0} width={390} height={336} fill="url(#heroGrad)" />
        <Circle cx={320} cy={50} r={120} fill="rgba(255,255,255,0.13)" />
        <Circle cx={50} cy={366} r={90} fill="rgba(255,255,255,0.09)" />
        <Circle cx={285} cy={165} r={45} fill="rgba(255,255,255,0.06)" />
      </Svg>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: pageBg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      {HeroBackground}
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 28, paddingBottom: 34, paddingTop: insets.top + 36 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={[{ width: 60, height: 60, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, { shadowColor: '#000000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.22, shadowRadius: 14, elevation: 4 }]}>
            <MonkeyLogo size={42} />
          </View>
          <View>
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#FFFFFF' }}>Ai Lubricant</Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.82)', marginTop: 2, letterSpacing: 1 }}>智能开发平台</Text>
          </View>
        </View>

        <Text style={{ marginTop: 32, fontSize: 30, fontWeight: '800', color: '#FFFFFF' }}>欢迎回来 👋</Text>
        <Text style={{ marginTop: 8, fontSize: 14.5, fontWeight: '500', color: 'rgba(255,255,255,0.85)' }}>填写服务器地址与账号即可登录</Text>

        <View style={[{ marginTop: 30, backgroundColor: sheetBg, borderRadius: 26, paddingTop: 22, paddingHorizontal: 22, paddingBottom: 24, gap: 15 }, loginShadow]}>
          <Text style={{ fontSize: 18, fontWeight: '600', color: darkText }}>登录</Text>

          <View style={fieldFrameStyle('server')}>
            <Icons.link size={19} color={focused === 'server' ? heroGreen : iconIdle} sw={1.9} />
            <TextInput value={server} onChangeText={setServer} placeholder="https://your-domain.com" placeholderTextColor="#B4B9B0"
              autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!busy}
              style={inputStyle} {...focusProps('server')} />
            <Pressable onPress={() => onScan()} disabled={scanning || busy} hitSlop={8} style={{ padding: 8 }}>
              {scanning
                ? <ActivityIndicator color={heroGreen} size="small" />
                : <Icons.radar size={20} color={focused === 'server' ? heroGreen : iconIdle} sw={1.9} />}
            </Pressable>
          </View>

          <View style={fieldFrameStyle('email')}>
            <Icons.mail size={19} color={focused === 'email' ? heroGreen : iconIdle} sw={1.9} />
            <TextInput value={email} onChangeText={setEmail} placeholder="账号 / 邮箱" placeholderTextColor="#B4B9B0"
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!busy}
              style={inputStyle} {...focusProps('email')} />
          </View>

          <View style={[fieldFrameStyle('pwd'), { paddingRight: 8 }]}>
            <Icons.lock size={19} color={focused === 'pwd' ? heroGreen : iconIdle} sw={1.9} />
            <TextInput value={password} onChangeText={setPassword} placeholder="请输入密码" placeholderTextColor="#B4B9B0"
              secureTextEntry={!showPwd} autoCapitalize="none" autoCorrect={false} editable={!busy}
              style={inputStyle} onSubmitEditing={onSubmit} {...focusProps('pwd')} />
            <Pressable onPress={() => setShowPwd((v) => !v)} hitSlop={8} style={{ padding: 8 }}>
              {showPwd ? <Icons.eye size={20} color={iconIdle} sw={1.8} /> : <Icons.eyeOff size={20} color={iconIdle} sw={1.8} />}
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 }}>
            <Text style={{ color: '#747B75', fontSize: 13, fontWeight: '600' }}>记住密码</Text>
            <Switch value={rememberPassword} onValueChange={setRememberPassword} disabled={busy} trackColor={{ false: '#DCDDDA', true: heroGreen }} />
          </View>

          {error ? <Text style={{ color: t.red, fontSize: 13 }}>{error}</Text> : null}

          <Pressable onPress={onSubmit} disabled={busy} style={({ pressed }) => [{ height: 54, backgroundColor: heroGreen2, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 4 }, primaryShadow, (busy || pressed) && { opacity: busy ? 0.55 : 0.86 }]}>
            {busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color="#FFFFFF" size="small" />
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>{phase || '登录中…'}</Text>
              </View>
            ) : <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 2 }}>登 录</Text>}
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={needsPortalChoice} transparent animationType="fade" onRequestClose={() => undefined}>
        <View style={styles.modeBackdrop}>
          <View style={[styles.modeCard, { backgroundColor: sheetBg }]}>
            <View style={styles.modeIcon}>
              <Icons.sparkle size={25} color={heroGreen2} sw={2} />
            </View>
            <Text style={styles.modeTitle}>选择进入的门户</Text>
            <Text style={styles.modeSubtitle}>此账号具有管理权限，之后可在“我的”中随时切换。</Text>
            <Pressable onPress={() => pickMode('user')} style={({ pressed }) => [styles.modeChoice, { borderColor: fieldBorder, backgroundColor: fieldBg }, pressed && { opacity: 0.72 }]}>
              <Icons.user size={21} color={inputText} sw={1.9} />
              <View style={{ flex: 1 }}>
                <Text style={styles.modeChoiceTitle}>用户端</Text>
                <Text style={styles.modeChoiceSub}>任务、项目、聊天与 Agent</Text>
              </View>
              <Icons.chevron size={17} color={iconIdle} sw={2} />
            </Pressable>
            <Pressable onPress={() => pickMode('admin')} style={({ pressed }) => [styles.modeChoice, { borderColor: heroGreen, backgroundColor: '#EFFAF3' }, pressed && { opacity: 0.72 }]}>
              <Icons.crown size={21} color={heroGreen2} sw={1.9} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.modeChoiceTitle, { color: heroGreen2 }]}>管理端</Text>
                <Text style={styles.modeChoiceSub}>平台配置、成员、渠道与日志</Text>
              </View>
              <Icons.chevron size={17} color={heroGreen2} sw={2} />
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 局域网扫描发现多台服务器时选择 */}
      <Modal visible={scanResults !== null} transparent animationType="fade" onRequestClose={() => setScanResults(null)}>
        <View style={styles.modeBackdrop}>
          <View style={[styles.modeCard, { backgroundColor: sheetBg }]}>
            <View style={styles.modeIcon}>
              <Icons.radar size={25} color={heroGreen2} sw={2} />
            </View>
            <Text style={styles.modeTitle}>发现 {scanResults?.length || 0} 台服务器</Text>
            <Text style={styles.modeSubtitle}>请选择要登录的服务器。</Text>
            {(scanResults || []).map((s) => (
              <Pressable
                key={s.url}
                onPress={() => pickServer(s)}
                style={({ pressed }) => [styles.modeChoice, { borderColor: fieldBorder, backgroundColor: fieldBg }, pressed && { opacity: 0.72 }]}
              >
                <Icons.server size={21} color={inputText} sw={1.9} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeChoiceTitle} numberOfLines={1}>{s.name}</Text>
                  <Text style={styles.modeChoiceSub} numberOfLines={1}>{s.ip}{s.version ? ` · v${s.version}` : ''}</Text>
                </View>
                <Icons.chevron size={17} color={iconIdle} sw={2} />
              </Pressable>
            ))}
            <Pressable onPress={() => setScanResults(null)} style={({ pressed }) => [styles.modeChoice, { borderColor: fieldBorder }, pressed && { opacity: 0.72 }]}>
              <Icons.x size={21} color={iconIdle} sw={2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.modeChoiceTitle}>取消</Text>
                <Text style={styles.modeChoiceSub}>保持当前填写的服务器地址</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  modeBackdrop: { flex: 1, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,18,13,0.48)' },
  modeCard: { width: '100%', borderRadius: 25, padding: 22, gap: 12 },
  modeIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F7EB', marginBottom: 2 },
  modeTitle: { color: '#17181A', fontSize: 20, fontWeight: '800' },
  modeSubtitle: { color: '#747B75', fontSize: 13.5, lineHeight: 20, marginBottom: 4 },
  modeChoice: { minHeight: 68, borderRadius: 16, borderWidth: 1.5, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  modeChoiceTitle: { color: '#262A27', fontSize: 15, fontWeight: '800' },
  modeChoiceSub: { color: '#8A918A', fontSize: 12, marginTop: 3 },
});
