import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

export interface ProjectStatus {
  projectRoot: string;
  goals: string[];
  plans: Array<{ goal: string; status: string; tasks: number }>;
  changes: Array<{ name: string; phase: string; archived: boolean }>;
  evolutions: Array<{ name: string; status: string }>;
}

async function readYamlFiles<T>(dir: string): Promise<T[]> {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const results: T[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
    try {
      const source = await fs.readFile(path.join(dir, entry), "utf8");
      results.push(parse(source) as T);
    } catch {
      // ignore unreadable generated files
    }
  }
  return results;
}

export async function collectProjectStatus(projectRoot: string): Promise<ProjectStatus> {
  const goals = await readYamlFiles<{ id: string }>(path.join(projectRoot, ".cometflow", "goals"));
  const plans = await readYamlFiles<{ goal: string; status: string; tasks: unknown[] }>(path.join(projectRoot, ".cometflow", "plans"));

  let changeEntries: string[];
  try {
    changeEntries = await fs.readdir(path.join(projectRoot, "changes"));
  } catch {
    changeEntries = [];
  }
  const changes = [];
  for (const name of changeEntries.sort()) {
    try {
      const source = await fs.readFile(path.join(projectRoot, "changes", name, "comet-state.yaml"), "utf8");
      const state = parse(source) as { name: string; phase: string; archived: boolean };
      changes.push({ name: state.name, phase: state.phase, archived: state.archived });
    } catch {
      // ignore non-change directories
    }
  }

  const evolutions = await readYamlFiles<{ name: string; status: string }>(path.join(projectRoot, "evolve"));

  return {
    projectRoot,
    goals: goals.map((goal) => goal.id),
    plans: plans.map((plan) => ({ goal: plan.goal, status: plan.status, tasks: (plan.tasks ?? []).length })),
    changes,
    evolutions: evolutions.map((evolution) => ({ name: evolution.name, status: evolution.status })),
  };
}
