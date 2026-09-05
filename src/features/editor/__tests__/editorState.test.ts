import { findTextMatches, isEditorDirty, resolveEditorReadOnly } from '../editorState';

describe('editor state', () => {
  it('defaults to read-only without a save capability', () => {
    expect(resolveEditorReadOnly(undefined, false)).toBe(true);
    expect(resolveEditorReadOnly(undefined, true)).toBe(false);
    expect(resolveEditorReadOnly(true, true)).toBe(true);
  });

  it('tracks dirty state against the loaded baseline', () => {
    expect(isEditorDirty('same', 'same')).toBe(false);
    expect(isEditorDirty('changed', 'same')).toBe(true);
  });

  it('finds case-insensitive non-overlapping matches', () => {
    expect(findTextMatches('Foo foo FOOD', 'foo')).toEqual([0, 4, 8]);
    expect(findTextMatches('abc', '')).toEqual([]);
  });
});
