/**
 * 响应重映射表（镜像 web 端 `user-frontend/src/api/endpointMap.ts` 的思路）。
 *
 * 后端 FastAPI 把 C 端列表接口返回成裸 REST 形状 ``{total, page, page_size, rows}``，
 * 而移动端各 wrapper 仍按旧 Go 信封里的键读取（``resp.data?.tasks`` / ``resp.data?.projects`` 等）。
 * ``client.ts`` 的 ``request()`` 在把裸响应包成 ``{code,0,data}`` 信封后，按请求 path 套这里的
 * ``transform``，把裸体改写成 wrapper 期望的形状，于是下游读取无需改动。
 *
 * key 为去掉查询串的请求 path；未列出的 path 不做转换（直接透传裸体作为 data）。
 */
export type Transform = (data: any) => any;

/** 列表形状归一：{rows,total,page,page_size} → {<key>: rows, ...分页字段}。 */
function rowsUnder(key: string): Transform {
  return (data: any) => {
    const rows = Array.isArray(data) ? data : (data?.rows ?? data?.[key] ?? []);
    return {
      [key]: rows,
      total: data?.total,
      page: data?.page,
      page_size: data?.page_size,
    };
  };
}

/** 项目列表：对齐移动端 ListProjectResp { projects, page{has_more} }（游标降级为分页）。 */
function projectsTransform(data: any): any {
  const rows = Array.isArray(data) ? data : (data?.rows ?? data?.projects ?? []);
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;
  const size = data?.page_size ?? rows.length ?? 1;
  return {
    projects: rows,
    page: { has_more: page * size < total },
  };
}

export const TRANSFORMS: Record<string, Transform> = {
  'GET /api/v1/users/projects': projectsTransform,
};

/** 归一化并重映射：输入解析后的 body，返回最终信封的 ``data``。 */
export function normalizeData(method: string, path: string, body: any): any {
  // 后端 /status、/oidc/default-team 本身就是 {code,message,data} 信封 —— 直接取 data。
  if (body && typeof body === 'object' && typeof body.code === 'number' && 'message' in body && 'data' in body) {
    return body.data;
  }
  const key = `${method} ${path}`;
  const t = TRANSFORMS[key];
  return t ? t(body) : body;
}
