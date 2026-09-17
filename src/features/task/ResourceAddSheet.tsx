/**
 * 隔离档「添加资源」弹框：从当前用户**有权使用**的引用清单里选。
 *
 * 集合容器（技能集 / 插件容器）先展开子技能勾选面板，确认后只把勾中的子技能加进
 * 任务——与 Web ResourceCenterAddDialog 的 collectEntries 语义一致。非集合行直接
 * 加入。
 *
 * 候选来源是授权可见的引用（旧表 effective + 新表 v2 映射行），所以这里选出来的
 * 一定过得了服务端的授权校验。
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';
import { collectionEntryNames, toResourceItems, type ReferenceLike, type ResourceItem } from '@/features/task/taskCreateModel';

export function ResourceAddSheet({
  visible,
  title,
  rows,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  rows: ReferenceLike[];
  /** 非集合行传单个 item；集合行在确认子技能后传展开出的多个 item。 */
  onPick: (items: ResourceItem[]) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState<{ row: ReferenceLike; checked: Set<string> } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => [row.name, row.display_name, row.version]
      .some((value) => String(value || '').toLowerCase().includes(q)));
  }, [rows, query]);

  const close = () => { setQuery(''); setPicking(null); onClose(); };

  const choose = (row: ReferenceLike) => {
    const names = collectionEntryNames(row);
    if (names) {
      setPicking({ row, checked: new Set(names) });
      return;
    }
    onPick(toResourceItems([row]));
    close();
  };

  // ── 子技能勾选面板（集合容器行）────────────────────────────────────────────
  if (picking) {
    const names = collectionEntryNames(picking.row) || [];
    const toggle = (name: string) => setPicking((cur) => {
      if (!cur) return cur;
      const next = new Set(cur.checked);
      if (next.has(name)) next.delete(name); else next.add(name);
      return { ...cur, checked: next };
    });
    const confirm = () => {
      const items = toResourceItems([picking.row]).filter(
        (item) => picking.checked.has(String(item.resource_entry || '')),
      );
      if (items.length) onPick(items);
      close();
    };
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.38)' }} onPress={close} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%', backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Pressable onPress={() => setPicking(null)} hitSlop={8} style={{ padding: 4, marginRight: 6 }}>
              <Icons.chevron size={16} color={t.acTx} sw={2.4} style={{ transform: [{ rotate: '180deg' }] }} />
            </Pressable>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: t.tx, fontSize: 16, fontWeight: '800' }}>
                {picking.row.display_name || picking.row.name}
              </Text>
              <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 2 }}>
                勾选本次任务要用的子技能（已选 {picking.checked.size}/{names.length}）
              </Text>
            </View>
            <Pressable onPress={close} hitSlop={8}><Icons.x size={18} color={t.tx2} sw={2.1} /></Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
            <Pressable
              onPress={() => setPicking((cur) => cur && { ...cur, checked: new Set(names) })}
              style={{ paddingHorizontal: 12, height: 30, borderRadius: 10, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: t.tx2 }}>全选</Text>
            </Pressable>
            <Pressable
              onPress={() => setPicking((cur) => cur && { ...cur, checked: new Set() })}
              style={{ paddingHorizontal: 12, height: 30, borderRadius: 10, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: t.tx2 }}>清空</Text>
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingBottom: 8 }}>
            {names.map((name) => {
              const on = picking.checked.has(name);
              return (
                <Pressable
                  key={name}
                  onPress={() => toggle(name)}
                  style={({ pressed }) => [{
                    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 11,
                    borderRadius: 12, backgroundColor: on ? t.acGhost : t.bg3, marginBottom: 6,
                  }, pressed && { opacity: 0.75 }]}
                >
                  <View style={{
                    width: 18, height: 18, borderRadius: 6, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center',
                    borderColor: on ? t.ac : t.line2, backgroundColor: on ? t.ac : 'transparent',
                  }}>
                    {on ? <Icons.check size={11} color={t.acInk} sw={3.2} /> : null}
                  </View>
                  <Text numberOfLines={1} style={{ flex: 1, color: t.tx, fontSize: 13 }}>{name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            onPress={confirm}
            disabled={picking.checked.size === 0}
            style={({ pressed }) => [{ height: 46, borderRadius: 14, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center', marginTop: 6 }, (pressed || picking.checked.size === 0) && { opacity: 0.5 }]}
          >
            <Text style={{ color: t.acInk, fontWeight: '800', fontSize: 14 }}>
              添加（{picking.checked.size}）
            </Text>
          </Pressable>
        </View>
      </Modal>
    );
  }

  // ── 候选列表 ──────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.38)' }} onPress={close} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '82%', backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.tx, fontSize: 17, fontWeight: '800' }}>{title}</Text>
            <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 3 }}>只列出你有权使用的资源</Text>
          </View>
          <Pressable onPress={close} hitSlop={8}><Icons.x size={19} color={t.tx2} sw={2.1} /></Pressable>
        </View>
        <View style={{ height: 44, borderRadius: 13, backgroundColor: t.bg3, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginBottom: 10 }}>
          <Icons.search size={17} color={t.tx3} sw={2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索名称"
            placeholderTextColor={t.tx3}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, color: t.tx, fontSize: 14 }}
          />
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(row) => String(row.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 20 }}
          ListEmptyComponent={
            <Text style={{ color: t.tx3, textAlign: 'center', paddingVertical: 30, fontSize: 13 }}>
              没有可用资源。请先在资源中心引用并授权给分组。
            </Text>
          }
          renderItem={({ item }) => {
            const entries = collectionEntryNames(item);
            return (
              <Pressable
                onPress={() => choose(item)}
                style={({ pressed }) => [{
                  flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, paddingVertical: 10, paddingHorizontal: 12,
                  borderRadius: 13, backgroundColor: t.bg3, marginBottom: 7,
                }, pressed && { opacity: 0.75 }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14, fontWeight: '600' }}>
                    {item.display_name || item.name}
                  </Text>
                  <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11, marginTop: 2 }}>
                    {entries ? `集合 · ${entries.length} 项` : item.version ? `v${item.version}` : '单条资源'}
                  </Text>
                </View>
                <Icons.chevron size={15} color={t.tx3} />
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}
