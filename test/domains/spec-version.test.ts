import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  latestSpecVersion,
  readSpecBlob,
  refreshSpecBaseline,
  resolveSpecVersionRef,
  specVersionsFor,
  readSpecHistory,
} from '../../domains/spec/spec-version.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { diffSpecs, readSpecLock } from '../../domains/spec/spec-lock.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');
const specPath = 'specs/auth/spec.md';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-spec-version-'));
  await fs.cp(fixture, tmp, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function freeze(projectRoot: string) {
  return freezeTaskPlan(projectRoot, await generateTaskPlan(projectRoot, 'G1'));
}

describe('spec version store', () => {
  it('records a version on freeze and reuses it when content is unchanged', async () => {
    const first = await freeze(tmp);
    expect(first.tasks[0].spec_version).toBe(1);

    const second = await freeze(tmp);
    expect(second.tasks[0].spec_version).toBe(1);

    const history = await readSpecHistory(tmp);
    expect(specVersionsFor(history, specPath)).toHaveLength(1);
  });

  it('bumps the version and links the parent when spec content changes', async () => {
    await freeze(tmp);
    const file = path.join(tmp, specPath);
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')) + '\n## POST /api/auth/logout\n\n登出。\n');

    const plan = await freeze(tmp);
    const task = plan.tasks.find((entry) => entry.spec_anchor === 'POST /api/auth/email-login');
    expect(task?.spec_version).toBe(2);

    const history = await readSpecHistory(tmp);
    const versions = specVersionsFor(history, specPath);
    expect(versions).toHaveLength(2);
    expect(versions[1].parent).toBe(versions[0].hash);
  });

  it('stores content addressably so any recorded version can be read back', async () => {
    await freeze(tmp);
    const version = await latestSpecVersion(tmp, specPath);
    expect(version).not.toBeNull();
    const content = await readSpecBlob(tmp, version!.hash);
    expect(content).toContain('POST /api/auth/email-login');
    expect(version!.hash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('resolves version references by path@version and by hash', async () => {
    await freeze(tmp);
    const byVersion = await resolveSpecVersionRef(tmp, specPath + '@1');
    expect(byVersion.path).toBe(specPath);
    expect(byVersion.record.spec_version).toBe(1);

    const byHash = await resolveSpecVersionRef(tmp, byVersion.record.hash);
    expect(byHash.path).toBe(specPath);
  });

  it('refreshes the lock as part of recording versions', async () => {
    await refreshSpecBaseline(tmp, { note: 'test' });
    const lock = await readSpecLock(tmp);
    expect(lock?.files.map((entry) => entry.path)).toEqual([specPath]);
    const diff = await diffSpecs(tmp);
    expect(diff.modified).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(1);
  });
});
