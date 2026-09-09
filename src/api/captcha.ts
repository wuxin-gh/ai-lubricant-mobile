/**
 * Cap.js 工作量证明（PoW）验证码求解器。
 *
 * 后端用 github.com/ackcoder/go-cap（WithChallenge(50, 32, 3)）。协议：
 *  1. POST /api/v1/public/captcha/challenge  -> { challenge:{c,s,d}, token }
 *  2. 对 c 个子质询，按确定性 PRNG 推导 salt / target，
 *     爆破 nonce 使 sha256hex(salt+nonce) 以 target 为前缀。
 *  3. POST /api/v1/public/captcha/redeem  { token, solutions } -> { success, token }
 *     返回的 token 即登录所需的 captcha_token。
 *
 * 算法与 go-cap 的 prng / calculateHashHex 完全一致：
 *  - prng: 用 FNV-1a(32) 作种子，xorshift32 迭代，每轮输出 8 位十六进制。
 *  - 校验: sha256 十六进制前缀匹配。
 *
 * 性能：求解是同步哈希爆破（c≈50、约 20 万次 SHA-256），一次性跑会冻结 JS 线程
 * 几秒——登录按钮卡死、动画停住。这里把循环切成宏任务分批执行（每批约 2 万次
 * 哈希让出线程一次），UI 期间保持响应；另外提供「预取」接口：登录页一挂载就
 * 拉挑战并后台算好，点登录时若预取已就绪直接 redeem，把计算成本藏进输入时间。
 */
import { utf8ToBytes } from '@noble/hashes/utils';
import { authHeaders } from './client';
import { sha256Bytes } from './sha256fast';

interface ChallengeResp {
  challenge: { c: number; s: number; d: number };
  token: string;
  expires?: number;
}

interface RedeemResp {
  success: boolean;
  token?: string;
  message?: string;
  expires?: number;
}

/** FNV-1a 32 位哈希（对 ASCII 种子按字节计算）。 */
function fnv1a32(seed: string): number {
  let hash = 0x811c9dc5; // 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i) & 0xff;
    // 32 位乘法（FNV prime 0x01000193），用 imul 保证不丢精度
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 确定性十六进制串生成（对应 go-cap 的 prng）。 */
function prng(seed: string, length: number): string {
  let state = fnv1a32(seed);
  let result = '';
  while (result.length < length) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    result += state.toString(16).padStart(8, '0');
  }
  return result.slice(0, length);
}

const MAX_NONCE = 5_000_000; // difficulty=3 时一般几千次内命中，留足上限

/**
 * 求解单个子质询，返回命中的 nonce。
 * 热路径优化（c≈50、约 20w 次哈希）：
 *  - salt 字节只编码一次，nonce 的十进制 ASCII 直接写进复用缓冲区，避免每次 utf8ToBytes(salt+nonce)；
 *  - 只按目标长度逐个 nibble 比较 digest，避免每次把 32 字节 digest 转成 64 字符 hex。
 * solveOne 已并入 solveOneCapped（跨批次推进 nonce），保留 buf 复用与 nibble 比较两处优化。
 */

/** 每批哈希次数（约 2 万次 ≈ 几十毫秒，肉眼无感又足够让出 JS 线程保动画）。 */
const HASH_BATCH = 20_000;

/** 把 cb 排到下一个宏任务（RN 里 setTimeout(0) 即可让出 JS 线程）。 */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 一个子质询的状态机：跨批次推进 nonce，命中即结束。 */
interface SubChallenge {
  salt: string;
  target: string;
  /** 下批从该 nonce 继续爆破。 */
  nextNonce: number;
  done: boolean;
  nonce: number;
}

function makeSubChallenges(challenge: ChallengeResp): SubChallenge[] {
  const { c, s, d } = challenge.challenge;
  const { token } = challenge;
  const subs: SubChallenge[] = new Array(c);
  for (let i = 0; i < c; i++) {
    const idx = i + 1;
    subs[i] = { salt: prng(token + idx, s), target: prng(token + idx + 'd', d), nextNonce: 0, done: false, nonce: -1 };
  }
  return subs;
}

/**
 * 求解整组质询（异步分批版）。计算总量与旧同步版完全一致，只是把哈希循环
 * 切成宏任务批次，让 UI/动画在批次间继续渲染。
 */
export async function solveChallenges(challenge: ChallengeResp): Promise<number[]> {
  const subs = makeSubChallenges(challenge);
  const solutions = new Array(subs.length);
  let i = 0;
  let budget = HASH_BATCH;
  for (;;) {
    const sub = subs[i];
    // 尚未命中的子质询：用掉本批剩余预算（或整批）继续爆破。
    const startNonce = sub.nextNonce;
    const hit = solveOneCapped(sub, budget);
    if (hit != null) {
      sub.done = true;
      sub.nonce = hit;
      solutions[i] = hit;
      i += 1;
      if (i >= subs.length) return solutions;
      // 命中后剩余预算转给下一个子质询，批次内不空转。
      budget -= Math.max(1, hit - startNonce + 1);
      if (budget <= 0) { budget = HASH_BATCH; await nextTick(); }
    } else {
      // 预算耗尽未命中：让出线程后从断点继续同一子质询。
      await nextTick();
      budget = HASH_BATCH;
    }
  }
}

