import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { readTextFile } from '../../platform/fs/read-file.js';
import type { AgentRunner } from '../../platform/agents/types.js';

export interface FlowRunOptions {
  projectRoot: string;
  agentId?: string;
  model?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export async function resolveAgentId(projectRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.COMETFLOW_AGENT) return env.COMETFLOW_AGENT;
  try {
    const source = await fs.readFile(path.join(projectRoot, '.cometflow', 'config.yaml'), 'utf8');
    const config = parse(source) as { agent?: string };
    if (config.agent) return config.agent;
  } catch {
    // fall through to default
  }
  return 'opencode';
}

export async function buildFlowPrompt(projectRoot: string): Promise<string> {
  const missionPath = path.join(projectRoot, 'COMETFLOW.md');
  let mission = "";
  try {
    mission = await readTextFile(missionPath);
  } catch {
    mission = "COMETFLOW.md not found";
  }

  return [
    "You are CometFlow, a full-time autonomous software development agent.",
    "Work independently. Do not ask the user questions.",
    "Read the project mission and specs, decompose the current goal into tasks, implement them, and verify the result.",
    "",
    "## Project mission",
    mission,
    "",
    "## Instructions",
    "- Use specs/ as the source of truth.",
    "- If frozen task plans exist at .cometflow/plans/, read them and implement only their tasks.",
    "- Implement only work that has a frozen task plan or explicit spec acceptance.",
    "- Record decisions and unresolved blockers in reports/latest.md.",
  ].join("\n");
}

export async function runFlowRun(
  runner: AgentRunner,
  options: FlowRunOptions,
) {
  const prompt = await buildFlowPrompt(options.projectRoot);
  const result = await runner.run({
    prompt,
    cwd: options.projectRoot,
    model: options.model,
    timeoutMs: options.timeoutMs,
  });
  return { agentId: runner.id, prompt, result };
}
