/**
 * 聊天会话详情：OpenAI 兼容 SSE 流式收发 + 图片/视频/语音生成 + 附件上传。
 *
 * 输入器对齐 Web MessageComposer：输入框卡片 + 左侧附件 + 右侧模型下拉（可搜索）+
 * 发送/停止；模式 / 推理强度 / 媒体参数是输入框上方的 compact chips，点击弹底部
 * Sheet，不再把全部参数横铺在输入框上。
 */
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { pickImages } from '@/api/upload';
import { useChatConversation, type ChatRenderMessage } from '@/hooks/useChatConversation';
import {
  appendChatMessage,
  chatMedia,
  DEFAULT_CHAT_SETTINGS,
  listChatModels,
  listUsableKeys,
  type AvailableModel,
  type ChatMediaItem,
  type ChatMode,
  type RuntimeKeyItem,
} from '@/api/agent';
import { ApiError } from '@/api/client';
import { StreamBlock } from '@/components/StreamBlocks';
import { AdminSheet, LabeledInput, SearchableSelect, Segmented, SwitchRow } from '@/components/admin-ui';
import { EmptyView, GlassNav, LoadingView, Scrim, Toast } from '@/components/ui';
import { Icons } from '@/components/Icons';
import { spacing, useTheme, type Theme } from '@/theme';

const MODE_OPTIONS: { value: ChatMode; label: string }[] = [
  { value: 'chat', label: '对话' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'tts', label: '语音' },
];

const IMAGE_SIZES = ['1024x1024', '1024x1536', '1536x1024', '1792x1024', '1024x1792', '512x512'];
const VIDEO_SIZES = ['1280x720', '1920x1080', '720x1280', '1080x1920', '1024x1024'];
const TTS_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'ash', 'ballad', 'coral', 'sage', 'verse'];
const TTS_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];
const MODALITY_MAP: Record<ChatMode, string> = { chat: 'text', image: 'image', video: 'video', tts: 'audio' };

const EFFORT_OPTIONS = [
  { value: '', label: '默认' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
];

/** 从 chatMedia 响应提取媒体（对齐 Web extractMedia）。 */
function extractMedia(result: Record<string, unknown>, mode: ChatMode): ChatMediaItem[] {
  const items: ChatMediaItem[] = [];
  if (mode === 'tts') {
    const audio = result.audio as string | undefined;
    if (audio) items.push({ type: 'audio', b64: audio, mimeType: (result.content_type as string) || 'audio/mpeg' });
    return items;
  }
  const data = (result.data as Record<string, unknown>[]) || [];
  const type = mode === 'image' ? 'image' : 'video';
  for (const d of data) {
    const url = d.url as string | undefined;
    const b64 = (d.b64_json as string) || (d.b64 as string) || undefined;
    if (url || b64) items.push({ type, url, b64 });
  }
  return items;
}

function mediaDataUri(item: ChatMediaItem): string | undefined {
  if (item.url) return item.url;
  if (item.b64) return `data:${item.mimeType || (item.type === 'video' ? 'video/mp4' : item.type === 'audio' ? 'audio/mpeg' : 'image/png')};base64,${item.b64}`;
  return undefined;
}

/** 媒体结果渲染：图片直接 <Image>；视频/音频用 WebView 内联原生控件。 */
function MediaResult({ items, t, onCopy }: { items: ChatMediaItem[]; t: ReturnType<typeof useTheme>; onCopy?: (text: string) => void }) {
  return (
    <View style={{ gap: 10 }}>
      {items.map((item, i) => {
        const uri = mediaDataUri(item);
        if (!uri) return null;
        if (item.type === 'image') {
          return (
            <Pressable key={i} onLongPress={() => onCopy?.(uri)}>
              <Image source={{ uri }} resizeMode="contain" style={{ width: '100%', height: 280, borderRadius: 12, backgroundColor: t.bg3 }} />
            </Pressable>
          );
        }
        const tag = item.type === 'video' ? 'video' : 'audio';
        const html = `<!doctype html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;background:transparent"><${tag} controls style="max-width:100%" src="${uri}"></${tag}></body></html>`;
        return (
          <View key={i} style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: t.bg3, height: item.type === 'video' ? 220 : 56 }}>
            <WebView originWhitelist={['*']} source={{ html }} javaScriptEnabled mediaPlaybackRequiresUserAction={false} style={{ backgroundColor: 'transparent' }} />
          </View>
        );
      })}
    </View>
  );
}

