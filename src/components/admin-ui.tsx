/**
 * 管理端共享 UI：顶部水平滚动分段导航 + 返回用户端按钮 + 列表/统计通用件。
 * 管理端只复用现有 /admin/* 与 /api/v1/teams/* 接口，权限最终由后端按 role=admin 判定。
 */
import React from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/auth/AuthContext';
import { Icons } from '@/components/Icons';
import { EmptyView } from '@/components/ui';
import { spacing, useTheme, type Theme } from '@/theme';

export const MGMT_TABS = [
  { key: 'index', label: '看板', icon: 'sparkle' },
  { key: 'members', label: '成员', icon: 'user' },
  { key: 'channels', label: '渠道', icon: 'git' },
  { key: 'models', label: '模型', icon: 'brain' },
  { key: 'api-keys', label: '密钥', icon: 'lock' },
  { key: 'request-logs', label: '日志', icon: 'file' },
  { key: 'audits', label: '操作', icon: 'eye' },
  { key: 'proxies', label: '代理', icon: 'globe' },
  { key: 'nodes', label: '节点', icon: 'terminal' },
] as const;

export function AdminTopBar({ active }: { active: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setMode } = useAuth();
  return (
    <View style={{ backgroundColor: t.bg2, paddingTop: insets.top, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.pad, height: 50 }}>
        <Text style={{ fontSize: 17, fontWeight: '800', color: t.tx }}>管理中心</Text>
        <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center' }}>
          <Pressable
            onPress={() => { setMode('user'); router.replace('/(tabs)/tasks' as never); }}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, height: 30, borderRadius: 15, backgroundColor: t.bg3 }, pressed && { opacity: 0.6 }]}
          >
            <Icons.user size={14} color={t.tx2} sw={1.9} />
            <Text style={{ fontSize: 12.5, fontWeight: '600', color: t.tx2 }}>用户端</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.pad, paddingBottom: 8, gap: 6 }}>
        {MGMT_TABS.map((tab) => {
          const on = tab.key === active;
          const I = Icons[tab.icon] ?? Icons.sparkle;
          return (
            <Pressable
              key={tab.key}
              onPress={() => router.replace(`/management/${tab.key === 'index' ? '' : tab.key}` as never)}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: on ? t.ac : t.bg3 }, pressed && { opacity: 0.7 }]}
            >
              <I size={14} color={on ? t.acInk : t.tx2} sw={2} />
              <Text style={{ fontSize: 12.5, fontWeight: on ? '700' : '600', color: on ? t.acInk : t.tx2 }}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function AdminScreen({ active, loading, error, onRetry, onRefresh, children }: { active: string; loading?: boolean; error?: string; onRetry?: () => void; onRefresh?: () => Promise<void> | void; children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = React.useState(false);
  const doRefresh = React.useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }, [onRefresh]);
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <AdminTopBar active={active} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.pad, paddingTop: 14, paddingBottom: insets.bottom + 40, gap: spacing.gap }}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={doRefresh} tintColor={t.tx3} /> : undefined}
      >
        {loading ? (
          <View style={{ paddingVertical: 60 }}><ActivityIndicator color={t.ac} /></View>
        ) : error ? (
          <View style={{ paddingTop: 40 }}>
            <EmptyView title="加载失败" subtitle={error} icon="alert" />
            {onRetry ? (
              <Pressable onPress={onRetry} style={({ pressed }) => [{ alignSelf: 'center', marginTop: 16, paddingHorizontal: 18, height: 38, borderRadius: 14, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.8 }]}>
                <Text style={{ color: t.acInk, fontWeight: '700', fontSize: 14 }}>重试</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          children
        )}
      </ScrollView>
    </View>
  );
}

