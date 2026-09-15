import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { atomicWriteText } from './atomic-write.js';

/**
 * 单文件乐观并发控制（compare-and-swap）。
 *
 * 原子写保证「不半写」，但保证不了「不互相覆盖」：CLI 与 serve 各自读旧内容再写新内容，
 * 后写的会把先写的静默盖掉。CAS 的做法是：写入前比对「我基于哪一版改的」与「磁盘现在是什么」，
 * 不一致就交给调用方处理（提示重读，或显式确认覆盖）。
 */

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** 读取目标文件的当前内容哈希；文件不存在返回 null。 */
export async function readContentHash(target: string): Promise<string | null> {
  try {
    return hashContent(await fs.readFile(target, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export interface CasConflict {
  path: string;
  /** 调用方基于的版本（null = 期望文件不存在）。 */
  expected: string | null;
  /** 磁盘上的实际版本（null = 文件不存在）。 */
  actual: string | null;
}

export class CasConflictError extends Error {
  readonly conflict: CasConflict;

  constructor(conflict: CasConflict) {
    super(
      'concurrent modification on ' +
        conflict.path +
        '：期望 ' +
        (conflict.expected ?? '(不存在)').slice(0, 12) +
        '，实际 ' +
        (conflict.actual ?? '(不存在)').slice(0, 12),
    );
    this.name = 'CasConflictError';
    this.conflict = conflict;
  }
}

export interface CasWriteOptions {
  /** 期望的当前哈希；undefined 表示不做并发检查（旧调用方）。 */
  expectedHash?: string | null;
}

/**
 * 带 CAS 检查的写。返回写入后的哈希，便于调用方把它作为下一次的 expectedHash。
 */
export async function writeWithCas(
  target: string,
  content: string,
  options: CasWriteOptions = {},
): Promise<{ hash: string }> {
  if (options.expectedHash !== undefined) {
    const actual = await readContentHash(target);
    if (actual !== options.expectedHash) {
      throw new CasConflictError({ path: target, expected: options.expectedHash, actual });
    }
  }
  await atomicWriteText(target, content);
  return { hash: hashContent(content) };
}
