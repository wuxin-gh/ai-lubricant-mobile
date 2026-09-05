import type { ProjectTask } from '@/api/types';
import type { UserTaskSummary } from '@/api/task';
import { modelLabel } from '@/config';

/** token 数格式化：1234 -> 1.2k */
export function formatTokens(n?: number): string {
  if (!n || n <= 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** 剥离常见 Markdown 标记，取纯文本（对齐 Web stripMarkdown 的轻量版，不引入 remark）。 */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^(\*|-|\+)\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 任务展示名：与 Web getTaskDisplayName 一致 —— title > summary > 剥离 Markdown 的 content > 「新任务」。 */
export function taskDisplayName(task?: ProjectTask | UserTaskSummary | null, fallback = '新任务'): string {
  if (!task) return fallback;
  const title = (task as { title?: string }).title?.trim();
  if (title) return title;
  const summary = (task as { summary?: string }).summary?.trim();
  if (summary) return summary;
  const content = stripMarkdown(String((task as { content?: string }).content ?? ''));
  if (content) return content;
  return fallback;
}

/** Unix 秒时间戳 -> 相对时间（中文）。非正数（含 Go 零值时间 -62135596800）视为无效。 */
export function fromNow(unixSeconds?: number): string {
  if (!unixSeconds || unixSeconds <= 0) return '';
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - unixSeconds);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  if (diff < 86400 * 365) return `${Math.floor(diff / 86400 / 30)} 个月前`;
  return `${Math.floor(diff / 86400 / 365)} 年前`;
}

/** Unix 秒时间戳 -> YYYY-MM-DD HH:mm */
export function formatDateTime(unixSeconds?: number): string {
  if (!unixSeconds) return '';
  const d = new Date(unixSeconds * 1000);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 取模型展示名（与选择器一致：内置名翻译为 基础/专业/旗舰模型）。 */
export function modelDisplayName(model?: { model?: string; remark?: string }): string {
  return modelLabel(model);
}

/** 把 canonical Task 的 ISO 字符串/Unix 秒时间归一成 Unix 秒。 */
function toUnixSeconds(value?: string | number | null): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return value > 0 ? value : undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed / 1000 : undefined;
}

/** 任务卡片时间：canonical Task 用 completed_at/created_at（ISO 或 Unix 秒）。 */
export function taskTime(task?: ProjectTask | UserTaskSummary | null): string {
  if (!task) return '';
  const completed = toUnixSeconds((task as { completed_at?: string | number | null }).completed_at);
  const created = toUnixSeconds((task as { created_at?: string | number | null }).created_at);
  return fromNow(completed ?? created);
}
