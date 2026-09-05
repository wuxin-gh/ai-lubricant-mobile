/**
 * 领域类型 —— 移动端实际用到的后端 JSON 形状子集。
 * 字段命名与后端 JSON 保持一致。
 */

export type TaskStatus = 'pending' | 'processing' | 'error' | 'finished';
export type TaskType = 'develop' | 'design' | 'review';

export interface ApiEnvelope<T = unknown> {
  code: number;
  message?: string;
  data?: T;
}

export interface ModelBrief {
  id?: string;
  model?: string;
  remark?: string;
  provider?: string;
}

export interface TaskStats {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  llm_requests?: number;
}

/** 开发环境（VM）准备过程中的条件，task.virtualmachine.conditions 取最后一项作当前状态。 */
export type ConditionType =
  | 'Scheduled' | 'ImagePulled' | 'ProjectCloned' | 'ImageBuilt'
  | 'ContainerCreated' | 'ContainerStarted' | 'Ready' | 'Failed';
export interface Condition {
  type?: ConditionType;
  status?: number; // 0 未知 / 1 进行中 / 2 完成 / 3 失败
  reason?: string;
  message?: string;
  progress?: number; // 0-100
  last_transition_time?: number;
}

export interface ProjectTask {
  id: string;
  title?: string;
  content?: string;
  summary?: string;
  status?: TaskStatus;
  type?: TaskType;
  sub_type?: string;
  cli_name?: string;
  repo_url?: string;
  repo_filename?: string;
  branch?: string;
  full_name?: string;
  project_id?: string;
  model?: ModelBrief;
  stats?: TaskStats;
  virtualmachine?: { id?: string; conditions?: Condition[] };
  created_at?: number;
  completed_at?: number;
}

export interface Project {
  id?: string;
  name?: string;
  description?: string;
  full_name?: string;
  repo_url?: string;
  platform?: string;
  auto_review_enabled?: boolean;
  created_at?: number;
  updated_at?: number;
  tasks?: ProjectTask[];
  issues?: { id?: string; status?: string }[];
}

export interface PageInfo {
  page?: number;
  size?: number;
  total?: number;
  total_count?: number;
  has_next_page?: boolean;
}

export interface ListTaskResp {
  tasks?: ProjectTask[];
  page_info?: PageInfo;
}

export interface ListProjectResp {
  projects?: Project[];
  page?: { has_more?: boolean };
}

/** 任务对话的原始事件块（rounds 接口返回）。data 为 base64 字符串。
 *  注：后端未实现 /tasks/rounds，移动端任务详情已移除对话历史；此类型保留给
 *  messages/handler 解码器沿用，待后端补齐后可直接复用。 */
export interface TaskChunkEntry {
  event?: string;
  kind?: string;
  data?: string;
  labels?: Record<string, string>;
  timestamp?: number;
}

export interface UserStatus {
  id?: string;
  name?: string;
  username?: string;
  email?: string;
  avatar?: string;
  avatar_url?: string;
  role?: string;
  team?: { id?: string; name?: string };
}

export type OwnerType = 'private' | 'public' | 'team';

export interface Model {
  id?: string;
  model?: string;
  remark?: string;
  provider?: string;
  is_default?: boolean;
  is_free?: boolean;
  is_hidden?: boolean;
  access_level?: string;
  weight?: number;
  owner?: { id?: string; name?: string; type?: OwnerType };
  /** 以下字段仅自有模型（owner.type === 'private'）返回，共享模型会被后端脱敏 */
  base_url?: string;
  api_key?: string;
  interface_type?: ModelInterfaceType;
  context_limit?: number;
  output_limit?: number;
  thinking_enabled?: boolean;
  support_image?: boolean;
}

export type ModelInterfaceType = 'openai_chat' | 'openai_responses' | 'anthropic';

/** 创建自有模型请求体（对齐后端 DomainCreateModelReq） */
export interface CreateModelReq {
  provider: string;
  model: string;
  base_url: string;
  api_key: string;
  interface_type: ModelInterfaceType;
  remark?: string;
  context_limit?: number;
  output_limit?: number;
  thinking_enabled?: boolean;
  support_image?: boolean;
  is_default?: boolean;
}

