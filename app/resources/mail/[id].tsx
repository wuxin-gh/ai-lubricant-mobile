/** 邮箱服务详情：设置表单 + 转发地址管理 + 「查询邮件」入口（独立页）。 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createMailAddress,
  createMailService,
  deleteMailAddress,
  deleteMailService,
  listMailServices,
  updateResource,
  type MailServiceResource,
} from '@/api/resources';
import { ApiError } from '@/api/client';
import { LabeledInput, SectionCard, SwitchRow } from '@/components/admin-ui';
import { EmptyView, GlassNav, LoadingView, PrimaryButton } from '@/components/ui';
import { Icons } from '@/components/Icons';
import { spacing, useTheme } from '@/theme';

const MAILBOX_TYPES = ['TempMail', 'IMAP', 'Gmail', 'Outlook'];

export default function MailDetailScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const [service, setService] = useState<MailServiceResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // 表单
  const [displayName, setDisplayName] = useState('');
  const [mailboxType, setMailboxType] = useState('TempMail');
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [mailSuffix, setMailSuffix] = useState('');
  const [password, setPassword] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [enabled, setEnabled] = useState(true);
  // 新增地址
  const [newAddress, setNewAddress] = useState('');
  const [newSource, setNewSource] = useState('');

  useEffect(() => {
    (async () => {
      if (isNew) { setLoading(false); return; }
      try {
        const list = await listMailServices();
        const s = list.find((x) => String(x.resource_id || x.id) === id) || null;
        setService(s);
        setDisplayName(s?.display_name || ''); setMailboxType(s?.mailbox_type || 'TempMail');
        setBaseUrl(s?.base_url || ''); setUsername(s?.username || ''); setMailSuffix(s?.mail_suffix || '');
        setEnabled(s?.enabled !== false);
      } finally { setLoading(false); }
    })();
  }, [id, isNew]);

  const save = async () => {
    if (busy) return;
    if (!displayName.trim()) { Alert.alert('请填写显示名称'); return; }
    setBusy(true);
    try {
      if (isNew) {
        await createMailService({
          display_name: displayName.trim(), mailbox_type: mailboxType, base_url: baseUrl.trim() || undefined,
          username: username.trim() || undefined, mail_suffix: mailSuffix.trim() || undefined,
          ...(password ? { password } : {}), ...(secretKey ? { secret_key: secretKey } : {}), enabled,
        });
      } else if (service) {
        const data: Record<string, unknown> = {
          display_name: displayName.trim(), mailbox_type: mailboxType, base_url: baseUrl.trim(),
          username: username.trim(), mail_suffix: mailSuffix.trim(), enabled,
        };
        if (password) data.password = password;
        if (secretKey) data.secret_key = secretKey;
        await updateResource(service.id, data, service.revision);
      }
      router.back();
    } catch (e) { Alert.alert('保存失败', e instanceof ApiError ? e.message : '请稍后重试'); }
    finally { setBusy(false); }
  };

  const addAddress = async () => {
    if (!service || !newAddress.trim() || busy) return;
    setBusy(true);
    try {
      await createMailAddress(service.resource_id, { address: newAddress.trim(), source_address: newSource.trim() || undefined });
      const list = await listMailServices();
      setService(list.find((x) => x.id === service.id) ?? service);
      setNewAddress(''); setNewSource('');
    } catch (e) { Alert.alert('保存失败', e instanceof ApiError ? e.message : '请稍后重试'); }
    finally { setBusy(false); }
  };
  const removeAddress = (addressId: number, addr: string) => {
    Alert.alert('删除地址', `删除「${addr}」？`, [
      { text: '取消' },
      { text: '删除', style: 'destructive', onPress: () => { void deleteMailAddress(addressId).then(async () => { const list = await listMailServices(); setService((prev) => (prev ? list.find((x) => x.id === prev.id) ?? prev : prev)); }).catch((e) => Alert.alert('删除失败', e instanceof ApiError ? e.message : '请稍后重试')); } },
    ]);
  };
  const removeService = () => {
    if (!service) return;
    Alert.alert('删除邮箱服务', `删除“${service.display_name || service.id}”？`, [
      { text: '取消' },
      { text: '删除', style: 'destructive', onPress: () => void deleteMailService(service.resource_id).then(() => router.back()).catch((e) => Alert.alert('删除失败', e instanceof ApiError ? e.message : '请稍后重试')) },
    ]);
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载…" /><GlassNav title="邮箱服务" onBack={() => router.back()} /></View>;
  if (!isNew && !service) return <View style={{ flex: 1, backgroundColor: t.bg }}><EmptyView title="未找到邮箱服务" icon="alert" /><GlassNav title="邮箱服务" onBack={() => router.back()} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 100, gap: 12 }}>
        {!isNew && service ? (
          <Pressable onPress={() => router.push(`/resources/mail/${service.resource_id}/query` as never)} style={({ pressed }) => [{ padding: 15, borderRadius: 16, backgroundColor: t.acGhost, borderWidth: 1, borderColor: t.ac, flexDirection: 'row', alignItems: 'center', gap: 12 }, pressed && { opacity: 0.75 }]}>
            <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }}><Icons.search size={20} color={t.acInk} sw={2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.tx, fontSize: 15, fontWeight: '700' }}>查询邮件</Text>
              <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 2 }}>按地址 / 关键词实时查询，均可留空</Text>
            </View>
            <Icons.chevron size={17} color={t.acTx} sw={1.8} />
          </Pressable>
        ) : null}

        <SectionCard title={isNew ? '新建邮箱服务' : '设置'}>
          <LabeledInput label="显示名称" value={displayName} onChangeText={setDisplayName} placeholder="例如：临时邮箱" />
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.3 }}>邮箱类型</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
              {MAILBOX_TYPES.map((type) => {
                const on = mailboxType === type;
                return (
                  <Pressable key={type} onPress={() => setMailboxType(type)} style={{ paddingHorizontal: 12, height: 34, borderRadius: 11, backgroundColor: on ? t.ac : t.bg3, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: on ? t.acInk : t.tx2, fontSize: 11.5, fontWeight: '700' }}>{type}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <LabeledInput label="服务器地址" value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" />
          <LabeledInput label="用户名" value={username} onChangeText={setUsername} autoCapitalize="none" />
          <LabeledInput label="邮箱后缀" value={mailSuffix} onChangeText={setMailSuffix} autoCapitalize="none" />
          <LabeledInput label="密码" value={password} onChangeText={setPassword} secureTextEntry hint={service?._secrets?.password?.state === 'set' ? '已设置，留空不改' : undefined} />
          <LabeledInput label="Secret Key" value={secretKey} onChangeText={setSecretKey} secureTextEntry hint={service?._secrets?.secret_key?.state === 'set' ? '已设置，留空不改' : undefined} />
          <SwitchRow label="启用" value={enabled} onValueChange={setEnabled} />
        </SectionCard>

        {!isNew && service ? (
          <>
            <SectionCard title={`转发地址（${service.addresses?.length || 0}）`}>
              {service.addresses?.length ? service.addresses.map((a) => (
                <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: 0.5, borderColor: t.line }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: t.tx2, fontSize: 12 }}>{a.address || '—'}</Text>
                    {a.source_address ? <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 10.5, marginTop: 1 }}>← {a.source_address}</Text> : null}
                  </View>
                  <Pressable onPress={() => removeAddress(a.id, a.address || '')} hitSlop={6}><Text style={{ color: t.red, fontSize: 11.5, fontWeight: '700' }}>删除</Text></Pressable>
                </View>
              )) : <Text style={{ color: t.tx3, fontSize: 12.5, paddingVertical: 6 }}>暂无地址</Text>}
              <View style={{ gap: 8, marginTop: 10 }}>
                <TextInput value={newAddress} onChangeText={setNewAddress} placeholder="新地址，例如 temp@demo.dev" placeholderTextColor={t.tx3} autoCapitalize="none" style={{ minHeight: 42, borderRadius: 12, paddingHorizontal: 12, backgroundColor: t.bg3, color: t.tx, fontSize: 13 }} />
                <TextInput value={newSource} onChangeText={setNewSource} placeholder="来源地址（可选）" placeholderTextColor={t.tx3} autoCapitalize="none" style={{ minHeight: 42, borderRadius: 12, paddingHorizontal: 12, backgroundColor: t.bg3, color: t.tx, fontSize: 13 }} />
                <Pressable onPress={() => void addAddress()} disabled={!newAddress.trim() || busy} style={({ pressed }) => [{ height: 42, borderRadius: 12, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }, (!newAddress.trim() || busy) && { opacity: 0.45 }, pressed && { opacity: 0.8 }]}>
                  <Text style={{ color: t.acInk, fontWeight: '700', fontSize: 13.5 }}>添加地址</Text>
                </Pressable>
              </View>
            </SectionCard>
            <Pressable onPress={removeService} style={({ pressed }) => [{ height: 46, borderRadius: 14, backgroundColor: t.redGhost, borderWidth: 1, borderColor: t.red, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.75 }]}>
              <Text style={{ color: t.red, fontWeight: '700', fontSize: 14.5 }}>删除邮箱服务</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.pad, paddingTop: 10, paddingBottom: insets.bottom + 10, backgroundColor: t.bg, borderTopWidth: 1, borderColor: t.line }}>
        <PrimaryButton label={busy ? '保存中…' : '保存'} icon="check" onPress={() => void save()} disabled={busy} block />
      </View>
      <GlassNav title={isNew ? '新建邮箱服务' : service?.display_name || '邮箱服务'} onBack={() => router.back()} />
    </View>
  );
}
