import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, apiUrl, eventStreamUrl, hasToken, tokenRejected } from '../api/client';
import { signalRefresh } from '../composables/useRefresh';
import type { JobEvent } from '../api/types';
import { useJobsStore } from './jobs';
import { useProjectStore } from './project';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'offline';

const MAX_BACKOFF_MS = 15000;

/** 把 SSE 的 path 收敛成面板级刷新区域。 */
function areaForPath(path: string | undefined): string {
  if (path === undefined) return 'overview';
  if (path.startsWith('/api/config')) return 'config';
  if (path.startsWith('/api/goals') || path.startsWith('/api/mission') || path.startsWith('/api/context')) return 'goals';
  if (path.startsWith('/api/specs')) return 'specs';
  if (path.startsWith('/api/plans')) return 'plans';
  if (path.startsWith('/api/changes')) return 'changes';
  if (path.startsWith('/api/evolutions')) return 'evolve';
  return 'overview';
}

export const useEventStore = defineStore('events', () => {
  const connection = ref<ConnectionState>('idle');
  const lastEventAt = ref<string | null>(null);
  const attempts = ref(0);

  let source: EventSource | null = null;
  let retryTimer: number | null = null;
  let stopped = true;

  function close(): void {
    if (source !== null) {
      source.close();
      source = null;
    }
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    connection.value = 'reconnecting';
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempts.value, 4));
    attempts.value += 1;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  }

  function handle(payload: JobEvent): void {
    lastEventAt.value = payload.at;
    if (payload.type === 'state.changed') {
      const project = useProjectStore();
      if (payload.projectId !== undefined && project.currentId !== null && payload.projectId !== project.currentId) {
        return;
      }
      signalRefresh(areaForPath(payload.path));
      // 总览的计数来自 status，任何区域变化都值得重算。
      signalRefresh('overview');
      return;
    }
    useJobsStore().applyEvent(payload);
  }

  async function connect(): Promise<void> {
    if (!hasToken() || tokenRejected.value) {
      connection.value = 'idle';
      return;
    }
    close();
    connection.value = attempts.value === 0 ? 'connecting' : 'reconnecting';
    // 优先用一次性票据换连接：token 不长住在 URL / 历史 / 代理日志里（N6）。
    let streamUrl = eventStreamUrl();
    try {
      const data = await api<{ ticket: string }>('/session/ticket', { method: 'POST' });
      streamUrl = apiUrl('/events', { ticket: data.ticket });
    } catch {
      // 拿不到票据时退回 token 查询串：实时刷新不能因为票据接口抖动而失效。
    }
    const next = new EventSource(streamUrl);
    source = next;
    next.onopen = () => {
      connection.value = 'open';
      attempts.value = 0;
    };
    next.onmessage = (event) => {
      try {
        handle(JSON.parse(event.data) as JobEvent);
      } catch {
        // 无法解析的消息直接忽略，不让它打断事件流。
      }
    };
    next.onerror = () => {
      // 401（token 失效）也会走到这里：关闭连接并退避重试，避免无限立刻重连。
      if (source === next) {
        next.close();
        source = null;
      }
      scheduleReconnect();
    };
  }

  function start(): void {
    stopped = false;
    attempts.value = 0;
    void connect();
  }

  function stop(): void {
    stopped = true;
    close();
    connection.value = 'idle';
  }

  function reconnectNow(): void {
    stopped = false;
    close();
    attempts.value = 0;
    void connect();
  }

  return { connection, lastEventAt, attempts, start, stop, reconnectNow };
});
