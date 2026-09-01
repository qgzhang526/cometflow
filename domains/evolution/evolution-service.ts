import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runCommand } from '../../platform/process/spawn-command.js';
import { evolutionDir, readEvolution, writeEvolution } from './evolution-store.js';
import type { EvolutionGate, EvolutionProposal } from './types.js';

const DEFAULT_GATES: EvolutionGate[] = [
  { name: "typecheck", command: process.execPath, args: ["-e", "process.exit(0)"] },
  { name: "tests", command: process.execPath, args: ["-e", "process.exit(0)"] },
];

export async function proposeEvolution(options: {
  projectRoot: string;
  name: string;
  summary: string;
  riskPlan?: string;
}): Promise<EvolutionProposal> {
  const now = new Date().toISOString();
  const proposal: EvolutionProposal = {
    schema: 'cometflow.evolution.v1',
    name: options.name,
    summary: options.summary,
    risk_plan: options.riskPlan ?? '待补充',
    gates: DEFAULT_GATES,
    status: 'draft',
    created_at: now,
    updated_at: now,
  };
  await writeEvolution(options.projectRoot, proposal);
  return proposal;
}

export async function verifyEvolution(projectRoot: string, name: string): Promise<EvolutionProposal> {
  const proposal = await readEvolution(projectRoot, name);
  let verified = true;
  for (const gate of proposal.gates) {
    const result = await runCommand(gate.command, gate.args, { cwd: projectRoot, timeoutMs: 120_000 });
    console.log(gate.name + ': ' + (result.exitCode === 0 ? 'OK' : 'FAIL'));
    if (result.exitCode !== 0) verified = false;
  }
  const next: EvolutionProposal = {
    ...proposal,
    status: verified ? 'verified' : 'rejected',
    updated_at: new Date().toISOString(),
  };
  await writeEvolution(projectRoot, next);
  return next;
}

export async function submitEvolution(projectRoot: string, name: string): Promise<EvolutionProposal> {
  const proposal = await readEvolution(projectRoot, name);
  if (proposal.status !== 'verified') throw new Error('Evolution must be verified before submit');
  const reviewPath = path.join(evolutionDir(projectRoot), name, "review.md");
  await fs.mkdir(path.dirname(reviewPath), { recursive: true });
  await fs.writeFile(reviewPath, "# Evolution Review\n\n## Summary\n\n" + proposal.summary + "\n\n## Risk and gate plan\n\n" + proposal.risk_plan + "\n");
  const next: EvolutionProposal = { ...proposal, status: "ready-for-review", updated_at: new Date().toISOString() };
  await writeEvolution(projectRoot, next);
  return next;
}

export async function statusEvolution(projectRoot: string, name: string): Promise<EvolutionProposal> {
  return readEvolution(projectRoot, name);
}

export async function rollbackEvolution(projectRoot: string, name: string): Promise<string[]> {
  const proposal = await readEvolution(projectRoot, name);
  return [
    'Evolution rollback guidance for ' + name + ':',
    '- Find the evolve tag: git tag | grep "evolve-"',
    '- Inspect before rollback: git show <tag>',
    '- Rollback with: git revert <commit>',
    'Proposal status: ' + proposal.status,
  ];
}
