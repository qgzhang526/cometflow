import { promises as fs } from 'node:fs';
import path from 'node:path';
import { installSkillPackage } from './skill-install.js';
import { loadSkillPackage } from './skill-load.js';
import type { SkillImportResult, SkillRiskWarning } from './types.js';

async function scanSkillFiles(root: string): Promise<SkillRiskWarning[]> {
  const warnings: SkillRiskWarning[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) { stack.push(fullPath); continue; }
      if (!entry.isFile()) continue;
      const lines = (await fs.readFile(fullPath, "utf8")).split(/\r?\n/u);
      lines.forEach((line, index) => {
        if (/https?:\/\//iu.test(line)) {
          warnings.push({ path: path.relative(root, fullPath).split(path.sep).join('/'), line: index + 1, category: 'network', text: line.trim() });
        }
        if (/rm\s+-rf|sudo\s+|chmod\s+-R|mkfs|shutdown\s+|reboot\s+/iu.test(line)) {
          warnings.push({ path: path.relative(root, fullPath).split(path.sep).join('/'), line: index + 1, category: 'dangerous-command', text: line.trim() });
        }
        if (/(?:^|[\\/])(home|Users|etc|opt|var|tmp)[\\/]|^[A-Za-z]:[\\/]/u.test(line)) {
          warnings.push({ path: path.relative(root, fullPath).split(path.sep).join('/'), line: index + 1, category: 'absolute-path', text: line.trim() });
        }
      });
    }
  }
  return warnings;
}

export async function importSkill(sourceRoot: string, projectRoot: string): Promise<SkillImportResult> {
  const pkg = await loadSkillPackage(sourceRoot);
  const warnings = await scanSkillFiles(sourceRoot);
  const installed = await installSkillPackage(sourceRoot, projectRoot);
  return { name: pkg.definition.name, destination: installed.destination, warnings };
}
