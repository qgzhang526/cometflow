import path from 'node:path';
import { loadSkillPackage } from '../../domains/skill/skill-load.js';
import { installSkillPackage } from '../../domains/skill/skill-install.js';
import { listInstalledSkills } from '../../domains/skill/skill-list.js';
import { importSkill } from '../../domains/skill/skill-import.js';

function root(targetPath: string): string {
  return path.resolve(targetPath);
}

export async function skillAddCommand(source: string, options: { project?: string; overwrite?: boolean }): Promise<void> {
  const projectRoot = root(options.project ?? '.');
  const result = await installSkillPackage(path.resolve(source), projectRoot, { overwrite: options.overwrite === true });
  console.log('installed ' + result.name + ' -> ' + result.destination);
}

export async function skillShowCommand(name: string, options: { project?: string }): Promise<void> {
  const projectRoot = root(options.project ?? '.');
  const skills = await listInstalledSkills(projectRoot);
  const pkg = skills.find((entry) => entry.definition.name === name);
  if (!pkg) throw new Error('Unknown skill: ' + name);
  console.log(JSON.stringify(pkg, null, 2));
}

export async function skillListCommand(options: { project?: string }): Promise<void> {
  const projectRoot = root(options.project ?? '.');
  const skills = await listInstalledSkills(projectRoot);
  for (const pkg of skills) {
    console.log([pkg.definition.name, pkg.definition.version, pkg.definition.description].join('	'));
  }
}

export async function skillImportCommand(source: string, name: string, options: { project?: string }): Promise<void> {
  const projectRoot = root(options.project ?? '.');
  void name;
  const result = await importSkill(path.resolve(source), projectRoot);
  console.log('imported ' + result.name + ' -> ' + result.destination);
  if (result.warnings.length === 0) {
    console.log('risk-scan: clean');
  } else {
    console.log('risk-scan: ' + result.warnings.length + ' warning(s)');
    for (const warning of result.warnings) {
      console.log(warning.path + ':' + warning.line + ' [' + warning.category + '] ' + warning.text);
    }
  }
}
