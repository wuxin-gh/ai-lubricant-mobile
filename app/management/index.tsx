/**
 * 数据看板：复用 GET /admin/dashboard-stats（section=all）与 GET /admin/stats。
 *
 * 注意后端不返回 by_provider / retry_count：渠道维度要从 rankings 里的
 * provider_* 榜单取，之前直接读 by_provider 会永远是空的。
 */
import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import {
  getAdminDashboard,
  getAdminStats,
  type AdminStats,
  type DashboardRankItem,
  type DashboardSeriesItem,
  type DashboardStats,
} from '@/api/management';
import { AdminScreen, Chip, FilterBar, SectionCard, StatCard } from '@/components/admin-ui';
import { useTheme } from '@/theme';

const RANGES = [
  { value: 'today', label: '今天' },
  { value: '24h', label: '近 24 小时' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
] as const;

type Range = (typeof RANGES)[number]['value'];
const RANGE_CFG: Record<Range, { seconds: number; grain: 'hour' | 'day' | 'week'; calendarToday?: boolean }> = {
  today: { seconds: 86400, grain: 'hour', calendarToday: true },
  '24h': { seconds: 86400, grain: 'hour' },
  '7d': { seconds: 604800, grain: 'day' },
  '30d': { seconds: 2592000, grain: 'day' },
};

/** 榜单维度：模型 / 渠道，各自有用量、失败率、速度、缓存四个榜。 */
const DIMENSIONS = [
  { value: 'model', label: '按模型' },
  { value: 'provider', label: '按渠道' },
] as const;
type Dimension = (typeof DIMENSIONS)[number]['value'];

export default function DashboardScreen() {
  const t = useTheme();
  const [data, setData] = useState<DashboardStats | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState<Range>('today');
  const [dim, setDim] = useState<Dimension>('model');

  const load = useCallback(async () => {
    setError('');
    try {
      const cfg = RANGE_CFG[range];
      const todayStart = cfg.calendarToday
        ? Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime() / 1000)
        : undefined;
      const [d, s] = await Promise.all([
        getAdminDashboard(cfg.seconds, cfg.grain, todayStart),
        getAdminStats().catch(() => ({} as AdminStats)),
      ]);
      setData(d); setStats(s);
    } catch (e) { setError((e as Error)?.message || '加载失败'); }
  }, [range]);

  React.useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  const s = data?.summary ?? {};
  const r = data?.rankings ?? {};
  const errRate = s.requests ? ((s.error_count ?? 0) / s.requests * 100) : 0;

  const usage = (dim === 'model' ? r.model_usage_top : r.provider_usage_top) ?? [];
  const failure = (dim === 'model' ? r.model_failure_rate_top : r.provider_failure_rate_top) ?? [];
  const speed = (dim === 'model' ? r.model_speed_top : r.provider_speed_top) ?? [];
  const cache = (dim === 'model' ? r.model_cache_hit_top : r.provider_cache_hit_top) ?? [];
  const custom = r.custom_model_usage_top ?? [];

  const providers = stats?.providers ?? [];
  const unhealthy = providers.filter((p) => p.auth_ok < p.total_accounts || p.cooldown > 0);
  const dimLabel = dim === 'model' ? '模型' : '渠道';

  return (
    <AdminScreen active="index" loading={loading} error={error} onRetry={() => { setLoading(true); void load().finally(() => setLoading(false)); }} onRefresh={load}>
      <FilterBar value={range} options={RANGES} onChange={setRange} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 140 }}><StatCard label="请求数" value={fmtNum(s.requests)} sub={`均 ${(s.avg_prm ?? 0).toFixed(1)} 次/分`} /></View>
        <View style={{ flex: 1, minWidth: 140 }}><StatCard label="错误率" value={`${errRate.toFixed(1)}%`} sub={`错误 ${fmtNum(s.error_count)}`} tone={errRate > 5 ? 'bad' : errRate > 1 ? 'warn' : 'good'} /></View>
        <View style={{ flex: 1, minWidth: 140 }}><StatCard label="总 Token" value={fmtTokens(s.total_tokens)} sub={`均 ${fmtTokens(s.avg_tpm)}/分`} /></View>
        <View style={{ flex: 1, minWidth: 140 }}><StatCard label="平均耗时" value={`${Math.round(s.avg_duration_ms ?? 0)}ms`} /></View>
      </View>

      <SectionCard title="使用趋势">
        <TrendChart rows={data?.series?.model_token_distribution ?? []} color={t.ac} valueLabel={fmtTokens} />
      </SectionCard>
      <SectionCard title="请求次数">
        <TrendChart rows={data?.series?.model_call_distribution ?? []} color={t.add} valueLabel={fmtNum} />
      </SectionCard>
      <SectionCard title="失败请求">
        <TrendChart rows={data?.series?.model_failure_distribution ?? []} color={t.red} valueLabel={fmtNum} />
      </SectionCard>
      <SectionCard title="平均响应时间">
        <TrendChart rows={data?.series?.model_response_average ?? []} color={t.amber} valueLabel={(v) => `${Math.round(v)}ms`} average />
      </SectionCard>

      <SectionCard title="Token 构成">
        <KvBar label="输入" value={s.prompt_tokens} total={s.total_tokens} color={t.ac} />
        <KvBar label="输出" value={s.completion_tokens} total={s.total_tokens} color={t.add} />
        <KvBar label="缓存读" value={s.cached_tokens} total={s.prompt_tokens} color={t.amber} hint="占输入" />
        <KvBar label="缓存写" value={s.cache_creation_tokens} total={s.prompt_tokens} color={t.tx3} hint="占输入" />
        <Text style={{ color: t.tx3, fontSize: 11, marginTop: 8, lineHeight: 16 }}>合计 = 输入 + 输出；缓存读/写是输入明细，不额外计入合计。</Text>
      </SectionCard>

      {(s.reasoning_requests ?? 0) > 0 ? (
        <SectionCard title="思考模型">
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><StatCard label="思考请求" value={fmtNum(s.reasoning_requests)} sub={`占比 ${((s.reasoning_request_rate ?? 0) * 100).toFixed(1)}%`} /></View>
            <View style={{ flex: 1 }}><StatCard label="思考 Token" value={fmtTokens(s.reasoning_tokens)} /></View>
          </View>
        </SectionCard>
      ) : null}

      {unhealthy.length ? (
        <SectionCard title={`渠道健康告警 (${unhealthy.length})`}>
          {unhealthy.map((p, i) => (
            <View key={p.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 0.5, borderColor: t.line }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: t.tx, fontWeight: '600' }}>{p.name}</Text>
              <Chip text={`可用 ${p.auth_ok}/${p.total_accounts}`} color={p.auth_ok < p.total_accounts ? t.red : t.tx2} bg={p.auth_ok < p.total_accounts ? t.redGhost : t.bg3} />
              {p.cooldown > 0 ? <Chip text={`冷却 ${p.cooldown}`} color={t.amber} bg={t.amberGhost} /> : null}
            </View>
          ))}
        </SectionCard>
      ) : null}

      <FilterBar value={dim} options={DIMENSIONS} onChange={setDim} />

      <SectionCard title={`用量排行 · ${dimLabel}`}>
        <RankList
          rows={usage}
          empty="暂无数据"
          right={(x) => `${fmtNum(x.requests)} 次`}
          sub={(x) => [
            fmtTokens(x.tokens),
            x.token_share != null ? `占比 ${(x.token_share * 100).toFixed(1)}%` : '',
            x.avg_duration_ms != null ? `${Math.round(x.avg_duration_ms)}ms` : '',
          ].filter(Boolean).join(' · ')}
        />
      </SectionCard>

      {failure.length ? (
        <SectionCard title={`失败率排行 · ${dimLabel}`}>
          <RankList
            rows={failure}
            empty="无失败记录"
            tone="bad"
            right={(x) => `${((x.failure_rate ?? 0) * 100).toFixed(1)}%`}
            sub={(x) => `${fmtNum(x.requests)} 次请求`}
          />
        </SectionCard>
      ) : null}

      {speed.length ? (
        <SectionCard title={`响应速度 · ${dimLabel}`}>
          <RankList
            rows={speed}
            empty="暂无数据"
            right={(x) => `${Math.round(x.avg_duration_ms ?? 0)}ms`}
            sub={(x) => `成功 ${fmtNum(x.success_requests)} / ${fmtNum(x.requests)}`}
          />
        </SectionCard>
      ) : null}

      {cache.length ? (
        <SectionCard title={`缓存命中 · ${dimLabel}`}>
          <RankList
            rows={cache}
            empty="暂无数据"
            right={(x) => `${((x.cache_hit_rate ?? 0) * 100).toFixed(0)}%`}
            sub={(x) => `缓存 ${fmtTokens(x.cached_tokens)} / 输入 ${fmtTokens(x.prompt_tokens)}`}
          />
        </SectionCard>
      ) : null}

      {custom.length ? (
        <SectionCard title="自定义别名用量">
          <RankList rows={custom} empty="暂无别名调用" right={(x) => `${fmtNum(x.requests)} 次`} sub={(x) => fmtTokens(x.tokens)} />
          <Text style={{ color: t.tx3, fontSize: 11, marginTop: 8 }}>这里按客户端请求的自定义别名统计，其余榜单按系统模型统计。</Text>
        </SectionCard>
      ) : null}

      {stats?.models_count != null ? (
        <SectionCard title="平台概览">
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><StatCard label="渠道数" value={providers.length} /></View>
            <View style={{ flex: 1 }}><StatCard label="模型数" value={stats.models_count ?? 0} /></View>
            <View style={{ flex: 1 }}><StatCard label="累计请求" value={fmtTokens(stats.total_requests)} /></View>
          </View>
        </SectionCard>
      ) : null}
    </AdminScreen>
  );
}

