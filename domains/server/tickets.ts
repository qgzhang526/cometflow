import { randomUUID } from 'node:crypto';

/**
 * 事件流的一次性票据（N6）。
 *
 * EventSource 不能自定义请求头，token 只能放在查询串里 —— 那会进浏览器历史、代理日志与 Referer。
 * 这里用「30 秒内有效、只能换一次连接」的票据替代：常规请求仍走 Authorization 头，
 * SSE 用一个用完即废的票据。
 */

export const TICKET_TTL_MS = 30_000;

export interface TicketStore {
  issue: () => string;
  consume: (ticket: string) => boolean;
  size: () => number;
}

export function createTicketStore(options: { ttlMs?: number; now?: () => number } = {}): TicketStore {
  const ttlMs = options.ttlMs ?? TICKET_TTL_MS;
  const now = options.now ?? Date.now;
  const tickets = new Map<string, number>();

  function prune(): void {
    const current = now();
    for (const [ticket, expiresAt] of tickets) {
      if (expiresAt <= current) tickets.delete(ticket);
    }
  }

  return {
    issue: () => {
      prune();
      const ticket = randomUUID().replace(/-/gu, '');
      tickets.set(ticket, now() + ttlMs);
      return ticket;
    },
    consume: (ticket: string) => {
      prune();
      const expiresAt = tickets.get(ticket);
      if (expiresAt === undefined) return false;
      // 单次使用：先删再判，重放必然失败。
      tickets.delete(ticket);
      return expiresAt > now();
    },
    size: () => tickets.size,
  };
}
