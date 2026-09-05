import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { resolveRootDestination } from '@/auth/routeGuard';
import { LoadingView } from '@/components/ui';
import { PreviewProvider } from '@/components/PreviewProvider';
import { ThemeProvider, useTheme } from '@/theme';

function RootNav() {
  const { ready, authenticated, isAdmin, mode, needsPortalChoice } = useAuth();
  const t = useTheme();
  const segments = useSegments();
  const router = useRouter();

  // 鉴权导航的唯一入口：未登录踢回登录页；登录成功后清掉登录屏并进入主界面。
  // 用 dismissAll 清栈，避免登录页残留在栈底导致「登录后返回又回到登录页」。
  // 管理员登录后按所选门户分流：mode==='admin' 进 /management，否则进用户端。
  useEffect(() => {
    const destination = resolveRootDestination({
      ready,
      authenticated,
      isAdmin,
      mode,
      needsPortalChoice,
      rootSegment: segments[0],
    });
    if (!destination) return;
    if (segments[0] === 'login' && router.canDismiss?.()) router.dismissAll();
    router.replace(destination as never);
  }, [ready, authenticated, isAdmin, mode, needsPortalChoice, segments, router]);

  if (!ready) return <LoadingView label="正在加载…" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="task/[id]" />
      <Stack.Screen name="project/[id]" />
      <Stack.Screen name="project/issues" />
      <Stack.Screen name="project/issue" />
      <Stack.Screen name="project/new-issue" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="new-task" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      {/* push 屏（非 modal）：因为它内部会进一步 push 出「管理账号 / 编辑账号」等用 GlassNav 的页面，
          若为 modal，iOS 上这些子页面会被压到状态栏下方，GlassNav 预留的 insets.top 就变成标题上方一大片空白。 */}
      <Stack.Screen name="new-project" />
      <Stack.Screen name="models" />
      {/* push 屏（非 modal）：用 GlassNav，modal 下 iOS 会顶部空白（同 git-identity-form） */}
      <Stack.Screen name="model-form" />
      <Stack.Screen name="git-identities" />
      {/* push 屏（非 modal）：从账号列表下钻编辑/新增，右滑进入；GlassNav 的 insets.top 在全屏 push 下才正确，
          若用 modal 则 iOS 上 insets.top 会与卡片偏移叠加，标题上方出现一大片空白。 */}
      <Stack.Screen name="git-identity-form" />
      {/* Agent 对话：列表/新建/详情都走 push（详情内含键盘与流式收发，modal 下 iOS 顶部留白） */}
      <Stack.Screen name="agent/index" />
      <Stack.Screen name="agent/new" />
      <Stack.Screen name="agent/[id]" />
      {/* 聊天（纯 LLM 对话，不跑 Agent 工具） */}
      <Stack.Screen name="chat/index" />
      <Stack.Screen name="chat/new" />
      <Stack.Screen name="chat/[id]" />
      {/* 编辑器路由仅作为已发布 App/deep link 的兼容重定向保留；产品入口已下线。 */}
      <Stack.Screen name="editor/index" />
      <Stack.Screen name="editor/[id]" />
      {/* 管理端：保持独立 Stack，由 management/_layout.tsx 承载管理导航。 */}
      <Stack.Screen name="management" />
    </Stack>
  );
}

function Themed() {
  const t = useTheme();
  // SDK 56：expo-router 不再基于 react-navigation，导航主题改由各屏 Stack 的 contentStyle 决定。
  return (
    <>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <PreviewProvider>
        <RootNav />
      </PreviewProvider>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <ThemeProvider>
          <AuthProvider>
            <Themed />
          </AuthProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
