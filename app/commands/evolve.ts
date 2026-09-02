import path from 'node:path';
import {
  approveEvolution,
  listEvolutionProposals,
  proposeEvolution,
  rejectEvolution,
  rollbackEvolution,
  statusEvolution,
  submitEvolution,
  verifyEvolution,
} from '../../domains/evolution/evolution-service.js';

function root(targetPath: string): string {
  return path.resolve(targetPath);
}

export async function evolveProposeCommand(
  name: string,
  options: { summary: string; risk?: string; path?: string },
): Promise<void> {
  const projectRoot = root(options.path ?? '.');
  const proposal = await proposeEvolution({
    projectRoot,
    name,
    summary: options.summary,
    riskPlan: options.risk,
  });
  console.log('created evolution proposal ' + proposal.name + ' status=' + proposal.status);
}

export async function evolveVerifyCommand(
  name: string,
  targetPath: string,
  options: { eval?: boolean },
): Promise<void> {
  const proposal = await verifyEvolution(root(targetPath), name, { includeEval: options.eval === true });
  console.log('evolution ' + proposal.name + ' status=' + proposal.status);
}

export async function evolveSubmitCommand(name: string, targetPath: string): Promise<void> {
  const proposal = await submitEvolution(root(targetPath), name);
  console.log('evolution ' + proposal.name + ' status=' + proposal.status);
}

export async function evolveStatusCommand(name: string, targetPath: string): Promise<void> {
  const proposal = await statusEvolution(root(targetPath), name);
  console.log(JSON.stringify(proposal, null, 2));
}

export async function evolveRollbackCommand(name: string, targetPath: string): Promise<void> {
  const lines = await rollbackEvolution(root(targetPath), name);
  for (const line of lines) console.log(line);
}

export async function evolveApproveCommand(
  name: string,
  targetPath: string,
  options: { note?: string; commits?: string },
): Promise<void> {
  const commits = options.commits
    ? options.commits.split(',').map((item) => item.trim()).filter(Boolean)
    : undefined;
  const proposal = await approveEvolution(root(targetPath), name, { note: options.note, commits });
  console.log('evolution ' + proposal.name + ' status=' + proposal.status);
}

export async function evolveRejectCommand(
  name: string,
  targetPath: string,
  options: { reason: string },
): Promise<void> {
  const proposal = await rejectEvolution(root(targetPath), name, options.reason);
  console.log('evolution ' + proposal.name + ' status=' + proposal.status);
}

export async function evolveReviewListCommand(
  targetPath: string,
  options: { json?: boolean },
): Promise<void> {
  const proposals = await listEvolutionProposals(root(targetPath));
  if (options.json) {
    console.log(JSON.stringify(proposals, null, 2));
    return;
  }
  for (const proposal of proposals) {
    const decision = proposal.status === 'approved' ? ' (approved)' : proposal.status === 'rejected' ? ' (rejected)' : '';
    console.log([proposal.name, proposal.status + decision, proposal.summary].join('\t'));
  }
}
