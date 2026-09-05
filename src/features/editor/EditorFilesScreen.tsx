/**
 * 任务/项目共用的编辑器文件入口。
 *
 * 先用现有 `/api/v1/users/editors` 找项目工作区；若无法从 projectId 唯一匹配，诚实展示
 * 选择器，不自动猜。选中后进入现有只读文件浏览页。
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { ApiError, listEditors, type EditorEntry } from '@/api/client';
import { Icons } from '@/components/Icons';
import { EmptyView } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

export function EditorFilesScreen({ projectId }: { projectId?: string }) {
  const t = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<EditorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await listEditors());
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载编辑器失败');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    if (!projectId) return [] as EditorEntry[];
    return rows.filter((r) => r.project_id === projectId);
  }, [projectId, rows]);

  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.ac} /></View>;

  // 没有 projectId（例如任务详情未返回 project_id）时，不列出全部编辑器，
  // 避免用户误以为这些工作区和当前任务有关。
  if (!projectId) {
    return (
      <View style={{ paddingTop: 40 }}>
        <EmptyView title="未绑定项目工作区" subtitle="当前任务未返回项目归属，无法自动定位编辑器工作区。可在项目详情中直接浏览文件。" icon="folder" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.pad, paddingTop: 14, paddingBottom: 100, gap: 10 }}>
      {shown.map((row) => (
        <Pressable key={row.id} onPress={() => router.push({ pathname: '/editor/[id]', params: { id: row.id, name: row.name || '编辑器' } } as never)} style={({ pressed }) => [{ padding: 14, borderRadius: 15, backgroundColor: t.bg2, flexDirection: 'row', alignItems: 'center', gap: 11, ...t.shCard }, pressed && { opacity: 0.72 }]}>
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}>
            <Icons.folder size={18} color={t.acTx} sw={1.9} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14, fontWeight: '700' }}>{row.name || `编辑器 ${row.id.slice(0, 8)}`}</Text>
            <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11.5, marginTop: 3 }}>{row.provider || '未知 provider'}{row.branch ? ` · ${row.branch}` : ''}</Text>
          </View>
          <Icons.chevron size={16} color={t.tx3} sw={1.9} />
        </Pressable>
      ))}
      {error ? <EmptyView title="加载失败" subtitle={error} icon="alert" /> : !shown.length ? <EmptyView title="该项目暂无编辑器" subtitle="请先在项目中创建编辑器" icon="folder" /> : null}
    </ScrollView>
  );
}
