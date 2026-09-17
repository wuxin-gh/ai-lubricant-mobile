/**
 * 第一步「环境资源」区：MCP / 技能 / 插件三 tab 的卡片列表。
 *
 * 按档位语义不同（对齐 Web EnvironmentResourceTabs）：
 * - ``isolated``：卡片 = 本次任务已添加的集合，带勾选框（取消 = 本次不用）；
 *   右上「添加」从资源中心选。
 * - ``shared`` / ``system``：卡片 = 环境已装/本机已有的资源，勾选 = **本次激活**
 *   （不勾的本次不启用，但环境文件不动）。手机不提供往环境里装/卸的入口。
 *
 * 勾选状态由父层持有（``active``），卡片本身只读。
 */
import React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';
import type { ResourceItem } from '@/features/task/taskCreateModel';

export type ResourceKind = 'skill' | 'plugin' | 'mcp';

const KIND_TABS: { value: ResourceKind; label: string }[] = [
  { value: 'skill', label: '技能' },
  { value: 'plugin', label: '插件' },
  { value: 'mcp', label: 'MCP' },
];

export function EnvResourcePanel({
  entries,
  active,
  kind,
  onKindChange,
  onToggle,
  selectable,
  emptyText,
  addLabel,
  onAdd,
  onRemove,
  hint,
}: {
  entries: Record<ResourceKind, ResourceItem[]>;
  /** 各 kind 已勾选的环境卡片 id（shared/system 档的激活子集）。 */
  active: Record<ResourceKind, Set<string>>;
  kind: ResourceKind;
  onKindChange: (kind: ResourceKind) => void;
  onToggle: (id: string) => void;
  /** 是否渲染勾选框：isolated 档展示集=已添加集，没有勾选语义，传 false。 */
  selectable: boolean;
  emptyText: string;
  /** 传了才渲染右上按钮（isolated=「添加」，shared/system 不提供）。 */
  addLabel?: string;
  onAdd?: () => void;
  onRemove?: (item: ResourceItem) => void;
  hint?: string;
}) {
  const t = useTheme();
  const items = entries[kind];
  const activeIds = active[kind];

  return (
    <View style={{ borderRadius: 16, backgroundColor: t.bg2, padding: 13, ...t.shCard }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', gap: 6, flex: 1 }}>
          {KIND_TABS.map((tab) => {
            const on = tab.value === kind;
            const count = entries[tab.value].length;
            return (
              <Pressable
                key={tab.value}
                onPress={() => onKindChange(tab.value)}
                style={({ pressed }) => [{
                  paddingHorizontal: 11, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: on ? t.ac : t.bg3,
                }, pressed && { opacity: 0.75 }]}
              >
                <Text style={{ fontSize: 11.5, fontWeight: '700', color: on ? t.acInk : t.tx2 }}>
                  {tab.label}{count ? ` ${count}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {addLabel && onAdd ? (
          <Pressable
            onPress={onAdd}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, height: 30, borderRadius: 10, backgroundColor: t.acGhost }, pressed && { opacity: 0.75 }]}
          >
            <Icons.plus size={13} color={t.acTx} sw={2.4} />
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: t.acTx }}>{addLabel}</Text>
          </Pressable>
        ) : null}
      </View>

      {hint ? <Text style={{ fontSize: 11, color: t.tx3, lineHeight: 16, marginBottom: 9 }}>{hint}</Text> : null}

      {items.length === 0 ? (
        <Text style={{ color: t.tx3, fontSize: 12, textAlign: 'center', paddingVertical: 20 }}>{emptyText}</Text>
      ) : (
        <FlatList
          data={items}
          scrollEnabled={false}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => {
            const id = String(item.id);
            const checked = activeIds.has(id);
            return (
              <Pressable
                disabled={!selectable}
                onPress={() => onToggle(id)}
                style={({ pressed }) => [{
                  flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 8, paddingHorizontal: 11,
                  borderRadius: 12, borderWidth: 1.5, borderColor: checked ? t.ac : t.line2,
                  backgroundColor: checked ? t.acGhost : t.bg3, marginBottom: 7,
                }, pressed && { opacity: 0.75 }]}
              >
                {selectable ? (
                  <View style={{
                    width: 18, height: 18, borderRadius: 6, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center',
                    borderColor: checked ? t.ac : t.line2, backgroundColor: checked ? t.ac : 'transparent',
                  }}>
                    {checked ? <Icons.check size={11} color={t.acInk} sw={3.2} /> : null}
                  </View>
                ) : (
                  <Icons.sparkle size={14} color={t.acTx} sw={1.8} />
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: t.tx, fontSize: 13.5, fontWeight: '600' }}>
                    {item.display_name || item.name || id}
                  </Text>
                  {item.description || item.__badge ? (
                    <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11, marginTop: 2 }}>
                      {[item.__badge, item.description].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                </View>
                {onRemove && !item.__badge?.startsWith('本机已有') ? (
                  <Pressable onPress={() => onRemove(item)} hitSlop={8} style={{ padding: 4 }}>
                    <Icons.trash size={14} color={t.tx3} sw={1.9} />
                  </Pressable>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
