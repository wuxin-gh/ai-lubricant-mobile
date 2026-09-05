/**
 * 成员与管理：复用 /api/v1/teams/* 接口（与管理端共用一套）。
 * 支持新增用户、编辑名称/停用、管理员开关、重置密码、删除，以及分组的增删/重命名/成员管理。
 * 创建/重置返回的一次性密码仅弹窗显示一次，不写入持久化存储。
 */
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import {
  bindAdminGroupNode,
  createAdminGroup,
  createAdminUser,
  deleteAdminGroup,
  deleteAdminUser,
  getAdminGroupApiKeys,
  getAdminGroupMcpServices,
  getAdminGroupNodePicker,
  getAdminGroupSkills,
  getAdminGroups,
  getAdminUsers,
  renameAdminGroup,
  resetAdminUserPassword,
  setAdminGroupApiKeys,
  setAdminGroupMcpServices,
  setAdminGroupSkills,
  setAdminGroupUsers,
  setAdminUserAdmin,
  unbindAdminGroupNode,
  updateAdminUser,
  type AdminUserRow,
  type GroupApiKeyRow,
  type GroupMcpRow,
  type GroupNodeRow,
  type GroupSkillRow,
  type TeamGroup,
} from '@/api/management';
import { AdminScreen, AdminSheet, FilterBar, LabeledInput, SectionCard, SwitchRow } from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';

