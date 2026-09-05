/**
 * 项目需求/Bug 列表 —— 对齐 Web issues-tab。
 * 支持类型、优先级、状态与「分配给我」筛选；终态沉底、优先级降序；
 * 行内展示分配者与标签，点击进入详情。
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, listIssues, listTeamUsers } from '@/api/client';
import type { IssueType, ProjectIssue, TeamUser } from '@/api/types';
import { SearchableSelect } from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { Card, Chip, EmptyView, GlassNav, LoadingView, PrimaryButton } from '@/components/ui';
import { ISSUE_STATUS_LABELS, issueIsDone, issueNeedsConfirmation, issuePriorityLabel, issueStatusLabel, issueTypeLabel } from '@/utils/issues';
import { spacing, useTheme, type Theme } from '@/theme';

type Filter = 'all' | IssueType;
const TYPE_FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'requirement', label: '需求' },
  { key: 'bug', label: 'Bug' },
];
const PRIORITIES = [
  { key: 0, label: '全部优先级' },
  { key: 3, label: '高' },
  { key: 2, label: '中' },
  { key: 1, label: '低' },
];

function IssueRow({ issue, assignee, onPress, divider, t }: { issue: ProjectIssue; assignee?: TeamUser; onPress: () => void; divider: boolean; t: Theme }) {
  const isBug = issue.type === 'bug';
  const done = issueIsDone(issue);
  const pending = issueNeedsConfirmation(issue);
  const statusColor = pending ? t.amber : done ? t.tx3 : t.acTx;
  const statusBg = pending ? t.amberGhost : done ? t.bg4 : t.acGhost;
  const tags = issue.tags ?? [];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 13, borderTopWidth: divider ? StyleSheet.hairlineWidth : 0, borderColor: t.line },
        pressed && { opacity: 0.55 },
      ]}
    >
      <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: isBug ? t.redGhost : t.acGhost, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
        <Icons.alert size={17} color={isBug ? t.red : t.acTx} sw={1.9} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ fontSize: 14.5, lineHeight: 20, fontWeight: '600', color: done ? t.tx2 : t.tx }}>
          {issue.title || '未命名'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          <Chip color={isBug ? t.red : t.acTx} bg={isBug ? t.redGhost : t.acGhost}>{issueTypeLabel(issue.type)}</Chip>
          <Chip color={statusColor} bg={statusBg}>{issueStatusLabel(issue.status)}</Chip>
          <Chip color={issue.priority === 3 ? t.red : issue.priority === 1 ? t.tx3 : t.amber} bg={t.bg3}>P{issue.priority ?? 2} · {issuePriorityLabel(issue.priority)}</Chip>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icons.user size={11} color={t.tx3} sw={1.8} />
            <Text style={{ color: t.tx3, fontSize: 11.5 }}>
              {assignee ? (assignee.name || assignee.username || assignee.id.slice(0, 8)) : issue.assignee_id ? `成员 ${issue.assignee_id.slice(0, 8)}` : '未分配'}
            </Text>
          </View>
          {tags.slice(0, 3).map((tag) => <Chip key={tag} color={t.tx2} bg={t.bg3}>{tag}</Chip>)}
          {tags.length > 3 ? <Text style={{ color: t.tx3, fontSize: 10.5 }}>+{tags.length - 3}</Text> : null}
        </View>
      </View>
      <Icons.chevron size={16} color={t.tx3} sw={1.9} style={{ marginTop: 8 }} />
    </Pressable>
  );
}

export default function ProjectIssuesScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [issues, setIssues] = useState<ProjectIssue[]>([]);
  const [members, setMembers] = useState<TeamUser[]>([]);
  const [typeFilter, setTypeFilter] = useState<Filter>('all');
  const [priority, setPriority] = useState(0);
  const [status, setStatus] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [rows, users] = await Promise.all([
        listIssues(id, { status: status || undefined, priority: priority || undefined, assigned_to_me: onlyMine }),
        listTeamUsers().catch(() => []),
      ]);
      setIssues(rows);
      setMembers(users);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败，请重试');
    }
  }, [id, onlyMine, priority, status]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void load().finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const shown = useMemo(() => {
    const rows = typeFilter === 'all' ? issues : issues.filter((i) => i.type === typeFilter);
    return [...rows].sort((a, b) => {
      const terminal = Number(issueIsDone(a)) - Number(issueIsDone(b));
      if (terminal) return terminal;
      const p = (b.priority ?? 2) - (a.priority ?? 2);
      if (p) return p;
      return Number(b.created_at ?? 0) - Number(a.created_at ?? 0);
    });
  }, [issues, typeFilter]);

  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const statusLabel = status ? issueStatusLabel(status) : '全部状态';

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {loading ? (
        <LoadingView label="加载需求中…" />
      ) : (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 164, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 96 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.tx3} progressViewOffset={insets.top + 140} />}
        >
          {issues.length === 0 && error ? (
            <EmptyView icon="alert" title="加载失败" subtitle={`${error}\n下拉可重试`} />
          ) : shown.length === 0 ? (
            <EmptyView
              title={issues.length === 0 ? '没有符合筛选的需求或 Bug' : `没有${typeFilter === 'bug' ? ' Bug' : '需求'}`}
              subtitle={issues.length === 0 ? '调整筛选或创建第一条' : '换个筛选看看'}
            />
          ) : (
            <>
              {error ? <Text style={{ textAlign: 'center', color: t.tx3, fontSize: 12, marginBottom: 10 }}>刷新失败：{error}</Text> : null}
              <Card style={{ paddingHorizontal: 15, paddingVertical: 3 }}>
                {shown.map((issue, i) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    assignee={issue.assignee_id ? memberMap.get(issue.assignee_id) : undefined}
                    divider={i !== 0}
                    t={t}
                    onPress={() => router.push({ pathname: '/project/issue', params: { projectId: id!, issueId: issue.id! } })}
                  />
                ))}
              </Card>
            </>
          )}
        </ScrollView>
      )}

      <GlassNav title={name || '需求与 Bug'} onBack={() => router.back()}>
        <View style={{ paddingHorizontal: spacing.pad, paddingBottom: 10, gap: 8 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
            {TYPE_FILTERS.map((f) => {
              const on = f.key === typeFilter;
              return <Pressable key={f.key} onPress={() => setTypeFilter(f.key)} style={{ paddingHorizontal: 13, height: 30, borderRadius: 15, backgroundColor: on ? t.ac : t.bg3, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 12, fontWeight: '600', color: on ? t.acInk : t.tx2 }}>{f.label}</Text></Pressable>;
            })}
            <Pressable onPress={() => setStatusOpen(true)} style={{ paddingHorizontal: 13, height: 30, borderRadius: 15, backgroundColor: status ? t.acGhost : t.bg3, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 12, fontWeight: '600', color: status ? t.acTx : t.tx2 }}>{statusLabel}</Text></Pressable>
            <Pressable onPress={() => setOnlyMine((v) => !v)} style={{ paddingHorizontal: 13, height: 30, borderRadius: 15, backgroundColor: onlyMine ? t.acGhost : t.bg3, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 }}><Icons.user size={11} color={onlyMine ? t.acTx : t.tx2} sw={2} /><Text style={{ fontSize: 12, fontWeight: '600', color: onlyMine ? t.acTx : t.tx2 }}>分配给我</Text></Pressable>
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
            {PRIORITIES.map((p) => {
              const on = p.key === priority;
              return <Pressable key={p.key} onPress={() => setPriority(p.key)} style={{ paddingHorizontal: 12, height: 28, borderRadius: 14, backgroundColor: on ? t.acGhost : t.bg3, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 11.5, fontWeight: '600', color: on ? t.acTx : t.tx3 }}>{p.label}</Text></Pressable>;
            })}
          </ScrollView>
        </View>
      </GlassNav>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.pad, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: t.bg }}>
        <PrimaryButton block label="新建需求 / Bug" icon="plus" onPress={() => router.push({ pathname: '/project/new-issue', params: { projectId: id! } })} />
      </View>

      <SearchableSelect
        visible={statusOpen}
        title="按状态筛选"
        options={[{ value: '', label: '全部状态' }, ...Object.entries(ISSUE_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}
        selected={[status]}
        onChange={(values) => setStatus(values[0] ?? '')}
        onClose={() => setStatusOpen(false)}
      />
    </View>
  );
}
