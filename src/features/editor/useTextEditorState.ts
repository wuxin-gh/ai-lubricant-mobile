/**
 * 轻量文本编辑状态。
 *
 * 当前公开 workspace API 只有 GET，所以默认 `readOnly=true`，保存按钮隐藏。
 * `saveFile(expectedRevision)` 是未来后端提供带 SHA/mtime 冲突检测 PUT 后的边界；调用者
 * 未传 save 时绝不本地假保存。dirty 状态、搜索与离开确认已完整实现并可单测。
 */
import { useCallback, useMemo, useState } from 'react';
import { findTextMatches, isEditorDirty, resolveEditorReadOnly } from './editorState';

export interface SaveFileInput {
  content: string;
  expectedRevision?: string;
}

export interface TextEditorOptions {
  initialText: string;
  expectedRevision?: string;
  readOnly?: boolean;
  saveFile?: (input: SaveFileInput) => Promise<{ revision?: string }>;
}

export function useTextEditorState(options: TextEditorOptions) {
  const [baseline, setBaseline] = useState(options.initialText);
  const [text, setText] = useState(options.initialText);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(options.expectedRevision);
  const readOnly = resolveEditorReadOnly(options.readOnly, !!options.saveFile);
  const dirty = isEditorDirty(text, baseline);

  const matches = useMemo(() => findTextMatches(text, query), [query, text]);

  const save = useCallback(async () => {
    if (readOnly || !dirty || !options.saveFile || saving) return false;
    setSaving(true);
    try {
      const r = await options.saveFile({ content: text, expectedRevision: revision });
      setBaseline(text);
      if (r.revision) setRevision(r.revision);
      return true;
    } finally {
      setSaving(false);
    }
  }, [dirty, options, readOnly, revision, saving, text]);

  const reset = useCallback(() => setText(baseline), [baseline]);

  return { text, setText, query, setQuery, matches, dirty, readOnly, saving, revision, save, reset };
}
