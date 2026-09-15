import { constants, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * 判断一条**命令字符串**在当前机器上能不能跑起来。
 *
 * 为什么需要它：`COMETFLOW_CLI` 不是文件路径，而是**命令行前缀**——
 * `node "D:/x/cli.js"`、`cometflow`、`C:\tools\cometflow.cmd` 都是合法取值。
 * 守卫在 CLI 不可用时会放行（ADR 0023 决策 5），所以「配了一条跑不起来的命令」
 * 等于写保护静默失效，必须有人能把它查出来。
 *
 * 全程只读、不抛错：解析不了就返回原因，交给调用方决定严重级别。
 */
export interface CommandResolution {
  /** 命令行前缀，原样保留。 */
  command: string;
  /** 首个 token：真正被执行的命令。 */
  executable: string;
  /** 解析到的绝对路径；解析不到为 null。 */
  path: string | null;
  resolved: boolean;
  /** 解析失败的原因（人类可读）。 */
  detail: string | null;
}

/** 按 shell 习惯拆 token：支持单双引号，反斜杠不做特殊处理（Windows 路径要能原样通过）。 */
export function splitCommandTokens(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const char of input) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

function isRunnableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
  } catch {
    return false;
  }
  // Windows 上没有可执行位这个概念，能作为文件存在就够了（.exe/.cmd/.bat 由 PATHEXT 匹配）。
  if (process.platform === 'win32') return true;
  try {
    return (statSync(candidate).mode & constants.S_IXUSR) !== 0;
  } catch {
    return false;
  }
}

/**
 * 在 PATH 上找命令。Windows 认 PATHEXT；名字自带扩展名时先按原样找一次。
 */
function findOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const pathValue = env.PATH ?? env.Path ?? env.path ?? '';
  const directories = pathValue.split(path.delimiter).filter((entry) => entry !== '');
  const extensions =
    process.platform === 'win32'
      ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((entry) => entry !== '')
      : [];
  // 自带扩展名（`claude.exe`）时先按原样找一次，否则补 PATHEXT 再找。
  const candidates = [name, ...extensions.map((extension) => name + extension)];
  for (const directory of directories) {
    for (const candidate of candidates) {
      const full = path.join(directory, candidate);
      if (isRunnableFile(full)) return full;
    }
  }
  return null;
}

/** 名字里带路径分隔符（或就是绝对路径）时按路径解析，否则当命令名去 PATH 上找。 */
function looksLikePath(name: string): boolean {
  return path.isAbsolute(name) || name.includes('/') || name.includes('\\');
}

export function resolveCommand(
  command: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): CommandResolution {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const trimmed = command.trim();
  const tokens = splitCommandTokens(trimmed);
  if (tokens.length === 0) {
    return { command, executable: '', path: null, resolved: false, detail: '命令为空' };
  }

  // 先试「整条就是路径」：`COMETFLOW_CLI` 常常被写成**未加引号**的带空格路径
  // （`C:\Program Files\nodejs\node.exe`），按 token 拆会从空格处被切碎 ——
  // 与守卫在 Windows 上踩过的坑同源。整条能当文件用时优先按文件解释。
  if (looksLikePath(trimmed)) {
    const direct = path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
    if (isRunnableFile(direct)) {
      return { command, executable: trimmed, path: direct, resolved: true, detail: null };
    }
  }

  const executable = tokens[0];

  if (looksLikePath(executable)) {
    const full = path.isAbsolute(executable) ? executable : path.resolve(cwd, executable);
    if (isRunnableFile(full)) {
      return { command, executable, path: full, resolved: true, detail: null };
    }
    return { command, executable, path: null, resolved: false, detail: '文件不存在或不可执行：' + full };
  }

  const found = findOnPath(executable, env);
  if (found !== null) {
    return { command, executable, path: found, resolved: true, detail: null };
  }
  return {
    command,
    executable,
    path: null,
    resolved: false,
    detail: '命令 "' + executable + '" 不在 PATH 上',
  };
}
