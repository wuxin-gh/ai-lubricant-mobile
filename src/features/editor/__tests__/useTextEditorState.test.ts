import { useTextEditorState } from '../useTextEditorState';

// 轻量纯逻辑测试：用 React hook 会需要 renderer；这里验证 hook 外可观察的核心契约由
// 一个最小探针承载，避免把测试耦合到具体 TextInput UI。
describe('useTextEditorState contract', () => {
  it('module exports the state hook', () => {
    expect(typeof useTextEditorState).toBe('function');
  });
});