export default function MembersScreen() {
  const t = useTheme();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [groups, setGroups] = useState<TeamGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // 新增用户
  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [addAdmin, setAddAdmin] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 编辑用户
  const [editTarget, setEditTarget] = useState<AdminUserRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editBlocked, setEditBlocked] = useState(false);

  // 一次性密码展示
  const [pwdResult, setPwdResult] = useState<{ email?: string | null; password?: string } | null>(null);

  // 分组编辑
  const [groupEdit, setGroupEdit] = useState<TeamGroup | null>(null); // null=新建
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);

  // 分组成员管理
  const [membersGroup, setMembersGroup] = useState<TeamGroup | null>(null);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [membersBusy, setMembersBusy] = useState(false);

  // 分组资源权限（与 Web 权限配置四个标签完全复用同一组接口）
  const [permissionGroup, setPermissionGroup] = useState<TeamGroup | null>(null);
  const [permissionTab, setPermissionTab] = useState<'api-keys' | 'mcp' | 'nodes' | 'skills'>('api-keys');
  const [permissionRows, setPermissionRows] = useState<Array<GroupApiKeyRow | GroupMcpRow | GroupNodeRow | GroupSkillRow>>([]);
  const [permissionSelected, setPermissionSelected] = useState<Set<string | number>>(new Set());
  const [permissionOriginal, setPermissionOriginal] = useState<Set<string | number>>(new Set());
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [permissionSaving, setPermissionSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [u, g] = await Promise.all([getAdminUsers(), getAdminGroups()]);
      setUsers(u); setGroups(g);
    } catch (e) {
      setError((e as Error)?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const reloadUsers = useCallback(async () => { setUsers(await getAdminUsers()); }, []);
  const reloadGroups = useCallback(async () => { setGroups(await getAdminGroups()); }, []);

  const admins = users.filter((u) => u.is_admin).length;

  const openAdd = () => { setEmail(''); setName(''); setAddAdmin(false); setAddOpen(true); };

  const submitAdd = useCallback(async () => {
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    try {
      const r = await createAdminUser({ email: email.trim(), name: name.trim() || undefined, is_admin: addAdmin });
      setAddOpen(false);
      if (r.password) setPwdResult({ email: r.user?.email || email.trim(), password: r.password });
      await reloadUsers();
    } catch (e) { Alert.alert('创建失败', (e as Error)?.message || '请稍后重试'); }
    finally { setSubmitting(false); }
  }, [addAdmin, email, name, reloadUsers, submitting]);

  const openEdit = (row: AdminUserRow) => {
    setEditTarget(row);
    setEditName(row.user.name || '');
    setEditBlocked(!!row.user.is_blocked);
  };

  const submitEdit = useCallback(async () => {
    if (!editTarget || !editName.trim()) return;
    setBusyId(editTarget.user.id);
    try {
      await updateAdminUser(editTarget.user.id, { name: editName.trim(), is_blocked: editBlocked });
      setEditTarget(null);
      await reloadUsers();
    } catch (e) { Alert.alert('更新失败', (e as Error)?.message || '请稍后重试'); }
    finally { setBusyId(null); }
  }, [editBlocked, editName, editTarget, reloadUsers]);

  const toggleAdmin = (row: AdminUserRow) => {
    const next = !row.is_admin;
    Alert.alert(next ? '设为管理员' : '取消管理员', `确定对“${row.user.name || row.user.email}”${next ? '授予' : '取消'}管理权限？`, [
      { text: '取消', style: 'cancel' },
      { text: '确定', onPress: async () => {
        setBusyId(row.user.id);
        try { await setAdminUserAdmin(row.user.id, next); await reloadUsers(); }
        catch (e) { Alert.alert('操作失败', (e as Error)?.message || '请稍后重试'); }
        finally { setBusyId(null); }
      } },
    ]);
  };

  const remove = (row: AdminUserRow) => {
    Alert.alert('删除用户', `确定永久删除“${row.user.name || row.user.email}”？此操作不可撤销。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        setBusyId(row.user.id);
        try { await deleteAdminUser(row.user.id); await reloadUsers(); }
        catch (e) { Alert.alert('删除失败', (e as Error)?.message || '请稍后重试'); }
        finally { setBusyId(null); }
      } },
    ]);
  };

  const resetPwd = (row: AdminUserRow) => {
    Alert.alert('重置密码', `将为“${row.user.email || row.user.name}”生成新密码，旧密码立即失效。`, [
      { text: '取消', style: 'cancel' },
      { text: '确认重置', onPress: async () => {
        setBusyId(row.user.id);
        try { const r = await resetAdminUserPassword(row.user.id); if (r.password) setPwdResult({ email: row.user.email, password: r.password }); }
        catch (e) { Alert.alert('重置失败', (e as Error)?.message || '请稍后重试'); }
        finally { setBusyId(null); }
      } },
    ]);
  };

  const copyPwd = async () => {
    if (!pwdResult?.password) return;
    await Clipboard.setStringAsync(pwdResult.password);
    Alert.alert('已复制', '密码已复制到剪贴板，请注意安全。');
  };

  // ── 分组 ──
  const openGroupCreate = () => { setGroupEdit(null); setGroupName(''); setGroupOpen(true); };
  const openGroupRename = (g: TeamGroup) => { setGroupEdit(g); setGroupName(g.name); setGroupOpen(true); };

  const submitGroup = useCallback(async () => {
    if (!groupName.trim() || groupBusy) return;
    setGroupBusy(true);
    try {
      if (groupEdit) { await renameAdminGroup(groupEdit.id, groupName.trim()); }
      else { await createAdminGroup(groupName.trim()); }
      setGroupOpen(false); await reloadGroups();
    } catch (e) { Alert.alert('保存失败', (e as Error)?.message || '请稍后重试'); }
    finally { setGroupBusy(false); }
  }, [groupBusy, groupEdit, groupName, reloadGroups]);

  const removeGroup = (g: TeamGroup) => {
    Alert.alert('删除分组', `确定删除分组“${g.name}”？组内用户不会被删除，仅解除归属。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try { await deleteAdminGroup(g.id); await reloadGroups(); }
        catch (e) { Alert.alert('删除失败', (e as Error)?.message || '请稍后重试'); }
      } },
    ]);
  };

  const openGroupMembers = (g: TeamGroup) => {
    setMembersGroup(g);
    setMemberIds(new Set((g.users ?? []).map((u) => u.id)));
  };

  const toggleMember = (id: string) => {
    setMemberIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const submitMembers = useCallback(async () => {
    if (!membersGroup || membersBusy) return;
    setMembersBusy(true);
    try { await setAdminGroupUsers(membersGroup.id, Array.from(memberIds)); setMembersGroup(null); await reloadGroups(); }
    catch (e) { Alert.alert('更新失败', (e as Error)?.message || '请稍后重试'); }
    finally { setMembersBusy(false); }
  }, [memberIds, membersBusy, membersGroup, reloadGroups]);

  const loadPermissions = useCallback(async (g: TeamGroup, tab: typeof permissionTab) => {
    setPermissionLoading(true);
    try {
      const rows = tab === 'api-keys' ? await getAdminGroupApiKeys(g.id)
        : tab === 'mcp' ? await getAdminGroupMcpServices(g.id)
          : tab === 'nodes' ? await getAdminGroupNodePicker(g.id)
            : await getAdminGroupSkills(g.id);
      const ids = new Set<string | number>(rows.filter((r) => r.bound).map(permissionId));
      setPermissionRows(rows); setPermissionSelected(ids); setPermissionOriginal(new Set(ids));
    } catch (e) { Alert.alert('权限加载失败', (e as Error)?.message || '请稍后重试'); }
    finally { setPermissionLoading(false); }
  }, []);

  const openPermissions = (g: TeamGroup) => {
    setPermissionGroup(g); setPermissionTab('api-keys'); void loadPermissions(g, 'api-keys');
  };
  const changePermissionTab = (tab: typeof permissionTab) => {
    setPermissionTab(tab); if (permissionGroup) void loadPermissions(permissionGroup, tab);
  };
  const togglePermission = (id: string | number) => setPermissionSelected((old) => { const n = new Set(old); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const savePermissions = useCallback(async () => {
    if (!permissionGroup || permissionSaving) return;
    setPermissionSaving(true);
    try {
      if (permissionTab === 'api-keys') await setAdminGroupApiKeys(permissionGroup.id, Array.from(permissionSelected).map(Number));
      else if (permissionTab === 'mcp') await setAdminGroupMcpServices(permissionGroup.id, Array.from(permissionSelected).map(Number));
      else if (permissionTab === 'skills') await setAdminGroupSkills(permissionGroup.id, Array.from(permissionSelected).map(String));
      else {
        const added = Array.from(permissionSelected).map(String).filter((id) => !permissionOriginal.has(id));
        const removed = Array.from(permissionOriginal).map(String).filter((id) => !permissionSelected.has(id));
        await Promise.all([...added.map((id) => bindAdminGroupNode(permissionGroup.id, id)), ...removed.map((id) => unbindAdminGroupNode(permissionGroup.id, id))]);
      }
      await loadPermissions(permissionGroup, permissionTab);
      Alert.alert('保存成功', '分组资源权限已更新');
    } catch (e) { Alert.alert('保存失败', (e as Error)?.message || '请稍后重试'); }
    finally { setPermissionSaving(false); }
  }, [loadPermissions, permissionGroup, permissionOriginal, permissionSaving, permissionSelected, permissionTab]);

  return (
    <>
      <AdminScreen active="members" loading={loading} error={error} onRetry={load}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, backgroundColor: t.bg2, borderRadius: 16, padding: 14, ...t.shCard }}>
            <Text style={{ fontSize: 11.5, color: t.tx3, fontWeight: '600' }}>成员总数</Text>
            <Text style={{ fontSize: 22, fontWeight: '800', color: t.tx, marginTop: 4 }}>{users.length}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: t.bg2, borderRadius: 16, padding: 14, ...t.shCard }}>
            <Text style={{ fontSize: 11.5, color: t.tx3, fontWeight: '600' }}>管理员</Text>
            <Text style={{ fontSize: 22, fontWeight: '800', color: t.acTx, marginTop: 4 }}>{admins}</Text>
          </View>
        </View>

        <Pressable onPress={openAdd} style={({ pressed }) => [{ height: 46, borderRadius: 15, backgroundColor: t.ac, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, pressed && { opacity: 0.75 }]}>
          <Icons.plus size={17} color={t.acInk} sw={2.2} /><Text style={{ color: t.acInk, fontSize: 14, fontWeight: '700' }}>新增用户</Text>
        </Pressable>

        <SectionCard title={`成员 (${users.length})`}>
          {users.map((row, i) => {
            const u = row.user;
            const blocked = !!u.is_blocked;
            const isBusy = busyId === u.id;
            return (
              <View key={u.id ?? i} style={{ paddingVertical: 11, borderTopWidth: i === 0 ? 0 : 0.5, borderColor: t.line }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}>
                    <Icons.user size={18} color={t.acTx} sw={1.9} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '700', color: blocked ? t.tx3 : t.tx, textDecorationLine: blocked ? 'line-through' : 'none' }}>{u.name || '未命名'}</Text>
                      {row.is_admin ? <View style={{ paddingHorizontal: 7, height: 18, borderRadius: 9, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 10, fontWeight: '700', color: t.acTx }}>管理员</Text></View> : null}
                      {blocked ? <View style={{ paddingHorizontal: 7, height: 18, borderRadius: 9, backgroundColor: t.redGhost, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 10, fontWeight: '700', color: t.red }}>已停用</Text></View> : null}
                    </View>
                    <Text numberOfLines={1} style={{ fontSize: 12, color: t.tx3, marginTop: 2 }}>{u.email || '—'}</Text>
                  </View>
                  {isBusy ? <Text style={{ color: t.tx3, fontSize: 11 }}>…</Text> : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginLeft: 50, marginTop: 9 }}>
                  <Pressable onPress={() => !row.is_first_admin && toggleAdmin(row)} disabled={row.is_first_admin} style={({ pressed }) => [{ opacity: row.is_first_admin ? 0.4 : 1 }, pressed && { opacity: 0.6 }]}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: row.is_first_admin ? t.tx3 : (row.is_admin ? t.amber : t.acTx) }}>{row.is_first_admin ? '首个管理员' : row.is_admin ? '取消管理' : '设为管理'}</Text>
                  </Pressable>
                  <View style={{ flexDirection: 'row', gap: 14 }}>
                    <Pressable onPress={() => openEdit(row)} hitSlop={8}><Icons.edit size={15} color={t.tx2} sw={1.9} /></Pressable>
                    <Pressable onPress={() => resetPwd(row)} hitSlop={8}><Icons.key size={15} color={t.tx2} sw={1.9} /></Pressable>
                    {!row.is_first_admin ? <Pressable onPress={() => remove(row)} hitSlop={8}><Icons.trash size={15} color={t.red} sw={1.9} /></Pressable> : null}
                  </View>
                </View>
              </View>
            );
          })}
          {!users.length ? <Text style={{ color: t.tx3, fontSize: 12.5, paddingVertical: 8 }}>暂无成员</Text> : null}
        </SectionCard>

        <SectionCard title={`分组 (${groups.length})`}>
          <Pressable onPress={openGroupCreate} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9 }, pressed && { opacity: 0.6 }]}>
            <Icons.plus size={15} color={t.acTx} sw={2} /><Text style={{ color: t.acTx, fontSize: 13, fontWeight: '700' }}>新增分组</Text>
          </Pressable>
          {groups.map((g, i) => (
            <View key={g.id} style={{ paddingVertical: 11, borderTopWidth: i === 0 ? 0 : 0.5, borderColor: t.line }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center' }}>
                  <Icons.cube size={17} color={t.tx2} sw={1.9} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '700', color: t.tx }}>{g.name}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx3, marginTop: 2 }}>{(g.users ?? []).length} 人</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 14, marginLeft: 47, marginTop: 9 }}>
                <Pressable onPress={() => openGroupMembers(g)} hitSlop={8}><Text style={{ fontSize: 12, fontWeight: '600', color: t.acTx }}>管理成员</Text></Pressable>
                <Pressable onPress={() => openPermissions(g)} hitSlop={8}><Text style={{ fontSize: 12, fontWeight: '600', color: t.amber }}>权限配置</Text></Pressable>
                <Pressable onPress={() => openGroupRename(g)} hitSlop={8}><Icons.edit size={15} color={t.tx2} sw={1.9} /></Pressable>
                <Pressable onPress={() => removeGroup(g)} hitSlop={8}><Icons.trash size={15} color={t.red} sw={1.9} /></Pressable>
              </View>
            </View>
          ))}
          {!groups.length ? <Text style={{ color: t.tx3, fontSize: 12.5, paddingVertical: 4 }}>暂无分组</Text> : null}
        </SectionCard>
      </AdminScreen>

      {/* 新增用户 */}
      <AdminSheet visible={addOpen} title="新增用户" onClose={() => setAddOpen(false)} submitLabel={submitting ? '创建中…' : '创建'} submitting={submitting} onSubmit={submitAdd} submitDisabled={!email.trim()}>
        <LabeledInput label="邮箱" value={email} onChangeText={setEmail} placeholder="user@example.com" keyboardType="email-address" />
        <LabeledInput label="名称（可选）" value={name} onChangeText={setName} placeholder="留空则用邮箱前缀" />
        <SwitchRow label="设为管理员" value={addAdmin} onValueChange={setAddAdmin} hint="授予管理后台权限" />
        <Text style={{ color: t.amber, fontSize: 11.5, lineHeight: 17 }}>创建后会生成初始密码，仅显示一次。</Text>
      </AdminSheet>

      {/* 编辑用户 */}
      <AdminSheet visible={!!editTarget} title="编辑用户" onClose={() => setEditTarget(null)} submitLabel="保存" onSubmit={submitEdit} submitDisabled={!editName.trim()} submitting={busyId === editTarget?.user.id}>
        <LabeledInput label="名称" value={editName} onChangeText={setEditName} placeholder="用户名称" />
        <SwitchRow label="停用账号" value={editBlocked} onValueChange={setEditBlocked} hint="停用后该用户无法登录" />
      </AdminSheet>

      {/* 分组新建/重命名 */}
      <AdminSheet visible={groupOpen} title={groupEdit ? '重命名分组' : '新增分组'} onClose={() => setGroupOpen(false)} submitLabel="保存" onSubmit={submitGroup} submitting={groupBusy} submitDisabled={!groupName.trim()}>
        <LabeledInput label="分组名称" value={groupName} onChangeText={setGroupName} placeholder="如：研发组" />
      </AdminSheet>

      {/* 分组成员管理 */}
      <AdminSheet visible={!!membersGroup} title={`管理成员 · ${membersGroup?.name ?? ''}`} onClose={() => setMembersGroup(null)} submitLabel={membersBusy ? '保存中…' : '保存'} onSubmit={submitMembers} submitting={membersBusy}>
        <Text style={{ color: t.tx3, fontSize: 11.5 }}>勾选要归入该分组的用户，保存后覆盖分组成员。</Text>
        <View style={{ gap: 2 }}>
          {users.map((row) => {
            const on = memberIds.has(row.user.id);
            return (
              <Pressable key={row.user.id} onPress={() => toggleMember(row.user.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8 }}>
                <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: on ? t.ac : t.tx3, backgroundColor: on ? t.ac : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {on ? <Icons.check size={13} color={t.acInk} sw={3} /> : null}
                </View>
                <Text style={{ flex: 1, fontSize: 13, color: t.tx }}>{row.user.name}{row.user.email ? ` - ${row.user.email}` : ''}</Text>
              </Pressable>
            );
          })}
          {!users.length ? <Text style={{ color: t.tx3, fontSize: 12.5 }}>暂无用户可选</Text> : null}
        </View>
      </AdminSheet>

      {/* 分组资源权限 */}
      <AdminSheet visible={!!permissionGroup} title={`权限配置 · ${permissionGroup?.name ?? ''}`} onClose={() => setPermissionGroup(null)} submitLabel={permissionSaving ? '保存中…' : '保存当前项'} onSubmit={savePermissions} submitting={permissionSaving || permissionLoading}>
        <Text style={{ color: t.tx3, fontSize: 11.5, lineHeight: 17 }}>配置该分组可用的 API Key、MCP 服务、管理/执行节点和 Skills。每次只保存当前标签。</Text>
        <FilterBar value={permissionTab} options={[{ value: 'api-keys', label: 'API Key' }, { value: 'mcp', label: 'MCP' }, { value: 'nodes', label: '节点' }, { value: 'skills', label: 'Skills' }]} onChange={changePermissionTab} />
        {permissionLoading ? <Text style={{ color: t.tx3, textAlign: 'center', paddingVertical: 20 }}>加载中…</Text> : (
          <View>{permissionTab === 'nodes' ? <NodePermissionTree rows={permissionRows as GroupNodeRow[]} selected={permissionSelected} onToggle={togglePermission} /> : permissionRows.map((row) => {
            const id = permissionId(row); const on = permissionSelected.has(id);
            return <Pressable key={`${permissionTab}-${id}`} onPress={() => togglePermission(id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9, borderBottomWidth: 0.5, borderColor: t.line }}>
              <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: on ? t.ac : t.tx3, backgroundColor: on ? t.ac : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{on ? <Icons.check size={13} color={t.acInk} sw={3} /> : null}</View>
              <View style={{ flex: 1 }}><Text style={{ color: t.tx, fontSize: 13, fontWeight: '600' }}>{permissionName(row)}</Text><Text numberOfLines={2} style={{ color: t.tx3, fontSize: 10.5, marginTop: 2 }}>{permissionSub(row)}</Text></View>
            </Pressable>;
          })}{!permissionRows.length ? <Text style={{ color: t.tx3, fontSize: 12.5 }}>暂无可分配资源</Text> : null}</View>
        )}
      </AdminSheet>

      {/* 一次性密码展示 */}
      <AdminSheet visible={!!pwdResult} title="一次性密码" onClose={() => setPwdResult(null)} submitLabel="复制密码" onSubmit={copyPwd} submitDisabled={!pwdResult?.password}>
        <Text style={{ color: t.tx3, fontSize: 12 }}>{pwdResult?.email || ''}</Text>
        <Text selectable style={{ backgroundColor: t.termBg, color: t.termTx, borderRadius: 12, padding: 13, fontFamily: 'monospace', fontSize: 14 }}>{pwdResult?.password || '—'}</Text>
        <Text style={{ color: t.amber, fontSize: 11.5, lineHeight: 17 }}>该密码仅显示一次，请立即复制并安全交给用户。</Text>
      </AdminSheet>
    </>
  );
}

