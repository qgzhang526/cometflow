import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CasConflictError, hashContent, readContentHash, writeWithCas } from '../../platform/fs/cas-write.js';

let tmp: string;
let target: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-cas-'));
  target = path.join(tmp, 'file.txt');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('cas write', () => {
  it('writes when the expected hash matches, and reports the new hash', async () => {
    await fs.writeFile(target, 'v1');
    const result = await writeWithCas(target, 'v2', { expectedHash: hashContent('v1') });
    expect(result.hash).toBe(hashContent('v2'));
    expect(await fs.readFile(target, 'utf8')).toBe('v2');
  });

  it('refuses to write when the file changed underneath (conflict carries both hashes)', async () => {
    await fs.writeFile(target, 'mine');
    await fs.writeFile(target, 'theirs');
    await expect(writeWithCas(target, 'mine-2', { expectedHash: hashContent('mine') })).rejects.toBeInstanceOf(
      CasConflictError,
    );
    await expect(
      writeWithCas(target, 'mine-2', { expectedHash: hashContent('mine') }).catch((error: CasConflictError) => {
        expect(error.conflict.expected).toBe(hashContent('mine'));
        expect(error.conflict.actual).toBe(hashContent('theirs'));
        throw error;
      }),
    ).rejects.toBeInstanceOf(CasConflictError);
    // 冲突时不落盘：内容保持对方写入的版本
    expect(await fs.readFile(target, 'utf8')).toBe('theirs');
  });

  it('treats expectedHash null as "must not exist"', async () => {
    await writeWithCas(target, 'created', { expectedHash: null });
    expect(await fs.readFile(target, 'utf8')).toBe('created');
    await expect(writeWithCas(target, 'again', { expectedHash: null })).rejects.toBeInstanceOf(CasConflictError);
  });

  it('skips the check when expectedHash is undefined (legacy callers)', async () => {
    await fs.writeFile(target, 'old');
    await writeWithCas(target, 'new');
    expect(await fs.readFile(target, 'utf8')).toBe('new');
    expect(await readContentHash(path.join(tmp, 'missing.txt'))).toBeNull();
  });
});
