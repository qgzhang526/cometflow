import { runCommand } from '../process/spawn-command.js';
import type { AgentCommand, AgentRunInput, AgentRunResult, AgentRunner } from './types.js';

export function createClaudeCodeRunner(): AgentRunner {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    buildCommand(input: AgentRunInput): AgentCommand {
      const args = ['-p', input.prompt, '--dangerously-skip-permissions'];
      if (input.model) args.push('--model', input.model);
      return { command: 'claude', args, cwd: input.cwd, timeoutMs: input.timeoutMs };
    },
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const command = this.buildCommand(input);
      return runCommand(command.command, command.args, { cwd: command.cwd, timeoutMs: command.timeoutMs });
    },
    async check(): Promise<boolean> {
      const result = await runCommand('claude', ['--version'], { cwd: process.cwd(), timeoutMs: 5000 });
      return result.exitCode === 0;
    },
    subagentTool(): string { return 'Task'; },
    configTemplate(): string { return 'CLAUDE.md'; },
  };
}
