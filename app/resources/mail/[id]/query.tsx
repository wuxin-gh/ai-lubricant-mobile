/**
 * 邮件查询独立页。地址/关键词都不是必填：留空即查询该服务全部当前邮件。
 * 结果先展示摘要列表，点某封邮件才展开正文，避免在邮箱一级列表塞满查询表单和 JSON。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { queryMailMessages, type MailMessage } from '@/api/resources';
import { ApiError } from '@/api/client';
import { LabeledInput } from '@/components/admin-ui';
import { EmptyView, GlassNav, PrimaryButton } from '@/components/ui';
import { Icons } from '@/components/Icons';
import { spacing, useTheme } from '@/theme';

function field(message: MailMessage, ...names: string[]): string {
  for (const name of names) {
    const v = message[name];
    if (v != null && String(v)) return String(v);
  }
  return '';
}

export default function MailQueryScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [address, setAddress] = useState('');
  const [keyword, setKeyword] = useState('');
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [detail, setDetail] = useState<MailMessage | null>(null);
  const [error, setError] = useState('');

  const search = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await queryMailMessages(Number(id), {
        address: address.trim() || undefined,
        keyword: keyword.trim() || undefined,
        limit: 20, offset: 0,
      });
      setMessages(result.messages || []); setSearched(true); setDetail(null);
    } catch (e) { setError(e instanceof ApiError ? e.message : '查询失败'); setSearched(true); }
    finally { setBusy(false); }
  };

  if (detail) {
    const subject = field(detail, 'subject', 'title') || '无主题';
    const sender = field(detail, 'from', 'sender') || '未知发送者';
    const body = field(detail, 'text_content', 'html_content', 'raw_content', 'body', 'content') || '无正文';
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 30 }}>
          <Text style={{ color: t.tx, fontSize: 18, fontWeight: '800' }}>{subject}</Text>
          <Text style={{ color: t.tx3, fontSize: 12, marginTop: 7 }}>{sender}</Text>
          <Text style={{ color: t.tx3, fontSize: 11, marginTop: 3 }}>{field(detail, 'date', 'created_at', 'received_at')}</Text>
          <View style={{ marginTop: 16, padding: 15, borderRadius: 16, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2 }}>
            <Text selectable style={{ color: t.tx2, fontSize: 13, lineHeight: 21 }}>{body}</Text>
          </View>
        </ScrollView>
        <GlassNav title="邮件正文" onBack={() => setDetail(null)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={messages}
        keyExtractor={(m, i) => String(m.id ?? i)}
        contentContainerStyle={{ paddingTop: insets.top + 60, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 30, flexGrow: 1 }}
        ListHeaderComponent={(
          <View style={{ gap: 10, marginBottom: 12 }}>
            <Text style={{ color: t.tx3, fontSize: 12.5, lineHeight: 18 }}>地址和关键词均可留空；留空将查询此邮箱服务的全部当前邮件。</Text>
            <LabeledInput label="邮箱地址（可选）" value={address} onChangeText={setAddress} placeholder="留空查全部" autoCapitalize="none" />
            <LabeledInput label="关键词（可选）" value={keyword} onChangeText={setKeyword} placeholder="主题、发件人或正文" />
            <PrimaryButton label={busy ? '查询中…' : '查询'} icon="search" onPress={() => void search()} disabled={busy} block />
            {busy ? <ActivityIndicator color={t.ac} /> : null}
            {searched && !error ? <Text style={{ color: t.tx3, fontSize: 11.5 }}>找到 {messages.length} 封邮件</Text> : null}
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => setDetail(item)} style={({ pressed }) => [{ padding: 14, borderRadius: 15, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2, flexDirection: 'row', gap: 11, alignItems: 'center' }, pressed && { opacity: 0.75 }]}>
            <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}><Icons.mail size={18} color={t.acTx} sw={1.9} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14.5, fontWeight: '700' }}>{field(item, 'subject', 'title') || '无主题'}</Text>
              <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11.5, marginTop: 3 }}>{field(item, 'from', 'sender') || '未知发送者'} · {field(item, 'received_address', 'requested_address')}</Text>
              {field(item, 'date', 'created_at', 'received_at') ? <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 10.5, marginTop: 2 }}>{field(item, 'date', 'created_at', 'received_at')}</Text> : null}
            </View>
            <Icons.chevron size={16} color={t.tx3} />
          </Pressable>
        )}
        ListEmptyComponent={error ? <EmptyView title="查询失败" subtitle={error} icon="alert" /> : searched ? <EmptyView title="没有找到邮件" subtitle="换个条件重试，或留空查询全部" icon="mail" /> : <EmptyView title="尚未查询" subtitle="点「查询」实时读取当前邮件" icon="mail" />}
      />
      <GlassNav title="查询邮件" onBack={() => router.back()} />
    </View>
  );
}
