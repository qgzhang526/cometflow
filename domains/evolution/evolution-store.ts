import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import type { EvolutionProposal } from './types.js';

export function evolutionDir(projectRoot: string): string {
  return path.join(projectRoot, 'evolve');
}

export function evolutionFile(projectRoot: string, name: string): string {
  return path.join(evolutionDir(projectRoot), name + '.yaml');
}

export async function readEvolution(projectRoot: string, name: string): Promise<EvolutionProposal> {
  const source = await fs.readFile(evolutionFile(projectRoot, name), "utf8");
  return parse(source) as EvolutionProposal;
}

export async function writeEvolution(projectRoot: string, proposal: EvolutionProposal): Promise<string> {
  const filePath = evolutionFile(projectRoot, proposal.name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringify(proposal));
  return filePath;
}
