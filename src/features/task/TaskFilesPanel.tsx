import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import {
  getUserTaskFileChanges,
  getUserTaskFileDiff,
  getUserTaskFiles,
  type UserTaskFileChange,
  type UserTaskFileEntry,
  type UserTaskFileResponse,
} from '@/api/task';
import { EmptyView } from '@/components/ui';
import { Icons } from '@/components/Icons';
import { spacing, useTheme } from '@/theme';

function joinPath(parent: string, name: string): string {
  const base = parent === '/' ? '' : parent.replace(/\/$/, '');
  return `${base}/${name}` || '/';
}

function statusMeta(status?: string): { label: string; color: string } {
  const code = String(status || '').trim();
  if (code.includes('A') || code === '??') return { label: code === '??' ? '未跟踪' : '新增', color: '#22C55E' };
  if (code.includes('D')) return { label: '删除', color: '#EF4444' };
  if (code.includes('R')) return { label: '重命名', color: '#A78BFA' };
  if (code.includes('U')) return { label: '冲突', color: '#F59E0B' };
  return { label: '修改', color: '#38BDF8' };
}

function DiffView({ diff }: { diff: string }) {
  const t = useTheme();
  return <ScrollView horizontal><View style={{ padding: 14, minWidth: '100%' }}>{diff.split('\n').map((line, i) => {
    const add = line.startsWith('+') && !line.startsWith('+++');
    const del = line.startsWith('-') && !line.startsWith('---');
    const color = add ? t.add : del ? t.red : line.startsWith('@@') ? t.acTx : t.tx;
    const backgroundColor = add ? t.acGhost : del ? t.redGhost : 'transparent';
    return <Text key={`${i}-${line.slice(0, 12)}`} selectable style={{ color, backgroundColor, fontFamily: 'monospace', fontSize: 11.5, lineHeight: 18 }}>{line || ' '}</Text>;
  })}</View></ScrollView>;
}

