import type { IssueStatus, IssueType, ProjectIssue } from '@/api/types';

/** 与 monkeycode_compat.project_service._STATUS_LABELS 保持一致。 */
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  unassigned: '待分配',
  designing: '设计中',
  design_pending_confirmation: '设计待确认',
  design_confirmed: '设计已确认',
  developing: '开发中',
  diagnosing: '定位中',
  reason_pending_confirmation: '原因待确认',
  reason_confirmed: '原因已确认',
  fixing: '修复中',
  completed: '已完成',
  fixed: '已修复',
  closed: '已关闭',
};

export function issueTypeLabel(type?: IssueType) {
  return type === 'bug' ? 'Bug' : '需求';
}

export function issueStatusLabel(status?: string) {
  return (status && ISSUE_STATUS_LABELS[status as IssueStatus]) || status || '未知';
}

export function issuePriorityLabel(priority?: number) {
  if (priority === 3) return '高';
  if (priority === 1) return '低';
  return '中';
}

export function issueIsDone(issue: Pick<ProjectIssue, 'status'>) {
  return issue.status === 'completed' || issue.status === 'fixed' || issue.status === 'closed';
}

export function issueNeedsConfirmation(issue: Pick<ProjectIssue, 'status'>) {
  return issue.status === 'design_pending_confirmation' || issue.status === 'reason_pending_confirmation';
}

/** 人工可切换的状态集合，按类型取双状态线（与 Web issue-meta 一致）。 */
export function statusOptionsForType(type?: string): { value: string; label: string }[] {
  const keys = type === 'bug'
    ? ['unassigned', 'diagnosing', 'reason_pending_confirmation', 'reason_confirmed', 'fixing', 'fixed', 'closed']
    : ['unassigned', 'designing', 'design_pending_confirmation', 'design_confirmed', 'developing', 'completed', 'closed'];
  return keys.map((k) => ({ value: k, label: ISSUE_STATUS_LABELS[k as IssueStatus] || k }));
}
