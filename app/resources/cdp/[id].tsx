/** CDP 浏览器客户端详情：连接信息 + 改名/启停 + Token 轮换/撤销 + 删除。 */
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createCdpClient,
  deleteCdpClient,
  getCdpConnectionInfo,
  listCdpClients,
  revokeCdpToken,
  rotateCdpToken,
  updateResource,
  type CdpClientResource,
  type CdpConnectionInfo,
} from '@/api/resources';
import { ApiError } from '@/api/client';
import { DetailRow, LabeledInput, SectionCard, SwitchRow } from '@/components/admin-ui';
import { EmptyView, GlassNav, LoadingView, PrimaryButton } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

export default function CdpDetailScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const [client, setClient] = useState<CdpClientResource | null>(null);
  const [connection, setConnection] = useState<CdpConnectionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const conn = await getCdpConnectionInfo().catch(() => null);
        setConnection(conn);
        if (isNew) { setLoading(false); return; }
        const list = await listCdpClients();
        const c = list.find((x) => String(x.id) === id) || null;
        setClient(c); setName(c?.name || ''); setEnabled(c?.enabled !== false);
      } finally { setLoading(false); }
    })();
  }, [id, isNew]);

  const showSecret = (title: string, secret: string) => Alert.alert(title, `${secret}\n\n完整内容只显示这一次，请复制保存。`, [{ text: '复制', onPress: () => void Clipboard.setStringAsync(secret) }, { text: '我已保存' }]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await createCdpClient(name.trim() || '浏览器客户端');
      showSecret('CDP 连接 Token（仅显示一次）', r.token);
      router.back();
    } catch (e) { Alert.alert('创建失败', e instanceof ApiError ? e.message : '请稍后重试'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!client || busy) return;
    setBusy(true);
    try { await updateResource(client.id, { name: name.trim(), enabled }, client.revision); router.back(); }
    catch (e) { Alert.alert('保存失败', e instanceof ApiError ? e.message : '请稍后重试'); }
    finally { setBusy(false); }
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载…" /><GlassNav title="浏览器客户端" onBack={() => router.back()} /></View>;
  if (!isNew && !client) return <View style={{ flex: 1, backgroundColor: t.bg }}><EmptyView title="未找到客户端" icon="alert" /><GlassNav title="浏览器客户端" onBack={() => router.back()} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 40, gap: 12 }}>
        <SectionCard title="连接信息">
          {connection ? (
            <>
              <DetailRow label="WebSocket" value={connection.ws_session_url} mono multiline />
              <DetailRow label="扩展下载" value={connection.extension_download_url} mono multiline />
            </>
          ) : <Text style={{ color: t.tx3, fontSize: 12.5 }}>连接信息不可用</Text>}
        </SectionCard>

        <SectionCard title={isNew ? '新建客户端' : '设置'}>
          <LabeledInput label="名称" value={name} onChangeText={setName} placeholder="浏览器客户端" />
          {!isNew ? <SwitchRow label="启用" value={enabled} onValueChange={setEnabled} /> : null}
        </SectionCard>

        {!isNew && client ? (
          <SectionCard title="Token">
            <DetailRow label="Token 摘要" value={client.token_hint || '已撤销'} mono />
            <View style={{ flexDirection: 'row', gap: 14, marginTop: 8 }}>
              <Pressable onPress={() => void rotateCdpToken(client.id).then((tk) => { showSecret('新 CDP Token（仅显示一次）', tk); }).catch((e) => Alert.alert('轮换失败', e instanceof ApiError ? e.message : '请稍后重试'))}><Text style={{ color: t.acTx, fontWeight: '700', fontSize: 12.5 }}>轮换</Text></Pressable>
              <Pressable onPress={() => void revokeCdpToken(client.id).then(() => setClient({ ...client, token_hint: '' })).catch((e) => Alert.alert('撤销失败', e instanceof ApiError ? e.message : '请稍后重试'))}><Text style={{ color: t.acTx, fontWeight: '700', fontSize: 12.5 }}>撤销</Text></Pressable>
              <Pressable onPress={() => Alert.alert('删除客户端', `删除“${client.name || client.id}”？`, [{ text: '取消' }, { text: '删除', style: 'destructive', onPress: () => void deleteCdpClient(client.id).then(() => router.back()).catch((e) => Alert.alert('删除失败', e instanceof ApiError ? e.message : '请稍后重试')) }])}><Text style={{ color: t.red, fontWeight: '700', fontSize: 12.5 }}>删除</Text></Pressable>
            </View>
            {client.pages?.length ? (
              <View style={{ marginTop: 10, gap: 6 }}>
                <Text style={{ fontSize: 11.5, color: t.tx3, fontWeight: '700' }}>当前网页</Text>
                {client.pages.map((p) => <Text key={p.id} numberOfLines={1} style={{ color: t.tx2, fontSize: 11, fontFamily: 'monospace' }}>{p.title || p.url}</Text>)}
              </View>
            ) : null}
          </SectionCard>
        ) : null}
      </ScrollView>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.pad, paddingTop: 10, paddingBottom: insets.bottom + 10, backgroundColor: t.bg, borderTopWidth: 1, borderColor: t.line }}>
        <PrimaryButton label={isNew ? '创建' : '保存'} icon="check" onPress={() => void (isNew ? create() : save())} disabled={busy} block />
      </View>
      <GlassNav title={isNew ? '新建浏览器客户端' : client?.name || '浏览器客户端'} onBack={() => router.back()} />
    </View>
  );
}