/** 带哈希预算上限的 solveOne：命中返回 nonce，预算耗尽返回 null（nextNonce 已推进）。 */
function solveOneCapped(sub: SubChallenge, maxHashes: number): number | null {
  const { salt, target } = sub;
  const saltBytes = utf8ToBytes(salt);
  const sLen = saltBytes.length;
  const d = target.length;
  const targetNibbles = new Uint8Array(d);
  for (let k = 0; k < d; k++) targetNibbles[k] = parseInt(target[k], 16);

  const buf = new Uint8Array(sLen + 8);
  buf.set(saltBytes, 0);

  let tried = 0;
  for (let nonce = sub.nextNonce; nonce < MAX_NONCE && tried < maxHashes; nonce++, tried++) {
    const ns = '' + nonce;
    const nLen = ns.length;
    for (let j = 0; j < nLen; j++) buf[sLen + j] = ns.charCodeAt(j);
    const digest = sha256Bytes(buf.subarray(0, sLen + nLen));
    let ok = true;
    for (let k = 0; k < d; k++) {
      const byte = digest[k >> 1];
      const nib = (k & 1) === 0 ? byte >> 4 : byte & 0x0f;
      if (nib !== targetNibbles[k]) { ok = false; break; }
    }
    if (ok) { sub.nextNonce = nonce; return nonce; }
  }
  sub.nextNonce = sub.nextNonce + tried;
  return null;
}

/* ── 预取：登录页挂载即拉挑战并后台算 PoW，点登录时若已就绪直接 redeem ── */

interface Prefetched {
  baseUrl: string;
  challenge: ChallengeResp;
  /** solutions 解算完成后填充；进行中为 null。 */
  solutionsPromise: Promise<number[]>;
  startedAt: number;
}

let prefetch: Prefetched | null = null;

async function fetchChallenge(baseUrl: string): Promise<ChallengeResp> {
  const res = await fetch(`${baseUrl}/api/v1/public/captcha/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  if (!res.ok) throw new Error(`获取验证码失败（${res.status}）`);
  const challenge = (await res.json()) as ChallengeResp;
  if (!challenge?.token || !challenge?.challenge) throw new Error('验证码响应格式异常');
  return challenge;
}

async function redeemChallenge(baseUrl: string, token: string, solutions: number[]): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/public/captcha/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ token, solutions }),
  });
  const redeem = (await res.json()) as RedeemResp;
  if (!redeem?.success || !redeem.token) throw new Error(redeem?.message || '验证码校验失败');
  return redeem.token;
}

/**
 * 预取验证码：拉取挑战并立即后台解算。用户填账号密码期间就把 20 万次哈希算完，
 * 点登录时 `obtainCaptchaToken` 直接复用结果。挑战 token 尚未 redeem 时可安全
 * 重复预取（后端按挑战 token 一次性消费）。
 */
export function prefetchCaptcha(baseUrl: string): void {
  // 同一地址已有预取在跑就不重复（挑战按一次性消费，重取反而浪费）。
  if (prefetch && prefetch.baseUrl === baseUrl) return;
  prefetch = null;
  void (async () => {
    try {
      const challenge = await fetchChallenge(baseUrl);
      const solutionsPromise = solveChallenges(challenge);
      prefetch = { baseUrl, challenge, solutionsPromise, startedAt: Date.now() };
    } catch {
      prefetch = null; // 预取失败不致命：点登录时会现场走完整流程
    }
  })();
}

/**
 * 完整跑一遍验证码流程，返回可用于登录的 captcha_token。
 * baseUrl 形如 https://your-server.example.com（无尾斜杠）。
 * 已有同 baseUrl 的预取且解算在途/完成时直接复用（省 1 个 RTT + 计算时间）。
 */
export async function obtainCaptchaToken(baseUrl: string): Promise<string> {
  const pre = prefetch;
  prefetch = null; // 预取一次性消费；失败/过期由本次现场流程兜底
  if (pre && pre.baseUrl === baseUrl) {
    try {
      const solutions = await pre.solutionsPromise;
      return await redeemChallenge(baseUrl, pre.challenge.token, solutions);
    } catch {
      /* 预取不可用（挑战过期/redeem 拒绝），回退现场完整流程 */
    }
  }
  const challenge = await fetchChallenge(baseUrl);
  const solutions = await solveChallenges(challenge);
  return redeemChallenge(baseUrl, challenge.token, solutions);
}
