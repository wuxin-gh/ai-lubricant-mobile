/**
 * 请求日志：复用 GET /admin/request-logs，支持后端已有的筛选参数、offset 分页与详情查看。
 * 模型主显示用 actual_model（系统模型名），自定义别名仅在与之不同时作为副行展示。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import {
  getAdminProviders,
  getAdminRequestLogDetail,
  getAdminRequestLogs,
  type RequestLogDetail,
  type RequestLogFilters,
  type RequestLogRow,
} from '@/api/management';
import {
  AdminScreen,
  AdminSheet,
  Chip,
  CodeBlock,
  Collapsible,
  DetailRow,
  FilterBar,
  LabeledInput,
  SectionCard,
  Segmented,
} from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';

const PAGE_SIZE = 30;

const STATUS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
] as const;

const RANGE_FILTERS = [
  { value: 'all', label: '不限时间' },
  { value: '1h', label: '近 1 小时' },
  { value: '24h', label: '近 24 小时' },
  { value: '7d', label: '近 7 天' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];
type RangeFilter = (typeof RANGE_FILTERS)[number]['value'];

const RANGE_SECONDS: Record<RangeFilter, number> = { all: 0, '1h': 3600, '24h': 86400, '7d': 604800 };

// 系统模型名：actual_model 是请求真正路由到的广场模型 ID；空时回退 model（旧日志）。
function systemModel(row: { actual_model?: string; model?: string }): string {
  return row.actual_model || row.model || '—';
}

// 自定义别名：仅当与系统模型不同时才返回，避免重复展示。
function aliasModel(row: { requested_model?: string; model?: string; actual_model?: string }): string {
  const alias = row.requested_model || row.model || '';
  const sys = row.actual_model || row.model || '';
  return alias && alias !== sys ? alias : '';
}

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtFullTime(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function json(v: unknown): string {
  if (v === undefined || v === null) return '';
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function isEmptyObj(v: unknown): boolean {
  return !v || (typeof v === 'object' && Object.keys(v as object).length === 0);
}

export default function RequestLogsScreen() {
  const t = useTheme();
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<RequestLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<RequestLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);

  // 筛选状态
  const [status, setStatus] = useState<StatusFilter>('all');
  const [range, setRange] = useState<RangeFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [fProvider, setFProvider] = useState('');
  const [fModel, setFModel] = useState('');
  const [fAccount, setFAccount] = useState('');
  const [fKeyName, setFKeyName] = useState('');
  const [fClient, setFClient] = useState('');
  const [fSession, setFSession] = useState('');

  const filters = useMemo<RequestLogFilters>(() => {
    const f: RequestLogFilters = {};
    if (status === 'success') f.success = true;
    if (status === 'failed') f.success = false;
    if (range !== 'all') f.start_time = Math.floor(Date.now() / 1000) - RANGE_SECONDS[range];
    if (fProvider.trim()) f.provider_name = fProvider.trim();
    if (fModel.trim()) f.model = fModel.trim();
    if (fAccount.trim()) f.account_username = fAccount.trim();
    if (fKeyName.trim()) f.api_key_name = fKeyName.trim();
    if (fClient.trim()) f.client_type = fClient.trim();
    if (fSession.trim()) f.session_id = fSession.trim();
    return f;
  }, [fAccount, fClient, fKeyName, fModel, fProvider, fSession, range, status]);

  const activeFilterCount = useMemo(
    () => [fProvider, fModel, fAccount, fKeyName, fClient, fSession].filter((v) => v.trim()).length,
    [fAccount, fClient, fKeyName, fModel, fProvider, fSession],
  );

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await getAdminRequestLogs(0, PAGE_SIZE, filters);
      setRows(r.rows); setTotal(r.total);
    } catch (e) { setError((e as Error)?.message || '加载失败'); }
  }, [filters]);

  React.useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  React.useEffect(() => {
    void getAdminProviders().then((p) => setProviders(p.map((x) => x.name).filter(Boolean))).catch(() => undefined);
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || rows.length >= total) return;
    setLoadingMore(true);
    try {
      const r = await getAdminRequestLogs(rows.length, PAGE_SIZE, filters);
      setRows((old) => [...old, ...r.rows.filter((n) => !old.some((o) => o.id === n.id))]);
      setTotal(r.total);
    } catch (e) { Alert.alert('加载失败', (e as Error)?.message || '请稍后重试'); }
    finally { setLoadingMore(false); }
  }, [filters, loadingMore, rows, total]);

  const openDetail = useCallback(async (row: RequestLogRow) => {
    setDetailLoading(true);
    try { setDetail(await getAdminRequestLogDetail(row.id)); }
    catch (e) { setDetail({ ...row, error_preview: (e as Error)?.message || '加载详情失败' }); }
    finally { setDetailLoading(false); }
  }, []);

  const resetFilters = () => {
    setFProvider(''); setFModel(''); setFAccount(''); setFKeyName(''); setFClient(''); setFSession('');
  };

  return (
    <>
      <AdminScreen active="request-logs" loading={loading} error={error} onRetry={() => { setLoading(true); void load().finally(() => setLoading(false)); }} onRefresh={load}>
        <FilterBar value={status} options={STATUS_FILTERS} onChange={setStatus} />
        <FilterBar value={range} options={RANGE_FILTERS} onChange={setRange} />

        <Pressable onPress={() => setFilterOpen(true)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, borderRadius: 14, paddingHorizontal: 14, backgroundColor: t.bg2, ...t.shCard }, pressed && { opacity: 0.7 }]}>
          <Icons.search size={16} color={t.tx2} sw={1.9} />
          <Text style={{ flex: 1, fontSize: 13, color: activeFilterCount ? t.tx : t.tx3, fontWeight: activeFilterCount ? '600' : '400' }}>
            {activeFilterCount ? `已启用 ${activeFilterCount} 个高级筛选` : '按渠道 / 模型 / 账号 / Key 筛选'}
          </Text>
          {activeFilterCount ? <Chip text={String(activeFilterCount)} color={t.acTx} bg={t.acGhost} /> : null}
          <Icons.chevron size={15} color={t.tx3} sw={1.9} />
        </Pressable>

        <SectionCard title={`请求日志 (${rows.length}/${total})`}>
          {rows.map((row, i) => (
            <Pressable key={row.id} onPress={() => void openDetail(row)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 11, borderTopWidth: i === 0 ? 0 : 0.5, borderColor: t.line }, pressed && { opacity: 0.65 }]}>
              <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: row.success ? t.acGhost : t.redGhost, alignItems: 'center', justifyContent: 'center' }}>
                {row.success ? <Icons.check size={16} color={t.add} sw={2.2} /> : <Icons.alert size={16} color={t.red} sw={2} />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontFamily: 'monospace', fontWeight: '700', color: t.tx }}>{systemModel(row)}</Text>
                  <Text style={{ fontSize: 10.5, fontWeight: '700', color: row.success ? t.add : t.red }}>{row.status || (row.success ? '成功' : '失败')}</Text>
                </View>
                {aliasModel(row) ? <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 10.5, marginTop: 2 }}>别名 {aliasModel(row)}</Text> : null}
                <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11.5, marginTop: 3 }}>{row.provider_name || '—'} / {row.account_username || '—'}</Text>
                {row.error_preview ? <Text numberOfLines={2} style={{ color: t.red, fontSize: 11, marginTop: 3 }}>{row.error_preview}</Text> : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  <Chip text={fmtTime(row.time)} />
                  <Chip text={row.duration_ms != null ? `${Math.round(row.duration_ms)}ms` : '—'} />
                  {row.total_tokens != null ? <Chip text={`${row.total_tokens} tok`} /> : null}
                  {row.stream ? <Chip text="流式" /> : null}
                  {(row.attempt_no ?? 0) > 1 ? <Chip text={`重试 ${row.attempt_no}`} color={t.amber} bg={t.amberGhost} /> : null}
                  {row.client_type ? <Chip text={row.client_type} /> : null}
                </View>
              </View>
              <Icons.chevron size={15} color={t.tx3} sw={1.8} />
            </Pressable>
          ))}
          {!rows.length ? <Text style={{ color: t.tx3, fontSize: 12.5 }}>没有符合条件的请求日志</Text> : null}
          {rows.length < total ? (
            <Pressable onPress={loadMore} disabled={loadingMore} style={({ pressed }) => [{ height: 42, marginTop: 8, borderRadius: 13, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
              {loadingMore ? <ActivityIndicator size="small" color={t.tx3} /> : <Text style={{ color: t.tx2, fontSize: 13, fontWeight: '600' }}>加载更多</Text>}
            </Pressable>
          ) : null}
        </SectionCard>
      </AdminScreen>

      {/* 高级筛选 */}
      <AdminSheet visible={filterOpen} title="高级筛选" onClose={() => setFilterOpen(false)} submitLabel="应用筛选" onSubmit={() => setFilterOpen(false)}>
        {providers.length ? (
          <Segmented
            label="渠道"
            value={fProvider}
            options={[{ value: '', label: '全部' }, ...providers.map((p) => ({ value: p, label: p }))]}
            onChange={setFProvider}
          />
        ) : null}
        <LabeledInput label="模型（自定义别名精确匹配）" value={fModel} onChangeText={setFModel} placeholder="如 gpt-4o" />
        <LabeledInput label="账号用户名" value={fAccount} onChangeText={setFAccount} placeholder="渠道账号" />
        <LabeledInput label="API Key 名称" value={fKeyName} onChangeText={setFKeyName} placeholder="Key 名称" />
        <LabeledInput label="客户端类型" value={fClient} onChangeText={setFClient} placeholder="如 claude-code / codex" />
        <LabeledInput label="会话 ID" value={fSession} onChangeText={setFSession} placeholder="session_id" />
        <Pressable onPress={resetFilters} style={({ pressed }) => [{ height: 42, borderRadius: 13, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
          <Text style={{ color: t.tx2, fontWeight: '600', fontSize: 13 }}>清空高级筛选</Text>
        </Pressable>
        <Text style={{ color: t.tx3, fontSize: 11.5, lineHeight: 17 }}>模型按客户端请求名（自定义别名）匹配，与列表主显示的系统模型名口径不同。</Text>
      </AdminSheet>

      {/* 详情 */}
      <AdminSheet visible={detailLoading || !!detail} title="请求详情" onClose={() => !detailLoading && setDetail(null)}>
        {detailLoading ? <ActivityIndicator color={t.ac} style={{ marginVertical: 40 }} /> : detail ? (
          <View>
            <DetailRow label="状态" value={detail.status || (detail.success ? '成功' : '失败')} color={detail.success ? t.add : t.red} />
            <DetailRow label="系统模型" value={systemModel(detail)} mono />
            {aliasModel(detail) ? <DetailRow label="请求别名" value={aliasModel(detail)} mono /> : null}
            {detail.upstream_returned_model ? <DetailRow label="上游返回" value={detail.upstream_returned_model} mono /> : null}
            <DetailRow label="渠道 / 账号" value={`${detail.provider_name || '—'} / ${detail.account_username || '—'}`} />
            <DetailRow label="时间" value={fmtFullTime(detail.time)} />
            <DetailRow label="请求 ID" value={detail.request_id} mono />
            {detail.api_key_name ? <DetailRow label="API Key" value={detail.api_key_name} /> : null}
            {detail.client_type ? <DetailRow label="客户端" value={detail.client_type} /> : null}
            {detail.endpoint ? <DetailRow label="入口" value={detail.endpoint} mono /> : null}
            {detail.router_request_path ? <DetailRow label="上游路径" value={detail.router_request_path} mono multiline /> : null}
            {detail.upstream_status != null ? <DetailRow label="上游状态码" value={String(detail.upstream_status)} /> : null}
            <DetailRow label="流式" value={detail.stream ? '是' : '否'} />

            <Collapsible title="耗时拆解" defaultOpen>
              <DetailRow label="总耗时" value={detail.duration_ms != null ? `${Math.round(detail.duration_ms)}ms` : '—'} />
              <DetailRow label="首 Token" value={detail.first_token_ms != null ? `${Math.round(detail.first_token_ms)}ms` : '—'} />
              <DetailRow label="选路耗时" value={detail.route_duration_ms != null ? `${Math.round(detail.route_duration_ms)}ms` : '—'} />
              <DetailRow label="候选收集" value={detail.candidate_collect_ms != null ? `${Math.round(detail.candidate_collect_ms)}ms` : '—'} />
              <DetailRow label="策略选择" value={detail.strategy_select_ms != null ? `${Math.round(detail.strategy_select_ms)}ms` : '—'} />
              <DetailRow label="账号预占" value={detail.account_reserve_ms != null ? `${Math.round(detail.account_reserve_ms)}ms` : '—'} />
              {detail.routing_redis_degraded ? <DetailRow label="Redis" value="选路期间降级" color={t.amber} /> : null}
            </Collapsible>

            <Collapsible title="Token 用量" defaultOpen>
              <DetailRow label="输入" value={detail.prompt_tokens ?? '—'} />
              <DetailRow label="输出" value={detail.completion_tokens ?? '—'} />
              <DetailRow label="缓存读" value={detail.cached_tokens ?? '—'} />
              <DetailRow label="缓存写" value={detail.cache_creation_tokens ?? '—'} />
              <DetailRow label="合计" value={detail.total_tokens ?? '—'} />
              <Text style={{ color: t.tx3, fontSize: 11, marginTop: 6, lineHeight: 16 }}>合计 = 输入 + 输出；缓存读/写是输入明细，不额外计入合计。</Text>
            </Collapsible>

            <Collapsible title="代理与会话">
              <DetailRow label="代理模式" value={detail.proxy_info?.mode} />
              <DetailRow label="目标主机" value={detail.proxy_info?.target_host} mono />
              {detail.proxy_info?.node_id ? <DetailRow label="转发节点" value={detail.proxy_info.node_id} mono /> : null}
              <DetailRow label="会话 ID" value={detail.session_id} mono />
              {detail.editor_id ? <DetailRow label="编辑器" value={detail.editor_id} mono /> : null}
              {detail.editor_session_id ? <DetailRow label="编辑器会话" value={detail.editor_session_id} mono /> : null}
            </Collapsible>

            {detail.attempts?.length ? (
              <Collapsible title={`重试链（${detail.attempts.length} 次尝试）`} defaultOpen={detail.attempts.length > 1}>
                {detail.attempts.map((a, i) => (
                  <View key={i} style={{ marginTop: i === 0 ? 0 : 10, padding: 11, borderRadius: 11, backgroundColor: t.bg3, gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx }}>#{a.attempt_no ?? i + 1}</Text>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: a.success ? t.add : t.red }}>{a.status || (a.success ? '成功' : '失败')}</Text>
                      {a.upstream_status != null ? <Chip text={`HTTP ${a.upstream_status}`} /> : null}
                      {a.duration_ms != null ? <Chip text={`${Math.round(a.duration_ms)}ms`} /> : null}
                    </View>
                    <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx2 }}>{a.provider_name || '—'} / {a.account_username || '—'}</Text>
                    <Text numberOfLines={1} style={{ fontSize: 11, color: t.tx3, fontFamily: 'monospace' }}>{a.actual_model || a.model || '—'}</Text>
                    {a.error || a.error_preview ? <Text numberOfLines={4} style={{ fontSize: 11, color: t.red, lineHeight: 16 }}>{a.error || a.error_preview}</Text> : null}
                  </View>
                ))}
              </Collapsible>
            ) : null}

            {detail.error || detail.error_preview ? (
              <Collapsible title="错误信息" defaultOpen>
                <CodeBlock text={detail.error || detail.error_preview || ''} />
              </Collapsible>
            ) : null}

            {!isEmptyObj(detail.request_body) ? (
              <Collapsible title="客户端请求正文"><CodeBlock text={json(detail.request_body)} /></Collapsible>
            ) : null}
            {!isEmptyObj(detail.router_request_body) ? (
              <Collapsible title="发往上游的正文"><CodeBlock text={json(detail.router_request_body)} /></Collapsible>
            ) : null}
            {!isEmptyObj(detail.response_body) ? (
              <Collapsible title="响应正文"><CodeBlock text={json(detail.response_body)} /></Collapsible>
            ) : null}
            {!isEmptyObj(detail.routing_detail) ? (
              <Collapsible title="选路明细"><CodeBlock text={json(detail.routing_detail)} /></Collapsible>
            ) : null}

            {detail.payload_truncated ? <Text style={{ color: t.amber, fontSize: 11.5, marginTop: 10 }}>正文过大已被截断保存。</Text> : null}
            {detail.archived ? <Text style={{ color: t.amber, fontSize: 12, marginTop: 10 }}>该日志已归档，大字段正文不再保留。</Text> : null}
          </View>
        ) : null}
      </AdminSheet>
    </>
  );
}
