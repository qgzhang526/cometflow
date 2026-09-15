import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCK_TTL_MS,
  LockHeldError,
  acquireLock,
  forceUnlock,
  inspectLock,
  lockPath,
  readLock,
} from '../../platform/fs/file-lock.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-lock-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('file lock', () => {
  it('grants one holder and rejects the second with the holder details', async () => {
    const lock = await acquireLock(tmp, 'change archive demo');
    expect((await readLock(tmp))?.action).toBe('change archive demo');

    await expect(acquireLock(tmp, 'plan freeze G1')).rejects.toBeInstanceOf(LockHeldError);
    await expect(acquireLock(tmp, 'plan freeze G1').catch((error: LockHeldError) => error.record.action)).resolves.toBe(
      'change archive demo',
    );

    await lock.release();
    expect(await readLock(tmp)).toBeNull();
  });

  it('takes over a lock whose TTL expired, and reports it as stale', async () => {
    await acquireLock(tmp, 'change archive old');
    const future = new Date(Date.now() + DEFAULT_LOCK_TTL_MS + 60_000);
    const inspection = await inspectLock(tmp, { now: future });
    expect(inspection.stale).toBe(true);
    expect(inspection.reason).toBe('ttl-expired');

    const second = await acquireLock(tmp, 'change archive new', { now: future });
    expect(second.record.action).toBe('change archive new');
    await second.release();
  });

  it('only releases its own lock (a stolen lock is not deleted by the old holder)', async () => {
    const first = await acquireLock(tmp, 'action A');
    await forceUnlock(tmp);
    const second = await acquireLock(tmp, 'action B');
    await first.release();
    // A 的 release 不能把 B 的锁删掉
    expect((await readLock(tmp))?.action).toBe('action B');
    await second.release();
  });

  it('forceUnlock reports whether anything was cleared', async () => {
    expect(await forceUnlock(tmp)).toBe(false);
    await acquireLock(tmp, 'action C');
    expect(await forceUnlock(tmp)).toBe(true);
    expect(await fs.access(lockPath(tmp)).then(() => true, () => false)).toBe(false);
  });
});
