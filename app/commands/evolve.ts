import path from 'node:path';
import {
  proposeEvolution,
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
