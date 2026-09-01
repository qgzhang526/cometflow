import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentRunResult } from '../agents/types.js';

const execFileAsync = promisify(execFile);

export interface RunCommandOptions {
  cwd: string;
  timeoutMs?: number;
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<AgentRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return { exitCode: 0, stdout, stderr, timedOut: false };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };
    if (err.code === "ETIMEDOUT" || err.killed) {
      return {
        exitCode: 124,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        timedOut: true,
      };
    }
    if (err.code === "ENOENT") {
      return {
        exitCode: 127,
        stdout: "",
        stderr: command + ": command not found",
        timedOut: false,
      };
    }
    return {
      exitCode: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(error),
      timedOut: false,
    };
  }
}
