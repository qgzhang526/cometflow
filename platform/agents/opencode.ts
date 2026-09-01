import { runCommand } from '../process/spawn-command.js';
import type { AgentCommand, AgentRunInput, AgentRunResult, AgentRunner } from './types.js';

export function createOpenCodeRunner(): AgentRunner {
  return {
    id: 'opencode',
    name: 'opencode',
    buildCommand(input: AgentRunInput): AgentCommand {
      const args = ['run', input.prompt, '--dir', input.cwd];
      if (input.model) args.push('--model', input.model);
      return { command: 'opencode', args, cwd: input.cwd, timeoutMs: input.timeoutMs };
    },
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const command = this.buildCommand(input);
      return runCommand(command.command, command.args, { cwd: command.cwd, timeoutMs: command.timeoutMs });
    },
    async check(): Promise<boolean> {
      const result = await runCommand('opencode', ['--version'], { cwd: process.cwd(), timeoutMs: 5000 });
      return result.exitCode === 0;
    },
    subagentTool(): string { return 'task'; },
    configTemplate(): string { return 'opencode.jsonc'; },
  };
}