export function TaskFilesPanel({ taskId }: { taskId: string }) {
  const t = useTheme();
  const [tab, setTab] = useState<'files' | 'changes'>('files');
  const [path, setPath] = useState('/');
  const [data, setData] = useState<UserTaskFileResponse | null>(null);
  const [changes, setChanges] = useState<UserTaskFileChange[]>([]);
  const [repoMeta, setRepoMeta] = useState<{ branch?: string; commit?: string }>({});
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (nextPath = path) => {
    setLoading(true);
    try {
      setData(await getUserTaskFiles(taskId, nextPath));
      setPath(nextPath);
      setError('');
    } catch (e) { setError(e instanceof ApiError ? e.message : '工作区文件加载失败'); }
    finally { setLoading(false); }
  }, [path, taskId]);

  const loadChanges = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getUserTaskFileChanges(taskId);
      setChanges(result.changes || []);
      setRepoMeta({ branch: result.branch, commit: result.commit_hash });
      setError(result.success ? '' : result.error || '文件变更加载失败');
    } catch (e) { setError(e instanceof ApiError ? e.message : '文件变更加载失败'); }
    finally { setLoading(false); }
  }, [taskId]);

  useEffect(() => { void load('/'); }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'changes') void loadChanges(); }, [loadChanges, tab]);

  const openDiff = useCallback(async (change: UserTaskFileChange) => {
    if (loadingDiff || !change.path) return;
    setLoadingDiff(true);
    try {
      const result = await getUserTaskFileDiff(taskId, change.path);
      if (!result.success) throw new Error(result.error || '差异加载失败');
      setDiff({ path: result.path || change.path, text: result.diff || '' });
    } catch (e) { setError(e instanceof ApiError ? e.message : (e as Error)?.message || '差异加载失败'); }
    finally { setLoadingDiff(false); }
  }, [loadingDiff, taskId]);

  const entries = (data?.entries || []).slice().sort((a, b) => Number(!a.is_dir) - Number(!b.is_dir) || String(a.name || a.path).localeCompare(String(b.name || b.path)));
  const parent = path === '/' ? null : (path.split('/').slice(0, -1).join('/') || '/');

  return <View style={{ flex: 1 }}>
    <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: spacing.pad, paddingTop: 10 }}>
      {([{ key: 'files', label: '文件' }, { key: 'changes', label: `变动${changes.length ? ` ${changes.length}` : ''}` }] as const).map((item) => <Pressable key={item.key} onPress={() => setTab(item.key)} style={{ height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: tab === item.key ? t.ac : t.bg3, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: tab === item.key ? t.acInk : t.tx2, fontSize: 12.5, fontWeight: '700' }}>{item.label}</Text></Pressable>)}
    </View>

    {tab === 'files' ? <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.pad, paddingTop: 12, paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {parent ? <Pressable onPress={() => void load(parent)} style={{ padding: 7, borderRadius: 10, backgroundColor: t.bg3 }}><Icons.chevron size={16} color={t.tx2} sw={2} style={{ transform: [{ rotate: '180deg' }] }} /></Pressable> : null}
        <Text numberOfLines={1} style={{ flex: 1, color: t.tx2, fontFamily: 'monospace', fontSize: 12 }}>{path}</Text>
        <Pressable onPress={() => void load(path)} style={{ padding: 7 }}><Icons.refresh size={16} color={t.tx2} sw={2} /></Pressable>
      </View>
      {loading && !data ? <ActivityIndicator color={t.ac} /> : data?.is_dir ? entries.map((entry: UserTaskFileEntry, index) => {
        const name = String(entry.name || entry.path || `entry-${index}`);
        return <Pressable key={`${name}-${index}`} onPress={() => void load(joinPath(path, name))} style={({ pressed }) => [{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: t.line }, pressed && { backgroundColor: t.bg3 }]}><Icons.folder size={17} color={entry.is_dir ? t.acTx : t.tx3} sw={1.8} /><Text numberOfLines={1} style={{ flex: 1, color: t.tx, fontSize: 13.5 }}>{name}</Text>{entry.size != null ? <Text style={{ color: t.tx3, fontSize: 11 }}>{entry.size} B</Text> : null}</Pressable>;
      }) : data?.encoding === 'base64' ? <EmptyView icon="file" title="二进制文件" subtitle="移动端只读浏览暂不展示二进制内容" /> : <View style={{ backgroundColor: t.bg2, borderRadius: 14, padding: 13 }}><Text selectable style={{ color: t.tx, fontFamily: 'monospace', fontSize: 12, lineHeight: 18 }}>{data?.content || ''}</Text>{data?.truncated ? <Text style={{ color: t.amber, fontSize: 11, marginTop: 10 }}>文件超过读取上限，仅展示前 4 MiB</Text> : null}</View>}
      {data?.is_dir && entries.length === 0 ? <EmptyView icon="folder" title="目录为空" /> : null}
    </ScrollView> : <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.pad, paddingTop: 12, paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}><Text style={{ flex: 1, color: t.tx3, fontSize: 11.5 }}>{repoMeta.branch || 'detached'}{repoMeta.commit ? ` · ${repoMeta.commit.slice(0, 8)}` : ''}</Text><Pressable onPress={() => void loadChanges()}><Icons.refresh size={16} color={t.tx2} sw={2} /></Pressable></View>
      {loading ? <ActivityIndicator color={t.ac} /> : changes.map((change) => {
        const meta = statusMeta(change.status);
        return <Pressable key={`${change.status}-${change.path}`} onPress={() => void openDiff(change)} style={({ pressed }) => [{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: t.line }, pressed && { backgroundColor: t.bg3 }]}><View style={{ minWidth: 54, paddingHorizontal: 7, height: 24, borderRadius: 8, backgroundColor: `${meta.color}22`, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: meta.color, fontSize: 10.5, fontWeight: '800' }}>{meta.label}</Text></View><View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: t.tx, fontFamily: 'monospace', fontSize: 12.5 }}>{change.path}</Text>{change.old_path ? <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 10.5 }}>原：{change.old_path}</Text> : null}</View><Text style={{ color: t.add, fontSize: 11 }}>+{change.additions || 0}</Text><Text style={{ color: t.red, fontSize: 11 }}>-{change.deletions || 0}</Text></Pressable>;
      })}
      {!loading && changes.length === 0 ? <EmptyView icon="file" title="没有文件变动" /> : null}
    </ScrollView>}
    {error ? <Text style={{ color: t.red, fontSize: 12, paddingHorizontal: spacing.pad, paddingBottom: 8 }}>{error}</Text> : null}

    <Modal visible={diff !== null} animationType="slide" onRequestClose={() => setDiff(null)}><View style={{ flex: 1, backgroundColor: t.bg }}><View style={{ minHeight: 58, paddingHorizontal: spacing.pad, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: t.line }}><Pressable onPress={() => setDiff(null)}><Icons.chevron size={18} color={t.tx} sw={2} style={{ transform: [{ rotate: '180deg' }] }} /></Pressable><Text numberOfLines={1} style={{ flex: 1, color: t.tx, fontFamily: 'monospace', fontSize: 13, fontWeight: '700' }}>{diff?.path}</Text></View>{loadingDiff ? <ActivityIndicator color={t.ac} /> : diff?.text ? <DiffView diff={diff.text} /> : <EmptyView icon="file" title="没有差异内容" />}</View></Modal>
  </View>;
}
