import { parseProxyUrl } from '../proxyUrl';

/**
 * 与后端 `server/proxy_utils.split_proxy_credentials`、Web 版
 * `user-frontend/src/utils/proxy-url.ts` 同一条口径的三份实现，边界用例保持一致。
 */
describe('parseProxyUrl（代理地址拆凭据）', () => {
  it('拆出用户名与密码', () => {
    expect(parseProxyUrl('http://u:p@127.0.0.1:7890')).toEqual({
      url: 'http://127.0.0.1:7890',
      username: 'u',
      password: 'p',
      hasCredentials: true,
    });
  });

  it('解码百分号转义', () => {
    expect(parseProxyUrl('http://u:p%40ss@h:7890')).toMatchObject({ username: 'u', password: 'p@ss' });
  });

  it('密码里的 @ 不切错（取最后一个 @）', () => {
    expect(parseProxyUrl('http://u:p@ss@h:7890')).toMatchObject({
      url: 'http://h:7890',
      username: 'u',
      password: 'p@ss',
    });
  });

  it('只有用户名时密码为空串', () => {
    expect(parseProxyUrl('http://user@h:7890')).toMatchObject({ username: 'user', password: '' });
  });

  it('空密码仍算有凭据', () => {
    expect(parseProxyUrl('http://u:@h:7890')).toMatchObject({ username: 'u', password: '', hasCredentials: true });
  });

  it('IPv6 主机', () => {
    expect(parseProxyUrl('http://u:p@[::1]:1080')).toMatchObject({ url: 'http://[::1]:1080', username: 'u' });
  });

  it('socks5 地址同样可拆', () => {
    expect(parseProxyUrl('socks5://u:p@1.2.3.4:1080')).toMatchObject({
      url: 'socks5://1.2.3.4:1080',
      username: 'u',
      password: 'p',
    });
  });

  it('畸形百分号转义不抛异常，原样保留', () => {
    expect(parseProxyUrl('http://u:p%zz@h:7890')).toMatchObject({ username: 'u', password: 'p%zz' });
  });

  it('无凭据时原样返回', () => {
    expect(parseProxyUrl('http://h:7890')).toEqual({
      url: 'http://h:7890',
      username: '',
      password: '',
      hasCredentials: false,
    });
  });

  it('只有 userinfo 没有主机时不拆', () => {
    expect(parseProxyUrl('http://u:p@')).toMatchObject({ url: 'http://u:p@', hasCredentials: false });
  });

  it('没有 scheme 时不拆', () => {
    expect(parseProxyUrl('127.0.0.1:7890')).toMatchObject({ hasCredentials: false });
  });

  it('空串', () => {
    expect(parseProxyUrl('')).toEqual({ url: '', username: '', password: '', hasCredentials: false });
  });

  it('path/query/fragment 原样保留', () => {
    expect(parseProxyUrl('http://u:p@h:7890/path?x=1#f')).toMatchObject({
      url: 'http://h:7890/path?x=1#f',
      username: 'u',
      password: 'p',
    });
  });

  it('去掉首尾空白，且不做其它规范化（默认端口不抹、不补尾斜杠）', () => {
    expect(parseProxyUrl('  http://u:p@h:7890  ')).toMatchObject({ url: 'http://h:7890' });
    expect(parseProxyUrl('http://h:80')).toMatchObject({ url: 'http://h:80' });
    expect(parseProxyUrl('http://h:7890/')).toMatchObject({ url: 'http://h:7890/' });
  });

  it('两边皆空的 userinfo 不算凭据', () => {
    expect(parseProxyUrl('http://:@h:7890')).toMatchObject({ url: 'http://h:7890', hasCredentials: false });
  });
});
