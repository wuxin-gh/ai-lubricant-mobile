/**
 * 任务端口预览 / 网关请求日志的两个底部 sheet（对齐 Web task-detail 的
 * 端口预览 Dialog 与 RequestLogsDialog）。
 *
 * 移动端交互：sheet 内二级导航——列表页点一行展开详情（日志为 JSON 全文），
 * 不做 Web 的左右分栏（手机宽度放不下两栏）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { getUserTaskLog, listUserTaskLogs, listUserTaskPorts, type UserTaskLog, type UserTaskPort } from '@/api/task';
import { EmptyView } from '@/components/ui';
import { Icons } from '@/components/Icons';
import { formatDateTime } from '@/utils/format';
import { spacing, useTheme, type Theme } from '@/theme';

function SheetShell({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '82%', backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 18, ...t.shLift }}>
        <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: t.line2, alignSelf: 'center', marginTop: 10 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: t.tx, fontSize: 15, fontWeight: '800' }}>{title}</Text>
            {sub ? <Text style={{ color: t.tx3, fontSize: 11, marginTop: 2 }}>{sub}</Text> : null}
          </View>
          <Pressable onPress={onClose} hitSlop={8}><Icons.x size={18} color={t.tx2} sw={2.1} /></Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

/** 端口预览：port 列表 + preview_url 打开（对齐 Web TaskPreviewPanel）。 */
export function TaskPortsSheet({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const t = useTheme();
  const [ports, setPorts] = useState<UserTaskPort[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listUserTaskPorts(taskId);
      setPorts(result.ports || []);
      setSupported(result.supported !== false);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '端口列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <SheetShell
      title="端口预览"
      sub={supported ? undefined : '当前节点未提供端口能力'}
      onClose={onClose}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.pad }}>
        <Pressable onPress={() => void load()} disabled={loading} style={{ padding: 6, opacity: loading ? 0.5 : 1 }}>
          {loading ? <Icons.refresh size={16} color={t.tx3} sw={2.2} /> : <Icons.refresh size={16} color={t.tx2} sw={2} />}
        </Pressable>
      </View>
      {error ? <Text style={{ color: t.red, fontSize: 12, paddingHorizontal: spacing.pad, paddingBottom: 8 }}>{error}</Text> : null}
      {ports && ports.length > 0 ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.pad, gap: 8, paddingBottom: 8 }}>
          {ports.map((port) => {
            const url = port.preview_url || '';
            const failed = !url;
            return (
              <View key={String(port.port)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: failed ? t.line : t.acGhost, borderRadius: 12, padding: 12, backgroundColor: t.bg3 }}>
                <Icons.globe size={16} color={failed ? t.tx3 : t.acTx} sw={2} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: t.tx, fontSize: 13.5, fontWeight: '700' }}>端口 {port.port}</Text>
                  <Text numberOfLines={2} style={{ color: failed ? t.amber : t.tx3, fontSize: 11.5, lineHeight: 16, marginTop: 2 }}>
                    {failed ? (port.error_message || '暂无访问地址') : url}
                  </Text>
                </View>
                {url ? (
                  <Pressable onPress={() => { void Linking.openURL(url); }} style={({ pressed }) => [{ height: 32, paddingHorizontal: 13, borderRadius: 10, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.85 }]}>
                    <Text style={{ color: t.acInk, fontSize: 12.5, fontWeight: '700' }}>打开</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <View style={{ paddingVertical: 26 }}>
          <EmptyView icon="globe" title={supported ? '暂无端口' : '当前节点未提供端口能力'} />
        </View>
      )}
    </SheetShell>
  );
}

function logLine(log: UserTaskLog): string {
  const raw = log.created_at ?? (log as { time?: number | string }).time;
  return `${String(log.status_code ?? (log as { status?: number }).status ?? '')} · ${log.total_tokens || 0} tokens · ${formatLogTime(raw)}`;
}

/** 网关请求日志的时间字段可能是 unix 秒或 ISO 串（与 Web formatTime 同口径）。 */
function formatLogTime(value: string | number | undefined): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'number') return formatDateTime(value);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

/** 网关请求日志：列表 → 点开看 JSON 详情（对齐 Web RequestLogsDialog 的双栏语义）。 */
export function TaskLogsSheet({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const t = useTheme();
  const [logs, setLogs] = useState<UserTaskLog[] | null>(null);
  const [selected, setSelected] = useState<UserTaskLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setSelected(null);
    try {
      const page = await listUserTaskLogs(taskId, 100, 0);
      setLogs(page.rows || []);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载请求日志失败');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);

  const openLog = useCallback(async (log: UserTaskLog) => {
    setLoadingDetail(true);
    try {
      setSelected(await getUserTaskLog(taskId, Number(log.id)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载日志详情失败');
    } finally {
      setLoadingDetail(false);
    }
  }, [taskId]);

  return (
    <SheetShell title="网关请求日志" onClose={selected ? () => setSelected(null) : onClose} sub={selected ? '点击返回箭头回到列表' : undefined}>
      {selected ? (
        <View style={{ paddingHorizontal: 14 }}>
          <Pressable onPress={() => setSelected(null)} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6 }}>
            <Icons.chevron size={13} color={t.acTx} sw={2.2} style={{ transform: [{ rotate: '180deg' }] }} />
            <Text style={{ color: t.acTx, fontSize: 12.5, fontWeight: '700' }}>返回列表</Text>
          </Pressable>
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 12 }}>
            <Text selectable style={{ color: t.tx, fontFamily: 'monospace', fontSize: 11, lineHeight: 17 }}>{JSON.stringify(selected, null, 2)}</Text>
          </ScrollView>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.pad }}>
            <Pressable onPress={() => void load()} disabled={loading} style={{ padding: 6, opacity: loading ? 0.5 : 1 }}>
              <Icons.refresh size={16} color={t.tx2} sw={2} />
            </Pressable>
          </View>
          {error ? <Text style={{ color: t.red, fontSize: 12, paddingHorizontal: spacing.pad, paddingBottom: 8 }}>{error}</Text> : null}
          {logs && logs.length === 0 ? (
            <View style={{ paddingVertical: 26 }}>
              <EmptyView icon="file" title="暂无请求日志" />
            </View>
          ) : (
            <FlatList
              data={logs || []}
              keyExtractor={(log) => String(log.id)}
              style={{ maxHeight: 430 }}
              contentContainerStyle={{ paddingHorizontal: spacing.pad, paddingBottom: 8, gap: 6 }}
              ListEmptyComponent={loading ? null : <Text style={{ color: t.tx3, textAlign: 'center', padding: 20, fontSize: 12 }}>暂无请求日志</Text>}
              renderItem={({ item }) => (
                <Pressable onPress={() => void openLog(item)} style={({ pressed }) => [{ borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 11, backgroundColor: t.bg3 }, pressed && { opacity: 0.75 }]}>
                  <Text numberOfLines={1} style={{ color: t.tx, fontSize: 13 }}>{String(item.request_path || item.model || `#${item.id}`)}</Text>
                  <Text style={{ color: t.tx3, fontSize: 11, marginTop: 3 }}>{logLine(item)}</Text>
                </Pressable>
              )}
            />
          )}
        </>
      )}
      {loadingDetail ? <Text style={{ color: t.tx3, fontSize: 11.5, textAlign: 'center', paddingBottom: 6 }}>加载详情中…</Text> : null}
    </SheetShell>
  );
}