/** 模型健康检查结果（DomainCheckModelResp） */
export interface CheckModelResp {
  success?: boolean;
  error?: string;
}

/** 更新自有模型请求体（对齐后端 DomainUpdateModelReq，字段均可选） */
export type UpdateModelReq = Partial<CreateModelReq>;

/** 供应商可用模型项（DomainProviderModelListItem） */
export interface ProviderModelItem {
  model?: string;
}

export interface Skill {
  id?: string;
  skill_id?: string;
  name?: string;
  description?: string;
  tags?: string[];
}

/**
 * 执行节点（agent-compose）。任务运行时已从 host+image 改为节点：
 * 建任务时从 ``/api/v1/teams/my-nodes`` 拉取用户所属分组绑定的节点，挑一个传 ``node_id``。
 * 字段取后端 nodes_service._binding_dict 输出的子集。
 */
export interface Node {
  node_id?: string;
  node_name?: string;
  /** execution | management | passive_management */
  node_role?: string;
  /** 纯分组容器（无客户端），不可作为执行节点。 */
  is_passive?: boolean;
  /** live daemon 状态：online / offline / unknown 等。 */
  status?: string;
  /** live daemon 是否在线。 */
  connected?: boolean;
  manager_node_id?: string;
  /** 当前正在运行的会话数（用于展示占用情况）。 */
  active_sessions?: number;
  group_id?: string;
}

/** Git 平台类型（对齐后端 consts.GitPlatform）。internal 为系统内部身份，不对用户展示。 */
export type GitPlatform = 'github' | 'gitlab' | 'gitea' | 'gitee' | 'codeup' | 'cnb' | 'atomgit' | 'internal';

/** Git 身份有权限访问的仓库（git-identities 详情接口返回）。 */
export interface AuthRepository {
  url?: string;
  full_name?: string;
  description?: string;
}

/** Git 身份凭证（对齐后端 domain.GitIdentity）。 */
export interface GitIdentity {
  id?: string;
  platform?: GitPlatform;
  base_url?: string;
  username?: string;
  email?: string;
  access_token?: string;
  remark?: string;
  organization_id?: string;
  /** true 表示通过 GitHub App 安装绑定（无需手动 token，编辑时隐藏 token 字段） */
  is_installation_app?: boolean;
  created_at?: string;
  /** 仅 git-identities 详情接口返回：该身份有权访问的仓库列表 */
  authorized_repositories?: AuthRepository[];
}

/** 添加 Git 身份请求体（对齐后端 domain.AddGitIdentityReq）。 */
export interface AddGitIdentityReq {
  platform: GitPlatform;
  base_url: string;
  access_token: string;
  username: string;
  email: string;
  remark?: string;
  organization_id?: string;
}

/** 更新 Git 身份请求体（对齐后端 domain.UpdateGitIdentityReq，字段均可选，只传需变更的）。 */
export interface UpdateGitIdentityReq {
  platform?: GitPlatform;
  base_url?: string;
  access_token?: string;
  username?: string;
  email?: string;
  remark?: string;
  organization_id?: string;
}

/** 创建项目请求体（对齐后端 domain.CreateProjectReq，移动端用到的子集）。 */
export interface CreateProjectReq {
  name?: string;
  description?: string;
  platform?: GitPlatform;
  git_identity_id?: string;
  repo_url?: string;
}

/** 创建任务请求体（对齐后端 CreateTaskReq：运行时为 agent-compose 节点）。 */
export interface CreateTaskReq {
  content: string;
  cli_name: string;
  model_id: string;
  /** agent-compose 执行节点 id（来自 /api/v1/teams/my-nodes）。 */
  node_id: string;
  task_type: TaskType;
  repo: { repo_url?: string; branch?: string; zip_url?: string; repo_filename?: string };
  resource: { core: number; memory: number; life: number };
  extra?: { skill_ids?: string[]; project_id?: string; issue_id?: string };
  git_identity_id?: string;
}

