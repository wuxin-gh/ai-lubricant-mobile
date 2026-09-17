/**
 * 代理地址解析：把「一行凭据」拆成 地址 / 用户名 / 密码。
 *
 * 背景：用户拿到的代理凭据几乎总是一行 `http://user:pass@host:port`，但代理池表单
 * 后端要的是三个独立字段。让用户自己拆容易漏填认证——漏填的后果是运行时静默 407，
 * 而不是当场报错。这里把拆解自动化，表单只留一个「代理地址」框。
 *
 * 为什么不用 `new URL()`：它会做规范化（host 转小写、抹掉默认端口 `http://h:80`
 * → `http://h`、补尾斜杠），而 url 参与后端 `_proxy_id` 的哈希，字节变化会让代理
 * id 漂移、绑定的账号引用失效。手工切分能保证除 userinfo 外**逐字节保留**用户输入。
 *
 * 与 Web 版 `user-frontend/src/utils/proxy-url.ts` 及后端
 * `server/proxy_utils.split_proxy_credentials` 是同一条口径的多份实现
 * （三端各一份，无法共享代码）；改任一边请同步另外两边。
 */

export interface ProxyCredentials {
  /** 去 userinfo 后的地址；没识别到凭据时原样返回输入 */
  url: string;
  username: string;
  password: string;
  /** 是否真的解析出了凭据（只有 `@` 而两侧皆空时为 false） */
  hasCredentials: boolean;
}

/** `decodeURIComponent` 对畸形转义（如 `%zz`）会抛，回退原始串。 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 解析代理地址。除 userinfo 外不做任何规范化，保证字节保真。
 *
 * 边界口径（与 Web / 后端一致）：
 * - 没有 `://`、authority 里没有 `@`、或 `@` 后主机为空（`http://u:p@`）→ 视为无凭据；
 * - userinfo 取 authority 里**最后一个** `@` 切分，故密码含 `@`（`u:p@ss@h`）不会切错；
 * - 仅用户名（`http://user@h:7890`）时密码为空串。
 */
export function parseProxyUrl(raw: string): ProxyCredentials {
  // 剪贴板粘贴常带首尾空白/换行；表单提交处本来也会 trim，这里一并做掉。
  const text = String(raw ?? '').trim();
  const none: ProxyCredentials = { url: text, username: '', password: '', hasCredentials: false };

  const schemeIdx = text.indexOf('://');
  if (schemeIdx < 0) return none;
  const authorityStart = schemeIdx + 3;

  // authority 到首个 `/`、`?`、`#` 为止。
  let authorityEnd = text.length;
  for (const ch of ['/', '?', '#']) {
    const i = text.indexOf(ch, authorityStart);
    if (i >= 0 && i < authorityEnd) authorityEnd = i;
  }

  const authority = text.slice(authorityStart, authorityEnd);
  const at = authority.lastIndexOf('@');
  if (at < 0) return none;

  const hostport = authority.slice(at + 1);
  // 只有 userinfo 没有主机：不是可用地址，原样返回让上层校验拦下。
  if (!hostport) return none;

  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(':');
  const username = safeDecode(colon < 0 ? userinfo : userinfo.slice(0, colon));
  const password = safeDecode(colon < 0 ? '' : userinfo.slice(colon + 1));
  const url = text.slice(0, authorityStart) + hostport + text.slice(authorityEnd);

  return { url, username, password, hasCredentials: username !== '' || password !== '' };
}