/** 按 name 保留多条系列，使用稳定颜色、图例、虚线网格和平滑曲线。 */
function TrendChart({ rows, color, valueLabel, average = false }: { rows: DashboardSeriesItem[]; color: string; valueLabel: (n: number) => string; average?: boolean }) {
  const t = useTheme();
  const chart = React.useMemo(() => {
    const names = Array.from(new Set(rows.map((row) => row.name || '全部'))).slice(0, 6);
    const buckets = Array.from(new Set(rows.map((row) => row.bucket))).sort((a, b) => a - b);
    const series = names.map((name) => ({ name, values: buckets.map((bucket) => { const same = rows.filter((row) => row.bucket === bucket && (row.name || '全部') === name); const total = same.reduce((sum, row) => sum + Number(row.value || 0), 0); return average && same.length ? total / same.length : total; }) }));
    return { buckets, series };
  }, [average, rows]);
  if (!chart.buckets.length) return <Text style={{ color: t.tx3, fontSize: 12.5 }}>暂无趋势数据</Text>;
  const colors = [color, t.add, t.amber, t.red, '#8b5cf6', '#06b6d4'];
  const width = 330; const height = 176; const left = 42; const top = 12; const bottom = 30; const right = 8;
  const chartW = width - left - right; const chartH = height - top - bottom;
  const all = chart.series.flatMap((item) => item.values); const max = Math.max(...all, 1);
  const x = (i: number) => left + (chart.buckets.length === 1 ? chartW / 2 : i * chartW / (chart.buckets.length - 1));
  const y = (v: number) => top + chartH - (v / max) * chartH;
  const smooth = (values: number[]) => { const pts = values.map((v, i) => ({ x: x(i), y: y(v) })); if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : ''; return pts.slice(1).reduce((d, p, i) => { const a = pts[i]; const mid = (a.x + p.x) / 2; return `${d} C ${mid} ${a.y}, ${mid} ${p.y}, ${p.x} ${p.y}`; }, `M ${pts[0].x} ${pts[0].y}`); };
  const latest = chart.series.reduce((sum, item) => sum + (item.values[item.values.length - 1] || 0), 0);
  return <View><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>{chart.series.map((item, i) => <View key={item.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors[i] }} /><Text numberOfLines={1} style={{ color: t.tx3, fontSize: 10.5, maxWidth: 118 }}>{item.name}</Text></View>)}</View><Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}><Defs><LinearGradient id="chartFade" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={color} stopOpacity="0.16" /><Stop offset="1" stopColor={color} stopOpacity="0" /></LinearGradient></Defs>{[0, 0.25, 0.5, 0.75, 1].map((ratio) => { const gy = top + chartH * ratio; return <React.Fragment key={ratio}><Line x1={left} y1={gy} x2={width - right} y2={gy} stroke={t.line} strokeWidth="0.7" strokeDasharray="3 4" /><SvgText x={left - 5} y={gy + 3} fill={t.tx3} fontSize="8" textAnchor="end">{valueLabel(max * (1 - ratio))}</SvgText></React.Fragment>; })}{chart.series[0] ? <Path d={`${smooth(chart.series[0].values)} L ${x(chart.buckets.length - 1)} ${top + chartH} L ${x(0)} ${top + chartH} Z`} fill="url(#chartFade)" /> : null}{chart.series.map((item, i) => <Path key={item.name} d={smooth(item.values)} fill="none" stroke={colors[i]} strokeWidth={i === 0 ? 2.5 : 2} strokeLinecap="round" />)}{[0, Math.floor((chart.buckets.length - 1) / 2), chart.buckets.length - 1].map((i) => <SvgText key={`${i}-${chart.buckets[i]}`} x={x(i)} y={height - 8} fill={t.tx3} fontSize="8" textAnchor={i === 0 ? 'start' : i === chart.buckets.length - 1 ? 'end' : 'middle'}>{chartTime(chart.buckets[i])}</SvgText>)}{chart.series.map((item, si) => { const i = item.values.length - 1; return <Circle key={`dot-${item.name}`} cx={x(i)} cy={y(item.values[i] || 0)} r={2.7} fill={colors[si]} stroke={t.bg2} strokeWidth={1.2} />; })}</Svg><Text style={{ color: t.tx3, fontSize: 10.5, textAlign: 'right' }}>最新合计 {valueLabel(latest)}</Text></View>;
}
function chartTime(ts: number): string { const d = new Date(ts * 1000); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`; }

/** 排行列表：名次 + 名称 + 右侧主指标 + 副行。 */
function RankList({
  rows,
  right,
  sub,
  empty,
  tone,
}: {
  rows: DashboardRankItem[];
  right: (x: DashboardRankItem) => string;
  sub?: (x: DashboardRankItem) => string;
  empty: string;
  tone?: 'bad';
}) {
  const t = useTheme();
  if (!rows.length) return <Text style={{ color: t.tx3, fontSize: 12.5 }}>{empty}</Text>;
  return (
    <>
      {rows.slice(0, 10).map((x, i) => {
        const subText = sub?.(x) ?? '';
        return (
          <View key={`${x.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, borderTopWidth: i === 0 ? 0 : 0.5, borderColor: t.line }}>
            <Text style={{ width: 18, fontSize: 11.5, fontWeight: '700', color: i < 3 ? t.acTx : t.tx3, textAlign: 'center' }}>{i + 1}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 12.5, color: t.tx, fontWeight: '600', fontFamily: 'monospace' }}>{x.name}</Text>
              {subText ? <Text numberOfLines={1} style={{ fontSize: 10.5, color: t.tx3, marginTop: 2 }}>{subText}</Text> : null}
            </View>
            <Text style={{ fontSize: 12, fontWeight: '700', color: tone === 'bad' ? t.red : t.tx2, fontFamily: 'monospace' }}>{right(x)}</Text>
          </View>
        );
      })}
    </>
  );
}

/** 带占比条的键值行。 */
function KvBar({ label, value, total, color, hint }: { label: string; value?: number; total?: number; color: string; hint?: string }) {
  const t = useTheme();
  const v = value ?? 0;
  const pct = total && total > 0 ? Math.min(100, (v / total) * 100) : 0;
  return (
    <View style={{ paddingVertical: 7 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 12.5, color: t.tx2, width: 56 }}>{label}</Text>
        <Text style={{ flex: 1, fontSize: 12.5, color: t.tx, fontWeight: '600', fontFamily: 'monospace' }}>{fmtTokens(v)}</Text>
        <Text style={{ fontSize: 11, color: t.tx3 }}>{pct.toFixed(1)}%{hint ? ` ${hint}` : ''}</Text>
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: t.bg3, marginTop: 6, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: 4, borderRadius: 2, backgroundColor: color }} />
      </View>
    </View>
  );
}

function fmtNum(n?: number): string {
  if (!n) return '0';
  return n.toLocaleString();
}

function fmtTokens(n?: number): string {
  if (!n) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}
