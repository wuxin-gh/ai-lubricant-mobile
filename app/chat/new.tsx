import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { LabeledInput, SwitchRow } from '@/components/admin-ui';
import { ApiError } from '@/api/client';
import { createChat, useChatModelOptions } from '@/hooks/useChatConversation';
import { Icons } from '@/components/Icons';
import { GlassNav, LoadingView } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

export default function NewChatScreen() {
  const t = useTheme();
  const router = useRouter();
  const { keys, models, loading, loadModelsFor } = useChatModelOptions();
  const [keyId, setKeyId] = useState<number | null>(null);
  const [model, setModel] = useState<string>('');
  const [title, setTitle] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState('0.7');
  const [maxTokens, setMaxTokens] = useState('4096');
  const [stream, setStream] = useState(true);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!keys.length) return;
    const first = keys[0];
    setKeyId(first.id);
    if (!model && models[0]?.id) setModel(models[0].id);
  }, [keys, models, model]);

  const create = async () => {
    if (busy) return;
    if (!keyId || !model) { Alert.alert('请选择 API Key 和模型'); return; }
    setBusy(true);
    try {
      const id = await createChat({
        apiKeyId: keyId,
        model,
        title,
        systemPrompt,
        temperature: Math.min(2, Math.max(0, Number(temperature) || 0.7)),
        maxTokens: Math.max(1, Number(maxTokens) || 4096),
        stream,
      });
      if (!id) throw new ApiError('创建失败');
      router.replace(`/chat/${id}` as never);
    } catch (e) {
      Alert.alert('创建失败', e instanceof ApiError ? e.message : '请稍后重试');
      setBusy(false);
    }
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载配置…" /><GlassNav title="新建聊天" onBack={() => router.back()} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: spacing.pad + 56, paddingHorizontal: spacing.pad, paddingBottom: 100, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.tx, fontSize: 22, fontWeight: '800' }}>新聊天</Text>

        <LabeledInput label="对话标题" value={title} onChangeText={setTitle} placeholder="可选，留空自动命名" />
        <LabeledInput label="系统提示词" value={systemPrompt} onChangeText={setSystemPrompt} placeholder="可选，设置助手角色和行为" multiline />

        {keys.length === 0 ? (
          <Text style={{ color: t.tx3, fontSize: 13, paddingVertical: 12 }}>没有可用的 API Key，请先在管理端创建。</Text>
        ) : (
          <>
            <Text style={{ color: t.tx3, fontSize: 12, fontWeight: '700', letterSpacing: 0.4, marginTop: 4 }}>API KEY</Text>
            {keys.map((k) => {
              const on = keyId === k.id;
              return (
                <Pressable key={k.id} onPress={() => { setKeyId(k.id); void loadModelsFor(k.id); setModel(''); }} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 13, borderWidth: 1.5, borderColor: on ? t.ac : t.line2, backgroundColor: on ? t.acGhost : t.bg2 }, pressed && { opacity: 0.8 }]}>
                  <Icons.key size={16} color={on ? t.acTx : t.tx2} sw={2} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14, fontWeight: '600' }}>{k.name || k.key_masked}</Text>
                    <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11, fontFamily: 'monospace', marginTop: 2 }}>{k.key_masked}</Text>
                  </View>
                  {on ? <Icons.check size={17} color={t.acTx} sw={2.4} /> : null}
                </Pressable>
              );
            })}

            <Text style={{ color: t.tx3, fontSize: 12, fontWeight: '700', letterSpacing: 0.4, marginTop: 6 }}>模型</Text>
            <Pressable onPress={() => { setModelSearch(''); setModelOpen(true); }} style={({ pressed }) => [{ height: 48, borderRadius: 14, borderWidth: 1.5, borderColor: model ? t.ac : t.line2, backgroundColor: model ? t.acGhost : t.bg2, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9 }, pressed && { opacity: 0.75 }]}>
              <Icons.search size={17} color={model ? t.acTx : t.tx3} sw={2} />
              <Text numberOfLines={1} style={{ flex: 1, color: model ? t.tx : t.tx3, fontSize: 14, fontWeight: model ? '700' : '500' }}>
                {models.find((m) => m.id === model)?.name || models.find((m) => m.id === model)?.remark || model || '搜索并选择模型'}
              </Text>
              <Icons.chevron size={16} color={t.tx3} sw={1.8} />
            </Pressable>
            {model ? <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 10.5, fontFamily: 'monospace' }}>{model}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><LabeledInput label="温度" value={temperature} onChangeText={setTemperature} keyboardType="numeric" hint="0–2，越高越随机" /></View>
              <View style={{ flex: 1 }}><LabeledInput label="最大输出 Token" value={maxTokens} onChangeText={setMaxTokens} keyboardType="numeric" /></View>
            </View>
            <SwitchRow label="流式输出" value={stream} onValueChange={setStream} hint="关闭时仍沿用现有聊天接口，回复完成后一次显示" />
          </>
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: spacing.pad, paddingBottom: 24, paddingTop: 8 }}>
        <Pressable onPress={create} disabled={busy || !keyId || !model} style={({ pressed }) => [{ height: 52, borderRadius: 16, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, (busy || !keyId || !model) && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.98 }] }]}>
          {busy ? <ActivityIndicator color={t.acInk} /> : <Icons.arrowRight size={18} color={t.acInk} sw={2.4} />}
          <Text style={{ color: t.acInk, fontSize: 16, fontWeight: '800' }}>{busy ? '创建中…' : '创建对话'}</Text>
        </Pressable>
      </View>
      <GlassNav title="新建聊天" onBack={() => router.back()} />
      <Modal visible={modelOpen} transparent animationType="fade" onRequestClose={() => setModelOpen(false)}>
        <Pressable onPress={() => setModelOpen(false)} style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.42)' }} />
        <View style={{ marginHorizontal: 18, marginTop: 90, maxHeight: '72%', borderRadius: 20, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2, overflow: 'hidden', ...t.shLift }}>
          <View style={{ padding: 12, borderBottomWidth: 1, borderColor: t.line }}>
            <View style={{ height: 44, borderRadius: 13, backgroundColor: t.bg3, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12 }}>
              <Icons.search size={17} color={t.tx3} sw={2} />
              <TextInput autoFocus value={modelSearch} onChangeText={setModelSearch} placeholder="搜索模型 ID、名称或说明" placeholderTextColor={t.tx3} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, color: t.tx, fontSize: 14 }} />
            </View>
          </View>
          <FlatList
            keyboardShouldPersistTaps="handled"
            data={models.filter((m) => { const q = modelSearch.trim().toLowerCase(); return !q || [m.id, m.name, m.remark, m.description].some((v) => String(v || '').toLowerCase().includes(q)); })}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: 8 }}
            renderItem={({ item: m }) => (
              <Pressable onPress={() => { setModel(m.id); setModelOpen(false); }} style={({ pressed }) => [{ paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12, backgroundColor: m.id === model ? t.acGhost : 'transparent' }, pressed && { backgroundColor: t.bg3 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text numberOfLines={1} style={{ flexShrink: 1, color: m.id === model ? t.acTx : t.tx, fontSize: 13.5, fontWeight: '700', fontFamily: 'monospace' }}>{m.id}</Text>
                      {m.type === 'model_group' ? (
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: t.bg4 }}>
                          <Text style={{ color: t.tx2, fontSize: 9.5, fontWeight: '700' }}>自定义模型组</Text>
                        </View>
                      ) : null}
                    </View>
                    {m.name || m.remark || m.description ? <Text numberOfLines={2} style={{ color: t.tx3, fontSize: 11, marginTop: 3 }}>{m.name || m.remark}{m.description ? ` · ${m.description}` : ''}</Text> : null}
                  </View>
                  {m.id === model ? <Icons.check size={17} color={t.acTx} sw={2.4} /> : null}
                </View>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={{ color: t.tx3, padding: 20, textAlign: 'center' }}>没有匹配的模型</Text>}
          />
        </View>
      </Modal>
    </View>
  );
}