export function StatCard({ label, value, sub, tone = 'neutral' }: { label: string; value: string | number; sub?: string; tone?: 'neutral' | 'good' | 'bad' | 'warn' }) {
  const t = useTheme();
  const color = tone === 'good' ? t.add : tone === 'bad' ? t.red : tone === 'warn' ? t.amber : t.tx;
  return (
    <View style={{ backgroundColor: t.bg2, borderRadius: 16, padding: 14, minWidth: 0, ...t.shCard }}>
      <Text style={{ fontSize: 11.5, fontWeight: '600', color: t.tx3, letterSpacing: 0.3 }}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: '800', color, marginTop: 6 }}>{value}</Text>
      {sub ? <Text style={{ fontSize: 11, color: t.tx3, marginTop: 3 }}>{sub}</Text> : null}
    </View>
  );
}

export function SectionCard({ title, children, t: _t }: { title?: string; children: React.ReactNode; t?: Theme }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.bg2, borderRadius: 16, padding: 14, ...t.shCard }}>
      {title ? <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.4, marginBottom: 10 }}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function kv(t: Theme, label: string, value: React.ReactNode) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
      <Text style={{ fontSize: 12.5, color: t.tx3, width: 86 }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 13, color: t.tx, fontWeight: '500' }}>{value ?? '—'}</Text>
    </View>
  );
}

/* ==================== 表单/弹窗通用件 ==================== */

/** 底部抽屉表单壳：标题 + 关闭 + 滚动内容 + 主按钮。 */
export function AdminSheet({
  visible,
  title,
  onClose,
  children,
  submitLabel,
  onSubmit,
  submitting,
  submitDisabled,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  submitLabel?: string;
  onSubmit?: () => void;
  submitting?: boolean;
  submitDisabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.38)' }} onPress={onClose} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%', backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
          <Text style={{ flex: 1, fontSize: 17, fontWeight: '800', color: t.tx }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Icons.plus size={20} color={t.tx2} sw={2} style={{ transform: [{ rotate: '45deg' }] }} />
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: '72%' }} contentContainerStyle={{ gap: 11, paddingBottom: 8 }}>
          {children}
        </ScrollView>
        {submitLabel && onSubmit ? (
          <Pressable
            onPress={onSubmit}
            disabled={submitting || submitDisabled}
            style={({ pressed }) => [{ height: 46, borderRadius: 14, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center', marginTop: 10 }, (pressed || submitting || submitDisabled) && { opacity: 0.6 }]}
          >
            {submitting ? <ActivityIndicator color={t.acInk} /> : <Text style={{ color: t.acInk, fontWeight: '700', fontSize: 14 }}>{submitLabel}</Text>}
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

/** 带标签的文本输入。 */
export function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  secureTextEntry,
  autoCapitalize,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'url';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  disabled?: boolean;
  hint?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.3 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.tx3}
        multiline={multiline}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false}
        editable={!disabled}
        style={{ minHeight: 46, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 10, backgroundColor: t.bg3, color: t.tx, fontSize: 13.5, ...(multiline ? { textAlignVertical: 'top' } : {}) }}
      />
      {hint ? <Text style={{ fontSize: 11, color: t.tx3 }}>{hint}</Text> : null}
    </View>
  );
}

/** 标签 + 开关行。 */
export function SwitchRow({ label, value, onValueChange, disabled, hint }: { label: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 13, paddingHorizontal: 13, paddingVertical: 10, backgroundColor: t.bg3 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '600', color: t.tx }}>{label}</Text>
        {hint ? <Text style={{ fontSize: 11, color: t.tx3, marginTop: 2 }}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ false: t.track, true: t.ac }} />
    </View>
  );
}

