import { runCommand } from '../process/spawn-command.js';
import type { AgentCommand, AgentRunInput, AgentRunResult, AgentRunner } from './types.js';

function winStdio(): 'inherit' | undefined {
  // Windows 下 opencode.exe 被 pipe stdio 拉起会卡在 init，需要继承控制台
  return process.platform === 'win32' ? 'inherit' : undefined;
}

export function createOpenCodeRunner(): AgentRunner {
  return {
    id: 'opencode',
    name: 'opencode',
    buildCommand(input: AgentRunInput): AgentCommand {
      // 工作目录由 spawn 的 cwd 决定；不要传 --dir（Windows 上绝对路径会被误解析为 git 根）
      const args = ['run', input.prompt];
      if (input.model) args.push('--model', input.model);
      return { command: 'opencode', args, cwd: input.cwd, timeoutMs: input.timeoutMs };
    },
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const command = this.buildCommand(input);
      return runCommand(command.command, command.args, {
        cwd: command.cwd,
        timeoutMs: command.timeoutMs,
        stdio: winStdio(),
      });
    },
    async check(): Promise<boolean> {
      const result = await runCommand('opencode', ['--version'], {
        cwd: process.cwd(),
        timeoutMs: 5000,
        stdio: winStdio(),
      });
      return result.exitCode === 0;
    },
    subagentTool(): string { return 'task'; },
    configTemplate(): string { return 'opencode.jsonc'; },
  };
}
