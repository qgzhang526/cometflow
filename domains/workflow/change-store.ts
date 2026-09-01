import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import type { ChangeState } from './change-types.js';

export function changeDir(projectRoot: string, name: string): string {
  return path.join(projectRoot, 'changes', name);
}

export function changeStateFile(projectRoot: string, name: string): string {
  return path.join(changeDir(projectRoot, name), 'comet-state.yaml');
}

export async function readChangeState(projectRoot: string, name: string): Promise<ChangeState> {
  const source = await fs.readFile(changeStateFile(projectRoot, name), "utf8");
  return parse(source) as ChangeState;
}

export async function writeChangeState(projectRoot: string, state: ChangeState): Promise<string> {
  const filePath = changeStateFile(projectRoot, state.name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringify(state));
  return filePath;
}
