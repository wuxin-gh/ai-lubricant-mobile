/**
 * 新建需求 / Bug —— 对齐 Web create-issue 弹窗。
 * 类型（需求 / Bug）+ 优先级为分段选择，分配者为必选（后端 assignee_id 强校验），
 * 标签为逗号分隔输入；提交后回到列表页（列表在 useFocusEffect 里自行重新拉取）。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, createIssue, listTeamUsers } from '@/api/client';
import type { IssuePriority, IssueType, TeamUser } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { SearchableSelect } from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { IconButton, PrimaryButton } from '@/components/ui';
import { spacing, useTheme, type Theme } from '@/theme';

function Segmented<T extends string | number>({ options, value, onChange, disabled, t }: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  t: Theme;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={String(o.key)}
            disabled={disabled}
            onPress={() => onChange(o.key)}
            style={({ pressed }) => [
              { flex: 1, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.ac : t.bg2, borderWidth: 1, borderColor: on ? t.ac : t.line2 },
              pressed && !disabled && { opacity: 0.7 },
              disabled && { opacity: 0.5 },
            ]}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: on ? t.acInk : t.tx2 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function NewIssueScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();

  const [type, setType] = useState<IssueType>('requirement');
  const [priority, setPriority] = useState<IssuePriority>(2);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [members, setMembers] = useState<TeamUser[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [pickingAssignee, setPickingAssignee] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 分配者必选（后端 assignee_required）；拉团队成员，默认选当前用户。
  useEffect(() => {
    let active = true;
    void listTeamUsers()
      .then((rows) => {
        if (!active) return;
        setMembers(rows);
        setAssigneeId((prev) => prev || String(user?.id || '') || rows[0]?.id || '');
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [user?.id]);

  const isBug = type === 'bug';
  const assignee = members.find((m) => m.id === assigneeId);

  const submit = useCallback(async () => {
    setError('');
    if (!projectId) { setError('缺少项目信息'); return; }
    if (!title.trim()) { setError('请填写标题'); return; }
    if (!body.trim()) { setError(isBug ? '请描述问题现象和复现方式' : '请填写需求描述'); return; }
    if (!assigneeId) { setError('请选择分配者'); return; }
    setSubmitting(true);
    try {
      await createIssue(projectId, {
        type,
        title: title.trim(),
        requirement_document: body.trim(),
        priority,
        assignee_id: assigneeId,
        tags: tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '创建失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }, [assigneeId, body, isBug, priority, projectId, router, tags, title, type]);

  const inputStyle = {
    backgroundColor: t.bg2,
    borderWidth: 1,
    borderColor: t.line2,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    color: t.tx,
    fontSize: 15.5,
    ...t.shCard,
  } as const;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior="padding">
      <View style={{ paddingTop: insets.top + 6 }}>
        <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>
          <View style={{ width: 38 }} />
          <Text style={{ position: 'absolute', left: 56, right: 56, textAlign: 'center', fontSize: 16.5, fontWeight: '700', color: t.tx }}>新建需求 / Bug</Text>
          <View style={{ marginLeft: 'auto' }}>
            <IconButton icon="plus" onPress={() => router.back()} iconSize={24} sw={2} style={{ transform: [{ rotate: '45deg' }] }} />
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.pad, paddingTop: 8, paddingBottom: insets.bottom + 110 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 13, color: t.tx2, fontWeight: '600', marginBottom: 8 }}>类型</Text>
        <Segmented
          t={t}
          disabled={submitting}
          value={type}
          onChange={setType}
          options={[{ key: 'requirement' as IssueType, label: '需求' }, { key: 'bug' as IssueType, label: 'Bug' }]}
        />

        <Text style={{ fontSize: 13, color: t.tx2, fontWeight: '600', marginTop: 18, marginBottom: 8 }}>优先级</Text>
        <Segmented
          t={t}
          disabled={submitting}
          value={priority}
          onChange={setPriority}
          options={[{ key: 3 as IssuePriority, label: '高' }, { key: 2 as IssuePriority, label: '中' }, { key: 1 as IssuePriority, label: '低' }]}
        />

        <Text style={{ fontSize: 13, color: t.tx2, fontWeight: '600', marginTop: 18, marginBottom: 8 }}>分配者</Text>
        <Pressable onPress={() => setPickingAssignee(true)} disabled={submitting} style={({ pressed }) => [{ height: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: assignee ? t.ac : t.line2, backgroundColor: t.bg2 }, pressed && { opacity: 0.7 }]}>
          <Icons.user size={17} color={assignee ? t.acTx : t.tx3} sw={1.9} />
          <Text numberOfLines={1} style={{ flex: 1, color: assignee ? t.tx : t.tx3, fontSize: 15 }}>
            {assignee ? (assignee.name || assignee.username || assignee.id.slice(0, 8)) : '选择团队成员'}
          </Text>
          <Icons.chevron size={16} color={t.tx3} sw={1.9} />
        </Pressable>

        <Text style={{ fontSize: 13, color: t.tx2, fontWeight: '600', marginTop: 18, marginBottom: 8 }}>标签</Text>
        <TextInput
          value={tags}
          onChangeText={setTags}
          placeholder="多个标签用逗号分隔（可选）"
          placeholderTextColor={t.tx3}
          editable={!submitting}
          autoCapitalize="none"
          style={inputStyle}
        />

        <Text style={{ fontSize: 13, color: t.tx2, fontWeight: '600', marginTop: 18, marginBottom: 8 }}>标题</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={isBug ? '简述问题' : '简述需求'}
          placeholderTextColor={t.tx3}
          editable={!submitting}
          style={inputStyle}
        />

        <Text style={{ fontSize: 13, color: t.tx2, fontWeight: '600', marginTop: 18, marginBottom: 8 }}>
          {isBug ? '问题描述 / 复现方式' : '需求描述'}
        </Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={isBug ? '出现了什么问题？如何复现？' : '希望实现什么？验收标准是什么？'}
          placeholderTextColor={t.tx3}
          editable={!submitting}
          multiline
          textAlignVertical="top"
          style={[inputStyle, { minHeight: 160 }]}
        />

        {error ? <Text style={{ color: t.red, fontSize: 13, marginTop: 16 }}>{error}</Text> : null}
      </ScrollView>

      <View style={{ paddingHorizontal: spacing.pad, paddingTop: 12, paddingBottom: insets.bottom + 14, borderTopWidth: 1, borderColor: t.line, backgroundColor: t.bg }}>
        {submitting ? (
          <View style={{ height: 50, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.ac} /></View>
        ) : (
          <PrimaryButton
            block
            icon="check"
            label="创建"
            disabled={!title.trim() || !body.trim() || !assigneeId}
            onPress={submit}
          />
        )}
      </View>

      <SearchableSelect
        visible={pickingAssignee}
        title="选择分配者"
        options={members.map((m) => ({ value: m.id, label: m.name || m.username || m.id.slice(0, 8), sub: m.role === 'admin' ? '管理员' : undefined }))}
        selected={assigneeId ? [assigneeId] : []}
        onChange={(values) => { if (values[0]) setAssigneeId(values[0]); }}
        onClose={() => setPickingAssignee(false)}
        emptyText="暂无团队成员"
      />
    </KeyboardAvoidingView>
  );
}
