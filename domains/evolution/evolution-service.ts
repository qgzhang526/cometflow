import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { runCommand } from '../../platform/process/spawn-command.js';
import { runLocalEval } from '../eval/eval-service.js';
import { evolutionDir, readEvolution, writeEvolution } from './evolution-store.js';
import type { EvolutionGate, EvolutionProposal } from './types.js';

const require = createRequire(import.meta.url);

// 默认真实门禁：优先解析到本仓库 node_modules 里的 tsc / vitest；
// 作为 npm 包安装到用户项目时，这些 devDependency 不存在，则回退到 PATH 上的 tsc/vitest。
function defaultGates(): EvolutionGate[] {
  try {
    const tsc = require.resolve('typescript/bin/tsc');
    const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
    return [
      { name: 'typecheck', command: process.execPath, args: [tsc, '-p', 'tsconfig.json', '--noEmit'] },
      { name: 'tests', command: process.execPath, args: [vitest, 'run'] },
    ];
  } catch {
    return [
      { name: 'typecheck', command: 'tsc', args: ['--noEmit'] },
      { name: 'tests', command: 'vitest', args: ['run'] },
    ];
  }
}

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
  const gates = options.gates ?? manifestGates ?? defaultGates();
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

export async function verifyEvolution(
  projectRoot: string,
  name: string,
  options: { includeEval?: boolean } = {},
): Promise<EvolutionProposal> {
  const proposal = await readEvolution(projectRoot, name);
  let verified = true;
  for (const gate of proposal.gates) {
    const result = await runCommand(gate.command, gate.args, { cwd: projectRoot, timeoutMs: 120_000 });
    console.log(gate.name + ': ' + (result.exitCode === 0 ? 'OK' : 'FAIL'));
    if (result.exitCode !== 0) verified = false;
  }

  let evalSummary: EvolutionProposal['eval'];
  if (options.includeEval) {
    const report = await runLocalEval(projectRoot);
    evalSummary = {
      passed: report.passed,
      passAtKRate: report.passAtKRate,
      passAllKRate: report.passAllKRate,
      sampling: report.sampling,
    };
    console.log(
      'eval: ' + (report.passed ? 'PASS' : 'FAIL') +
      ' pass@k=' + report.passAtKRate.toFixed(2) +
      ' pass^k=' + report.passAllKRate.toFixed(2),
    );
    if (!report.passed) verified = false;
  }

  const next: EvolutionProposal = {
    ...proposal,
    eval: evalSummary,
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

async function appendDecision(projectRoot: string, name: string, verdict: string, note: string): Promise<void> {
  const reviewPath = path.join(evolutionDir(projectRoot), name, "review.md");
  try {
    await fs.appendFile(reviewPath, "\n## Decision\n\n- " + verdict + "\n- note: " + note + "\n");
  } catch {
    // review.md 不存在则跳过（决策字段已写入 proposal.yaml）
  }
}

export async function approveEvolution(
  projectRoot: string,
  name: string,
  options: { note?: string; commits?: string[] } = {},
): Promise<EvolutionProposal> {
  const proposal = await readEvolution(projectRoot, name);
  if (proposal.status !== 'ready-for-review' && proposal.status !== 'verified') {
    throw new Error('Evolution must be ready-for-review or verified before approve, got ' + proposal.status);
  }
  const now = new Date().toISOString();
  const next: EvolutionProposal = {
    ...proposal,
    status: 'approved' as const,
    review_note: options.note ?? 'approved',
    merged_commits: options.commits ?? proposal.merged_commits,
    decision_at: now,
    updated_at: now,
  };
  await writeEvolution(projectRoot, next);
  await appendDecision(projectRoot, name, 'APPROVED', next.review_note ?? '');
  return next;
}

export async function rejectEvolution(
  projectRoot: string,
  name: string,
  reason: string,
): Promise<EvolutionProposal> {
  const proposal = await readEvolution(projectRoot, name);
  if (proposal.status === 'approved' || proposal.status === 'rejected') {
    throw new Error('Evolution is already in terminal state: ' + proposal.status);
  }
  const now = new Date().toISOString();
  const next: EvolutionProposal = {
    ...proposal,
    status: 'rejected' as const,
    rejected_reason: reason,
    decision_at: now,
    updated_at: now,
  };
  await writeEvolution(projectRoot, next);
  await appendDecision(projectRoot, name, 'REJECTED', reason);
  return next;
}

export async function listEvolutionProposals(projectRoot: string): Promise<EvolutionProposal[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(evolutionDir(projectRoot));
  } catch {
    return [];
  }
  const proposals: EvolutionProposal[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.yaml')) continue;
    try {
      const source = await fs.readFile(path.join(evolutionDir(projectRoot), entry), 'utf8');
      proposals.push(parse(source) as EvolutionProposal);
    } catch {
      // 跳过无法解析的文件（如目录）
    }
  }
  return proposals;
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