/** 分段选择器：在若干互斥选项中选一个。 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.3 }}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              style={({ pressed }) => [{ minWidth: 64, paddingHorizontal: 12, height: 34, borderRadius: 11, backgroundColor: on ? t.ac : t.bg3, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}
            >
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: on ? t.acInk : t.tx2 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? <Text style={{ fontSize: 11, color: t.tx3 }}>{hint}</Text> : null}
    </View>
  );
}

/** 横向滚动的筛选条（列表页顶部用）。 */
export function FilterBar<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [{ paddingHorizontal: 13, height: 32, borderRadius: 16, backgroundColor: on ? t.ac : t.bg2, borderWidth: on ? 0 : StyleSheet.hairlineWidth, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}
          >
            <Text style={{ fontSize: 12.5, fontWeight: on ? '700' : '600', color: on ? t.acInk : t.tx2 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** 多选标签组（白名单/模态等）。 */
export function ChipMultiSelect({
  label,
  options,
  selected,
  onToggle,
  hint,
  emptyText,
}: {
  label: string;
  options: readonly string[];
  selected: readonly string[];
  onToggle: (v: string) => void;
  hint?: string;
  emptyText?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.3 }}>{label}</Text>
      {options.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {options.map((o) => {
            const on = selected.includes(o);
            return (
              <Pressable
                key={o}
                onPress={() => onToggle(o)}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 30, borderRadius: 10, backgroundColor: on ? t.acGhost : t.bg3, borderWidth: on ? 1 : 0, borderColor: t.ac }, pressed && { opacity: 0.7 }]}
              >
                {on ? <Icons.check size={12} color={t.acTx} sw={3} /> : null}
                <Text numberOfLines={1} style={{ fontSize: 11.5, fontWeight: '600', color: on ? t.acTx : t.tx2, maxWidth: 150 }}>{o}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : <Text style={{ fontSize: 11.5, color: t.tx3 }}>{emptyText || '暂无可选项'}</Text>}
      {hint ? <Text style={{ fontSize: 11, color: t.tx3 }}>{hint}</Text> : null}
    </View>
  );
}

export interface SearchableOption {
  value: string;
  label: string;
  sub?: string;
  keywords?: string;
  disabled?: boolean;
}

/** 大列表的搜索单选/多选 Sheet；选项完全由调用方提供，不在组件内请求接口。 */
export function SearchableSelect({
  visible,
  title,
  options,
  selected,
  onChange,
  onClose,
  multiple = false,
  placeholder = '搜索名称或 ID',
  emptyText = '没有匹配项',
}: {
  visible: boolean;
  title: string;
  options: readonly SearchableOption[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
  onClose: () => void;
  multiple?: boolean;
  placeholder?: string;
  emptyText?: string;
}) {
  const t = useTheme();
  const [query, setQuery] = React.useState('');
  React.useEffect(() => { if (!visible) setQuery(''); }, [visible]);
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? options.filter((o) => `${o.label} ${o.value} ${o.sub || ''} ${o.keywords || ''}`.toLowerCase().includes(q)) : [...options];
    return rows.sort((a, b) => Number(selected.includes(b.value)) - Number(selected.includes(a.value)));
  }, [options, query, selected]);
  const pick = (value: string) => {
    if (multiple) onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
    else { onChange([value]); onClose(); }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.38)' }} onPress={onClose} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '82%', backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ flex: 1, color: t.tx, fontSize: 17, fontWeight: '800' }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={8}><Icons.plus size={20} color={t.tx2} sw={2} style={{ transform: [{ rotate: '45deg' }] }} /></Pressable>
        </View>
        <View style={{ height: 44, borderRadius: 13, backgroundColor: t.bg3, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginBottom: 10 }}>
          <Icons.search size={17} color={t.tx3} sw={2} />
          <TextInput autoFocus value={query} onChangeText={setQuery} placeholder={placeholder} placeholderTextColor={t.tx3} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, color: t.tx, fontSize: 14 }} />
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.value}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 16 }}
          renderItem={({ item }) => {
            const on = selected.includes(item.value);
            return <Pressable disabled={item.disabled} onPress={() => pick(item.value)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12, backgroundColor: on ? t.acGhost : 'transparent' }, pressed && { backgroundColor: t.bg3 }, item.disabled && { opacity: 0.45 }]}><View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: on ? t.acTx : t.tx, fontSize: 13.5, fontWeight: on ? '700' : '600' }}>{item.label}</Text>{item.sub || item.value !== item.label ? <Text numberOfLines={2} style={{ color: t.tx3, fontSize: 11, marginTop: 2, fontFamily: item.sub ? undefined : 'monospace' }}>{item.sub || item.value}</Text> : null}</View>{on ? <Icons.check size={17} color={t.acTx} sw={2.5} /> : null}</Pressable>;
          }}
          ListEmptyComponent={<Text style={{ color: t.tx3, textAlign: 'center', paddingVertical: 28 }}>{emptyText}</Text>}
        />
        {multiple ? <Pressable onPress={onClose} style={{ height: 46, borderRadius: 14, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.acInk, fontWeight: '800' }}>完成（{selected.length}）</Text></Pressable> : null}
      </View>
    </Modal>
  );
}

