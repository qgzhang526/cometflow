import { promises as fs } from 'node:fs';
import { loadSkillPackage } from './skill-load.js';
import { installedSkillsRoot } from './skill-install.js';
import type { SkillPackage } from './types.js';

export async function listInstalledSkills(projectRoot: string): Promise<SkillPackage[]> {
  const root = installedSkillsRoot(projectRoot);
  let entries: string[];
  try { entries = await fs.readdir(root); } catch { return []; }
  const packages: SkillPackage[] = [];
  for (const entry of entries.sort()) {
    try { packages.push(await loadSkillPackage(root + (process.platform === "win32" ? "\\" : "/") + entry)); } catch { /* skip invalid skill */ }
  }
  return packages;
}