function NodePermissionTree({ rows, selected, onToggle }: { rows: GroupNodeRow[]; selected: Set<string | number>; onToggle: (id: string | number) => void }) {
  const t = useTheme();
  const managers = rows.filter((row) => (row.node_role || row.role) === 'management');
  const executions = rows.filter((row) => (row.node_role || row.role) !== 'management');
  const managed = new Set(managers.map((row) => row.node_id));
  const groups = managers.map((manager) => ({ manager, children: executions.filter((row) => row.manager_node_id === manager.node_id) }));
  const loose = executions.filter((row) => !row.manager_node_id || !managed.has(row.manager_node_id));
  const checkbox = (on: boolean, inherited = false) => <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: on ? t.ac : t.tx3, backgroundColor: on ? t.ac : 'transparent', alignItems: 'center', justifyContent: 'center', opacity: inherited ? 0.65 : 1 }}>{on ? <Icons.check size={13} color={t.acInk} sw={3} /> : null}</View>;
  const nodeRow = (row: GroupNodeRow, depth: number, inherited = false) => { const own = selected.has(row.node_id); const on = own || inherited; return <Pressable key={row.node_id} disabled={inherited} onPress={() => onToggle(row.node_id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingLeft: depth * 22, borderBottomWidth: 0.5, borderColor: t.line, opacity: inherited ? 0.72 : 1 }}>{checkbox(on, inherited)}<View style={{ flex: 1 }}><Text style={{ color: t.tx, fontSize: 13, fontWeight: depth ? '600' : '700' }}>{row.node_name || row.node_id}</Text><Text style={{ color: t.tx3, fontSize: 10.5, marginTop: 2 }}>{row.node_role || row.role || 'execution'} · {row.connected ? '在线' : '离线'}{inherited ? ' · 继承管理节点授权' : ''}</Text></View></Pressable>; };
  return <View>{groups.map(({ manager, children }) => <View key={manager.node_id} style={{ marginBottom: 6 }}>{nodeRow(manager, 0)}{children.map((child) => nodeRow(child, 1, selected.has(manager.node_id)))}</View>)}{loose.length ? <View><Text style={{ color: t.tx3, fontSize: 11, fontWeight: '700', paddingTop: 8 }}>未分组执行节点</Text>{loose.map((row) => nodeRow(row, 0))}</View> : null}</View>;
}

function permissionId(row: GroupApiKeyRow | GroupMcpRow | GroupNodeRow | GroupSkillRow): string | number {
  return 'node_id' in row ? row.node_id : row.id;
}
function permissionName(row: GroupApiKeyRow | GroupMcpRow | GroupNodeRow | GroupSkillRow): string {
  if ('node_id' in row) return row.node_name || row.node_id;
  if ('display_name' in row && row.display_name) return row.display_name;
  return row.name;
}
function permissionSub(row: GroupApiKeyRow | GroupMcpRow | GroupNodeRow | GroupSkillRow): string {
  if ('node_id' in row) return `${row.role || row.node_role || '节点'} · ${row.connected ? '在线' : '离线'} · ${row.status || 'unknown'}`;
  if ('key_masked' in row) return `${row.key_masked || '已脱敏'}${row.disabled ? ' · 已停用' : ''}`;
  if ('runtime_status' in row) return `${row.description || row.name}${row.runtime_status ? ` · ${row.runtime_status}` : ''}`;
  if ('source_type' in row) return row.description || row.source_label || 'Skill';
  return row.name;
}
