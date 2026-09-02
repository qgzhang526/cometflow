import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadSkillPackage } from './skill-load.js';
import type { SkillPackage } from './types.js';

export function installedSkillsRoot(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'skills');
}

export async function installSkillPackage(sourceRoot: string, projectRoot: string, options: { overwrite?: boolean } = {}): Promise<{ name: string; destination: string }> {
  const pkg = await loadSkillPackage(sourceRoot);
  const destination = path.join(installedSkillsRoot(projectRoot), pkg.definition.name);
  const exists = await fs.access(destination).then(() => true, () => false);
  if (exists && !options.overwrite) throw new Error("Skill already installed: " + pkg.definition.name);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rm(destination, { recursive: true, force: true });
  await fs.cp(sourceRoot, destination, { recursive: true, force: false });
  return { name: pkg.definition.name, destination };
}
