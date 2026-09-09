/** 资源中心：对齐 Web /console/mcp。顶部横向 tab：MCP / Skill / 插件 / 项目提示词 / 市场。
 * 每个 tab 都是简洁列表；点条目下钻到详情/编辑/导入页，不在一级页塞大表单和 JSON。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  fetchMarketIndex,
  listProjectPrompts,
  listResourceReferences,
  type MarketItem,
  type ProjectPrompt,
  type ResourceReference,
  type ResourceModule,
} from '@/api/mcpCenter';
import { listMyMcpServices, type MyMcpService } from '@/api/resources';
import { Icons } from '@/components/Icons';
import { EmptyView, GlassNav, LoadingView, PrimaryButton } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

const TABS = [
  { value: 'mcp', label: 'MCP' },
  { value: 'skills', label: 'Skill' },
  { value: 'plugins', label: '插件' },
  { value: 'prompts', label: '项目提示词' },
  { value: 'market', label: '市场' },
] as const;
type Tab = (typeof TABS)[number]['value'];

export default function ResourceCenterScreen() {
  const t = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  // 默认「市场」tab：新用户其它 tab 大概率是空的（没建过 MCP/Skill/插件/提示词），
  // 市场一开始就有内容，避免进来一片空 + 一个孤零零按钮。
  const [tab, setTab] = useState<Tab>('market');
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false);
  const [mcp, setMcp] = useState<MyMcpService[]>([]);
  const [skills, setSkills] = useState<ResourceReference[]>([]);
  const [plugins, setPlugins] = useState<ResourceReference[]>([]);
  const [prompts, setPrompts] = useState<ProjectPrompt[]>([]);
  const [market, setMarket] = useState<MarketItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      // MCP/Skill/插件/提示词 是个人/团队引用列表，并行加载；市场单独按 tab 懒加载。
      const [m, sk, pl, pr] = await Promise.all([
        listMyMcpServices().catch(() => [] as MyMcpService[]),
        listResourceReferences('skill').catch(() => [] as ResourceReference[]),
        listResourceReferences('plugin').catch(() => [] as ResourceReference[]),
        listProjectPrompts().catch(() => [] as ProjectPrompt[]),
      ]);
      setMcp(m); setSkills(sk); setPlugins(pl); setPrompts(pr.filter((p) => p.scope !== 'system'));
    } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 市场分类切换时拉对应 module 索引。
  const [marketCat, setMarketCat] = useState<Exclude<ResourceModule, 'prompts'> | 'prompts'>('mcp');
  useEffect(() => {
    if (tab !== 'market') return;
    setMarketLoading(true);
    void fetchMarketIndex(marketCat as ResourceModule).then(setMarket).catch(() => setMarket([])).finally(() => setMarketLoading(false));
  }, [tab, marketCat]);

  const marketCats: { v: Exclude<ResourceModule, 'prompts'> | 'prompts'; label: string }[] = [
    { v: 'mcp', label: 'MCP' }, { v: 'skills', label: 'Skill' }, { v: 'plugins', label: '插件' }, { v: 'prompts', label: '提示词' },
  ];

  // tab 栏常驻（加载/空态都显示），对齐 web 资源中心的左侧 tab rail。
  // 顶部留 insets.top + 52（状态栏 + GlassNav 标题条高度），tab 紧贴标题栏下方，
  // 上方不留空白；GlassNav 悬浮在这段留白位置正好盖住状态栏区。
  const tabBar = (
    <View style={{ paddingTop: insets.top + 52, backgroundColor: t.bg2, borderBottomWidth: 1, borderColor: t.line }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.pad, paddingVertical: 8, gap: 7 }}>
        {TABS.map((item) => {
          const on = tab === item.value;
          return (
            <Pressable key={item.value} onPress={() => setTab(item.value)} style={({ pressed }) => [{ height: 34, paddingHorizontal: 14, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.ac : t.bg3 }, pressed && { opacity: 0.7 }]}>
              <Text style={{ color: on ? t.acInk : t.tx2, fontSize: 12.5, fontWeight: '700' }}>{item.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const emptyMeta: Record<Tab, { title: string; sub: string }> = {
    mcp: { title: '还没有个人 MCP 服务', sub: '点上方「新增」添加 SSE 地址，或在市场安装' },
    skills: { title: '还没有 Skill', sub: '点上方「导入 Skill」从 GitHub 仓库引用' },
    plugins: { title: '还没有插件', sub: '点上方「导入插件」从 GitHub 仓库引用' },
    prompts: { title: '还没有项目提示词', sub: '点上方「新建提示词」给编辑器配置角色提示' },
    market: { title: '市场暂无内容', sub: '市场服务可能未配置，稍后重试或联系管理员' },
  };

  // 首次加载也渲染 tab 栏 + 骨架列表（而不是整屏 LoadingView 盖住 tab——
  // 用户会以为页面空白/没内容）；数据到位后各 tab 自然填充。
  if (loading) return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {tabBar}
      <View style={{ flex: 1 }}><LoadingView label="加载资源…" /></View>
      <GlassNav title="资源中心" onBack={() => router.back()} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {tabBar}

      {tab === 'market' ? (
        <View style={{ paddingHorizontal: spacing.pad, paddingTop: 10, paddingBottom: 8 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {marketCats.map((c) => {
              const on = marketCat === c.v;
              return (
                <Pressable key={c.v} onPress={() => setMarketCat(c.v)} style={({ pressed }) => [{ paddingHorizontal: 11, height: 30, borderRadius: 15, backgroundColor: on ? t.acGhost : t.bg2, borderWidth: on ? 0 : 1, borderColor: t.line2, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
                  <Text style={{ color: on ? t.acTx : t.tx3, fontSize: 11.5, fontWeight: '700' }}>{c.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <FlatList
        data={
          tab === 'mcp' ? mcp.map((s) => ({ key: String(s.id), title: s.display_name || s.name, sub: s.url, status: `${s.tool_count || 0} 工具 · ${s.runtime_status || '未同步'}`, bad: s.runtime_status === 'error', route: `/mcp/service/${s.id}` }))
          : tab === 'skills' ? skills.map((s) => ({ key: s.id, title: s.display_name || s.name, sub: s.manifest ? String((s.manifest as { summary?: string }).summary || '') : '', status: `v${s.version || '0'}`, bad: s.status === 'error', route: '' }))
          : tab === 'plugins' ? plugins.map((s) => ({ key: s.id, title: s.display_name || s.name, sub: s.manifest ? String((s.manifest as { summary?: string }).summary || '') : '', status: `v${s.version || '0'}`, bad: false, route: '' }))
          : tab === 'prompts' ? prompts.map((p) => ({ key: p.id, title: p.name, sub: p.content.slice(0, 80), status: p.enabled ? '已启用' : '已停用', bad: !p.enabled, route: `/mcp/prompt/${p.id}` }))
          : market.map((m) => ({ key: m.id, title: m.display_name || m.name || m.id, sub: m.summary, status: `v${m.latest_version || '—'} · ${m.publisher || '社区'}`, bad: false, route: `/mcp/market/${marketCat}/${m.id}` }))
        }
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ paddingHorizontal: spacing.pad, paddingTop: 10, paddingBottom: insets.bottom + 40, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={t.ac} />}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListHeaderComponent={tab === 'mcp' ? (
          <View style={{ gap: 8 }}>
            <PrimaryButton label="新增 MCP 服务" icon="plus" onPress={() => router.push('/mcp/service/new' as never)} block />
            <PrimaryButton label="管理 MCP 用户" icon="user" onPress={() => router.push('/mcp/principals' as never)} block style={{ backgroundColor: t.bg2 }} />
          </View>
        ) : tab === 'skills' || tab === 'plugins' ? (
          <PrimaryButton label={`导入${tab === 'skills' ? 'Skill' : '插件'}`} icon="plus" onPress={() => router.push({ pathname: '/mcp/import', params: { kind: tab === 'skills' ? 'skill' : 'plugin' } } as never)} block />
        ) : tab === 'prompts' ? (
          <PrimaryButton label="新建提示词" icon="plus" onPress={() => router.push('/mcp/prompt/new' as never)} block />
        ) : marketLoading ? (
          <View style={{ paddingVertical: 14, alignItems: 'center' }}><ActivityIndicator color={t.ac} /></View>
        ) : null}
        ListEmptyComponent={<EmptyView title={emptyMeta[tab].title} subtitle={emptyMeta[tab].sub} icon="cube" />}
        renderItem={({ item }) => (
          <Pressable onPress={() => item.route && router.push(item.route as never)} style={({ pressed }) => [{ padding: 15, borderRadius: 16, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2, ...t.shCard }, pressed && { opacity: 0.78 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}><Icons.cube size={20} color={t.acTx} sw={1.9} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14.5, fontWeight: '700' }}>{item.title}</Text>
                {item.sub ? <Text numberOfLines={2} style={{ color: t.tx3, fontSize: 11.5, marginTop: 3 }}>{item.sub}</Text> : null}
              </View>
              <Text style={{ color: item.bad ? t.red : t.tx3, fontSize: 10.5, fontWeight: '700' }}>{item.status}</Text>
            </View>
          </Pressable>
        )}
      />
      <GlassNav title="资源中心" onBack={() => router.back()} />
    </View>
  );
}
