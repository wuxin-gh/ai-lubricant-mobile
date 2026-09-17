/**
 * 执行节点选择（底部 sheet）。
 *
 * 对齐 Web 的 NodeTree 语义：管理节点只作**可折叠分组父行**（永远不可选，只提供
 * 归属上下文），执行节点才是可选项；不可选的执行节点仍然显示，但禁用并标注原因
 * （离线 / 容量已满 / 未开启系统环境 / 未安装所选客户端）——「列表里没有」和
 * 「为什么没有」对用户是两件事。
 *
 * 手机没有树控件，这里用「分组父行 + 子行」的扁平列表还原同样的信息层级（与
 * app/nodes/index.tsx 的用户侧节点页同一套渲染思路）。
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';
import { nodeUnusableReason } from '@/features/task/nodeHealth';
import type { Node } from '@/api/types';

type Row =
  | { kind: 'header'; node: Node; count: number; collapsed: boolean }
  | { kind: 'exec'; node: Node; reason: string };

function nodeSubtitle(node: Node): string {
  const caps = (node.capabilities || {}) as { os?: string; arch?: string; client_version?: string };
  const parts = [caps.os, caps.arch].filter(Boolean).join('/');
  const version = caps.client_version ? `v${String(caps.client_version).replace(/^v/i, '')}` : '';
  const sessions = node.active_sessions != null ? `${node.active_sessions} 会话` : '';
  return [parts, version, sessions].filter(Boolean).join(' · ');
}

export function NodePickerSheet({
  visible,
  nodes,
  value,
  provider,
  requireSystemEnv,
  onPick,
  onClose,
}: {
  visible: boolean;
  nodes: Node[];
  value: string;
  provider: string;
  /** 系统内置档要求节点开启该模式：未开启的禁用并标注。 */
  requireSystemEnv: boolean;
  onPick: (nodeId: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      if (node.node_role === 'management' || node.node_role === 'passive_management') {
        const id = node.node_id || '';
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          kind: 'header',
          node,
          count: nodes.filter((n) => n.manager_node_id === id && n.node_role !== 'management').length,
          collapsed: collapsed.has(id),
        });
        continue;
      }
      out.push({ kind: 'exec', node, reason: nodeUnusableReason(node, provider, requireSystemEnv) });
    }
    return out;
  }, [nodes, collapsed, provider, requireSystemEnv]);

  const usable = rows.some((row) => row.kind === 'exec' && !row.reason);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.38)' }} onPress={onClose} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '82%', backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, marginBottom: 6 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.tx, fontSize: 17, fontWeight: '800' }}>选择执行节点</Text>
            <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 3 }}>
              选中的节点跑本次任务；不可用原因标注在行内。
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8}>
            <Icons.x size={19} color={t.tx2} sw={2.1} />
          </Pressable>
        </View>
        <FlatList
          data={rows}
          keyExtractor={(row, index) => row.node.node_id || `row-${index}`}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 28, paddingTop: 6 }}
          ListEmptyComponent={
            <Text style={{ color: t.tx3, textAlign: 'center', paddingVertical: 30, fontSize: 13 }}>
              暂无可用节点，请联系管理员分配。
            </Text>
          }
          ListFooterComponent={usable ? null : (
            <Text style={{ color: t.tx3, textAlign: 'center', paddingVertical: 14, fontSize: 11.5 }}>
              当前没有可用节点{requireSystemEnv ? '（系统内置档要求节点开启该模式）' : ''}。
            </Text>
          )}
          renderItem={({ item }) => {
            if (item.kind === 'header') {
              return (
                <Pressable
                  onPress={() => setCollapsed((prev) => {
                    const next = new Set(prev);
                    const id = item.node.node_id || '';
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                  })}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 13, backgroundColor: t.bg3, marginTop: 10 }}
                >
                  <Icons.server size={16} color={t.tx2} sw={1.9} />
                  <Text numberOfLines={1} style={{ flex: 1, color: t.tx, fontSize: 13.5, fontWeight: '700' }}>
                    {item.node.node_name || item.node.node_id}
                  </Text>
                  <Text style={{ color: t.tx3, fontSize: 11 }}>{item.count} 个执行节点</Text>
                  <Icons.chevron size={14} color={t.tx3} style={{ transform: [{ rotate: item.collapsed ? '0deg' : '90deg' }] }} />
                </Pressable>
              );
            }
            const { node, reason } = item;
            const disabled = Boolean(reason);
            const on = node.node_id === value;
            return (
              <Pressable
                disabled={disabled}
                onPress={() => { if (node.node_id) { onPick(node.node_id); onClose(); } }}
                style={({ pressed }) => [{
                  flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 54, paddingVertical: 10, paddingHorizontal: 12,
                  borderRadius: 14, borderWidth: 1.5, borderColor: on ? t.ac : t.line2,
                  backgroundColor: on ? t.acGhost : t.bg2, marginTop: 8,
                }, pressed && { opacity: 0.75 }, disabled && { opacity: 0.45 }]}
              >
                <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: reason ? t.track : t.add }} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14, fontWeight: '700' }}>
                    {node.node_name || node.node_id}
                  </Text>
                  <Text numberOfLines={1} style={{ color: disabled ? t.red : t.tx3, fontSize: 11, marginTop: 3 }}>
                    {disabled ? `不可选 · ${reason}` : nodeSubtitle(node) || '在线'}
                  </Text>
                </View>
                {on ? <Icons.check size={17} color={t.acTx} sw={2.5} /> : null}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}
