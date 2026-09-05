import { Stack } from 'expo-router';
import React from 'react';

export default function ManagementLayout() {
  // 管理端用裸 Stack：每个页面自带 AdminTopBar 顶部导航，不再叠加 header。
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />;
}
