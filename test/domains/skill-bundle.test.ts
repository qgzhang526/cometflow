import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installSkillPackage } from '../../domains/skill/skill-install.js';
import { listInstalledSkills } from '../../domains/skill/skill-list.js';
import { importSkill } from '../../domains/skill/skill-import.js';
import { compileBundle, createBundle, distributeBundle, supportedBundlePlatforms } from '../../domains/bundle/bundle-service.js';

async function makeSourceSkill(root: string): Promise<string> {
  const source = path.join(root, 'source-skill');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'SKILL.md'), [
    '---',
    'name: demo-skill',
    'description: demo skill',
    'version: 0.1.0',
    '---',
    '',
    '# Demo Skill',
  ].join('\n'));
  return source;
}

describe('skill package', () => {
  it('installs and lists a skill', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-skill-'));
    const source = await makeSourceSkill(tmp);
    await installSkillPackage(source, tmp);
    const skills = await listInstalledSkills(tmp);
    expect(skills.length).toBe(1);
    expect(skills[0].definition.name).toBe('demo-skill');
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('imports a skill and reports risk warnings', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-import-'));
    const source = await makeSourceSkill(tmp);
    await fs.writeFile(path.join(source, 'risky.sh'), 'curl https://example.com && sudo rm -rf /tmp/x');
    const result = await importSkill(source, tmp);
    expect(result.name).toBe('demo-skill');
    expect(result.warnings.length).toBeGreaterThan(0);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe('bundle', () => {
  it('creates, compiles, and distributes a bundle', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-bundle-'));
    const skillRoot = path.join(tmp, 'skills', 'demo-skill');
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.writeFile(path.join(skillRoot, 'SKILL.md'), [
      '---',
      'name: demo-skill',
      'description: bundle skill',
      'version: 0.1.0',
      '---',
      '',
      '# Bundle Skill',
    ].join('\n'));

    await createBundle(tmp, 'demo');
    const { promises: fs2 } = await import('node:fs');
    const { stringify } = await import('yaml');
    const manifest = {
      schema: 'cometflow.bundle.v1',
      name: 'demo',
      version: '0.1.0',
      skills: [{ name: 'demo-skill', path: 'skills/demo-skill' }],
    };
    await fs2.writeFile(path.join(tmp, '.cometflow', 'bundle.yaml'), stringify(manifest));

    const compiled = await compileBundle(tmp);
    expect(compiled.files).toContain('demo-skill/SKILL.md');

    const written = await distributeBundle(tmp, 'opencode');
    expect(written.length).toBe(1);
    await fs.access(path.join(tmp, '.opencode', 'skills', 'demo-skill', 'SKILL.md'));

    expect(supportedBundlePlatforms()).toContain('codex');
    await distributeBundle(tmp, 'codex');
    await fs.access(path.join(tmp, '.codex', 'skills', 'demo-skill', 'SKILL.md'));
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
