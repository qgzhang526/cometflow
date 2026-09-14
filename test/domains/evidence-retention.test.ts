import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_SCOPE_FILE_BYTES,
  captureImplementationBaseline,
  collectImplementationScope,
} from '../../domains/workflow/implementation-scope.js';
import {
  appendChangeEvent,
  changeJournalPath,
  readChangeJournal,
  rotateChangeJournal,
  rotatedJournalPath,
} from '../../domains/workflow/change-journal.js';
import {
  applyEvidenceGc,
  collectEvidenceUsage,
  planEvidenceGc,
} from '../../domains/workflow/evidence-retention.js';
import { runDoctor } from '../../domains/dashboard/doctor.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');
let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-retention-'));
  await fs.cp(fixture, tmp, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('scope omission tracking', () => {
  it('records oversized files instead of silently skipping them', async () => {
    await fs.writeFile(path.join(tmp, 'huge.bin'), 'x'.repeat(MAX_SCOPE_FILE_BYTES + 1));
    const baseline = await captureImplementationBaseline(tmp, 'c1');

    expect(baseline.complete).toBe(false);
    expect(baseline.omittedCount).toBeGreaterThan(0);
    expect(baseline.omitted?.map((entry) => entry.reason)).toContain('file-too-large');
    expect(baseline.omitted?.find((entry) => entry.path === 'huge.bin')?.size).toBeGreaterThan(
      MAX_SCOPE_FILE_BYTES,
    );
  });

  it('surfaces the omission in the scope report and marks it incomplete', async () => {
    await fs.writeFile(path.join(tmp, 'huge.bin'), 'x'.repeat(MAX_SCOPE_FILE_BYTES + 1));
    await captureImplementationBaseline(tmp, 'c1');

    const scope = await collectImplementationScope(tmp, 'c1', { module: 'src/core' });
    expect(scope.complete).toBe(false);
    expect(scope.omittedCount).toBeGreaterThan(0);
    expect(scope.omitted.map((entry) => entry.path)).toContain('huge.bin');
  });

  it('folds omissions beyond the detail cap while keeping a stable hash', async () => {
    const dir = path.join(tmp, 'many');
    await fs.mkdir(dir, { recursive: true });
    for (let index = 0; index < 5; index += 1) {
      await fs.writeFile(path.join(dir, 'big-' + index + '.bin'), 'x'.repeat(MAX_SCOPE_FILE_BYTES + 1));
    }
    const first = await captureImplementationBaseline(tmp, 'fold');
    expect(first.omittedCount).toBe(5);
    expect(first.omitted).toHaveLength(5);
  });
});

describe('journal rotation and retention', () => {
  it('rotates an oversized journal and keeps the history readable', async () => {
    for (let index = 0; index < 20; index += 1) {
      await appendChangeEvent(tmp, 'c1', 'transition', { index, pad: 'x'.repeat(50) });
    }
    const rotated = await rotateChangeJournal(tmp, 'c1', { force: true });
    expect(rotated.rotated).toBe(true);

    await appendChangeEvent(tmp, 'c1', 'archive-started');
    const events = await readChangeJournal(tmp, 'c1');
    expect(events[0].event).toBe('transition');
    expect(events.some((event) => event.event === 'journal-rotated')).toBe(true);
    expect(events[events.length - 1].event).toBe('archive-started');
  });

  it('rotates automatically when the append crosses the threshold', async () => {
    for (let index = 0; index < 4; index += 1) {
      await appendChangeEvent(tmp, 'c2', 'transition', { index, pad: 'y'.repeat(80) });
    }
    await appendChangeEvent(tmp, 'c2', 'verify-result', { passed: true }, { maxJournalBytes: 10 });

    await expect(fs.access(rotatedJournalPath(tmp, 'c2'))).resolves.toBeUndefined();
    const events = await readChangeJournal(tmp, 'c2');
    expect(events.some((event) => event.event === 'journal-rotated')).toBe(true);
  });

  it('honours the read limit by returning the most recent events', async () => {
    for (let index = 0; index < 10; index += 1) {
      await appendChangeEvent(tmp, 'c3', 'transition', { index });
    }
    const recent = await readChangeJournal(tmp, 'c3', { limit: 3 });
    expect(recent).toHaveLength(3);
    expect(recent[2].data?.index).toBe(9);
  });
});

describe('evidence gc', () => {
  async function seedRuntime(change: string, archived: boolean): Promise<void> {
    await fs.mkdir(path.join(tmp, 'changes', change), { recursive: true });
    await fs.writeFile(
      path.join(tmp, 'changes', change, 'comet-state.yaml'),
      [
        'schema: cometflow.change.v1',
        'name: ' + change,
        'goal: G1',
        'task: T1',
        'phase: archive',
        'status: active',
        'spec_ref: null',
        'spec_anchor: null',
        'acceptance_ids: []',
        'spec_version: null',
        'spec_hash: null',
        'created_at: "2026-01-01T00:00:00.000Z"',
        'archived: ' + archived,
      ].join('\n'),
    );
    const txDir = path.join(tmp, '.cometflow', 'runtime', 'changes', change, 'tx', 'tx-1');
    await fs.mkdir(path.join(txDir, 'staged'), { recursive: true });
    await fs.mkdir(path.join(txDir, 'backup'), { recursive: true });
    await fs.writeFile(path.join(txDir, 'staged', 'spec.md'), 'x'.repeat(2048));
    await fs.writeFile(path.join(txDir, 'backup', 'spec.md'), 'x'.repeat(1024));
    await fs.writeFile(path.join(txDir, 'state.json'), '{"status":"committed"}');
    await fs.writeFile(
      path.join(tmp, '.cometflow', 'runtime', 'changes', change, 'impl-baseline.json'),
      JSON.stringify({ files: { 'a.ts': { hash: 'x', size: 1 } } }),
    );
    await appendChangeEvent(tmp, change, 'archive-completed', { change });
  }

  it('plans reclamation only for archived changes', async () => {
    await seedRuntime('archived-one', true);
    await seedRuntime('active-one', false);

    const plan = await planEvidenceGc(tmp);
    const changes = new Set(plan.candidates.map((entry) => entry.change));
    expect(changes.has('archived-one')).toBe(true);
    expect(changes.has('active-one')).toBe(false);
    expect(plan.candidates.some((entry) => entry.reason === 'implementation-baseline')).toBe(true);
    expect(plan.candidates.some((entry) => entry.reason === 'tx-staging')).toBe(true);
    expect(plan.reclaimableBytes).toBeGreaterThan(0);
  });

  it('removes candidates on apply while keeping the journal and change state', async () => {
    await seedRuntime('archived-one', true);
    const plan = await planEvidenceGc(tmp);
    const result = await applyEvidenceGc(tmp, plan);

    expect(result.freedBytes).toBeGreaterThan(0);
    await expect(
      fs.access(path.join(tmp, '.cometflow', 'runtime', 'changes', 'archived-one', 'impl-baseline.json')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(tmp, '.cometflow', 'runtime', 'changes', 'archived-one', 'tx', 'tx-1', 'staged')),
    ).rejects.toThrow();
    // 证据主体必须保留。
    await expect(
      fs.access(changeJournalPath(tmp, 'archived-one')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(tmp, 'changes', 'archived-one', 'comet-state.yaml')),
    ).resolves.toBeUndefined();
  });

  it('reports usage through doctor', async () => {
    await seedRuntime('archived-one', true);
    const report = await runDoctor(tmp);
    const usage = report.findings.find((finding) => finding.code === 'evidence-usage');
    expect(usage?.message).toContain('change gc');

    const entries = await collectEvidenceUsage(tmp);
    expect(entries.some((entry) => entry.change === 'archived-one' && entry.archived)).toBe(true);
  });
});
