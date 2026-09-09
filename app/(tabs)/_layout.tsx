import { Tabs } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AiConsentModal, useAiConsent } from '@/components/AiConsent';
import { Glass } from '@/components/glass';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';

const TAB_META: Record<string, { label: string; icon: string }> = {
  tasks: { label: '任务', icon: 'tasks' },
  projects: { label: '项目', icon: 'folder' },
  chat: { label: '对话', icon: 'mail' },
  agent: { label: 'Agent', icon: 'brain' },
  profile: { label: '我的', icon: 'user' },
};

// 纯 tab dock：新建入口分派到各页面自身（任务/聊天列表右上角 +、Agent 页选择器旁 +）。
function GlassDock({ state, navigation }: { state: any; navigation: any }) {
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
      </Glass>
    </View>
  );
}

export default function TabsLayout() {
  // 登录后进入首页（tab 区）首次提示 AI 数据处理同意（App Store 2.1）。已同意则不再弹；
  // 「暂不使用」仅本次关闭（下次启动再问），真正的硬拦截在任务会话页/新建任务页。
  const aiConsent = useAiConsent();
  const [consentDismissed, setConsentDismissed] = useState(false);
  return (
    <>
      <Tabs tabBar={(props) => <GlassDock {...(props as any)} />} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="tasks" />
        <Tabs.Screen name="projects" />
        <Tabs.Screen name="chat" />
        <Tabs.Screen name="agent" />
        <Tabs.Screen name="profile" />
      </Tabs>
      <AiConsentModal
        visible={aiConsent.status === 'needed' && !consentDismissed}
        onAgree={aiConsent.grant}
        onDecline={() => setConsentDismissed(true)}
      />
    </>
  );
}
