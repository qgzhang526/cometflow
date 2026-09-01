import { builtInAgentRunners } from '../../platform/agents/registry.js';

export async function agentListCommand(): Promise<void> {
  for (const runner of builtInAgentRunners()) {
    const available = await runner.check();
    console.log(runner.id + '\t' + runner.name + '\t' + (available ? 'available' : 'missing'));
  }
}

export async function agentCheckCommand(agentId: string): Promise<void> {
  const runner = builtInAgentRunners().find((entry) => entry.id === agentId);
  if (!runner) throw new Error('Unknown built-in agent: ' + agentId);
  const available = await runner.check();
  console.log(agentId + ': ' + (available ? 'available' : 'missing'));
}
