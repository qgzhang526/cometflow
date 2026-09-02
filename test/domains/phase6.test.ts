import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runDoctor } from '../../domains/dashboard/doctor.js';
import { migrateProject } from '../../domains/project/migrate.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');

describe('doctor', () => {
  it('reports a healthy project with warnings when plans are absent', async () => {
    const report = await runDoctor(fixture);
    expect(report.healthy).toBe(true);
    expect(report.findings.some((finding) => finding.code === 'no-plans')).toBe(true);
  });
});

describe('project migrate', () => {
  it('migrates legacy NIGHTSHIFT and .nightshift config', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-migrate-'));
    await fs.writeFile(path.join(tmp, 'NIGHTSHIFT.md'), '# 项目使命\n\n## 任务目标\n');
    await fs.mkdir(path.join(tmp, '.nightshift'), { recursive: true });
    await fs.writeFile(path.join(tmp, '.nightshift', 'config'), 'AGENT=claude-code\n');

    const report = await migrateProject(tmp);
    expect(report.migrated.length).toBe(2);
    await fs.access(path.join(tmp, 'COMETFLOW.md'));
    const config = await fs.readFile(path.join(tmp, '.cometflow', 'config.yaml'), 'utf8');
    expect(config).toContain('claude-code');

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
