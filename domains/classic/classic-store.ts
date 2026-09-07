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
