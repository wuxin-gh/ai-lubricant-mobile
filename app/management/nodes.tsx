/** 执行节点：复用 Web 管理端节点控制面，提供入驻、审批、移动、编辑器与升级操作。 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import {
  approveAdminNode,
  getAdminNodes,
  getLatestAdminNodeVersion,
  installAdminNodeEditor,
  moveAdminNode,
  onboardAdminNode,
  revokeAdminNode,
  revokeAdminNodeOnboard,
  selfUpgradeAdminNode,
  upgradeAdminNodeEditor,
  type NodeInfo,
  type OnboardNodeResult,
  type OnboardNodeRole,
} from '@/api/management';
import { AdminScreen, AdminSheet, Chip, CodeBlock, DetailRow, FilterBar, LabeledInput, SectionCard, Segmented, StatCard } from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'execution', label: '执行' },
  { value: 'management', label: '管理' },
  { value: 'pending', label: '待审批' },
  { value: 'offline', label: '离线' },
] as const;
type Filter = (typeof FILTERS)[number]['value'];

const ROLES: Array<{ value: OnboardNodeRole; label: string }> = [
  { value: 'management', label: '管理节点' },
  { value: 'passive_management', label: '分组容器' },
  { value: 'execution', label: '执行节点' },
];
const EDITORS = ['claude-code', 'codex', 'gemini'];

function nodeServiceError(error: unknown): string {
  const raw = (error as Error)?.message || '加载失败';
  const lower = raw.toLowerCase();
  if (raw.includes('未配置控制面') || raw.includes('agent_compose_base_url/token')) {
    return '节点控制服务未配置。请在服务端设置 AGENT_COMPOSE_BASE_URL 与 NODE_CONTROL_TOKEN，并启动 node_server。';
  }
  if (lower.includes('timeout') || lower.includes('timed out') || raw.includes('超时')) {
    return '节点控制服务响应超时。请检查 node_server 状态、网络连通性和 AGENT_COMPOSE_TIMEOUT。';
  }
  if (raw.includes('节点服务未启用') || raw.includes('控制面') || lower.includes('connection refused') || lower.includes('connect')) {
    return '节点控制服务不可达。请确认 node_server 已启动，且 AGENT_COMPOSE_BASE_URL 可从当前服务访问。';
  }
  return raw;
}

export default function NodesScreen() {
  const t = useTheme();
  const [rows, setRows] = useState<NodeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<NodeInfo | null>(null);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [role, setRole] = useState<OnboardNodeRole>('management');
  const [nodeName, setNodeName] = useState('');
  const [managerId, setManagerId] = useState('');
  const [onboardResult, setOnboardResult] = useState<OnboardNodeResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [latestVersion, setLatestVersion] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [list, version] = await Promise.all([getAdminNodes(), getLatestAdminNodeVersion().catch(() => '')]);
      setRows(list); setLatestVersion(version);
      setDetail((old) => old ? list.find((n) => n.node_id === old.node_id) ?? old : null);
    } catch (e) { setError(nodeServiceError(e)); }
  }, []);
  React.useEffect(() => { setLoading(true); void load().finally(() => setLoading(false)); }, [load]);

  const visible = useMemo(() => rows.filter((n) => {
    if (filter === 'all') return true;
    if (filter === 'execution' || filter === 'management') return n.role === filter;
    if (filter === 'pending') return n.status === 'pending';
    return n.status === 'approved' && !(n.online ?? n.connected);
  }), [filter, rows]);
  const execution = rows.filter((n) => n.role === 'execution');
  const online = execution.filter((n) => n.online ?? n.connected).length;
  const pending = rows.filter((n) => n.status === 'pending').length;
  const managers = rows.filter((n) => n.role === 'management');

  const run = useCallback(async (row: NodeInfo, fn: () => Promise<unknown>, success: string) => {
    setBusyId(row.node_id);
    try { await fn(); await load(); Alert.alert('操作成功', success); }
    catch (e) { Alert.alert('操作失败', (e as Error)?.message || '请稍后重试'); }
    finally { setBusyId(null); }
  }, [load]);

  const confirmStatus = (row: NodeInfo, kind: 'approve' | 'revoke') => {
    const approving = kind === 'approve';
    Alert.alert(approving ? '审批节点' : '吊销节点', approving ? `确认批准“${nameOf(row)}”接入？` : `确认吊销“${nameOf(row)}”？节点将无法继续连接。`, [
      { text: '取消', style: 'cancel' },
      { text: approving ? '批准' : '吊销', style: approving ? 'default' : 'destructive', onPress: () => void run(row, () => approving ? approveAdminNode(row.node_id) : revokeAdminNode(row.node_id), approving ? '节点已批准' : '节点已吊销') },
    ]);
  };

  const submitOnboard = useCallback(async () => {
    if (submitting) return;
    if (role === 'execution' && !managerId) { Alert.alert('请选择归属管理节点'); return; }
    setSubmitting(true);
    try {
      const result = await onboardAdminNode({
        role,
        startup_method: role === 'execution' ? 'standalone' : 'docker',
        node_name: nodeName.trim() || undefined,
        manager_node_id: role === 'execution' ? managerId : undefined,
      });
      setOnboardOpen(false); setOnboardResult(result); setNodeName(''); await load();
    } catch (e) { Alert.alert('入驻失败', (e as Error)?.message || '请稍后重试'); }
    finally { setSubmitting(false); }
  }, [load, managerId, nodeName, role, submitting]);

  const move = (row: NodeInfo, target: string) => {
    if (!target || target === row.manager_node_id) return;
    void run(row, () => moveAdminNode(row.node_id, target), '执行节点已移动');
  };

  const editorAction = (row: NodeInfo, editor: string, installed: boolean) => {
    void run(row, () => installed ? upgradeAdminNodeEditor(row.node_id, editor) : installAdminNodeEditor(row.node_id, editor), `${editor} 已${installed ? '升级' : '安装'}`);
  };

  return (
    <>
      <AdminScreen active="nodes" loading={loading} error={error} onRetry={load} onRefresh={load}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 100 }}><StatCard label="执行节点" value={execution.length} /></View>
          <View style={{ flex: 1, minWidth: 100 }}><StatCard label="在线" value={online} tone={online === execution.length ? 'good' : 'warn'} /></View>
          <View style={{ flex: 1, minWidth: 100 }}><StatCard label="待审批" value={pending} tone={pending ? 'warn' : 'neutral'} /></View>
        </View>
        <Pressable onPress={() => { setRole('management'); setManagerId(''); setOnboardOpen(true); }} style={({ pressed }) => [{ height: 44, borderRadius: 14, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 }, pressed && { opacity: 0.75 }]}>
          <Icons.plus size={17} color="#fff" sw={2.2} /><Text style={{ color: '#fff', fontWeight: '700' }}>入驻节点</Text>
        </Pressable>
        <FilterBar value={filter} options={FILTERS} onChange={setFilter} />
        <SectionCard title={`节点 (${visible.length}/${rows.length})`}>
          {visible.map((row, i) => {
            const isOnline = row.online ?? row.connected;
            return (
              <Pressable key={row.node_id} onPress={() => setDetail(row)} style={({ pressed }) => [{ paddingVertical: 12, borderTopWidth: i === 0 ? 0 : 0.5, borderColor: t.line }, pressed && { opacity: 0.68 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: isOnline ? t.acGhost : t.bg3, alignItems: 'center', justifyContent: 'center' }}><Icons.terminal size={18} color={isOnline ? t.acTx : t.tx3} sw={1.9} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text numberOfLines={1} style={{ flex: 1, color: t.tx, fontSize: 14, fontWeight: '700' }}>{nameOf(row)}</Text><Chip text={statusLabel(row)} color={statusColor(row, t)} bg={t.bg3} /></View>
                    <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 3 }}>{roleLabel(row)} · 会话 {row.active_session_ids?.length ?? 0}{row.capabilities?.client_version ? ` · v${row.capabilities.client_version.replace(/^v/, '')}` : ''}</Text>
                    {editorsOf(row).length ? <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 10.5, marginTop: 3 }}>编辑器 {editorsOf(row).join(' · ')}</Text> : null}
                  </View>
                  {busyId === row.node_id ? <ActivityIndicator size="small" color={t.tx3} /> : <Icons.chevron size={15} color={t.tx3} sw={1.8} />}
                </View>
              </Pressable>
            );
          })}
          {!visible.length ? <Text style={{ color: t.tx3, fontSize: 12.5 }}>暂无符合条件的节点</Text> : null}
        </SectionCard>
      </AdminScreen>

      <AdminSheet visible={onboardOpen} title="入驻节点" onClose={() => setOnboardOpen(false)} submitLabel={submitting ? '创建中…' : '创建入驻'} submitting={submitting} onSubmit={submitOnboard}>
        <Segmented label="节点类型" value={role} options={ROLES} onChange={setRole} />
        <LabeledInput label="节点名称" value={nodeName} onChangeText={setNodeName} placeholder="留空由服务端生成" />
        {role === 'execution' ? <Segmented label="归属管理节点" value={managerId} options={managers.map((n) => ({ value: n.node_id, label: nameOf(n) }))} onChange={setManagerId} /> : null}
        <Text style={{ color: t.tx3, fontSize: 11.5, lineHeight: 17 }}>{role === 'passive_management' ? '分组容器没有客户端、凭证和安装命令，只用于归拢执行节点。' : '节点凭证与安装命令仅在创建结果中显示一次，请立即妥善保存。'}</Text>
      </AdminSheet>

      <AdminSheet visible={!!onboardResult} title="节点入驻结果" onClose={() => setOnboardResult(null)}>
        {onboardResult ? <View style={{ gap: 10 }}>
          <DetailRow label="节点 ID" value={onboardResult.node_id} mono />
          {onboardResult.secret ? <><Text style={{ color: t.amber, fontSize: 11.5, lineHeight: 17 }}>凭证仅显示一次，不会保存到手机。</Text><CodeBlock text={onboardResult.secret} /></> : null}
          {onboardResult.install_command ? <><Text style={{ color: t.tx2, fontSize: 12, fontWeight: '700' }}>安装命令</Text><CodeBlock text={onboardResult.install_command} /></> : null}
          <Pressable onPress={() => { const id = onboardResult.node_id; Alert.alert('撤销入驻', '撤销尚未完成的节点入驻？', [{ text: '取消', style: 'cancel' }, { text: '撤销', style: 'destructive', onPress: () => void revokeAdminNodeOnboard(id).then(() => { setOnboardResult(null); return load(); }).catch((e) => Alert.alert('撤销失败', (e as Error)?.message || '请稍后重试')) }]); }} style={{ height: 40, borderRadius: 12, backgroundColor: t.redGhost, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.red, fontWeight: '700' }}>撤销本次入驻</Text></Pressable>
        </View> : null}
      </AdminSheet>

      <AdminSheet visible={!!detail} title="节点详情" onClose={() => setDetail(null)}>
        {detail ? <View>
          <DetailRow label="名称" value={nameOf(detail)} />
          <DetailRow label="节点 ID" value={detail.node_id} mono />
          <DetailRow label="类型" value={roleLabel(detail)} />
          <DetailRow label="审批状态" value={detail.status || 'unknown'} />
          <DetailRow label="连接状态" value={statusLabel(detail)} color={statusColor(detail, t)} />
          <DetailRow label="启动方式" value={detail.startup_method || '—'} />
          <DetailRow label="最后心跳" value={fmtTime(detail.last_heartbeat_at)} />
          <DetailRow label="活动会话" value={detail.active_session_ids?.length ?? 0} />
          <DetailRow label="客户端版本" value={detail.capabilities?.client_version ? `v${detail.capabilities.client_version.replace(/^v/, '')}` : '—'} mono />
          {machineLine(detail) ? <DetailRow label="机器" value={machineLine(detail)} /> : null}
          {detail.role === 'execution' && managers.length > 0 ? <Segmented label="归属管理节点" value={detail.manager_node_id || ''} options={managers.map((n) => ({ value: n.node_id, label: nameOf(n) }))} onChange={(v) => move(detail, v)} /> : null}
          {!detail.is_passive && detail.status === 'approved' ? <SectionCard title="编辑器 CLI">{EDITORS.map((editor) => { const installed = editorsOf(detail).includes(editor); return <View key={editor} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, gap: 8 }}><Text style={{ flex: 1, color: t.tx, fontSize: 12.5, fontFamily: 'monospace' }}>{editor}</Text><Chip text={installed ? '已安装' : '未安装'} color={installed ? t.add : t.tx3} bg={t.bg3} /><Pressable disabled={busyId === detail.node_id || !(detail.online ?? detail.connected)} onPress={() => editorAction(detail, editor, installed)}><Text style={{ color: (detail.online ?? detail.connected) ? t.acTx : t.tx3, fontSize: 12, fontWeight: '700' }}>{installed ? '升级' : '安装'}</Text></Pressable></View>; })}</SectionCard> : null}
          {!detail.is_passive && latestVersion && detail.status === 'approved' ? <Pressable disabled={busyId === detail.node_id || !(detail.online ?? detail.connected)} onPress={() => void run(detail, () => selfUpgradeAdminNode(detail.node_id), `已下发升级至 ${latestVersion}`)} style={{ height: 40, marginTop: 10, borderRadius: 12, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: (detail.online ?? detail.connected) ? t.acTx : t.tx3, fontWeight: '700' }}>升级节点至 {latestVersion}</Text></Pressable> : null}
          {detail.status === 'pending' ? <Pressable onPress={() => confirmStatus(detail, 'approve')} style={{ height: 40, marginTop: 10, borderRadius: 12, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.acTx, fontWeight: '700' }}>批准接入</Text></Pressable> : null}
          {detail.status === 'approved' ? <Pressable onPress={() => confirmStatus(detail, 'revoke')} style={{ height: 40, marginTop: 10, borderRadius: 12, backgroundColor: t.redGhost, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.red, fontWeight: '700' }}>吊销节点</Text></Pressable> : null}
        </View> : null}
      </AdminSheet>
    </>
  );
}

function nameOf(n: NodeInfo): string { return n.node_name || n.node_id; }
function roleLabel(n: NodeInfo): string { if (n.role === 'execution') return '执行节点'; if (n.role === 'management') return n.is_passive ? '分组容器' : '管理节点'; return n.role || '未知角色'; }
function statusLabel(n: NodeInfo): string { if (n.status === 'pending') return '待审批'; if (n.status === 'revoked') return '已吊销'; if (n.status !== 'approved') return '未知'; if (n.online ?? n.connected) return '在线'; if (n.connected) return '心跳超时'; return '离线'; }
function statusColor(n: NodeInfo, t: ReturnType<typeof useTheme>): string { if (n.status === 'pending') return t.amber; if (n.status === 'revoked' || n.status === 'approved' && !(n.online ?? n.connected)) return t.red; return n.status === 'approved' ? t.add : t.tx3; }
function editorsOf(n: NodeInfo): string[] { const raw = n.capabilities?.editors || n.capabilities?.editor || ''; return raw.split(',').map((x) => x.trim()).filter(Boolean); }
function machineLine(n: NodeInfo): string { const c = n.capabilities ?? {}; return [c.os, c.arch, c.cpu_model || c.cpu, c.memory].filter(Boolean).join(' · '); }
function fmtTime(v?: string): string { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString(); }
