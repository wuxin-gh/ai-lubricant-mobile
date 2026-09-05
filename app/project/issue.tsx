/**
 * 需求 / Bug 详情 —— 对齐 Web ViewIssueDialog。
 * 展示与编辑：标题、状态流转、优先级、分配者（改派）、标签、正文 Markdown；
 * 确认/退回、启动任务、评论列表与发布。
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addIssueComment, ApiError, assignIssue, confirmIssue, listIssueComments, listIssues, listNodes, listTeamUsers, reassignIssue, updateIssue } from '@/api/client';
import { listRuntimeModelOptions } from '@/api/agent';
import { listParentKeys, type ParentKeyItem, type TaskProvider } from '@/api/task';
import type { IssueStatus, Model, Node, ProjectIssue, ProjectIssueComment, TeamUser } from '@/api/types';
import { LabeledInput, SearchableSelect, Segmented } from '@/components/admin-ui';
import { Card, Chip, EmptyView, GlassNav, LoadingView, PrimaryButton, Scrim, StatusBadge } from '@/components/ui';
import { MarkdownView } from '@/components/MarkdownView';
import { ModelSheet } from '@/components/sheets';
import { Icons, Spinner } from '@/components/Icons';
import { modelLabel } from '@/config';
import { issueNeedsConfirmation, issueStatusLabel, issueTypeLabel, statusOptionsForType } from '@/utils/issues';
import { formatDateTime } from '@/utils/format';
import { spacing, useTheme, type Theme } from '@/theme';

/** 数字优先级的分段选择（admin-ui 的 Segmented 限定 string，这里单独写一个）。 */
function PrioritySegmented({ value, onChange, disabled, t }: { value: number; onChange: (v: 1 | 2 | 3) => void; disabled?: boolean; t: Theme }) {
  const opts: { key: 1 | 2 | 3; label: string }[] = [{ key: 3, label: '高' }, { key: 2, label: '中' }, { key: 1, label: '低' }];
  return (
    <View style={{ flexDirection: 'row', gap: 7 }}>
      {opts.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} disabled={disabled} onPress={() => onChange(o.key)} style={({ pressed }) => [{ paddingHorizontal: 13, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.ac : t.bg3 }, pressed && { opacity: 0.7 }]}>
            <Text style={{ color: on ? t.acInk : t.tx2, fontSize: 12, fontWeight: on ? '700' : '600' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function IssueDetailScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId, issueId } = useLocalSearchParams<{ projectId: string; issueId: string }>();
  const [issue, setIssue] = useState<ProjectIssue | null>(null);
  const [comments, setComments] = useState<ProjectIssueComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  // 成员表（分配者显示与改派）。
  const [members, setMembers] = useState<TeamUser[]>([]);
  const [pickingAssignee, setPickingAssignee] = useState(false);
  const [pickingStatus, setPickingStatus] = useState(false);

  // 标签编辑。
  const [tagDraft, setTagDraft] = useState('');
  const [tagEditing, setTagEditing] = useState(false);

  // 标题 / 正文编辑。
  const [editingDoc, setEditingDoc] = useState<null | 'requirement' | 'design'>(null);
  const [docDraft, setDocDraft] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');

  // 启动任务弹窗：显式选择 provider、执行节点、模型和父 Key。
  const [assignOpen, setAssignOpen] = useState(false);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [parentKeys, setParentKeys] = useState<ParentKeyItem[]>([]);
  const [provider, setProvider] = useState<TaskProvider>('opencode');
  const [nodeId, setNodeId] = useState('');
  const [modelId, setModelId] = useState('');
  const [parentKeyId, setParentKeyId] = useState('');
  const [maxRequests, setMaxRequests] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [picking, setPicking] = useState<null | 'model' | 'node' | 'key'>(null);
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const rows = await listIssues(projectId);
      setIssue(rows.find((row) => row.id === issueId) || null);
      setComments(await listIssueComments(projectId, issueId!).catch(() => []));
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败，请重试');
    }
  }, [issueId, projectId]);

  useFocusEffect(useCallback(() => {
    let active = true;
    void load().finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]));

  // 成员表：详情页要显示分配者姓名；失败静默（列表页没有也不阻塞）。
  useEffect(() => {
    let active = true;
    void listTeamUsers()
      .then((rows) => { if (active) setMembers(rows); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // ── 字段编辑（统一走 updateIssue / reassignIssue）────────────────────────────

  const applyPatch = useCallback(async (patch: Partial<ProjectIssue>, success: string) => {
    if (!projectId || !issueId || working) return;
    setWorking(true);
    try {
      await updateIssue(projectId, issueId, patch);
      await load();
      setError('');
    } catch (e) {
      Alert.alert('保存失败', e instanceof ApiError ? e.message : '请稍后重试');
    } finally {
      setWorking(false);
      void success;
    }
  }, [issueId, load, projectId, working]);

  const onReassign = useCallback(async (userId: string) => {
    setPickingAssignee(false);
    if (!projectId || !issueId || working) return;
    setWorking(true);
    try {
      const next = await reassignIssue(projectId, issueId, userId);
      if (next) setIssue(next); else await load();
    } catch (e) {
      Alert.alert('改派失败', e instanceof ApiError ? e.message : '请稍后重试');
    } finally {
      setWorking(false);
    }
  }, [issueId, load, projectId, working]);

  const saveTags = useCallback(() => {
    const tags = tagDraft.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    setTagEditing(false);
    if (!issue) return;
    const current = issue.tags ?? [];
    if (tags.length === current.length && tags.every((v, i) => v === current[i])) return;
    void applyPatch({ tags }, '');
  }, [applyPatch, issue, tagDraft]);

  const saveDoc = useCallback(() => {
    setEditingDoc(null);
    if (!editingDoc) return;
    void applyPatch(
      editingDoc === 'design' ? { design_document: docDraft } : { requirement_document: docDraft },
      '',
    );
  }, [applyPatch, docDraft, editingDoc]);

  const sendComment = useCallback(async () => {
    const text = commentDraft.trim();
    if (!text || !projectId || !issueId || commentSending) return;
    setCommentSending(true);
    try {
      await addIssueComment(projectId, issueId, text);
      setCommentDraft('');
      setComments(await listIssueComments(projectId, issueId).catch(() => comments));
    } catch (e) {
      Alert.alert('评论失败', e instanceof ApiError ? e.message : '请稍后重试');
    } finally {
      setCommentSending(false);
    }
  }, [commentDraft, commentSending, comments, issueId, projectId]);

  // ── 确认 / 启动任务 ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!assignOpen) return;
    (async () => {
      try {
        const [nds, keys] = await Promise.all([listNodes(), listParentKeys()]);
        const usableNodes = nds.filter((node) => node.connected && !node.is_passive && node.node_role !== 'management' && node.node_role !== 'passive_management' && (node.active_sessions ?? 0) === 0);
        const usableKeys = keys.filter((key) => !key.disabled);
        setNodes(usableNodes);
        setParentKeys(usableKeys);
        if (!nodeId) setNodeId(usableNodes[0]?.node_id || '');
        if (!parentKeyId && usableKeys[0]) setParentKeyId(String(usableKeys[0].id));
      } catch {
        /* 容错：预取失败不阻塞弹窗，用户可看到空列表 */
      }
    })();
  }, [assignOpen, nodeId, modelId, parentKeyId]);

  useEffect(() => {
    if (!assignOpen || !parentKeyId) {
      setModels([]);
      setModelId('');
      return;
    }
    let active = true;
    setModels([]);
    setModelId('');
    void listRuntimeModelOptions(Number(parentKeyId))
      .then((options) => {
        if (!active) return;
        const rows: Model[] = options.map((item) => ({ id: item.value, model: item.value, remark: item.label }));
        setModels(rows);
        setModelId(rows[0]?.id || '');
      })
      .catch(() => { if (active) setModels([]); });
    return () => { active = false; };
  }, [assignOpen, parentKeyId]);

  const confirm = useCallback(async (approve: boolean) => {
    if (!projectId || !issueId || working) return;
    setWorking(true);
    try {
      const result = await confirmIssue(projectId, issueId, approve);
      if (result?.issue) setIssue(result.issue);
      else await load();
      Alert.alert(approve ? '已确认' : '已退回', approve ? '内容已确认，后续任务可以继续。' : '已退回给 agent 修改。');
    } catch (e) {
      Alert.alert('操作失败', e instanceof ApiError ? e.message : '请稍后重试');
    } finally {
      setWorking(false);
    }
  }, [issueId, load, projectId, working]);

  const doAssign = useCallback(async () => {
    if (!projectId || !issueId) return;
    if (!nodeId || !modelId || !parentKeyId) { Alert.alert('请选择执行节点、模型和父 API Key'); return; }
    if (provider === 'codex') {
      Alert.alert('暂不支持', 'Issue 自动生成的首条内容当前无法在提交前稳定取得，暂不能使用 Codex 启动。');
      return;
    }
    setAssigning(true);
    try {
      const result = await assignIssue(projectId, issueId, {
        cli_name: provider,
        model_id: modelId,
        node_id: nodeId,
        parent_api_key_id: Number(parentKeyId),
        ...((maxRequests || maxTokens) ? {
          usage_limit: {
            ...(maxRequests ? { max_requests: Number(maxRequests) } : {}),
            ...(maxTokens ? { max_total_tokens: Number(maxTokens) } : {}),
          },
        } : {}),
      });
      setAssignOpen(false);
      const taskId = result?.task?.id;
      Alert.alert('任务已启动', '可立即进入任务工作区查看进度。', [
        { text: '留在当前' },
        taskId
          ? { text: '查看任务', onPress: () => router.push(`/task/${taskId}`) }
          : { text: '去任务列表', onPress: () => router.push('/(tabs)/tasks') },
      ]);
      if (result?.issue) setIssue(result.issue); else await load();
    } catch (e) {
      Alert.alert('启动失败', e instanceof ApiError ? e.message : '请稍后重试');
    } finally {
      setAssigning(false);
    }
  }, [projectId, issueId, nodeId, modelId, parentKeyId, provider, maxRequests, maxTokens, load, router]);

  if (loading) return <LoadingView label="加载 Issue…" />;
  if (!issue) return <View style={{ flex: 1, backgroundColor: t.bg }}><GlassNav title="Issue" onBack={() => router.back()} /><EmptyView icon="alert" title="Issue 不存在" subtitle={error || '可能已被删除'} /></View>;

  const isBug = issue.type === 'bug';
  const canAssign = issue.status === 'unassigned';
  const selectedModel = models.find((m) => m.id === modelId);
  const selectedNode = nodes.find((n) => n.node_id === nodeId);
  const selectedKey = parentKeys.find((key) => String(key.id) === parentKeyId);
  const assignee = members.find((m) => m.id === issue.assignee_id);
  const statusOptions = statusOptionsForType(issue.type);
  const tags = issue.tags ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 70, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 96, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.tx3} />}
      >
        {/* 标题 + 状态徽标；点标题进入编辑 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            onPress={() => {
              const next = (issue.title || '').trim();
              setEditingTitle(next);
              setTitleEditing(true);
            }}
            style={{ flex: 1 }}
          >
            <Text style={{ fontSize: 22, fontWeight: '800', color: t.tx }}>{issue.title || '未命名'}</Text>
            <Text style={{ color: t.tx3, fontSize: 11, marginTop: 3 }}>点击编辑标题</Text>
          </Pressable>
          <Pressable onPress={() => setPickingStatus(true)}>
            <StatusBadge status={issue.status} />
          </Pressable>
        </View>

        {/* 属性行：类型 / 优先级 / 分配者 / 时间 */}
        <Card style={{ padding: 14, gap: 9 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: t.tx3, fontSize: 12, fontWeight: '700', width: 64 }}>类型</Text>
            <Chip color={isBug ? t.red : t.acTx} bg={isBug ? t.redGhost : t.acGhost}>{issueTypeLabel(issue.type)}</Chip>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: t.tx3, fontSize: 12, fontWeight: '700', width: 64 }}>优先级</Text>
            <PrioritySegmented
              value={issue.priority ?? 2}
              onChange={(v) => { if (v !== issue.priority) void applyPatch({ priority: v }, ''); }}
              disabled={working}
              t={t}
            />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: t.tx3, fontSize: 12, fontWeight: '700', width: 64 }}>分配者</Text>
            <Pressable onPress={() => setPickingAssignee(true)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 32, borderRadius: 9, backgroundColor: t.bg3 }, pressed && { opacity: 0.6 }]}>
              <Icons.user size={13} color={assignee ? t.acTx : t.tx3} sw={1.9} />
              <Text style={{ color: assignee ? t.tx : t.tx3, fontSize: 12.5, fontWeight: '600' }}>
                {assignee ? (assignee.name || assignee.username || assignee.id.slice(0, 8)) : issue.assignee_id ? `成员 ${issue.assignee_id.slice(0, 8)}` : '未分配'}
              </Text>
              <Icons.chevron size={12} color={t.tx3} sw={2} />
            </Pressable>
          </View>
          {issue.created_at ? <Text style={{ color: t.tx3, fontSize: 11 }}>创建于 {formatDateTime(issue.created_at)}</Text> : null}
        </Card>

        {/* 标签 */}
        <Card style={{ padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Text style={{ color: t.tx3, fontSize: 12, fontWeight: '700' }}>标签</Text>
            <Pressable onPress={() => { setTagDraft((issue.tags ?? []).join(', ')); setTagEditing((v) => !v); }} hitSlop={8} style={{ marginLeft: 'auto' }}>
              <Text style={{ color: t.acTx, fontSize: 12, fontWeight: '700' }}>{tagEditing ? '收起' : '编辑'}</Text>
            </Pressable>
          </View>
          {tagEditing ? (
            <View style={{ gap: 8 }}>
              <TextInput
                value={tagDraft}
                onChangeText={setTagDraft}
                placeholder="多个标签用逗号分隔"
                placeholderTextColor={t.tx3}
                autoCapitalize="none"
                onSubmitEditing={saveTags}
                style={{ minHeight: 40, borderRadius: 10, backgroundColor: t.bg3, paddingHorizontal: 11, color: t.tx, fontSize: 13 }}
              />
              <Pressable onPress={saveTags} style={{ alignSelf: 'flex-start', paddingHorizontal: 13, height: 32, borderRadius: 9, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: t.acInk, fontSize: 12, fontWeight: '700' }}>保存</Text>
              </Pressable>
            </View>
          ) : tags.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {tags.map((tag) => (
                <View key={tag} style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: t.acGhost }}>
                  <Text style={{ color: t.acTx, fontSize: 11.5, fontWeight: '600' }}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ color: t.tx3, fontSize: 12 }}>暂无标签</Text>
          )}
        </Card>

        {/* 正文卡片（Markdown + 编辑） */}
        <DocCard title={isBug ? '问题描述 / 复现方式' : '需求描述'} text={issue.requirement_document} onEdit={() => { setEditingDoc('requirement'); setDocDraft(issue.requirement_document || ''); }} />
        {issue.design_document ? <DocCard title="设计文档" text={issue.design_document} onEdit={() => { setEditingDoc('design'); setDocDraft(issue.design_document || ''); }} /> : null}
        {issue.bug_reason ? <DocCard title="Bug 根因" text={issue.bug_reason} readOnly /> : null}
        {issue.resolution_note ? <DocCard title="完成说明" text={issue.resolution_note} readOnly /> : null}
        {issue.pending_items?.length ? (
          <Card style={{ padding: 15, gap: 8 }}>
            <Text style={{ color: t.tx3, fontSize: 12, fontWeight: '700' }}>待确认项</Text>
            {issue.pending_items.map((item, index) => <Text key={item.id || index} style={{ color: t.tx, fontSize: 14 }}>• {item.content || '未命名待确认项'} {item.status === 'resolved' ? '（已解决）' : '（待确认）'}</Text>)}
          </Card>
        ) : null}

        {/* 评论 */}
        <Card style={{ padding: 14, gap: 10 }}>
          <Text style={{ color: t.tx3, fontSize: 12, fontWeight: '700' }}>评论（{comments.length}）</Text>
          {comments.map((c) => (
            <View key={c.id} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line, paddingTop: 9 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ color: t.tx, fontSize: 12.5, fontWeight: '600' }}>
                  {members.find((m) => m.id === c.user_id)?.name || (c.user_id ? `成员 ${String(c.user_id).slice(0, 8)}` : '用户')}
                </Text>
                {c.created_at ? <Text style={{ color: t.tx3, fontSize: 10.5 }}>{formatDateTime(c.created_at)}</Text> : null}
              </View>
              <Text style={{ color: t.tx2, fontSize: 13.5, lineHeight: 20, marginTop: 4 }}>{c.comment}</Text>
            </View>
          ))}
          {!comments.length ? <Text style={{ color: t.tx3, fontSize: 12 }}>还没有评论</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <TextInput
              value={commentDraft}
              onChangeText={setCommentDraft}
              placeholder="发表评论…"
              placeholderTextColor={t.tx3}
              multiline
              style={{ flex: 1, minHeight: 40, maxHeight: 100, borderRadius: 12, backgroundColor: t.bg3, paddingHorizontal: 11, paddingVertical: 9, color: t.tx, fontSize: 13.5 }}
              onSubmitEditing={sendComment}
            />
            <Pressable onPress={sendComment} disabled={commentSending || !commentDraft.trim()} style={({ pressed }) => [{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }, (commentSending || !commentDraft.trim()) && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}>
              {commentSending ? <Spinner size={16} color={t.acInk} sw={2.2} /> : <Icons.send size={17} color={t.acInk} sw={2.2} />}
            </Pressable>
          </View>
        </Card>

        {issueNeedsConfirmation(issue) ? <View style={{ flexDirection: 'row', gap: 10 }}><PrimaryButton block label={working ? '处理中…' : '确认通过'} disabled={working} onPress={() => void confirm(true)} style={{ flex: 1 }} /><PrimaryButton block label="退回修改" disabled={working} onPress={() => void confirm(false)} style={{ flex: 1, backgroundColor: t.bg3 }} /></View> : null}
      </ScrollView>

      {canAssign ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.pad, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: t.bg, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
          <PrimaryButton block label="启动任务" icon="cube" onPress={() => setAssignOpen(true)} />
        </View>
      ) : null}
      <GlassNav title={isBug ? 'Bug 详情' : '需求详情'} onBack={() => router.back()} />

      {/* ── 选择器与弹窗 ─────────────────────────────────────────────────────── */}

      <SearchableSelect
        visible={pickingStatus}
        title="切换状态"
        options={statusOptions.map((o) => ({ value: o.value, label: o.label }))}
        selected={issue.status ? [issue.status] : []}
        onChange={(values) => { setPickingStatus(false); if (values[0] && values[0] !== issue.status) void applyPatch({ status: values[0] as IssueStatus }, ''); }}
        onClose={() => setPickingStatus(false)}
      />

      <Modal visible={titleEditing} transparent animationType="slide" onRequestClose={() => setTitleEditing(false)} statusBarTranslucent>
        <Scrim onPress={() => setTitleEditing(false)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line2, paddingBottom: insets.bottom + 16, ...t.shLift }}>
          <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: t.line2, alignSelf: 'center', marginTop: 10, marginBottom: 4 }} />
          <Text style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, fontSize: 16, fontWeight: '700', color: t.tx }}>编辑标题</Text>
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            <TextInput
              value={editingTitle}
              onChangeText={setEditingTitle}
              autoFocus
              placeholder="标题"
              placeholderTextColor={t.tx3}
              style={{ minHeight: 48, borderRadius: 14, backgroundColor: t.bg3, paddingHorizontal: 13, color: t.tx, fontSize: 15 }}
            />
            <Pressable
              onPress={() => {
                const v = editingTitle.trim();
                setTitleEditing(false);
                if (v && v !== issue.title) void applyPatch({ title: v }, '');
              }}
              disabled={working}
              style={({ pressed }) => [{ height: 48, borderRadius: 15, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }, working && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}
            >
              <Text style={{ color: t.acInk, fontSize: 15, fontWeight: '700' }}>{working ? '保存中…' : '保存'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <SearchableSelect
        visible={pickingAssignee}
        title="改派给"
        options={members.map((m) => ({ value: m.id, label: m.name || m.username || m.id.slice(0, 8), sub: m.role === 'admin' ? '管理员' : undefined }))}
        selected={issue.assignee_id ? [issue.assignee_id] : []}
        onChange={(values) => { if (values[0]) void onReassign(values[0]); else setPickingAssignee(false); }}
        onClose={() => setPickingAssignee(false)}
        emptyText="暂无团队成员"
      />

      <Modal visible={!!editingDoc} transparent animationType="slide" onRequestClose={saveDoc} statusBarTranslucent>
        <Scrim onPress={saveDoc} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line2, paddingBottom: insets.bottom + 16, ...t.shLift }}>
          <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: t.line2, alignSelf: 'center', marginTop: 10, marginBottom: 4 }} />
          <Text style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, fontSize: 16, fontWeight: '700', color: t.tx }}>{editingDoc === 'design' ? '编辑设计文档' : isBug ? '编辑问题描述' : '编辑需求描述'}</Text>
          <View style={{ paddingHorizontal: 16, gap: 10, maxHeight: 420 }}>
            <TextInput
              value={docDraft}
              onChangeText={setDocDraft}
              multiline
              textAlignVertical="top"
              placeholder="支持 Markdown"
              placeholderTextColor={t.tx3}
              style={{ minHeight: 240, borderRadius: 14, backgroundColor: t.bg3, paddingHorizontal: 13, paddingVertical: 11, color: t.tx, fontSize: 14, lineHeight: 22 }}
            />
            <Pressable onPress={saveDoc} disabled={working} style={({ pressed }) => [{ height: 48, borderRadius: 15, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }, working && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}>
              <Text style={{ color: t.acInk, fontSize: 15, fontWeight: '700' }}>{working ? '保存中…' : '保存'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 启动任务弹窗：显式选择 provider、执行节点、模型和父 Key。 */}
      <Modal visible={assignOpen} transparent animationType="slide" onRequestClose={() => setAssignOpen(false)} statusBarTranslucent>
        <Scrim onPress={() => setAssignOpen(false)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line2, paddingBottom: insets.bottom + 16, ...t.shLift }}>
          <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: t.line2, alignSelf: 'center', marginTop: 10, marginBottom: 4 }} />
          <Text style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, fontSize: 16, fontWeight: '700', color: t.tx }}>启动任务</Text>
          <ScrollView style={{ maxHeight: 500 }} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }} keyboardShouldPersistTaps="handled">
            <Segmented label="执行工具" value={provider} options={[{ value: 'opencode', label: 'OpenCode' }, { value: 'claude', label: 'Claude Code' }]} onChange={setProvider} hint="Codex Issue 任务需预先确定首条内容，当前入口暂不提供。" />
            <AssignRow icon="server" label="执行节点" value={selectedNode ? (selectedNode.node_name || selectedNode.node_id || '已选择') : (nodes.length ? '选择节点' : '无可用节点')} t={t} onPress={() => setPicking('node')} />
            <AssignRow icon="cube" label="模型" value={selectedModel ? modelLabel(selectedModel) : '选择模型'} t={t} onPress={() => setPicking('model')} divider />
            <AssignRow icon="lock" label="父 API Key" value={selectedKey?.name || selectedKey?.key_masked || '选择可用父 Key'} t={t} onPress={() => setPicking('key')} divider />
            <View style={{ flexDirection: 'row', gap: 8 }}><View style={{ flex: 1 }}><LabeledInput label="最大请求数" value={maxRequests} onChangeText={setMaxRequests} keyboardType="numeric" placeholder="不限制" /></View><View style={{ flex: 1 }}><LabeledInput label="最大 Token" value={maxTokens} onChangeText={setMaxTokens} keyboardType="numeric" placeholder="不限制" /></View></View>
            <View style={{ height: 4 }} />
            <Pressable onPress={doAssign} disabled={assigning || !nodeId || !modelId || !parentKeyId || provider === 'codex'} style={({ pressed }) => [{ height: 52, borderRadius: 16, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, (assigning || !nodeId || !modelId || !parentKeyId || provider === 'codex') && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.98 }] }]}>
              {assigning ? <Spinner size={18} color={t.acInk} sw={2.4} /> : <Icons.arrowRight size={18} color={t.acInk} sw={2.4} />}
              <Text style={{ color: t.acInk, fontSize: 16, fontWeight: '800' }}>{assigning ? '启动中…' : '启动任务'}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* 模型选择 */}
      <ModelSheet visible={picking === 'model'} models={models} selectedId={modelId} onPick={(id) => { setModelId(id); setPicking(null); }} onClose={() => setPicking(null)} />

      <SearchableSelect
        visible={picking === 'key'}
        title="选择父 API Key"
        options={parentKeys.map((key) => ({ value: String(key.id), label: key.name || key.key_masked, sub: `${key.source} · ${key.key_masked}` }))}
        selected={parentKeyId ? [parentKeyId] : []}
        onChange={(values) => { setParentKeyId(values[0] || ''); setPicking(null); }}
        onClose={() => setPicking(null)}
      />

      {/* 节点选择：简单底部列表 */}
      <Modal visible={picking === 'node'} transparent animationType="slide" onRequestClose={() => setPicking(null)} statusBarTranslucent>
        <Scrim onPress={() => setPicking(null)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '70%', backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line2, paddingBottom: insets.bottom + 16, ...t.shLift }}>
          <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: t.line2, alignSelf: 'center', marginTop: 10, marginBottom: 4 }} />
          <Text style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 10, fontSize: 16, fontWeight: '700', color: t.tx }}>选择执行节点</Text>
          <ScrollView style={{ paddingHorizontal: 12 }}>
            {nodes.map((n) => {
              const on = n.node_id === nodeId;
              const I = n.connected ? Icons.server : Icons.dot;
              return (
                <Pressable key={n.node_id || ''} onPress={() => { setNodeId(n.node_id || ''); setPicking(null); }} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 13, backgroundColor: on ? t.acGhost : 'transparent' }, pressed && !on && { backgroundColor: t.bg3 }]}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.bg4, alignItems: 'center', justifyContent: 'center' }}><I size={18} color={n.connected ? t.acTx : t.tx3} sw={1.9} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: t.tx }}>{n.node_name || n.node_id || '未命名节点'}</Text>
                    <Text style={{ fontSize: 11.5, color: n.connected ? t.acTx : t.tx3, marginTop: 2 }}>{n.connected ? (n.is_passive ? '被动分组节点' : '在线') : '离线'}</Text>
                  </View>
                  {on ? <Icons.check size={18} color={t.acTx} sw={2.4} /> : null}
                </Pressable>
              );
            })}
            {nodes.length === 0 ? <Text style={{ textAlign: 'center', color: t.tx3, paddingVertical: 24 }}>没有可用节点</Text> : null}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

