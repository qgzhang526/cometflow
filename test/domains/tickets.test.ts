import { describe, expect, it } from 'vitest';
import { createTicketStore } from '../../domains/server/tickets.js';

describe('event stream tickets', () => {
  it('issues a ticket that can be consumed exactly once', () => {
    const store = createTicketStore();
    const ticket = store.issue();
    expect(store.consume(ticket)).toBe(true);
    // 重放必须失败：票据是一次性的。
    expect(store.consume(ticket)).toBe(false);
  });

  it('rejects expired tickets', () => {
    let now = 1000;
    const store = createTicketStore({ ttlMs: 30_000, now: () => now });
    const ticket = store.issue();
    now += 30_001;
    expect(store.consume(ticket)).toBe(false);
    expect(store.size()).toBe(0);
  });
});
