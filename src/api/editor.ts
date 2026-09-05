import { request } from '@/api/client';

export type EditorProvider = 'claude' | 'codex' | 'opencode' | 'cursor';
export type EditorBranchMode = 'default' | 'existing' | 'auto';
export interface EditorSession { id: string; editor_id: string; model?: string | null; models?: string[]; status: string; last_request_at?: string | null; created_at?: string; task_type?: string | null; task_role?: string | null; sub_type?: string | null; issue_id?: string | null; api_key_copy?: { key_masked?: string; disabled?: boolean } }
export interface EditorInstance { id: string; name?: string; provider: EditorProvider; project_id?: string | null; branch?: string | null; branch_mode?: EditorBranchMode | null; workdir?: string | null; node_id?: string | null; mcp_config?: unknown[]; skill_config?: unknown[]; plugin_config?: unknown[]; prompt_id?: string | null; status: string; sessions?: EditorSession[]; created_at?: string; updated_at?: string }
export interface ParentKeyItem { id: number; key_masked: string; name: string; source: string; disabled?: boolean; editor_provider_whitelist?: EditorProvider[]; editor_provider_blacklist?: EditorProvider[] }
export interface CreateEditorPayload { provider: EditorProvider; project_id?: string; branch?: string; branch_mode?: EditorBranchMode; workdir?: string; node_id?: string; name?: string; mcp_config?: unknown[]; skill_config?: unknown[]; plugin_config?: unknown[]; prompt_id?: string }
export type UpdateEditorPayload = Partial<Omit<CreateEditorPayload, 'provider' | 'project_id' | 'branch' | 'branch_mode' | 'workdir'>>;
export interface CreateEditorSessionPayload { parent_api_key_id: number; models?: string[]; model?: string; usage_limit?: { max_requests?: number; max_total_tokens?: number }; expires_at?: number; expected_client_id?: string; first_content?: string; task_type?: string; task_role?: string; sub_type?: string; issue_id?: string }
export interface GatewayModelOption { value: string; label: string }

export async function listEditorInstances(): Promise<EditorInstance[]> { const r = await request<EditorInstance[]>('/api/v1/users/editors'); return Array.isArray(r.data) ? r.data : []; }
export async function getEditorInstance(id: string): Promise<EditorInstance> { const r = await request<EditorInstance>(`/api/v1/users/editors/${encodeURIComponent(id)}`); return r.data as EditorInstance; }
export async function listProjectEditors(projectId: string): Promise<EditorInstance[]> { const r = await request<EditorInstance[]>(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editors`); return Array.isArray(r.data) ? r.data : []; }
export async function getProjectEditor(projectId: string): Promise<{ project_id: string; editor: EditorInstance | null }> { const r = await request<{ project_id: string; editor: EditorInstance | null }>(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editor`); return r.data ?? { project_id: projectId, editor: null }; }
export async function createProjectEditor(projectId: string, body: CreateEditorPayload): Promise<EditorInstance> { const r = await request<EditorInstance>(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editor`, { method: 'POST', body: { ...body, project_id: projectId } }); return r.data as EditorInstance; }
export async function updateProjectEditor(projectId: string, body: UpdateEditorPayload): Promise<EditorInstance> { const r = await request<EditorInstance>(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editor`, { method: 'PATCH', body }); return r.data as EditorInstance; }
export async function deleteProjectEditor(projectId: string, editorId: string): Promise<void> { await request(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editors/${encodeURIComponent(editorId)}`, { method: 'DELETE' }); }
export async function duplicateProjectEditor(projectId: string, editorId: string): Promise<void> { await request(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editors/${encodeURIComponent(editorId)}/duplicate`, { method: 'POST' }); }
export async function listParentKeys(): Promise<ParentKeyItem[]> { const r = await request<ParentKeyItem[]>('/api/v1/users/model-gateway/parent-keys'); return Array.isArray(r.data) ? r.data : []; }
export async function createProjectEditorSession(projectId: string, editorId: string, body: CreateEditorSessionPayload): Promise<EditorSession> { const r = await request<EditorSession>(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editors/${encodeURIComponent(editorId)}/sessions`, { method: 'POST', body }); return r.data as EditorSession; }
export async function closeEditorSession(editorId: string, sessionId: string): Promise<void> { await request(`/api/v1/users/editors/${editorId}/sessions/${sessionId}`, { method: 'DELETE' }); }
export async function switchEditorSessionModel(editorId: string, sessionId: string, model: string): Promise<void> { await request(`/api/v1/users/editors/${editorId}/sessions/${sessionId}`, { method: 'PATCH', body: { model } }); }

/** 编辑器的对外显示名：所有面向用户的位置都走这里，别各自写 `name || id`。 */
export function editorDisplayName(editor: Pick<EditorInstance, 'id' | 'name' | 'provider' | 'node_id'> | null | undefined): string {
  if (!editor) return '未选择编辑器';
  const name = editor.name?.trim();
  if (name) return name;
  const provider = editor.provider || '编辑器';
  if (editor.node_id) return `${provider} · ${editor.node_id}`;
  return `${provider} · ${editor.id.slice(0, 8)}`;
}
