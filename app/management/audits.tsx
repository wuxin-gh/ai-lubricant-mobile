/** 操作记录：服务端 operation/user 精确筛选，客户端摘要搜索，支持完整请求/响应详情。 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { getAdminAudits, getAdminUsers, type AdminUserRow, type AuditRow } from '@/api/management';
import { AdminScreen, AdminSheet, Chip, CodeBlock, Collapsible, DetailRow, LabeledInput, SectionCard, Segmented } from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';

const PAGE_SIZE = 30;

export default function AuditsScreen() {
  const t = useTheme();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [operation, setOperation] = useState('');
  const [userId, setUserId] = useState('');
  const [search, setSearch] = useState('');

  const filters = useMemo(() => ({ operation: operation.trim() || undefined, user_id: userId || undefined }), [operation, userId]);
  const load = useCallback(async () => {
    setError('');
    try {
      const [r, u] = await Promise.all([getAdminAudits(undefined, PAGE_SIZE, filters), getAdminUsers().catch(() => [])]);
      setRows(r.audits); setCursor(r.cursor); setHasNext(r.hasNext); setUsers(u);
    } catch (e) { setError((e as Error)?.message || '加载失败'); }
  }, [filters]);
  React.useEffect(() => { setLoading(true); void load().finally(() => setLoading(false)); }, [load]);

  const loadMore = useCallback(async () => {
    if (!cursor || !hasNext || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await getAdminAudits(cursor, PAGE_SIZE, filters);
      setRows((old) => [...old, ...r.audits.filter((n) => !old.some((o) => o.id === n.id))]);
      setCursor(r.cursor); setHasNext(r.hasNext);
    } finally { setLoadingMore(false); }
  }, [cursor, filters, hasNext, loadingMore]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.operation, r.target, operator(r), r.request, r.response].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [rows, search]);
  const activeFilters = (operation.trim() ? 1 : 0) + (userId ? 1 : 0);

  return (
    <>
      <AdminScreen active="audits" loading={loading} error={error} onRetry={load} onRefresh={load}>
        <LabeledInput label="当前结果内搜索" value={search} onChangeText={setSearch} placeholder="操作、对象、管理员或正文" />
        <Pressable onPress={() => setFilterOpen(true)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, borderRadius: 14, paddingHorizontal: 14, backgroundColor: t.bg2, ...t.shCard }, pressed && { opacity: 0.7 }]}>
          <Icons.search size={16} color={t.tx2} sw={1.9} /><Text style={{ flex: 1, color: activeFilters ? t.tx : t.tx3, fontSize: 13 }}>{activeFilters ? `服务端筛选 ${activeFilters} 项` : '按操作类型 / 操作者精确筛选'}</Text>{activeFilters ? <Chip text={String(activeFilters)} color={t.acTx} bg={t.acGhost} /> : null}<Icons.chevron size={15} color={t.tx3} sw={1.8} />
        </Pressable>
        <SectionCard title={`操作记录 (${visible.length}${visible.length !== rows.length ? `/${rows.length}` : ''})`}>
          {visible.map((row, i) => (
            <Pressable key={row.id ?? `${row.created_at}-${i}`} onPress={() => setDetail(row)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 11, borderTopWidth: i === 0 ? 0 : 0.5, borderColor: t.line }, pressed && { opacity: 0.65 }]}>
              <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center' }}><Icons.eye size={16} color={t.tx2} sw={1.9} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: t.tx, fontSize: 13.5, fontWeight: '700' }}>{operationLabel(row.operation)}</Text>
                <Text numberOfLines={2} style={{ color: t.tx2, fontSize: 11.5, marginTop: 3 }}>{targetSummary(row)}</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 5 }}><Text numberOfLines={1} style={{ flex: 1, color: t.tx3, fontSize: 10.5 }}>{operator(row)}</Text><Text style={{ color: t.tx3, fontSize: 10.5 }}>{fmtTime(row.created_at)}</Text></View>
              </View><Icons.chevron size={15} color={t.tx3} sw={1.8} />
            </Pressable>
          ))}
          {!visible.length ? <Text style={{ color: t.tx3, fontSize: 12.5 }}>暂无符合条件的操作记录</Text> : null}
          {hasNext && !search.trim() ? <Pressable onPress={loadMore} disabled={loadingMore} style={({ pressed }) => [{ height: 42, marginTop: 8, borderRadius: 13, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>{loadingMore ? <ActivityIndicator size="small" color={t.tx3} /> : <Text style={{ color: t.tx2, fontSize: 13, fontWeight: '600' }}>加载更多</Text>}</Pressable> : null}
        </SectionCard>
      </AdminScreen>

      <AdminSheet visible={filterOpen} title="操作记录筛选" onClose={() => setFilterOpen(false)} submitLabel="应用筛选" onSubmit={() => setFilterOpen(false)}>
        <LabeledInput label="操作类型（精确匹配）" value={operation} onChangeText={setOperation} placeholder="如 provider.update / group.set_users" />
        {users.length ? <Segmented label="操作者" value={userId} options={[{ value: '', label: '全部' }, ...users.map((u) => ({ value: u.user.id, label: u.user.name || u.user.email || u.user.id || '用户' })).filter((x) => x.value)]} onChange={setUserId} /> : null}
        <Pressable onPress={() => { setOperation(''); setUserId(''); }} style={{ height: 40, borderRadius: 12, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.tx2, fontWeight: '700' }}>清空筛选</Text></Pressable>
        <Text style={{ color: t.tx3, fontSize: 11.5, lineHeight: 17 }}>操作类型与操作者由现有接口在服务端筛选；顶部文本搜索只搜索当前已加载结果。</Text>
      </AdminSheet>

      <AdminSheet visible={!!detail} title="操作详情" onClose={() => setDetail(null)}>
        {detail ? <View>
          <DetailRow label="操作" value={operationLabel(detail.operation)} />
          {detail.operation ? <DetailRow label="动作码" value={detail.operation} mono /> : null}
          <DetailRow label="对象" value={detail.target || targetSummary(detail)} multiline />
          <DetailRow label="操作者" value={operator(detail)} />
          {detail.user?.email ? <DetailRow label="邮箱" value={detail.user.email} /> : null}
          <DetailRow label="时间" value={fmtFullTime(detail.created_at)} />
          {detail.source_ip ? <DetailRow label="来源 IP" value={detail.source_ip} mono /> : null}
          {detail.user_agent ? <DetailRow label="User Agent" value={detail.user_agent} multiline /> : null}
          <Collapsible title="请求参数" defaultOpen><CodeBlock text={pretty(detail.request)} /></Collapsible>
          <Collapsible title="操作结果"><CodeBlock text={pretty(detail.response)} /></Collapsible>
        </View> : null}
      </AdminSheet>
    </>
  );
}

const OPERATION_LABELS: Record<string, string> = {
  'user.create_with_password': '批量创建用户', 'user.create': '创建用户', 'user.update': '修改用户', 'user.delete': '删除用户', 'user.set_admin': '设置管理员权限', 'user.change_password': '修改密码', 'user.reset_password': '重置密码',
  'group.delete': '删除分组', 'group.set_users': '设置分组成员', 'group.set_api_keys': '设置分组 API Key', 'group.set_mcp_services': '设置分组 MCP 服务', 'group.set_skills': '设置分组 Skills', 'group.bind_node': '绑定分组节点', 'group.unbind_node': '解绑分组节点',
  'model.create': '创建模型', 'model.update': '修改模型', 'model.delete': '删除模型', 'oidc.update': '更新 OIDC 配置', 'mcp.delete': '删除 MCP 上游', 'node.unbind': '解绑执行节点', 'node.delete': '删除执行节点',
  add_api_key: '创建 API Key', update_api_key: '修改 API Key', delete_api_key: '删除 API Key', disable_api_key: '禁用/启用 API Key', toggle_api_keys: '开关 API Key 总开关',
  create_provider: '创建渠道', update_custom_provider: '修改渠道', delete_provider: '删除渠道', toggle_provider: '启用/停用渠道', update_limit_policy: '更新限流策略',
  replace_provider_models: '替换渠道模型', upsert_provider_model: '新增/更新渠道模型', delete_provider_model: '删除渠道模型', refresh_provider_models: '刷新渠道模型', health_check_provider: '渠道健康检查', check_provider_accounts: '检查渠道账号',
  add_account: '添加渠道账号', update_account: '修改渠道账号', delete_account: '删除渠道账号', toggle_account_switch: '开关渠道账号', init_account: '初始化渠道账号', start_account_auth: '发起账号授权', cancel_account_auth: '取消账号授权', refresh_account_auth: '刷新账号授权', account_auth_callback: '账号授权回调', device_code_auth_complete: '设备码授权完成', clear_cooldown: '清除账号冷却', clear_all_cooldowns: '清除渠道全部冷却', batch_switch: '批量切换账号', cleanup_account_routes: '清理账号模型路由',
  create_model_group: '创建模型分组', update_model_group: '修改模型分组', delete_model_group: '删除模型分组', update_model_routing: '更新模型路由', update_proxies: '更新代理池', update_model_metadata: '更新模型元数据', update_model_metadata_default: '更新模型元数据默认值', delete_model_metadata: '删除模型元数据', sync_model_metadata_openrouter: '同步 OpenRouter 元数据', sync_model_metadata_modelsdev: '同步 models.dev 元数据',
  update_header_templates: '更新请求头模板', update_security_config: '更新安全配置', update_security_rules: '更新脱敏规则', update_main_config: '更新主配置', update_tokenizer_rules: '更新分词规则', update_thinking_global: '更新思考全局配置', update_server_config: '更新服务配置', update_logging_config: '更新日志配置', update_model_refresh: '更新模型刷新配置', update_message_delete: '更新消息清理配置', update_log_retention: '更新日志保留配置', update_data_retention: '更新数据保留配置', update_retry_config: '更新重试配置', update_stream_config: '更新流式配置', update_rate_limit_config: '更新限流配置', update_system_config: '更新系统配置', change_admin_password: '修改管理员密码', update_admin_session: '更新管理员会话时长',
};
function operationLabel(operation?: string): string { if (!operation) return '未知操作'; return OPERATION_LABELS[operation] || OPERATION_LABELS[operation.replace(/\./g, '_')] || operation; }

function operator(row: AuditRow): string { return row.user?.name || row.user?.email || row.source_ip || '系统管理员'; }
function targetSummary(row: AuditRow): string { if (row.target) return row.target; const parsed = parse(row.request); if (parsed && typeof parsed === 'object') { const x = parsed as Record<string, unknown>; for (const k of ['name', 'provider_name', 'provider', 'model_id', 'user_id', 'group_id', 'node_id', 'id']) if (x[k]) return `${k}: ${String(x[k])}`; } return '未记录操作对象'; }
function parse(v?: string): unknown { if (!v) return null; try { return JSON.parse(v); } catch { return v; } }
function pretty(v?: string): string { const x = parse(v); if (x === null) return '—'; return typeof x === 'string' ? x : JSON.stringify(x, null, 2); }
function dateOf(v?: string | number): Date | null { if (v === undefined || v === null || v === '') return null; const d = new Date(typeof v === 'number' ? v * 1000 : v); return Number.isNaN(d.getTime()) ? null : d; }
function fmtTime(v?: string | number): string { const d = dateOf(v); if (!d) return v ? String(v) : '—'; return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function fmtFullTime(v?: string | number): string { const d = dateOf(v); return d ? d.toLocaleString() : v ? String(v) : '—'; }