/** assistant 消息下方的 usage 脚注。 */
function UsageFooter({ meta, t }: { meta?: { usage?: Record<string, unknown>; model?: string }; t: ReturnType<typeof useTheme> }) {
  const u = meta?.usage;
  if (!u) return null;
  const promptDetails = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const completionDetails = (u.completion_tokens_details ?? {}) as Record<string, unknown>;
  const input = Number(u.prompt_tokens ?? u.input_tokens) || 0;
  const output = Number(u.completion_tokens ?? u.output_tokens) || 0;
  const total = Number(u.total_tokens) || input + output;
  const cached = Number(u.cached_tokens ?? u.cache_read_input_tokens ?? promptDetails.cached_tokens) || 0;
  const reasoning = Number(u.reasoning_tokens ?? completionDetails.reasoning_tokens) || 0;
  const parts = [
    `${total} tokens`,
    cached ? `缓存 ${cached}` : '',
    reasoning ? `思考 ${reasoning}` : '',
    meta?.model ? meta.model : '',
  ].filter(Boolean);
  return <Text style={{ color: t.tx3, fontSize: 10.5, marginTop: 4 }}>{parts.join(' · ')}</Text>;
}

function chip(t: Theme, on: boolean) {
  return { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: on ? t.ac : t.bg3 } as const;
}
function chipText(t: Theme, on: boolean) {
  return { color: on ? t.acInk : t.tx2, fontSize: 11.5, fontWeight: '700' as const, maxWidth: 110 };
}

