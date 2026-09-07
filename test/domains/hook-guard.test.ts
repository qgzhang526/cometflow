import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateHook } from '../../domains/guard/hook-guard.js';

async function writeChange(root: string, name: string, phase: string, archived: boolean): Promise<void> {
  const dir = path.join(root, 'changes', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'comet-state.yaml'), [
    'schema: cometflow.change.v1',
    'name: ' + name,
    'goal: G1',
    'task: T1',
    'phase: ' + phase,
    'status: active',
    'spec_ref: null',
    'spec_anchor: null',
    'acceptance_ids: []',
    'spec_version: null',
    'spec_hash: null',
    'created_at: "2026-01-01T00:00:00.000Z"',
    'archived: ' + archived,
  ].join('\n'));
}

describe('hook guard', () => {
  it('allows source writes with one build-phase change', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-hook-'));
    await writeChange(tmp, 'build-change', 'build', false);
    const decision = await evaluateHook(tmp, 'write', path.join(tmp, 'src', 'index.ts'));
    expect(decision.allowed).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('denies spec writes outside shape phase', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-hook-'));
    await writeChange(tmp, 'build-change', 'build', false);
    const decision = await evaluateHook(tmp, 'write', path.join(tmp, 'specs', 'core', 'spec.md'));
    expect(decision.allowed).toBe(false);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('denies writes with multiple active changes', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-hook-'));
    await writeChange(tmp, 'a', 'build', false);
    await writeChange(tmp, 'b', 'build', false);
    const decision = await evaluateHook(tmp, 'write', path.join(tmp, 'src', 'index.ts'));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('multiple-active-changes');
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