/** 正文卡片：Markdown 渲染 + 可选编辑入口。 */
function DocCard({ title, text, onEdit, readOnly }: { title: string; text?: string; onEdit?: () => void; readOnly?: boolean }) {
  const t = useTheme();
  return (
    <Card style={{ padding: 15, gap: 7 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: t.tx3, fontSize: 12, fontWeight: '700', flex: 1 }}>{title}</Text>
        {onEdit ? (
          <Pressable onPress={onEdit} hitSlop={8}>
            <Text style={{ color: t.acTx, fontSize: 12, fontWeight: '700' }}>编辑</Text>
          </Pressable>
        ) : null}
      </View>
      {text?.trim()
        ? <MarkdownView text={text} />
        : <Text style={{ color: t.tx3, fontSize: 13.5 }}>{readOnly ? '暂无内容' : '暂无内容，点击右上角编辑'}</Text>}
    </Card>
  );
}

function AssignRow({ icon, label, value, t, onPress, divider }: { icon: string; label: string; value: string; t: Theme; onPress: () => void; divider?: boolean }) {
  const I = Icons[icon] ?? Icons.dot;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 14, borderRadius: 13, borderTopWidth: divider ? StyleSheet.hairlineWidth : 0, borderColor: t.line }, pressed && { backgroundColor: t.bg3 }]}>
      <I size={18} color={t.tx2} sw={1.8} />
      <Text style={{ fontSize: 14.5, fontWeight: '600', color: t.tx }}>{label}</Text>
      <Text numberOfLines={1} style={{ marginLeft: 'auto', color: t.tx3, fontSize: 13 }}>{value}</Text>
      <Icons.chevron size={16} color={t.tx3} sw={1.9} />
    </Pressable>
  );
}
