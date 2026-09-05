import { taskDisplayName } from '../format';
import type { UserTaskSummary } from '@/api/task';

function task(overrides: Partial<UserTaskSummary> = {}): UserTaskSummary {
  return {
    id: 'task-1',
    kind: 'develop',
    content: '',
    status: 'pending',
    provider: 'claude',
    ...overrides,
  };
}

describe('taskDisplayName（对齐 Web getTaskDisplayName）', () => {
  it('prefers title over summary and content', () => {
    expect(taskDisplayName(task({ title: '标题', summary: '摘要', content: '内容' }))).toBe('标题');
  });

  it('falls back to summary when title is empty', () => {
    expect(taskDisplayName(task({ title: ' ', summary: '摘要', content: '内容' }))).toBe('摘要');
  });

  it('uses markdown-stripped content when title and summary are empty', () => {
    expect(taskDisplayName(task({ content: '## 实现登录页\n\n支持**手机号**与邮箱登录' }))).toBe('实现登录页 支持手机号与邮箱登录');
    expect(taskDisplayName(task({ content: '开发一个 `贪吃蛇` 小游戏' }))).toBe('开发一个 贪吃蛇 小游戏');
  });

  it('shows 新任务 like the web fallback when everything is empty', () => {
    expect(taskDisplayName(task())).toBe('新任务');
    expect(taskDisplayName(null)).toBe('新任务');
  });
});
