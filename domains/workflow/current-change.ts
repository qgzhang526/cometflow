import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';

export const CURRENT_CHANGE_SCHEMA = 'cometflow.current-change.v1';

export type CurrentChangeSource = 'auto' | 'manual';

export interface CurrentChangePointer {
  schema: typeof CURRENT_CHANGE_SCHEMA;
  change: string;
  selected_at: string;
  source: CurrentChangeSource;
}

export function currentChangePath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'current-change.json');
}

export async function readCurrentChange(
  projectRoot: string,
): Promise<CurrentChangePointer | null> {
  try {
    const source = await fs.readFile(currentChangePath(projectRoot), 'utf8');
    const parsed = JSON.parse(source) as Partial<CurrentChangePointer>;
    if (typeof parsed.change !== 'string' || parsed.change.trim() === '') return null;
    return {
      schema: CURRENT_CHANGE_SCHEMA,
      change: parsed.change,
      selected_at: typeof parsed.selected_at === 'string' ? parsed.selected_at : '',
      source: parsed.source === 'manual' ? 'manual' : 'auto',
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    // 指针损坏时按「没有指针」处理：路由层会 fail closed，而不是猜。
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * 选定「当前 change」。
 *
 * 当同时存在多个活跃 change 时，hook 无法靠自己判断一次写入属于谁；
 * 这个指针就是那份缺失的归属信息。写入走原子路径（H1-1），
 * 避免出现「指针半写」这种新的不可判定状态。
 */
export async function selectCurrentChange(
  projectRoot: string,
  name: string,
  options: { source?: CurrentChangeSource; now?: Date } = {},
): Promise<CurrentChangePointer> {
  const pointer: CurrentChangePointer = {
    schema: CURRENT_CHANGE_SCHEMA,
    change: name,
    selected_at: (options.now ?? new Date()).toISOString(),
    source: options.source ?? 'manual',
  };
  await atomicWriteText(currentChangePath(projectRoot), JSON.stringify(pointer, null, 2) + '\n');
  return pointer;
}

/**
 * 清除指针。默认只在它仍指向 `name` 时清除，避免误删别人刚选中的归属。
 */
export async function clearCurrentChange(
  projectRoot: string,
  name: string,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const pointer = await readCurrentChange(projectRoot);
  if (!pointer) return false;
  if (!options.force && pointer.change !== name) return false;
  await fs.rm(currentChangePath(projectRoot), { force: true });
  return true;
}
