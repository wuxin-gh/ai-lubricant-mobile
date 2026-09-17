/**
 * 系统内置环境（env_mode=system）的节点级资源客户端（对齐 Web
 * ``user-frontend/src/api/systemEnvClient.ts``）。
 *
 * 与 environment 的区别：共用环境按 env_id 寻址（用户建的命名环境），系统环境按
 * node_id 寻址 —— 它就是节点操作者的真实 HOME，一个节点只有一个，没有 env_id。
 *
 * 移动端本轮只做**读取**：创建任务选系统档时，把节点本机清单带进勾选页，让用户
 * 决定本次任务激活哪些（active_skills/active_plugins 子集）。装/卸/归档是 Web
 * 系统环境页的职责，手机不提供入口。
 */
import { request } from '@/api/client';

/** 一条节点本机 HOME 里观测到的资源。 */
export interface SystemEnvEntry {
  id: string;
  kind: 'skill' | 'plugin' | 'mcp';
  name: string;
  version: string;
  /**
   * 来自哪个 provider 的发现路径（声明方）：.claude/skills→claude、
   * .agents 树→空（无单一属主）、claude 插件→claude、MCP→声明它的那份编辑器
   * 配置（~/.mcp.json 也是 claude 的项目级配置）。
   */
  provider: string;
  /**
   * 会加载这条资源的编辑器集合（节点上报的事实，与运行时读取范围一致）。
   * 一条资源被多个编辑器读到就列多个 —— 勾选页据此按所选客户端过滤。
   */
  readers: string[];
  /** 相对 HOME 的路径，用来向用户解释这条资源来自哪里。 */
  path: string;
  /** 技能 SKILL.md frontmatter / 插件 manifest 里的描述；MCP 无，恒空。 */
  description: string;
  /** true = 平台装的（可卸载）；false = 节点操作者自有（只读）。 */
  platform_managed: boolean;
  /** 已归档进平台资源库时指向那条引用，用于展示「已入库」。 */
  archived_reference_id: string | null;
  reported_at: string | null;
}

export interface SystemEnvDetail {
  node_id: string;
  /** 节点是否开启系统内置环境；false 时清单必然为空。 */
  system_env_enabled: boolean;
  /** 节点当前是否在线；离线时清单是上次的快照。 */
  online: boolean;
  resources: Record<string, SystemEnvEntry[]>;
  last_reported_at: string | null;
}

/** 读已存的清单快照（不打节点，离线也能看到上次的结果）。 */
export async function getSystemEnv(nodeId: string): Promise<SystemEnvDetail> {
  const response = await request<SystemEnvDetail>(
    `/api/v1/teams/nodes/${encodeURIComponent(nodeId)}/system-env`,
  );
  return response.data as SystemEnvDetail;
}