/** 底部参数 Sheet：图片尺寸/张数、视频尺寸/时长、语音音色/格式/语速。 */
function MediaParamsSheet({ visible, mode, t, imageSize, setImageSize, imageN, setImageN, videoSize, setVideoSize, videoSeconds, setVideoSeconds, ttsVoice, setTtsVoice, ttsFormat, setTtsFormat, ttsSpeed, setTtsSpeed, onClose }: {
  visible: boolean;
  mode: ChatMode;
  t: Theme;
  imageSize: string; setImageSize: (v: string) => void;
  imageN: string; setImageN: (v: string) => void;
  videoSize: string; setVideoSize: (v: string) => void;
  videoSeconds: string; setVideoSeconds: (v: string) => void;
  ttsVoice: string; setTtsVoice: (v: string) => void;
  ttsFormat: string; setTtsFormat: (v: string) => void;
  ttsSpeed: string; setTtsSpeed: (v: string) => void;
  onClose: () => void;
}) {
  const option = (label: string, on: boolean, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} style={({ pressed }) => [{ paddingHorizontal: 11, height: 30, borderRadius: 15, backgroundColor: on ? t.acGhost : t.bg3, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
      <Text style={{ color: on ? t.acTx : t.tx3, fontSize: 11.5, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Scrim onPress={onClose} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 24, ...t.shLift }}>
        <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: t.line2, alignSelf: 'center', marginTop: 10 }} />
        <Text style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10, fontSize: 15, fontWeight: '700', color: t.tx }}>
          {mode === 'image' ? '图片参数' : mode === 'video' ? '视频参数' : '语音参数'}
        </Text>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 14, paddingBottom: 8 }}>
          {mode === 'image' ? (
            <>
              <View>
                <Text style={{ color: t.tx3, fontSize: 11.5, fontWeight: '700', marginBottom: 8 }}>尺寸</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
                  {IMAGE_SIZES.map((s) => option(s, imageSize === s, () => setImageSize(s)))}
                </ScrollView>
              </View>
              <View>
                <Text style={{ color: t.tx3, fontSize: 11.5, fontWeight: '700', marginBottom: 8 }}>生成数量</Text>
                <View style={{ flexDirection: 'row', gap: 7 }}>
                  {[1, 2, 3, 4].map((n) => option(`n=${n}`, Number(imageN) === n, () => setImageN(String(n))))}
                </View>
              </View>
            </>
          ) : null}
          {mode === 'video' ? (
            <>
              <View>
                <Text style={{ color: t.tx3, fontSize: 11.5, fontWeight: '700', marginBottom: 8 }}>分辨率</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
                  {VIDEO_SIZES.map((s) => option(s, videoSize === s, () => setVideoSize(s)))}
                </ScrollView>
              </View>
              <View>
                <Text style={{ color: t.tx3, fontSize: 11.5, fontWeight: '700', marginBottom: 8 }}>时长（秒）</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  {[5, 10, 15, 20, 30, 60].map((s) => option(String(s), Number(videoSeconds) === s, () => setVideoSeconds(String(s))))}
                </View>
              </View>
            </>
          ) : null}
          {mode === 'tts' ? (
            <>
              <View>
                <Text style={{ color: t.tx3, fontSize: 11.5, fontWeight: '700', marginBottom: 8 }}>音色</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  {TTS_VOICES.map((v) => option(v, ttsVoice === v, () => setTtsVoice(v)))}
                </View>
              </View>
              <View>
                <Text style={{ color: t.tx3, fontSize: 11.5, fontWeight: '700', marginBottom: 8 }}>格式</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  {TTS_FORMATS.map((f) => option(`.${f}`, ttsFormat === f, () => setTtsFormat(f)))}
                </View>
              </View>
              <View>
                <Text style={{ color: t.tx3, fontSize: 11.5, fontWeight: '700', marginBottom: 8 }}>语速</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => option(`${s}x`, Number(ttsSpeed) === s, () => setTtsSpeed(String(s))))}
                </View>
              </View>
            </>
          ) : null}
          <Pressable onPress={onClose} style={{ height: 44, borderRadius: 14, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: t.acInk, fontSize: 14, fontWeight: '700' }}>完成</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function ChatConversationScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [keys, setKeys] = useState<RuntimeKeyItem[]>([]);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [apiKeyId, setApiKeyId] = useState<number | null>(null);
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<ChatMode>('chat');
  const [reasoningEffort, setReasoningEffort] = useState('');

  // 会话里 chat_settings 可能有上次选的 key/model；先用预取兜底，加载后回填。
  const conv = useChatConversation(id, { apiKeyId, model, reasoningEffort });
  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<{ uri: string; name: string; mimeType?: string }[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState('0.7');
  const [maxTokens, setMaxTokens] = useState('4096');
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [imageSize, setImageSize] = useState(DEFAULT_CHAT_SETTINGS.imageSize);
  const [imageN, setImageN] = useState('1');
  const [videoSize, setVideoSize] = useState(DEFAULT_CHAT_SETTINGS.videoSize);
  const [videoSeconds, setVideoSeconds] = useState('5');
  const [ttsVoice, setTtsVoice] = useState(DEFAULT_CHAT_SETTINGS.ttsVoice);
  const [ttsFormat, setTtsFormat] = useState(DEFAULT_CHAT_SETTINGS.ttsFormat);
  const [ttsSpeed, setTtsSpeed] = useState('1');
  const [contextSaving, setContextSaving] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatRenderMessage>>(null);

  useEffect(() => {
    const c = conv.conversation;
    if (!c) return;
    const s = (c.chat_settings ?? {}) as Partial<typeof DEFAULT_CHAT_SETTINGS>;
    setSystemPrompt(c.system_prompt || '');
    setTemperature(String(s.temperature ?? 0.7));
    setMaxTokens(String(s.maxTokens ?? 4096));
    setStreamEnabled(s.stream !== false);
    setReasoningEffort((s.reasoningEffort as '' | 'low' | 'medium' | 'high' | 'xhigh') ?? '');
    if (s.mode) setMode(s.mode as ChatMode);
    if (s.imageSize) setImageSize(s.imageSize);
    if (s.imageN) setImageN(String(s.imageN));
    if (s.videoSize) setVideoSize(s.videoSize);
    if (s.videoSeconds) setVideoSeconds(String(s.videoSeconds));
    if (s.ttsVoice) setTtsVoice(s.ttsVoice);
    if (s.ttsFormat) setTtsFormat(s.ttsFormat);
    if (s.ttsSpeed) setTtsSpeed(String(s.ttsSpeed));
  }, [conv.conversation]);

  const selectKey = async (nextKeyId: number) => {
    setApiKeyId(nextKeyId);
    const nextModels = await listChatModels(nextKeyId).catch(() => [] as AvailableModel[]);
    setModels(nextModels);
    if (!nextModels.some((item) => item.id === model)) setModel(nextModels[0]?.id || '');
  };

  const saveContext = async () => {
    const temp = Number(temperature); const max = Number(maxTokens);
    if (!Number.isFinite(temp) || temp < 0 || temp > 2) { Alert.alert('温度需在 0 到 2 之间'); return; }
    if (!Number.isFinite(max) || max <= 0) { Alert.alert('最大输出 Token 必须为正数'); return; }
    setContextSaving(true);
    try {
      const old = conv.conversation?.chat_settings ?? {};
      await conv.updateContext({
        system_prompt: systemPrompt,
        model,
        chat_settings: {
          ...old,
          mode,
          apiKeyId,
          model,
          temperature: temp,
          maxTokens: Math.floor(max),
          stream: streamEnabled,
          reasoningEffort,
          imageSize,
          imageN: Math.max(1, Number(imageN) || 1),
          videoSize,
          videoSeconds: Math.max(1, Number(videoSeconds) || 5),
          ttsVoice,
          ttsFormat,
          ttsSpeed: Math.min(4, Math.max(0.25, Number(ttsSpeed) || 1)),
        } as Record<string, unknown>,
      });
      setContextOpen(false); setToast('对话设置已保存');
    } catch (e) { Alert.alert('保存失败', (e as Error)?.message || '请稍后重试'); }
    finally { setContextSaving(false); }
  };

  useEffect(() => {
    (async () => {
      const k = await listUsableKeys().catch(() => [] as RuntimeKeyItem[]);
      setKeys(k);
      if (!k.length) return;
      const cs = conv.conversation?.chat_settings as { apiKeyId?: number; model?: string } | null | undefined;
      const wantedKey = cs?.apiKeyId && k.some((item) => item.id === cs.apiKeyId) ? cs.apiKeyId : k[0].id;
      const wantedModel = conv.conversation?.model || cs?.model || '';
      setApiKeyId(wantedKey);
      const m = await listChatModels(wantedKey).catch(() => [] as AvailableModel[]);
      setModels(m);
      setModel(m.some((item) => item.id === wantedModel) ? wantedModel : m[0]?.id || '');
    })();
  }, [conv.conversation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const tm = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(tm);
  }, [toast]);

  const len = conv.messages.length;
  const last = conv.messages[len - 1];
  const lastText = last?.kind === 'agent' ? last.text : undefined;
  useEffect(() => {
    if (!len) return;
    listRef.current?.scrollToEnd({ animated: true });
  }, [len, lastText]);

  /** 渲染消息（含媒体/usage 脚注）。 */
  const renderItem = ({ item, index }: { item: ChatRenderMessage; index: number }) => {
    const isLast = index === conv.messages.length - 1;
    const streamingNow = isLast && conv.streaming && item.kind === 'agent';
    const media = item.meta?.media;
    return (
      <View>
        <StreamBlock
          message={item}
          isStreaming={streamingNow}
          onCopy={async (txt) => { await Clipboard.setStringAsync(txt); setToast('已复制'); }}
        />
        {media?.length ? <MediaResult items={media} t={t} onCopy={async (u) => { await Clipboard.setStringAsync(u); setToast('已复制媒体地址'); }} /> : null}
        {item.kind === 'agent' && !streamingNow ? <UsageFooter meta={item.meta} t={t} /> : null}
        {item.kind === 'error' ? (
          <Pressable onPress={conv.retry} style={{ alignSelf: 'center', marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: t.acGhost }}>
            <Icons.refresh size={13} color={t.acTx} sw={2} />
            <Text style={{ color: t.acTx, fontSize: 12, fontWeight: '700' }}>重试</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  const filteredModels = useMemo(() => {
    const need = MODALITY_MAP[mode];
    return models.filter((m) => {
      const out = m.output_modalities;
      if (!out || out.length === 0) return mode === 'chat';
      return out.includes(need);
    });
  }, [mode, models]);

  const modelOk = filteredModels.some((m) => m.id === model);

  // 切媒体模式时若当前模型不支持该 output modality，自动切到第一项，避免发错接口。
  useEffect(() => {
    if (filteredModels.length && !modelOk) setModel(filteredModels[0].id);
  }, [filteredModels, modelOk]);

  const attachImages = async () => {
    if (pendingImages.length >= 3) { setToast('最多 3 张图片'); return; }
    const picked = await pickImages(3 - pendingImages.length);
    if (picked.length) setPendingImages((prev) => [...prev, ...picked]);
  };

  /** 媒体生成（image/video/tts）：非流式，结果写进消息流并落库。 */
  const sendMedia = async (text: string) => {
    if (!id || !apiKeyId || !model) return;
    setMediaBusy(true);
    try {
      const payload: Parameters<typeof chatMedia>[0] = {
        api_key_id: apiKeyId,
        mode: mode as 'image' | 'video' | 'tts',
        model,
      };
      if (mode === 'image') { payload.prompt = text; payload.size = imageSize; payload.n = Math.max(1, Number(imageN) || 1); }
      else if (mode === 'video') { payload.prompt = text; payload.size = videoSize; payload.seconds = Math.max(1, Number(videoSeconds) || 5); }
      else { payload.input = text; payload.voice = ttsVoice; payload.response_format = ttsFormat; payload.speed = Math.min(4, Math.max(0.25, Number(ttsSpeed) || 1)); }
      // 用户消息乐观插入 + 落库。
      void appendChatMessage(id, { role: 'user', content: text, status: 'done' }).catch(() => undefined);
      const result = await chatMedia(payload);
      const media = extractMedia(result, mode);
      // 落库 assistant（含媒体）。
      void appendChatMessage(id, { role: 'assistant', content: '', status: 'done', media, model }).catch(() => undefined);
      setToast('生成完成');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '生成失败';
      void appendChatMessage(id, { role: 'assistant', content: '', status: 'error', error: msg }).catch(() => undefined);
      Alert.alert('生成失败', msg);
    } finally {
      setMediaBusy(false);
      void conv.reload();
    }
  };

  const onSubmit = () => {
    const text = draft.trim();
    if ((!text && !pendingImages.length) || conv.streaming || mediaBusy || !apiKeyId || !model) return;
    if (mode !== 'chat') {
      if (!text) return;
      setDraft('');
      void sendMedia(text);
      return;
    }
    setDraft('');
    const files = pendingImages.length ? pendingImages : undefined;
    setPendingImages([]);
    conv.send(text, files);
  };

  if (conv.loading && !conv.messages.length) {
    return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载对话…" /><GlassNav title={conv.conversation?.title || '聊天'} onBack={() => router.back()} /></View>;
  }
  if (conv.error && !conv.messages.length) {
    return <View style={{ flex: 1, backgroundColor: t.bg }}><EmptyView title="加载失败" subtitle={conv.error} icon="alert" /><GlassNav title="聊天" onBack={() => router.back()} /></View>;
  }

  const ready = !!apiKeyId && !!model;
  const busy = conv.streaming || mediaBusy;
  const canSubmit = ready && !busy && (!!draft.trim() || (mode === 'chat' && pendingImages.length > 0));
  const modeLabel = MODE_OPTIONS.find((o) => o.value === mode)?.label || '对话';
  const paramsSummary = mode === 'image'
    ? `${imageSize} · n=${Math.max(1, Number(imageN) || 1)}`
    : mode === 'video'
      ? `${videoSize} · ${Math.max(1, Number(videoSeconds) || 5)}s`
      : mode === 'tts'
        ? `${ttsVoice} · .${ttsFormat} · ${Number(ttsSpeed) || 1}x`
        : '';

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        ref={listRef}
        data={conv.messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingTop: insets.top + 64, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 150, gap: 14, flexGrow: 1 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListHeaderComponent={conv.hasMore ? (
          <Pressable onPress={conv.loadOlder} disabled={conv.loadingOlder} style={{ alignSelf: 'center', marginBottom: 8, paddingHorizontal: 14, height: 30, borderRadius: 15, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: t.tx2, fontSize: 12, fontWeight: '600' }}>{conv.loadingOlder ? '加载中…' : '加载更早消息'}</Text>
          </Pressable>
        ) : null}
        ListEmptyComponent={<EmptyView title="开始聊天" subtitle={ready ? '在下方输入你的问题' : '请先在右上角选择 Key 与模型'} icon="mail" />}
        keyboardShouldPersistTaps="handled"
      />
      <GlassNav
        title={conv.conversation?.title || '聊天'}
        onBack={() => router.back()}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Pressable onPress={() => setContextOpen(true)} hitSlop={8} style={{ padding: 8 }}><Icons.settings size={19} color={t.tx2} sw={2} /></Pressable>
            {busy ? (
              <Pressable onPress={conv.abort} hitSlop={6} style={{ padding: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icons.stop size={15} color={t.red} sw={2.2} />
                <Text style={{ color: t.red, fontSize: 13, fontWeight: '700' }}>停止</Text>
              </Pressable>
            ) : null}
          </View>
        }
      />

      {/* 输入器（对齐 Web MessageComposer）：上方一行 compact 控件 + 卡片化输入框。 */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.pad, paddingTop: 8, paddingBottom: insets.bottom + 8, backgroundColor: t.bg, borderTopWidth: 1, borderColor: t.line, gap: 7 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: 'center' }}>
          {MODE_OPTIONS.map((o) => (
            <Pressable key={o.value} onPress={() => setMode(o.value)} style={chip(t, mode === o.value)}>
              <Text style={chipText(t, mode === o.value)}>{o.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setReasoningEffort((v) => (v ? '' : 'high'))} style={chip(t, !!reasoningEffort)}>
            <Icons.brain size={11} color={reasoningEffort ? t.acInk : t.tx2} sw={2.2} />
            <Text style={chipText(t, !!reasoningEffort)}>{reasoningEffort ? `思考 ${reasoningEffort}` : '思考'}</Text>
          </Pressable>
          {mode !== 'chat' ? (
            <Pressable onPress={() => setParamsOpen(true)} style={chip(t, false)}>
              <Text numberOfLines={1} style={[chipText(t, false), { maxWidth: 170 }]}>{paramsSummary || '参数'}</Text>
              <Icons.chevron size={11} color={t.tx3} sw={2.2} />
            </Pressable>
          ) : null}
        </ScrollView>

        {mode === 'chat' && pendingImages.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {pendingImages.map((img, i) => (
              <Pressable key={i} onPress={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}>
                <Image source={{ uri: img.uri }} style={{ width: 56, height: 56, borderRadius: 9, backgroundColor: t.bg3 }} />
                <View style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 99, backgroundColor: t.red, alignItems: 'center', justifyContent: 'center' }}>
                  <Icons.plus size={11} color="#fff" sw={2.6} style={{ transform: [{ rotate: '45deg' }] }} />
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <View style={{ borderRadius: 18, borderWidth: 1, borderColor: t.line2, backgroundColor: t.bg2, paddingHorizontal: 10, paddingVertical: 8, gap: 8 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={busy ? (mode === 'chat' ? '正在回复…' : '正在生成…') : mode === 'tts' ? '输入要转成语音的文本' : mode === 'chat' ? (ready ? '给模型发消息' : '请先选择 Key 与模型') : '描述要生成的内容'}
            placeholderTextColor={t.tx3}
            editable={ready && !busy}
            multiline
            style={{ minHeight: 40, maxHeight: 110, color: t.tx, fontSize: 15, paddingHorizontal: 4, paddingVertical: 4 }}
            onSubmitEditing={onSubmit}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {mode === 'chat' ? (
              <Pressable onPress={attachImages} disabled={busy} style={{ width: 30, height: 30, borderRadius: 99, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : 1 }}>
                <Icons.attach size={16} color={t.tx2} sw={1.9} />
              </Pressable>
            ) : null}
            <Pressable onPress={() => setModelOpen(true)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, borderRadius: 15, backgroundColor: t.bg3, paddingHorizontal: 10 }}>
              <Text numberOfLines={1} style={{ flexShrink: 1, color: modelOk ? t.tx2 : t.amber, fontSize: 11.5, fontFamily: 'monospace', fontWeight: '600' }}>{model || '选择模型'}</Text>
              <Icons.chevron size={11} color={t.tx3} sw={2.2} />
            </Pressable>
            {busy ? (
              <Pressable onPress={conv.abort} style={{ width: 34, height: 30, borderRadius: 15, backgroundColor: t.redGhost, alignItems: 'center', justifyContent: 'center' }}>
                <Icons.stop size={14} color={t.red} sw={2.2} />
              </Pressable>
            ) : (
              <Pressable onPress={onSubmit} disabled={!canSubmit} style={({ pressed }) => [{ width: 34, height: 30, borderRadius: 15, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }, !canSubmit && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.94 }] }]}>
                <Icons.send size={15} color={t.acInk} sw={2.2} />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {toast ? <Toast text={toast} bottom={insets.bottom + 160} /> : null}

      <MediaParamsSheet
        visible={paramsOpen}
        mode={mode}
        t={t}
        imageSize={imageSize} setImageSize={setImageSize}
        imageN={imageN} setImageN={setImageN}
        videoSize={videoSize} setVideoSize={setVideoSize}
        videoSeconds={videoSeconds} setVideoSeconds={setVideoSeconds}
        ttsVoice={ttsVoice} setTtsVoice={setTtsVoice}
        ttsFormat={ttsFormat} setTtsFormat={setTtsFormat}
        ttsSpeed={ttsSpeed} setTtsSpeed={setTtsSpeed}
        onClose={() => setParamsOpen(false)}
      />

      <AdminSheet visible={contextOpen} title="对话设置" onClose={() => setContextOpen(false)} submitLabel={contextSaving ? '保存中…' : '保存设置'} onSubmit={saveContext} submitting={contextSaving}>
        <Segmented label="模式" value={mode} options={MODE_OPTIONS} onChange={setMode} />
        <Pressable onPress={() => setKeyOpen(true)} style={{ minHeight: 48, borderRadius: 13, backgroundColor: t.bg3, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9 }}><Icons.key size={16} color={t.tx2} sw={2} /><View style={{ flex: 1 }}><Text style={{ color: t.tx3, fontSize: 11 }}>API KEY</Text><Text numberOfLines={1} style={{ color: t.tx, fontWeight: '700', marginTop: 2 }}>{keys.find((k) => k.id === apiKeyId)?.name || keys.find((k) => k.id === apiKeyId)?.key_masked || '请选择'}</Text></View><Icons.chevron size={16} color={t.tx3} /></Pressable>
        <Pressable onPress={() => setModelOpen(true)} style={{ minHeight: 48, borderRadius: 13, backgroundColor: t.bg3, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9 }}><Icons.search size={16} color={t.tx2} sw={2} /><View style={{ flex: 1 }}><Text style={{ color: t.tx3, fontSize: 11 }}>模型</Text><Text numberOfLines={1} style={{ color: t.tx, fontWeight: '700', marginTop: 2 }}>{models.find((m) => m.id === model)?.name || models.find((m) => m.id === model)?.remark || model || '搜索并选择模型'}</Text>{model ? <Text numberOfLines={1} style={{ color: t.tx3, fontFamily: 'monospace', fontSize: 10.5, marginTop: 2 }}>{model}</Text> : null}</View><Icons.chevron size={16} color={t.tx3} /></Pressable>
        <Segmented label="推理强度" value={reasoningEffort} options={EFFORT_OPTIONS} onChange={setReasoningEffort} hint="仅思考类模型生效；默认沿用模型配置" />
        <LabeledInput label="系统提示词" value={systemPrompt} onChangeText={setSystemPrompt} multiline placeholder="例如：你是一位严谨的编程助手…" />
        <LabeledInput label="温度" value={temperature} onChangeText={setTemperature} keyboardType="numeric" hint="0–2" />
        <LabeledInput label="最大输出 Token" value={maxTokens} onChangeText={setMaxTokens} keyboardType="numeric" />
        <SwitchRow label="流式输出" value={streamEnabled} onValueChange={setStreamEnabled} />
        <Text style={{ color: t.tx3, fontSize: 11 }}>历史上下文：{conv.messages.filter((m) => m.kind === 'user' || m.kind === 'agent').length} 条消息</Text>
      </AdminSheet>
      <SearchableSelect visible={keyOpen} title="选择 API Key" options={keys.map((k) => ({ value: String(k.id), label: k.name || k.key_masked, sub: k.key_masked }))} selected={apiKeyId ? [String(apiKeyId)] : []} onChange={(values) => { const next = Number(values[0]); if (next) void selectKey(next); }} onClose={() => setKeyOpen(false)} />
      <SearchableSelect
        visible={modelOpen}
        title={`选择模型（${modeLabel}模式）`}
        options={filteredModels.map((m) => ({
          value: m.id,
          label: m.type === 'model_group' ? `${m.name || m.remark || m.id}（自定义模型组）` : (m.name || m.remark || m.id),
          sub: m.description || m.id,
          keywords: [m.id, m.description, m.type === 'model_group' ? '自定义' : ''].filter(Boolean).join(' '),
        }))}
        selected={model ? [model] : []}
        onChange={(values) => setModel(values[0] || '')}
        onClose={() => setModelOpen(false)}
        emptyText="该模式下没有可用模型（按 output_modalities 过滤）"
      />
    </View>
  );
}
