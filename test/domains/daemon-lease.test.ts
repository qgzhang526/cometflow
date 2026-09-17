import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireDaemonLease,
  daemonLeasePath,
  isLeaseFresh,
  readDaemonLease,
} from '../../domains/scheduler/daemon-lease.js';

/**
 * 单实例租约（C3 前置）：一个项目同时只应该有一个调度器。
 *
 * C1 只保证「不会选中同一条任务」，两个 daemon 仍可各跑一条；租约把这件事收紧成
 * 「一个调度器 + 它内部并发」，也是页面「启动」按钮敢做的前提。
 */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-lease-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('daemon 单实例租约', () => {
  it('第一个持有，第二个被回绝并拿到持有者信息', async () => {
    const first = await acquireDaemonLease(root, { mode: 'always', agent: 'mock' });
    expect(first.acquired).toBe(true);
    expect((await readDaemonLease(root))?.mode).toBe('always');

    const second = await acquireDaemonLease(root, { mode: 'idle', agent: 'claude-code' });
    expect(second.acquired).toBe(false);
    expect(second.lease).toBeNull();
    expect(second.holder?.mode).toBe('always');
    expect(second.holder?.agent).toBe('mock');

    // 释放后可以再次持有：锁不是永久挡板。
    await first.lease!.release();
    expect(await readDaemonLease(root)).toBeNull();
    const third = await acquireDaemonLease(root, { mode: 'idle', agent: 'mock' });
    expect(third.acquired).toBe(true);
    await third.lease!.release();
  });

  it('心跳过期视为崩溃遗留，可被接管', async () => {
    const stale = new Date(Date.now() - 10 * 60_000);
    const first = await acquireDaemonLease(root, { mode: 'always', agent: 'mock', now: stale, heartbeatMs: 60 * 60_000 });
    expect(first.acquired).toBe(true);
    // 手动把心跳改成"很久没动"（模拟进程被杀）。
    const record = (await readDaemonLease(root))!;
    expect(isLeaseFresh(record, { staleAfterMs: 60_000 })).toBe(false);

    const takeover = await acquireDaemonLease(root, { mode: 'idle', agent: 'mock' });
    expect(takeover.acquired).toBe(true);
    // 旧持有者随后 release 不该删掉新租约。
    await first.lease!.release();
    expect((await readDaemonLease(root))?.mode).toBe('idle');
    await takeover.lease!.release();
  });

  it('坏租约文件按「没有持有者」处理', async () => {
    await fs.mkdir(path.dirname(daemonLeasePath(root)), { recursive: true });
    await fs.writeFile(daemonLeasePath(root), '{ 不是 JSON');
    expect(await readDaemonLease(root)).toBeNull();
    const acquired = await acquireDaemonLease(root, { mode: 'always', agent: 'mock' });
    expect(acquired.acquired).toBe(true);
    await acquired.lease!.release();
  });
});
