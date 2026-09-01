import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeSpecLock, diffSpecs, writeSpecLock } from '../../domains/spec/spec-lock.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');

describe('spec lock/diff', () => {
  it('creates a lock and reports no diff immediately after', async () => {
    const lock = await computeSpecLock(fixture);
    expect(lock.files.length).toBe(1);
    await writeSpecLock(fixture, lock);
    const diff = await diffSpecs(fixture);
    expect(diff.added).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(1);
  });
});
