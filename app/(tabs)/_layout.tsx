import { Tabs, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AiConsentModal, useAiConsent } from '@/components/AiConsent';
import { Glass } from '@/components/glass';
import { Icons } from '@/components/Icons';
import { Scrim } from '@/components/ui';
import { useTheme } from '@/theme';

const TAB_META: Record<string, { label: string; icon: string }> = {
  tasks: { label: '任务', icon: 'tasks' },
  projects: { label: '项目', icon: 'folder' },
  chat: { label: '对话', icon: 'mail' },
  agent: { label: 'Agent', icon: 'brain' },
  profile: { label: '我的', icon: 'user' },
};

// 中间「+」的创建操作面板：新任务 / 聊天 / Agent 对话 / 新项目。
const CREATE_ACTIONS: { key: string; label: string; sub: string; icon: string; route: string }[] = [
  { key: 'task', label: '新任务', sub: '发起一个 AI 编码任务', icon: 'sparkle', route: '/new-task' },
  { key: 'chat', label: '聊天', sub: '直接与模型对话', icon: 'mail', route: '/chat/new' },
  { key: 'agent', label: 'Agent 对话', sub: '让 Agent 分析、实现和处理', icon: 'brain', route: '/agent/new' },
  { key: 'project', label: '新项目', sub: '关联 Git 仓库创建项目', icon: 'folder', route: '/new-project' },
];

function CreateSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (route: string) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Scrim onPress={onClose} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line2, paddingBottom: insets.bottom + 16, ...t.shLift }}>
        <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: t.line2, alignSelf: 'center', marginTop: 10, marginBottom: 4 }} />
        <Text style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 10, fontSize: 16, fontWeight: '700', color: t.tx }}>新建</Text>
        <View style={{ paddingHorizontal: 12, gap: 4 }}>
          {CREATE_ACTIONS.map((a) => {
            const I = Icons[a.icon] ?? Icons.plus;
            return (
              <Pressable key={a.key} onPress={() => onPick(a.route)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 12, paddingVertical: 14, borderRadius: 14 }, pressed && { backgroundColor: t.bg3 }]}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}><I size={21} color={t.acTx} sw={1.9} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: t.tx }}>{a.label}</Text>
                  <Text style={{ fontSize: 12, color: t.tx3, marginTop: 2 }}>{a.sub}</Text>
                </View>
                <Icons.chevron size={16} color={t.tx3} sw={1.9} />
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

function GlassDock({ state, navigation, onCreate }: { state: any; navigation: any; onCreate: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 8, alignItems: 'center' }}>
      <Glass radius={30} shadow border style={{ flexDirection: 'row', alignItems: 'center', gap: 5, padding: 7 }}>
        {state.routes.map((route: any, i: number) => {
          const meta = TAB_META[route.name];
          if (!meta) return null;
          const focused = state.index === i;
          const I = Icons[meta.icon];
          return (
            <Pressable
              key={route.key}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={{ minWidth: 60, height: 47, borderRadius: 21, alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: focused ? t.acGhost : 'transparent' }}
            >
              <I size={22} color={focused ? t.acTx : t.tx2} sw={focused ? 2.1 : 1.8} />
              <Text style={{ fontSize: 10.5, fontWeight: '600', color: focused ? t.acTx : t.tx2, letterSpacing: 0.2 }}>{meta.label}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={onCreate}
          style={({ pressed }) => [{ width: 47, height: 47, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: t.ac }, pressed && { transform: [{ scale: 0.9 }] }]}
        >
          <Icons.plus size={24} color={t.acInk} sw={2.4} />
        </Pressable>
      </Glass>
    </View>
  );
}

export default function TabsLayout() {
  // 登录后进入首页（tab 区）首次提示 AI 数据处理同意（App Store 2.1）。已同意则不再弹；
  // 「暂不使用」仅本次关闭（下次启动再问），真正的硬拦截在任务会话页/新建任务页。
  const aiConsent = useAiConsent();
  const router = useRouter();
  const [consentDismissed, setConsentDismissed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <>
      <Tabs tabBar={(props) => <GlassDock {...(props as any)} onCreate={() => setCreateOpen(true)} />} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="tasks" />
        <Tabs.Screen name="projects" />
        <Tabs.Screen name="chat" />
        <Tabs.Screen name="agent" />
        <Tabs.Screen name="profile" />
      </Tabs>
      <CreateSheet visible={createOpen} onClose={() => setCreateOpen(false)} onPick={(route) => { setCreateOpen(false); router.push(route as never); }} />
      <AiConsentModal
        visible={aiConsent.status === 'needed' && !consentDismissed}
        onAgree={aiConsent.grant}
        onDecline={() => setConsentDismissed(true)}
      />
    </>
  );
}
