import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { runCommand } from '../../platform/process/spawn-command.js';
import { evolutionDir, readEvolution, writeEvolution } from './evolution-store.js';
import type { EvolutionGate, EvolutionProposal } from './types.js';

const require = createRequire(import.meta.url);

// 默认真实门禁：解析到 cometflow 自身 node_modules 里的 tsc / vitest（绝对路径，cwd 无关）
const TSC = require.resolve('typescript/bin/tsc');
const VITEST = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

const DEFAULT_GATES: EvolutionGate[] = [
  { name: 'typecheck', command: process.execPath, args: [TSC, '-p', 'tsconfig.json', '--noEmit'] },
  { name: 'tests', command: process.execPath, args: [VITEST, 'run'] },
];

async function readGateManifest(projectRoot: string): Promise<EvolutionGate[] | null> {
  const manifestPath = path.join(projectRoot, '.cometflow', 'evolve.yaml');
  try {
    const source = await fs.readFile(manifestPath, 'utf8');
    const manifest = parse(source) as { gates?: EvolutionGate[] };
    return manifest.gates ?? null;
  } catch {
    return null;
  }
}

export async function proposeEvolution(options: {
  projectRoot: string;
  name: string;
  summary: string;
  riskPlan?: string;
  gates?: EvolutionGate[];
}): Promise<EvolutionProposal> {
  const now = new Date().toISOString();
  const manifestGates = await readGateManifest(options.projectRoot);
  const gates = options.gates ?? manifestGates ?? DEFAULT_GATES;
  const proposal: EvolutionProposal = {
    schema: 'cometflow.evolution.v1',
    name: options.name,
    summary: options.summary,
    risk_plan: options.riskPlan ?? '待补充',
    gates,
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
