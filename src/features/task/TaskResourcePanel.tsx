/**
 * Task 运行期资源面板（设置 Tab 内）。
 *
 * 展示当前持久化在 Task 行上的 skill/mcp/plugin 配置（后端已脱敏，只含
 * name/type/source 等展示字段），并允许增删——改动通过 PUT /tasks/{id}
 * 下发，后端解析授权后落库并对活跃 runtime 跑 apply_node_session_* 热更新。
 * 运行时离线时只持久化，下次重启/restart 后生效，面板如实提示。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import {
  listAuthorizedResources,
  updateUserTask,
  type AuthorizedResource,
  type TaskResourceKind,
  type UserTaskDetail,
} from '@/api/task';
import { EmptyView } from '@/components/ui';
import { Icons } from '@/components/Icons';
import { spacing, useTheme } from '@/theme';

type Kind = 'skill' | 'mcp' | 'plugin';

const KINDS: { key: Kind; label: string }[] = [
  { key: 'skill', label: '技能' },
  { key: 'mcp', label: 'MCP' },
  { key: 'plugin', label: '插件' },
];

/** 后端脱敏后的资源项：至少有 name；type/url/source 可能为空。 */
function nameOf(item: Record<string, unknown>): string {
  return String(item.name || item.id || '未命名');
}
function subOf(item: Record<string, unknown>): string {
  const parts: string[] = [];
  if (item.type) parts.push(String(item.type));
  if (item.source) parts.push(String(item.source));
  if (item.version) parts.push(`v${item.version}`);
  return parts.join(' · ');
}

export function TaskResourcePanel({ task, onChanged }: { task: UserTaskDetail; onChanged?: () => void }) {
  const t = useTheme();
  const [available, setAvailable] = useState<Record<Kind, AuthorizedResource[]>>({ skill: [], mcp: [], plugin: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadAvailable = useCallback(async () => {
    const [skill, mcp, plugin] = await Promise.all([
      listAuthorizedResources('skill').catch(() => [] as AuthorizedResource[]),
      listAuthorizedResources('mcp').catch(() => [] as AuthorizedResource[]),
      listAuthorizedResources('plugin').catch(() => [] as AuthorizedResource[]),
    ]);
    setAvailable({ skill, mcp, plugin });
  }, []);

  useEffect(() => {
    void loadAvailable().finally(() => setLoading(false));
  }, [loadAvailable]);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  const currentIds = useCallback((kind: Kind): string[] => {
    const list = (task[`${kind}_config`] as Record<string, unknown>[] | undefined) || [];
    return list.map((item) => String(item.resource_id || item.id || nameOf(item))).filter(Boolean);
  }, [task]);

  const save = useCallback(async (kind: Kind, nextIds: string[]) => {
    if (busy) return;
    setBusy(kind);
    try {
      // Only mcp_config carries resource_id-bearing dicts at the API; skill/plugin
      // ride on extra.skill_ids/plugin_ids. But the update route only accepts
      // *_config lists (not extra ids), so we send resource_id dicts for all
      // three — the resolver folds them back into trusted specs.
      const payload = { [`${kind}_config`]: nextIds.map((id) => ({ resource_id: id })) };
      const res = await updateUserTask(task.id, payload);
      const resync = res?.config_resync;
      const applied = resync?.applied?.length ? `已热更新 ${resync.applied.length} 个运行时` : '已保存（运行时离线，重启后生效）';
      flash(applied);
      onChanged?.();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : '更新失败');
    } finally {
      setBusy(null);
    }
  }, [busy, task.id, onChanged]);

  if (loading) return <View style={{ paddingTop: 40 }}><ActivityIndicator color={t.ac} /></View>;

  return (
    <View style={{ backgroundColor: t.bg2, borderRadius: 16, padding: 14, ...t.shCard }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.4, marginBottom: 10 }}>资源配置</Text>
      <Text style={{ fontSize: 11.5, color: t.tx3, lineHeight: 17, marginBottom: 12 }}>改动会即时下发到活跃运行时（节点纯磁盘写入，下一条消息重新准备 provider）。运行时离线时仅保存，重启后生效。</Text>
      {KINDS.map((k) => {
        const list = (task[`${k.key}_config`] as Record<string, unknown>[] | undefined) || [];
        const pool = available[k.key];
        const selectedIds = currentIds(k.key);
        return (
          <View key={k.key} style={{ marginBottom: 14 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx2, marginBottom: 6 }}>{k.label}（{list.length}）</Text>
            {list.length === 0 ? <Text style={{ color: t.tx3, fontSize: 12 }}>未配置</Text> : list.map((item, i) => (
              <View key={`${nameOf(item)}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 34, paddingVertical: 4 }}>
                <Icons.sparkle size={13} color={t.acTx} sw={1.8} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: t.tx, fontSize: 13 }}>{nameOf(item)}</Text>
                  {subOf(item) ? <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11 }}>{subOf(item)}</Text> : null}
                </View>
                <Pressable onPress={() => busy === k.key ? null : void save(k.key, selectedIds.filter((id) => id !== String(item.resource_id || item.id || nameOf(item))))} disabled={busy === k.key} style={{ paddingHorizontal: 10, height: 28, borderRadius: 8, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center', opacity: busy === k.key ? 0.5 : 1 }}>
                  <Text style={{ color: t.red, fontSize: 12, fontWeight: '700' }}>移除</Text>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => {
              const unselected = pool.filter((r) => !selectedIds.includes(r.id));
              if (!unselected.length) { flash(`没有可新增的已授权${k.label}`); return; }
              const next = [...selectedIds, unselected[0].id];
              void save(k.key, next);
            }} disabled={busy === k.key} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, height: 32, borderRadius: 10, backgroundColor: t.bg3, marginTop: 6 }, busy === k.key && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}>
              <Icons.plus size={14} color={t.acTx} sw={2.2} />
              <Text style={{ color: t.acTx, fontSize: 12.5, fontWeight: '700' }}>{busy === k.key ? '处理中…' : `添加${k.label}`}</Text>
            </Pressable>
          </View>
        );
      })}
      {toast ? <View style={{ marginTop: 6, backgroundColor: t.bg3, borderRadius: 10, padding: 10 }}><Text style={{ color: t.tx, fontSize: 12 }}>{toast}</Text></View> : null}
    </View>
  );
}
