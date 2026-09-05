import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * 前后台感知的轮询 hook。
 *
 * - 前台（active）时按 interval 轮询 pollFn；
 * - 进入后台立即停止定时器（不再无意义刷接口、省电省流量）；
 * - 回前台立即 tick 一次再恢复定时器（补回后台期间错过的状态变化）。
 *
 * `enabled` 为 false 时不轮询（用于终态停止轮询、未登录等）。
 * `pollFn` 抛错被吞掉，避免一个定时器异常把整屏搞挂。
 *
 * 用于任务详情页轮询运行态任务状态等场景，替代裸 `setInterval`（后者在后台
 * 仍会被节流但行为不可控，且无法在回前台时补刷一次）。
 */
export function useBackgroundPolling(
  pollFn: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
): void {
  const fnRef = useRef(pollFn);
  fnRef.current = pollFn;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let active = true;

    const tick = () => {
      if (!active) return;
      Promise.resolve(fnRef.current()).catch(() => undefined);
    };
    const start = () => {
      if (timer) return;
      timer = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onAppState = (state: AppStateStatus) => {
      if (state === 'active') {
        tick(); // 回前台：立刻补刷一次
        start();
      } else {
        stop(); // 切后台：停掉定时器
      }
    };

    start(); // 启动即在前台，开始轮询
    const sub = AppState.addEventListener('change', onAppState);
    return () => {
      active = false;
      stop();
      sub.remove();
    };
  }, [intervalMs, enabled]);
}
