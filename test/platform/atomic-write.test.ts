import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ATOMIC_TEMP_PREFIX,
  appendLineAtomic,
  atomicWriteJson,
  atomicWriteText,
  findOrphanTempFiles,
  removeOrphanTempFiles,
} from '../../platform/fs/atomic-write.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-atomic-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function tempFiles(directory = tmp): Promise<string[]> {
  const entries = await fs.readdir(directory);
  return entries.filter((entry) => entry.startsWith(ATOMIC_TEMP_PREFIX));
}

describe('atomic write', () => {
  it('writes the file and leaves no temporary file behind', async () => {
    const target = path.join(tmp, 'nested', 'state.yaml');
    await atomicWriteText(target, 'schema: v1\n');
    expect(await fs.readFile(target, 'utf8')).toBe('schema: v1\n');
    expect(await tempFiles(path.join(tmp, 'nested'))).toEqual([]);
  });

  it('keeps the previous content when the commit step fails', async () => {
    const target = path.join(tmp, 'state.json');
    await atomicWriteText(target, '{"version":1}\n');

    await expect(
      atomicWriteText(target, '{"version":2}\n', {
        beforeCommit: () => {
          throw new Error('injected crash before rename');
        },
      }),
    ).rejects.toThrow(/injected crash/u);

    // 旧内容必须完好，临时文件必须被清理。
    expect(await fs.readFile(target, 'utf8')).toBe('{"version":1}\n');
    expect(await tempFiles()).toEqual([]);
  });

  it('never exposes a partially written file to a concurrent reader', async () => {
    const target = path.join(tmp, 'big.json');
    const big = JSON.stringify({ payload: 'x'.repeat(200_000) });
    await atomicWriteText(target, big);

    const reads: string[] = [];
    const reader = (async () => {
      for (let index = 0; index < 40; index += 1) {
        reads.push(await fs.readFile(target, 'utf8'));
      }
    })();
    const writer = (async () => {
      for (let index = 0; index < 10; index += 1) await atomicWriteText(target, big);
    })();
    await Promise.all([reader, writer]);

    // 每次读到的内容都必须是完整 JSON（不存在截断的中间态）。
    for (const content of reads) {
      expect(() => JSON.parse(content)).not.toThrow();
    }
  });

  it('writes json with a trailing newline', async () => {
    const target = path.join(tmp, 'report.json');
    await atomicWriteJson(target, { ok: true });
    expect(await fs.readFile(target, 'utf8')).toBe('{\n  "ok": true\n}\n');
  });

  it('appends a single line without rewriting the file', async () => {
    const target = path.join(tmp, 'journal.jsonl');
    await appendLineAtomic(target, '{"event":"a"}\n');
    await appendLineAtomic(target, '{"event":"b"}\n');
    expect(await fs.readFile(target, 'utf8')).toBe('{"event":"a"}\n{"event":"b"}\n');
  });
});

describe('orphan temp files', () => {
  it('finds and removes only files matching the temp naming rule', async () => {
    await fs.mkdir(path.join(tmp, 'runtime'), { recursive: true });
    const orphan = path.join(tmp, 'runtime', ATOMIC_TEMP_PREFIX + 'state.yaml.abc.tmp');
    const keep = path.join(tmp, 'runtime', 'state.yaml');
    await fs.writeFile(orphan, 'half written');
    await fs.writeFile(keep, 'schema: v1\n');

    const found = await findOrphanTempFiles(tmp);
    expect(found.map((entry) => entry.path)).toEqual([orphan]);

    const removed = await removeOrphanTempFiles(found);
    expect(removed).toEqual([orphan]);
    await expect(fs.access(orphan)).rejects.toThrow();
    expect(await fs.readFile(keep, 'utf8')).toBe('schema: v1\n');
  });

  it('honours the age filter so in-flight writes are not reported', async () => {
    const fresh = path.join(tmp, ATOMIC_TEMP_PREFIX + 'fresh.tmp');
    await fs.writeFile(fresh, 'in flight');
    expect(await findOrphanTempFiles(tmp, { maxAgeMs: 60_000 })).toEqual([]);
    expect((await findOrphanTempFiles(tmp)).map((entry) => entry.path)).toEqual([fresh]);
  });

  it('reports files whose mtime is slightly in the future when no age filter is set', async () => {
    // CI 虚拟机时钟同步会让刚创建的文件 mtime 比 Date.now() 略新；
    // maxAgeMs=0 表示「不过滤」，此时这类文件必须照样报出来。
    const skewed = path.join(tmp, ATOMIC_TEMP_PREFIX + 'skewed.tmp');
    await fs.writeFile(skewed, 'clock skew');
    const ahead = new Date(Date.now() + 5_000);
    await fs.utimes(skewed, ahead, ahead);

    expect((await findOrphanTempFiles(tmp)).map((entry) => entry.path)).toEqual([skewed]);
    // 带年龄过滤时，未来时间戳按「刚写的」处理，不报。
    expect(await findOrphanTempFiles(tmp, { maxAgeMs: 1_000 })).toEqual([]);
  });
});
