import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathExists, readTextFile } from '../../platform/fs/read-file.js';
import { listSpecFiles } from '../spec/spec-index.js';
import { hashSpecText } from '../spec/spec-hash.js';

export const CHANGE_SPEC_BASELINE_SCHEMA = 'cometflow.change-spec-baseline.v1';

export interface ChangeSpecBaseline {
  schema: typeof CHANGE_SPEC_BASELINE_SCHEMA;
  change: string;
  captured_at: string;
  /** canonical spec 路径 → 创建 change 时的内容哈希。 */
  files: Record<string, string>;
}

export interface ChangeSpecConflict {
  path: string;
  expected: string | null;
  actual: string | null;
  kind: 'modified' | 'removed';
}

export function changeSpecBaselinePath(projectRoot: string, name: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'changes', name, 'spec-baseline.json');
}

/**
 * 在 change 创建时对 canonical spec 做一次全量快照。
 *
 * 相比只记录任务绑定的那一份 spec，全量快照能覆盖 change 在 shape 阶段
 * 顺带修改其它 spec 文件（例如 models.md / errors.md）的场景：
 * 归档前任何一个目标文件被外部改过，都能被检测出来。
 */
export async function captureChangeSpecBaseline(
  projectRoot: string,
  name: string,
  options: { now?: Date } = {},
): Promise<ChangeSpecBaseline> {
  const files: Record<string, string> = {};
  for (const relativePath of await listSpecFiles(projectRoot)) {
    files[relativePath] = hashSpecText(await readTextFile(path.join(projectRoot, relativePath)));
  }
  const baseline: ChangeSpecBaseline = {
    schema: CHANGE_SPEC_BASELINE_SCHEMA,
    change: name,
    captured_at: (options.now ?? new Date()).toISOString(),
    files,
  };
  const filePath = changeSpecBaselinePath(projectRoot, name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(baseline, null, 2));
  return baseline;
}

export async function readChangeSpecBaseline(
  projectRoot: string,
  name: string,
): Promise<ChangeSpecBaseline | null> {
  try {
    const source = await fs.readFile(changeSpecBaselinePath(projectRoot, name), 'utf8');
    return JSON.parse(source) as ChangeSpecBaseline;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * 只把「与本 change 将要写入的目标」相关的漂移判定为冲突，避免无关 spec 变化阻塞归档。
 */
export async function diffChangeSpecBaseline(
  projectRoot: string,
  baseline: ChangeSpecBaseline,
  targets?: string[],
): Promise<ChangeSpecConflict[]> {
  const relevant = targets ? new Set(targets) : null;
  const conflicts: ChangeSpecConflict[] = [];
  for (const [relativePath, expected] of Object.entries(baseline.files)) {
    if (relevant && !relevant.has(relativePath)) continue;
    const absolute = path.join(projectRoot, relativePath);
    if (!(await pathExists(absolute))) {
      conflicts.push({ path: relativePath, expected, actual: null, kind: 'removed' });
      continue;
    }
    const actual = hashSpecText(await readTextFile(absolute));
    if (actual !== expected) {
      conflicts.push({ path: relativePath, expected, actual, kind: 'modified' });
    }
  }
  return conflicts;
}
