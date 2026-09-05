/**
 * 兼容重定向：编辑器工作区入口已下线。Editor id 不能安全映射到 Task，
 * 因此统一回到任务列表，不猜测目标。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Toast } from '@/components/ui';

export default function EditorDetailRedirect() {
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ id?: string; projectId?: string }>();

  useEffect(() => {
    if (projectId) {
      router.replace({ pathname: '/project/[id]', params: { id: projectId } } as never);
      return;
    }
    router.replace('/(tabs)/tasks' as never);
  }, [projectId, router]);

  return <Toast text="编辑器入口已迁移，已为你跳转" />;
}
