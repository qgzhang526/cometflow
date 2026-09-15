import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeSpecLock, diffSpecs, writeSpecLock } from '../../domains/spec/spec-lock.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');

describe('spec lock/diff', () => {
  it('creates a lock and reports no diff immediately after', async () => {
    // 夹具是**提交在库里的基线**，只能在临时副本上写：`writeSpecLock` 会落在项目里，
    // 直接在夹具上写会让工作区多出非提交产物（版本仓带 recorded_at 时间戳，一跑就变）。
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-spec-lock-'));
    try {
      await fs.cp(fixture, tmp, { recursive: true });

      const lock = await computeSpecLock(tmp);
      expect(lock.files.length).toBe(1);
      await writeSpecLock(tmp, lock);
      const diff = await diffSpecs(tmp);
      expect(diff.added).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(1);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
