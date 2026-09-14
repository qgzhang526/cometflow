import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import type { ClassicState } from './types.js';

export function classicStateFile(projectRoot: string, name: string): string {
  return path.join(projectRoot, 'changes', name, 'classic-state.yaml');
}

export async function readClassicState(projectRoot: string, name: string): Promise<ClassicState> {
  const source = await fs.readFile(classicStateFile(projectRoot, name), "utf8");
  return parse(source) as ClassicState;
}

export async function writeClassicState(projectRoot: string, state: ClassicState): Promise<string> {
  const filePath = classicStateFile(projectRoot, state.name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringify(state));
  return filePath;
}

/**
 * 列出项目里的 classic change。
 *
 * classic 状态与 native change 共用 changes/ 目录（文件名不同），所以按文件名扫描而不是
 * 维护第二份注册表——目录本身就是事实源。
 */
export async function listClassicStates(projectRoot: string): Promise<ClassicState[]> {
  const dir = path.join(projectRoot, 'changes');
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const states: ClassicState[] = [];
  for (const entry of entries.sort()) {
    try {
      states.push(await readClassicState(projectRoot, entry));
    } catch {
      // 不是 classic change（没有 classic-state.yaml）就跳过
    }
  }
  return states;
}
