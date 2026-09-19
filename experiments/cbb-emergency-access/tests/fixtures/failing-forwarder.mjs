/**
 * 转发器适配器的异常替身：open 正常、close 一定失败。
 *
 * 用于验收「回收失败不允许静默失败」这条路径（guard/spec.md 的 A15）。
 */
import { createForwarder as createWorkingForwarder } from './fake-forwarder.mjs';

export function createForwarder({ config } = {}) {
  const working = createWorkingForwarder({ config });
  return {
    open: (input) => working.open(input),
    close: () => {
      throw new Error('forwarder teardown failed (failing-forwarder fixture)');
    },
    list: () => working.list(),
  };
}
