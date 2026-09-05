/**
 * 兼容重定向：编辑器入口已下线，统一回到任务列表或所属项目详情。
 * Editor id 不能推断 Task id，这里不做错误映射，避免错误跳转。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Toast } from '@/components/ui';

export default function EditorIndexRedirect() {
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();

  useEffect(() => {
    if (projectId) {
      router.replace({ pathname: '/project/[id]', params: { id: projectId } } as never);
      return;
    }
    router.replace('/(tabs)/tasks' as never);
  }, [projectId, router]);

  return <Toast text="编辑器入口已迁移，已为你跳转" />;
}
