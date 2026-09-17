/**
 * 错误信封提取：后端全局 HTTPException handler 把 C 端错误包成
 * ``{error:{message,type,code}}``，只读 detail/message 会让真实原因退化成
 * 「请求失败（409）」。这里锁住各响应形状的提取优先级与兜底。
 */
import { errorMessageFromBody } from '../client';

describe('errorMessageFromBody', () => {
  it('reads the OpenAI-style envelope the global handler emits', () => {
    expect(errorMessageFromBody(
      { error: { message: '该节点已被占用，请选择其它空闲节点', type: 'invalid_request_error', code: null } },
      409,
    )).toBe('该节点已被占用，请选择其它空闲节点');
  });

  it('prefers the envelope message over detail', () => {
    expect(errorMessageFromBody(
      { error: { message: '资源未授权或配置无效: resource_not_granted:x' }, detail: '兜底文案' },
      403,
    )).toBe('资源未授权或配置无效: resource_not_granted:x');
  });

  it('falls back to detail when there is no envelope', () => {
    // 路由未匹配的 404 走 Starlette 内建 handler，只有 {detail}。
    expect(errorMessageFromBody({ detail: 'Not Found' }, 404)).toBe('Not Found');
  });

  it('falls back to message when there is neither envelope nor detail', () => {
    expect(errorMessageFromBody({ message: '请求失败' }, 400)).toBe('请求失败');
  });

  it('stringifies a structured detail (e.g. 422 validation errors)', () => {
    const detail = [{ loc: ['body', 'node_id'], msg: 'field required' }];
    expect(errorMessageFromBody({ detail }, 422)).toBe(JSON.stringify(detail));
  });

  it('uses a plain-text body when the response is not JSON', () => {
    expect(errorMessageFromBody('# node not found\n', 404)).toBe('# node not found\n');
  });

  it('ignores blank and non-string candidates', () => {
    expect(errorMessageFromBody({ error: { message: '   ' }, detail: '', message: null }, 500))
      .toBe('请求失败（500）');
  });

  it('falls back to the status code when nothing is extractable', () => {
    expect(errorMessageFromBody(null, 503)).toBe('请求失败（503）');
    expect(errorMessageFromBody({}, 502)).toBe('请求失败（502）');
  });
});
