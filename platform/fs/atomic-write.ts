import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * 原子写入：写临时文件 → fsync → rename → 同步目录。
 *
 * 目的只有一个：任何时刻被中断（进程被杀、机器掉电），读到的目标文件
 * 要么是旧内容、要么是新内容，不会是截断或半写的中间态。
 * rename 在同一文件系统内是原子的，这是整套保证的核心。
 */
export const ATOMIC_TEMP_PREFIX = '.cometflow-tmp-';

export interface AtomicWriteOptions {
  encoding?: BufferEncoding;
  /** 测试注入点：临时文件打开之前。 */
  beforeTemporaryOpen?: () => void | Promise<void>;
  /** 测试注入点：临时文件已 fsync、即将 rename 之前。此处抛错可验证回滚。 */
  beforeCommit?: () => void | Promise<void>;
}

/** 目录 fsync 在部分平台/文件系统上不被支持，这些错误按「尽力而为」忽略。 */
const DIRECTORY_SYNC_UNSUPPORTED = new Set([
  'EACCES',
  'EBADF',
  'EINVAL',
  'EISDIR',
  'ENOTSUP',
  'EPERM',
  'EPUNKNOWN',
]);

/**
 * Windows 上如果目标文件正被其他进程读取（没有 FILE_SHARE_DELETE），
 * rename 会返回 EPERM/EBUSY 而不是像 POSIX 那样直接替换。
 * 这不是错误状态，只是抢占失败，短暂退避后重试即可。
 */
const RETRYABLE_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function renameWithRetry(from: string, to: string): Promise<void> {
  const attempts = 8;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!RETRYABLE_RENAME_ERRORS.has(code)) throw error;
      await delay(15 * (attempt + 1));
    }
  }
  throw lastError;
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (!DIRECTORY_SYNC_UNSUPPORTED.has(code)) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function temporaryFilePath(target: string): string {
  return path.join(
    path.dirname(target),
    ATOMIC_TEMP_PREFIX + path.basename(target) + '.' + randomUUID() + '.tmp',
  );
}

export async function atomicWriteFile(
  target: string,
  content: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const directory = path.dirname(target);
  await fs.mkdir(directory, { recursive: true });
  const temporary = temporaryFilePath(target);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;

  try {
    await options.beforeTemporaryOpen?.();
    // wx：目标已存在则失败，避免两个进程共用同一个临时文件。
    handle = await fs.open(temporary, 'wx');
    if (typeof content === 'string') await handle.writeFile(content, options.encoding ?? 'utf8');
    else await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;

    await options.beforeCommit?.();
    await renameWithRetry(temporary, target);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    // 只清理本次创建的临时文件；失败时保持旧文件不变。
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function atomicWriteText(
  target: string,
  content: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await atomicWriteFile(target, content, options);
}

export async function atomicWriteJson(
  target: string,
  value: unknown,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await atomicWriteFile(target, JSON.stringify(value, null, 2) + '\n', options);
}

/**
 * 追加一行。单次 write 调用在 POSIX 上对小于 PIPE_BUF 的写入是原子的，
 * 配合 fsync 可以让审计流水不会出现半行被后续读取解析的情况。
 * 读取端仍要容忍最后一行不完整（见 change-journal）。
 */
export async function appendLineAtomic(target: string, line: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const handle = await fs.open(target, 'a');
  try {
    await handle.writeFile(line, 'utf8');
    await handle.sync();
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export interface OrphanTempFile {
  path: string;
  size: number;
  modifiedAt: string;
}

/**
 * 找出残留的临时文件。
 *
 * 正常路径下临时文件会被 rename 或删除；只有进程在写入中途被杀才会留下，
 * 因此这份清单同时是「上次崩溃发生过」的证据。
 */
export async function findOrphanTempFiles(
  root: string,
  options: { maxAgeMs?: number; now?: Date } = {},
): Promise<OrphanTempFile[]> {
  const maxAgeMs = options.maxAgeMs ?? 0;
  const now = (options.now ?? new Date()).getTime();
  const found: OrphanTempFile[] = [];

  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile() || !entry.name.startsWith(ATOMIC_TEMP_PREFIX)) continue;
      let stat;
      try {
        stat = await fs.stat(absolute);
      } catch {
        continue;
      }
      if (now - stat.mtimeMs < maxAgeMs) continue;
      found.push({
        path: absolute,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  }

  await walk(root);
  return found.sort((left, right) => left.path.localeCompare(right.path));
}

/** 删除孤儿临时文件。只删自己命名规则内的文件，且必须先由调用方列出清单。 */
export async function removeOrphanTempFiles(files: readonly OrphanTempFile[]): Promise<string[]> {
  const removed: string[] = [];
  for (const file of files) {
    if (!path.basename(file.path).startsWith(ATOMIC_TEMP_PREFIX)) continue;
    await fs.rm(file.path, { force: true });
    removed.push(file.path);
  }
  return removed;
}
