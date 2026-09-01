import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readTextFile } from '../../platform/fs/read-file.js';
import { listSpecFiles } from './spec-index.js';

export interface SpecLockEntry {
  path: string;
  hash: string;
}

export interface SpecLock {
  schema: 'cometflow.spec-lock.v1';
  files: SpecLockEntry[];
}

export interface SpecDiff {
  added: SpecLockEntry[];
  modified: SpecLockEntry[];
  removed: SpecLockEntry[];
  unchanged: SpecLockEntry[];
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function specLockPath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'spec-lock.json');
}

export async function readSpecLock(projectRoot: string): Promise<SpecLock | null> {
  try {
    const source = await fs.readFile(specLockPath(projectRoot), 'utf8');
    return JSON.parse(source) as SpecLock;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function computeSpecLock(projectRoot: string): Promise<SpecLock> {
  const files = await listSpecFiles(projectRoot);
  const entries: SpecLockEntry[] = [];
  for (const relativePath of files) {
    const content = await readTextFile(path.join(projectRoot, relativePath));
    entries.push({ path: relativePath, hash: sha256(content) });
  }
  return { schema: 'cometflow.spec-lock.v1', files: entries };
}

export async function writeSpecLock(projectRoot: string, lock: SpecLock): Promise<string> {
  const filePath = specLockPath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(lock, null, 2));
  return filePath;
}

export async function diffSpecs(projectRoot: string): Promise<SpecDiff> {
  const current = await computeSpecLock(projectRoot);
  const previous = await readSpecLock(projectRoot);
  const previousByPath = new Map((previous?.files ?? []).map((entry) => [entry.path, entry.hash]));

  const added: SpecLockEntry[] = [];
  const modified: SpecLockEntry[] = [];
  const unchanged: SpecLockEntry[] = [];
  for (const entry of current.files) {
    const previousHash = previousByPath.get(entry.path);
    if (previousHash === undefined) added.push(entry);
    else if (previousHash !== entry.hash) modified.push(entry);
    else unchanged.push(entry);
  }

  const currentPaths = new Set(current.files.map((entry) => entry.path));
  const removed = (previous?.files ?? [])
    .filter((entry) => !currentPaths.has(entry.path))
    .map((entry) => ({ ...entry }));

  return { added, modified, removed, unchanged };
}
