import { promises as fs } from 'node:fs';
import path from 'node:path';
import { toPosix } from '../../platform/paths/relative.js';
import { kindForSpecFile, type SpecKind } from './kind.js';

async function walkMarkdown(root: string, current = root): Promise<string[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkMarkdown(root, fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push('specs/' + toPosix(path.relative(root, fullPath)));
    }
  }
  return files;
}

export async function listSpecFiles(projectRoot: string): Promise<string[]> {
  const specsDir = path.join(projectRoot, 'specs');
  try {
    await fs.access(specsDir);
  } catch {
    return [];
  }
  const files = await walkMarkdown(specsDir);
  return files.sort();
}

export function capabilitySpecFile(capability: string): string {
  return 'specs/' + capability + '/spec.md';
}

export interface SpecEntry {
  path: string;
  kind: SpecKind;
}

export async function listSpecEntries(projectRoot: string): Promise<SpecEntry[]> {
  const files = await listSpecFiles(projectRoot);
  return files.map((file) => ({ path: file, kind: kindForSpecFile(file) }));
}
