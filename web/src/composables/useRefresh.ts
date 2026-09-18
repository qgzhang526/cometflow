import { reactive } from 'vue';
import type { RefreshArea } from '../api/refresh-areas';

export type { RefreshArea };

/**
 * 外部变更（SSE）→ 面板刷新 的路由。
 *
 * 三个约束：
 * 1. 只刷新受影响的区域，而不是整页重挂；
 * 2. 同一区域的连发事件合并成一次刷新（去抖）；
 * 3. 编辑中（模态打开）挂起刷新，等编辑器关掉再补，避免把用户输入冲掉。
 */
const counters = reactive<Record<string, number>>({});
const pending = reactive(new Set<string>());
const timers = new Map<string, number>();
const DEBOUNCE_MS = 250;

let suspendDepth = 0;

function flush(area: string): void {
  counters[area] = (counters[area] ?? 0) + 1;
}

function schedule(area: string): void {
  const existing = timers.get(area);
  if (existing !== undefined) window.clearTimeout(existing);
  timers.set(
    area,
    window.setTimeout(() => {
      timers.delete(area);
      flush(area);
    }, DEBOUNCE_MS),
  );
}

export function signalRefresh(area: string): void {
  if (suspendDepth > 0) {
    pending.add(area);
    return;
  }
  schedule(area);
}

/**
 * 面板用法：`watch(() => refreshCounter('changes'), reload)`。
 * 读取这个函数即建立响应式依赖，数值变化代表该区域有外部变更。
 */
export function refreshCounter(area: RefreshArea): number {
  return counters[area] ?? 0;
}

export function suspendRefresh(): void {
  suspendDepth += 1;
}

export function resumeRefresh(): void {
  suspendDepth = Math.max(0, suspendDepth - 1);
  if (suspendDepth > 0) return;
  for (const area of [...pending]) {
    pending.delete(area);
    schedule(area);
  }
}

export function pendingAreas(): string[] {
  return [...pending];
}
