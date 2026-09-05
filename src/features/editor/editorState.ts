/** 纯函数版编辑器状态，供 hook 与单测共用。 */
export function findTextMatches(text: string, query: string): number[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const out: number[] = [];
  const hay = text.toLowerCase();
  let from = 0;
  while (from < hay.length) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    out.push(i);
    from = i + Math.max(1, needle.length);
  }
  return out;
}

export function isEditorDirty(text: string, baseline: string): boolean {
  return text !== baseline;
}

export function resolveEditorReadOnly(readOnly: boolean | undefined, hasSaveFile: boolean): boolean {
  return readOnly ?? !hasSaveFile;
}
