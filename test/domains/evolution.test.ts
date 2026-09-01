import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { proposeEvolution, submitEvolution, verifyEvolution } from '../../domains/evolution/evolution-service.js';

describe('evolution workflow', () => {
  it('proposes, verifies, and submits an evolution', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cometflow-evolve-"));
    const proposal = await proposeEvolution({
      projectRoot: tmp,
      name: 'better-prompt',
      summary: 'Improve task decomposition prompt',
      riskPlan: 'Isolated branch + tests',
      gates: [{ name: 'trivial', command: process.execPath, args: ['-e', 'process.exit(0)'] }],
    });
    expect(proposal.status).toBe('draft');

    const verified = await verifyEvolution(tmp, "better-prompt");
    expect(verified.status).toBe('verified');

    const submitted = await submitEvolution(tmp, "better-prompt");
    expect(submitted.status).toBe('ready-for-review');

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
describe('evolution gates', () => {
  it('默认门禁是真实 typecheck/tests（非 stub）', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cometflow-evolve-gates-"));
    const proposal = await proposeEvolution({
      projectRoot: tmp,
      name: 'gates-check',
      summary: 'check default gates',
    });
    const commands = proposal.gates.map((gate) => gate.name + ':' + gate.args.join(' ').replace(/\\/g, '/'));
    expect(commands.some((line) => line.includes('typescript/bin/tsc'))).toBe(true);
    expect(commands.some((line) => line.includes('vitest/vitest.mjs'))).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('支持项目级 .cometflow/evolve.yaml 覆盖门禁', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cometflow-evolve-manifest-"));
    await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, '.cometflow', 'evolve.yaml'),
      'gates:\n  - name: custom\n    command: node\n    args: ["-e", "process.exit(0)"]\n',
    );
    const proposal = await proposeEvolution({
      projectRoot: tmp,
      name: 'manifest-gates',
      summary: 'manifest gates',
    });
    expect(proposal.gates).toEqual([
      { name: 'custom', command: 'node', args: ['-e', 'process.exit(0)'] },
    ]);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
