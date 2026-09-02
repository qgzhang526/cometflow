import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { ChangeState } from './change-types.js';

export async function listChangeStates(projectRoot: string): Promise<ChangeState[]> {
  const changesDir = path.join(projectRoot, "changes");
  let entries: string[];
  try {
    entries = await fs.readdir(changesDir);
  } catch {
    return [];
  }

  const states: ChangeState[] = [];
  for (const entry of entries.sort()) {
    const stateFile = path.join(changesDir, entry, "comet-state.yaml");
    try {
      const source = await fs.readFile(stateFile, "utf8");
      states.push(parse(source) as ChangeState);
    } catch {
      // ignore directories without readable change state
    }
  }
  return states;
}
