/**
 * Issue 详情用的轻量 Markdown 渲染。
 *
 * 复用 StreamBlocks 的样式口径（标题/列表/代码/引用），但不含 mermaid WebView 与
 * 流式节流 —— 那些是聊天流的专用能力，Issue 文档用不上，也不该为此背上依赖。
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Keyboard } from 'react-native';
import { useTheme, type Theme } from '@/theme';

function styles(t: Theme) {
  return {
    body: { color: t.tx, fontSize: 14.5, lineHeight: 23 },
    paragraph: { color: t.tx, fontSize: 14.5, lineHeight: 23, marginTop: 0, marginBottom: 8 },
    heading1: { color: t.tx, fontSize: 19, fontWeight: '700', marginVertical: 6 },
    heading2: { color: t.tx, fontSize: 16.5, fontWeight: '700', marginVertical: 5 },
    heading3: { color: t.tx, fontSize: 15, fontWeight: '700', marginVertical: 4 },
    strong: { color: t.tx, fontWeight: '700' },
    em: { color: t.tx, fontStyle: 'italic' },
    link: { color: t.acTx },
    bullet_list: { marginVertical: 4 },
    ordered_list: { marginVertical: 4 },
    list_item: { color: t.tx, marginVertical: 1 },
    code_inline: { color: t.acTx, backgroundColor: t.bg3, borderRadius: 5, paddingHorizontal: 5, fontFamily: 'monospace', fontSize: 13 },
    code_block: { color: t.termTx, backgroundColor: t.termBg, borderRadius: 11, padding: 12, fontFamily: 'monospace', fontSize: 12 },
    fence: { color: t.termTx, backgroundColor: t.termBg, borderRadius: 11, padding: 12, fontFamily: 'monospace', fontSize: 12 },
    blockquote: { backgroundColor: t.bg3, borderColor: t.line2, borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    hr: { backgroundColor: t.line2, height: 1 },
  } as const;
}

export function MarkdownView({ text, onCopy }: { text: string; onCopy?: (text: string) => void }) {
  const t = useTheme();
  if (!text?.trim()) return null;
  return (
    <Pressable onPress={() => Keyboard.dismiss()} onLongPress={() => onCopy?.(text)}>
      <Markdown style={styles(t) as never}>{text}</Markdown>
    </Pressable>
  );
}
