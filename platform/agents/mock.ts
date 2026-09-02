import type { AgentCommand, AgentRunInput, AgentRunResult, AgentRunner } from './types.js';

export function createMockAgentRunner(): AgentRunner {
  return {
    id: 'mock',
    name: 'mock',
    buildCommand(input: AgentRunInput): AgentCommand {
      return { command: 'mock', args: [input.prompt], cwd: input.cwd, timeoutMs: input.timeoutMs };
    },
    async run(): Promise<AgentRunResult> {
      return { exitCode: 0, stdout: 'mock agent ok', stderr: '', timedOut: false };
    },
    async check(): Promise<boolean> {
      return true;
    },
    subagentTool(): string { return 'task'; },
    configTemplate(): string { return 'none'; },
  };
}
