import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AgentRunResult } from '../agents/types.js';

const execFileAsync = promisify(execFile);

export interface RunCommandOptions {
  cwd: string;
  timeoutMs?: number;
  /**
   * pipe（默认）捕获输出；inherit 直接继承父进程控制台。
   * Windows 下部分控制台程序（如 opencode.exe）被 pipe stdio 拉起会卡死，需要 inherit。
   */
  stdio?: 'pipe' | 'inherit';
}

interface ResolvedCommand {
  command: string;
  args: string[];
}

const SCRIPT_EXTENSION = /\.(?:js|mjs|cjs)$/iu;

/**
 * 解析 npm/pnpm 生成的 Windows cmd shim，找到真正要执行的程序与前置参数。
 *
 * 例如：
 *   - exe shim:  "%dp0%\node_modules\opencode-ai\bin\opencode.exe" %*
 *   - node shim: node  "%~dp0\..\tsx\dist\cli.mjs" %*
 *   - %_prog%:   "%_prog%"  "%dp0%\node_modules\pnpm\bin\pnpm.cjs" %*
 *
 * 返回 null 表示无法解析（非 shim 格式）。
 */
export function parseNpmShim(content: string, shimDir: string): ResolvedCommand | null {
  const lines = content.split(/\r?\n/u);
  let invocation: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.includes('%*')) continue;
    if (!trimmed.includes('"') && !/^node(?:\s|$)/iu.test(trimmed)) continue;
    invocation = trimmed;
  }
  if (!invocation) return null;

  // pnpm 全局 shim 通过 %_prog% 间接指向 node 或 %dp0%\node.exe
  let expanded = invocation;
  const progVar = /SET\s+"?_prog=([^"]+)"?/iu.exec(content);
  if (progVar) {
    const value = progVar[1].trim();
    expanded = expanded.replace(
      /%_prog%/giu,
      value.toLowerCase().includes('node.exe') ? shimDir + path.sep + 'node.exe' : 'node',
    );
  }

  const tokens: string[] = [];
  const tokenRe = /"([^"]*)"|(\S+)/gu;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(expanded)) !== null) {
    tokens.push(match[1] ?? match[2]);
  }
  if (tokens.length === 0) return null;

  const expand = (token: string): string => {
    const replaced = token.replace(/%~dp0|%dp0%/giu, shimDir);
    return path.resolve(shimDir, replaced);
  };

  let program = tokens[0];
  const prefixArgs: string[] = [];
  const firstLower = program.toLowerCase();
  if (firstLower === 'node' || firstLower === 'node.exe') {
    program = firstLower === 'node.exe' ? expand(program) : 'node';
    if (tokens[1]) prefixArgs.push(expand(tokens[1]));
  } else {
    program = expand(program);
    if (SCRIPT_EXTENSION.test(program)) {
      prefixArgs.unshift(program);
      program = 'node';
    }
  }
  return { command: program, args: prefixArgs };
}

/**
 * Windows 上 execFile 无法直接执行 .cmd/.bat shim（ENOENT）。
 * 在 PATH 中查找 <command>.cmd/.bat 并解析其真实目标（如 npm 全局安装的 CLI）。
 */
export async function resolveWindowsShim(command: string): Promise<ResolvedCommand | null> {
  if (process.platform !== 'win32') return null;
  const hasExtension = path.extname(command) !== '';
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidates = hasExtension
      ? [path.join(dir, command)]
      : [path.join(dir, command + '.cmd'), path.join(dir, command + '.bat')];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        const parsed = parseNpmShim(await fs.readFile(candidate, 'utf8'), path.dirname(candidate));
        if (parsed) return parsed;
      } catch {
        // 继续搜索下一个候选
      }
    }
  }
  return null;
}

async function runSpawnInherit(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<AgentRunResult> {
  // Windows 下部分控制台程序（opencode.exe）经 execFile 的管道关闭等待会卡在实例初始化；
  // 用 spawn + stdio inherit + 手动超时更稳定（实测 3/3 成功）。
  let target: ResolvedCommand = { command, args: [] };
  if (process.platform === 'win32') {
    const resolved = await resolveWindowsShim(command);
    if (resolved) target = resolved;
  }
  return new Promise<AgentRunResult>((resolvePromise) => {
    const child = spawn(target.command, [...target.args, ...args], {
      cwd: options.cwd,
      stdio: 'inherit',
      windowsHide: false,
    });
    let timedOut = false;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill();
          }, options.timeoutMs);
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolvePromise({
        exitCode: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 1,
        stdout: '',
        stderr: error.message,
        timedOut: false,
      });
    });
    child.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      resolvePromise({
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout: '',
        stderr: '',
        timedOut,
      });
    });
  });
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<AgentRunResult> {
  if (options.stdio === 'inherit' && process.platform === 'win32') {
    return runSpawnInherit(command, args, options);
  }
  const execOptions = {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    maxBuffer: options.stdio === 'inherit' ? undefined : 16 * 1024 * 1024,
    windowsHide: true,
    stdio: options.stdio ?? 'pipe',
  };

  try {
    const { stdout, stderr } = await execFileAsync(command, args, execOptions);
    return { exitCode: 0, stdout, stderr, timedOut: false };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };
    if (err.code === 'ETIMEDOUT' || err.killed) {
      return {
        exitCode: 124,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
        timedOut: true,
      };
    }
    if (err.code === 'ENOENT' && process.platform === 'win32') {
      const resolved = await resolveWindowsShim(command);
      if (resolved) {
        try {
          const { stdout, stderr } = await execFileAsync(
            resolved.command,
            [...resolved.args, ...args],
            execOptions,
          );
          return { exitCode: 0, stdout, stderr, timedOut: false };
        } catch (retryError) {
          const retry = retryError as NodeJS.ErrnoException & {
            stdout?: string;
            stderr?: string;
            killed?: boolean;
          };
          if (retry.code === 'ETIMEDOUT' || retry.killed) {
            return {
              exitCode: 124,
              stdout: retry.stdout ?? '',
              stderr: retry.stderr ?? '',
              timedOut: true,
            };
          }
          if (retry.code === 'ENOENT') {
            return { exitCode: 127, stdout: '', stderr: command + ': command not found', timedOut: false };
          }
          return {
            exitCode: typeof retry.code === 'number' ? retry.code : 1,
            stdout: retry.stdout ?? '',
            stderr: retry.stderr ?? String(retryError),
            timedOut: false,
          };
        }
      }
    }
    if (err.code === 'ENOENT') {
      return {
        exitCode: 127,
        stdout: '',
        stderr: command + ': command not found',
        timedOut: false,
      };
    }
    return {
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? String(error),
      timedOut: false,
    };
  }
}
