/**
 * 用户侧任务环境 API（对齐 Web ``user-frontend/src/api/environmentClient.ts``）。
 *
 * 环境是创建任务前先选的东西：它决定编辑器跑在哪个 HOME 上，共用档还带一套可复用
 * 的 skill/MCP/插件配置。只有共用档有记录 —— 系统档用节点操作者的真实 HOME、隔离档
 * 是每次一次性的初始环境，都由档位名直接解析，没有可管理的东西。
 *
 * 移动端本轮只做**读取**（创建任务时选环境、把环境自带资源带进勾选页）。往环境里
 * 装/卸资源是 Web 环境页的职责，手机不提供入口 —— 所以这里没有 add/remove/sync。
 *
 * 两个真相源：``resources`` 是用户配的期望状态，``extras`` 是节点回报磁盘上有、但
 * 配置里没有的（多半是从维护终端手装的）。服务端已经把两边 diff 好，每条带 state。
 */
import { request } from '@/api/client';

/** 环境档位：系统内置 / 隔离 / 共用。空视为隔离（初始环境）。 */
export type EnvTier = 'system' | 'isolated' | 'shared';

/** 环境里一条配置的资源，state 已由服务端与节点清单 diff 得出。 */
export interface EnvResource {
  id: string;
  kind: 'skill' | 'mcp' | 'plugin';
  resource_id: string;
  name: string;
  version: string;
  /**
   * installed=节点上已装；pending=已配置但节点还没装（改完没同步/节点离线）；
   * config=MCP，不是文件所以无所谓装没装，每个任务用自己的 token 现取。
   */
  state?: 'installed' | 'pending' | 'config';
  installed_version?: string;
}

/** 节点上有、配置里没有的条目（手动装的），只展示不自动删。 */
export interface EnvExtra {
  kind: string;
  name: string;
  version: string;
  state: 'extra';
}

export interface TaskEnvironment {
  id: string;
  name: string;
  description?: string | null;
  node_id: string;
  revision: number;
  synced_revision: number;
  /** 配置改了还没同步到节点。改完/节点离线时为 true。 */
  needs_sync: boolean;
  last_synced_at?: string | null;
  last_sync_error?: string | null;
}

export interface TaskEnvironmentDetail extends TaskEnvironment {
  resources: EnvResource[];
  extras: EnvExtra[];
}

const BASE = '/api/v1/teams/environments';

/** 我的共用环境；传 nodeId 只看该节点上的。 */
export async function listEnvironments(nodeId?: string): Promise<TaskEnvironment[]> {
  const response = await request<{ environments?: TaskEnvironment[] }>(BASE, {
    query: nodeId ? { node_id: nodeId } : undefined,
  });
  return response.data?.environments ?? [];
}

/** 环境 + 配置资源 + 节点清单（已 diff）。 */
export async function getEnvironment(envId: string): Promise<TaskEnvironmentDetail> {
  const response = await request<TaskEnvironmentDetail>(`${BASE}/${encodeURIComponent(envId)}`);
  return response.data as TaskEnvironmentDetail;
}

/** 新建共用环境（id 由数据库生成）。 */
export async function createEnvironment(payload: {
  node_id: string;
  name: string;
  description?: string;
}): Promise<TaskEnvironment> {
  const response = await request<TaskEnvironment>(BASE, { method: 'POST', body: payload });
  return response.data as TaskEnvironment;
}
