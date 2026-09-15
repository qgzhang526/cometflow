import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveCommand, splitCommandTokens } from '../../platform/process/resolve-command.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe('splitCommandTokens', () => {
  it('按 shell 习惯拆 token，引号内保留空格', () => {
    expect(splitCommandTokens('node "D:/x y/cli.js"')).toEqual(['node', 'D:/x y/cli.js']);
    expect(splitCommandTokens('  cometflow  ')).toEqual(['cometflow']);
    expect(splitCommandTokens('')).toEqual([]);
  });

  it('反斜杠不做转义，Windows 路径原样保留', () => {
    expect(splitCommandTokens('C:\\Program Files\\cometflow.exe')).toEqual([
      'C:\\Program',
      'Files\\cometflow.exe',
    ]);
    expect(splitCommandTokens('"C:\\Program Files\\cometflow.exe"')).toEqual([
      'C:\\Program Files\\cometflow.exe',
    ]);
  });
});

describe('resolveCommand', () => {
  it('裸命令名能在 PATH 上找到（node 一定在）', () => {
    const resolution = resolveCommand('node');

    expect(resolution.resolved).toBe(true);
    expect(resolution.executable).toBe('node');
    expect(resolution.path).not.toBeNull();
  });

  it('带参数的命令行前缀只解析首个 token', () => {
    const resolution = resolveCommand('node "D:/somewhere/cli.js" --flag');

    expect(resolution.resolved).toBe(true);
    expect(resolution.executable).toBe('node');
  });

  it('绝对路径按文件解析，存在即可用', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-resolve-'));
    temporaryRoots.push(root);
    const script = path.join(root, 'cli.mjs');
    await fs.writeFile(script, '// noop\n');
    await fs.chmod(script, 0o755).catch(() => undefined);

    const found = resolveCommand(script);
    expect(found.resolved).toBe(true);
    expect(found.path).toBe(script);

    const missing = resolveCommand(path.join(root, 'nope.mjs'));
    expect(missing.resolved).toBe(false);
    expect(missing.detail).toContain('文件不存在或不可执行');
  });

  it('命令不在 PATH 上时给出原因', () => {
    const resolution = resolveCommand('definitely-not-a-real-cli-xyz');

    expect(resolution.resolved).toBe(false);
    expect(resolution.detail).toContain('不在 PATH 上');
  });

  it('未加引号但含空格的绝对路径仍按整条路径解析（Windows 上很常见）', () => {
    // Windows 的 `C:\Program Files\nodejs\node.exe` 就是这种形态：按空格拆会切碎。
    const resolution = resolveCommand(process.execPath);

    expect(resolution.resolved).toBe(true);
    expect(resolution.path).toBe(process.execPath);
  });

  it('空命令不抛错', () => {
    const resolution = resolveCommand('   ');

    expect(resolution.resolved).toBe(false);
    expect(resolution.detail).toBe('命令为空');
  });

  it('Windows 上认 PATHEXT（用显式 PATH 模拟）', () => {
    if (process.platform !== 'win32') return;
    const resolution = resolveCommand('cmd', { env: { PATH: process.env.PATH ?? '', PATHEXT: '.EXE' } });

    expect(resolution.resolved).toBe(true);
  });
});