/** 详情键值行（可选等宽、可选强调色）。 */
export function DetailRow({ label, value, mono, color, multiline }: { label: string; value?: string | number | null; mono?: boolean; color?: string; multiline?: boolean }) {
  const t = useTheme();
  const text = value === undefined || value === null || value === '' ? '—' : String(value);
  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
      <Text style={{ width: 84, color: t.tx3, fontSize: 12 }}>{label}</Text>
      <Text selectable numberOfLines={multiline ? undefined : 2} style={{ flex: 1, color: color || t.tx, fontSize: 12.5, fontWeight: '500', ...(mono ? { fontFamily: 'monospace' } : {}) }}>{text}</Text>
    </View>
  );
}

/** 可折叠区块（详情里放大字段/高级选项）。 */
export function Collapsible({ title, children, defaultOpen }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const t = useTheme();
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
      <Pressable onPress={() => setOpen((v) => !v)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10 }, pressed && { opacity: 0.6 }]}>
        <Icons.chevron size={14} color={t.tx2} sw={2.2} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
        <Text style={{ fontSize: 12.5, fontWeight: '700', color: t.tx2 }}>{title}</Text>
      </Pressable>
      {open ? <View style={{ paddingBottom: 10 }}>{children}</View> : null}
    </View>
  );
}

/** 代码/JSON 块。 */
export function CodeBlock({ text, maxHeight }: { text: string; maxHeight?: number }) {
  const t = useTheme();
  return (
    <ScrollView style={{ maxHeight: maxHeight ?? 220, backgroundColor: t.termBg, borderRadius: 11 }} contentContainerStyle={{ padding: 11 }} nestedScrollEnabled>
      <Text selectable style={{ color: t.termTx, fontFamily: 'monospace', fontSize: 11, lineHeight: 17 }}>{text}</Text>
    </ScrollView>
  );
}

/** 小徽标。 */
export function Chip({ text, color, bg }: { text: string; color?: string; bg?: string }) {
  const t = useTheme();
  return <View style={{ borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: bg || t.bg3 }}><Text style={{ fontSize: 10.5, fontWeight: '600', color: color || t.tx2 }}>{text}</Text></View>;
}

/** 主操作按钮（实心强调色）。 */
export function PrimaryButton({ label, onPress, disabled, loading, icon }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean; icon?: 'plus' | 'check' | 'edit' }) {
  const t = useTheme();
  const I = icon === 'check' ? Icons.check : icon === 'edit' ? Icons.edit : icon === 'plus' ? Icons.plus : null;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [{ height: 46, borderRadius: 15, backgroundColor: t.ac, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, (pressed || disabled || loading) && { opacity: 0.65 }]}
    >
      {loading ? <ActivityIndicator color={t.acInk} /> : <>
        {I ? <I size={17} color={t.acInk} sw={2.2} /> : null}
        <Text style={{ color: t.acInk, fontSize: 14, fontWeight: '700' }}>{label}</Text>
      </>}
    </Pressable>
  );
}
