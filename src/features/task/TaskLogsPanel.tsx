import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { getUserTaskLog, listUserTaskLogs, type UserTaskLog } from '@/api/task';
import { EmptyView } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

export function TaskLogsPanel({ taskId }: { taskId: string }) {
  const t = useTheme();
  const [logs, setLogs] = useState<UserTaskLog[]>([]);
  const [selected, setSelected] = useState<UserTaskLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listUserTaskLogs(taskId, 100, 0);
      setLogs(result.rows);
      setError('');
    } catch (e) {
      setError((e as Error)?.message || '请求日志加载失败');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !logs.length) return <View style={{ paddingTop: 50 }}><ActivityIndicator color={t.ac} /></View>;
  if (error && !logs.length) return <EmptyView icon="file" title="日志暂不可用" subtitle={error} />;

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.pad, paddingTop: 12, paddingBottom: 40, gap: 8 }}>
      {logs.map((log) => (
        <Pressable key={String(log.id)} onPress={() => void getUserTaskLog(taskId, log.id).then(setSelected).catch((e) => setError((e as Error)?.message || '日志详情加载失败'))} style={({ pressed }) => [{ backgroundColor: t.bg2, borderRadius: 13, padding: 12, borderWidth: 1, borderColor: selected?.id === log.id ? t.ac : t.line }, pressed && { opacity: 0.7 }]}>
          <Text numberOfLines={1} style={{ color: t.tx, fontSize: 13.5, fontWeight: '700' }}>{String(log.request_path || log.model || `请求 #${log.id}`)}</Text>
          <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 4 }}>{log.status_code || '—'} · {log.total_tokens || 0} tokens · {String(log.created_at || '')}</Text>
        </Pressable>
      ))}
      {logs.length === 0 ? <EmptyView icon="file" title="还没有请求日志" /> : null}
      {selected ? (
        <View style={{ backgroundColor: t.bg3, borderRadius: 13, padding: 12, marginTop: 4 }}>
          <Text style={{ color: t.tx3, fontSize: 11.5, fontWeight: '700', marginBottom: 8 }}>日志详情</Text>
          <Text selectable style={{ color: t.tx, fontFamily: 'monospace', fontSize: 11, lineHeight: 17 }}>{JSON.stringify(selected, null, 2)}</Text>
        </View>
      ) : null}
      {error ? <Text style={{ color: t.red, fontSize: 12 }}>{error}</Text> : null}
    </ScrollView>
  );
}