/** Issue 类型：需求 / bug */
export type IssueType = 'requirement' | 'bug';

/** Issue 状态（对齐后端 ISSUE_TRANSITIONS 双状态线）。 */
export type IssueStatus =
  | 'unassigned'
  | 'designing' | 'design_pending_confirmation' | 'design_confirmed'
  | 'developing'
  | 'diagnosing' | 'reason_pending_confirmation' | 'reason_confirmed'
  | 'fixing'
  | 'completed' | 'fixed' | 'closed';

/** Issue 优先级：1=低 / 2=中 / 3=高 */
export type IssuePriority = 1 | 2 | 3;

/** 需求/bug（对齐后端 _issue_dict 输出）。 */
export interface ProjectIssue {
  id?: string;
  user_id?: string;
  project_id?: string;
  /** 后端 JSON 字段名为 ``type``（值 requirement | bug）。 */
  type?: IssueType;
  status?: IssueStatus;
  title?: string;
  /** 需求文档 / bug 描述 */
  requirement_document?: string;
  design_document?: string;
  bug_reason?: string;
  resolution_note?: string;
  summary?: string;
  /** 待定项数组（后端 JSONField，默认 []）。 */
  pending_items?: Array<{ id?: string; content?: string; status?: string }>;
  priority?: IssuePriority;
  assignee_id?: string;
  /** 标签数组（后端 JSONField，默认 []）。 */
  tags?: string[];
  created_at?: number;
  updated_at?: number;
  closed_at?: number;
}

/** 创建 Issue 请求体（对齐后端 CreateProjectIssueReq：assignee_id 必填）。 */
export interface CreateIssueReq {
  type: IssueType;
  title: string;
  requirement_document: string;
  priority: IssuePriority;
  /** 分配者，后端要求必填，缺失会 400「请选择分配者」。 */
  assignee_id: string;
  tags?: string[];
  design_document?: string;
}

/** 更新 Issue 字段（对齐后端 UpdateIssueReq）。 */
export interface UpdateIssueReq {
  title?: string;
  status?: IssueStatus;
  requirement_document?: string;
  design_document?: string;
  bug_reason?: string;
  resolution_note?: string;
  summary?: string;
  assignee_id?: string;
  priority?: IssuePriority;
  tags?: string[];
}

/** Issue 评论（对齐后端 _comment_dict）。 */
export interface ProjectIssueComment {
  id?: string;
  user_id?: string;
  issue_id?: string;
  parent_id?: string | null;
  comment?: string;
  created_at?: number;
  updated_at?: number;
}

/** 团队成员条目（对齐后端 list_all_users 输出的 user 子对象）。 */
export interface TeamUser {
  id: string;
  name?: string;
  username?: string;
  email?: string;
  avatar?: string;
  avatar_url?: string;
  role?: string;
  is_admin?: boolean;
  is_first_admin?: boolean;
  created_at?: number;
  last_active_at?: number;
}

/** Issue 列表响应（对齐后端 project_service.list_project_issues）。 */
export interface ListIssuesResp {
  issues?: ProjectIssue[];
}

/** Issue 分配请求体（对齐后端 canonical Task runtime 字段）。 */
export interface AssignIssueReq {
  cli_name: 'claude' | 'codex' | 'opencode' | 'cursor';
  model_id: string;
  node_id: string;
  parent_api_key_id: number;
  content?: string;
  task_role?: string;
  task_type?: string;
  sub_type?: string;
  mode?: string;
  git_identity_id?: string;
  branch?: string;
  usage_limit?: { max_requests?: number; max_total_tokens?: number };
  expires_at?: number;
  expected_client_id?: string;
  bootstrap_content?: string;
  skill_config?: Record<string, unknown>[];
  mcp_config?: Record<string, unknown>[];
  plugin_config?: Record<string, unknown>[];
}

/** Issue 确认请求体（task 完成后人工确认/打回）。 */
export interface ConfirmIssueReq {
  approve: boolean;
  note?: string;
}
