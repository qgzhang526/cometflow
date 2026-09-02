import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  approveEvolution,
  listEvolutionProposals,
  proposeEvolution,
  rejectEvolution,
  submitEvolution,
  verifyEvolution,
} from '../../domains/evolution/evolution-service.js';

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
describe('evolution review workflow (approve/reject/review-list)', () => {
  const trivialGates = [{ name: 'trivial', command: process.execPath, args: ['-e', 'process.exit(0)'] }];

  it('approve 从 ready-for-review 进入终态 approved，并写入决策字段', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cometflow-evolve-approve-"));
    const proposal = await proposeEvolution({ projectRoot: tmp, name: 'p1', summary: 's1', gates: trivialGates });
    await verifyEvolution(tmp, 'p1');
    await submitEvolution(tmp, 'p1');
    const approved = await approveEvolution(tmp, 'p1', { note: 'human approved', commits: ['abc123'] });
    expect(approved.status).toBe('approved');
    expect(approved.review_note).toBe('human approved');
    expect(approved.merged_commits).toEqual(['abc123']);
    expect(approved.decision_at).toBeTruthy();
    // 终态后重复 approve 应报错
    await expect(approveEvolution(tmp, 'p1')).rejects.toThrow('ready-for-review or verified');
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('reject 记录原因并进入终态', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cometflow-evolve-reject-"));
    const proposal = await proposeEvolution({ projectRoot: tmp, name: 'p2', summary: 's2', gates: trivialGates });
    await verifyEvolution(tmp, 'p2');
    await submitEvolution(tmp, 'p2');
    const rejected = await rejectEvolution(tmp, 'p2', '评测不达标');
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejected_reason).toBe('评测不达标');
    await expect(rejectEvolution(tmp, 'p2', 'again')).rejects.toThrow('terminal state');
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('review-list 列出全部提案（含终态）', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cometflow-evolve-list-"));
    const a = await proposeEvolution({ projectRoot: tmp, name: 'a-prop', summary: 'aaa', gates: trivialGates });
    const b = await proposeEvolution({ projectRoot: tmp, name: 'b-prop', summary: 'bbb', gates: trivialGates });
    await verifyEvolution(tmp, 'a-prop');
    await submitEvolution(tmp, 'a-prop');
    await approveEvolution(tmp, 'a-prop', { note: 'ok' });
    const list = await listEvolutionProposals(tmp);
    expect(list.map((p) => p.name)).toEqual(['a-prop', 'b-prop']);
    expect(list.find((p) => p.name === 'a-prop')?.status).toBe('approved');
    expect(list.find((p) => p.name === 'b-prop')?.status).toBe('draft');
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
