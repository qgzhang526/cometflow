import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNpmShim } from '../../platform/process/spawn-command.js';

const exeShim = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*',
].join('\n');

const nodeScriptShim = [
  '@IF EXIST "%~dp0\\node.exe" (',
  '  "%~dp0\\node.exe"  "%~dp0\\..\\tsx\\dist\\cli.mjs" %*',
  ') ELSE (',
  '  node  "%~dp0\\..\\tsx\\dist\\cli.mjs" %*',
  ')',
].join('\n');

const progVarShim = [
  'SET "_prog=node"',
  '"%_prog%"  "%dp0%\\node_modules\\pnpm\\bin\\pnpm.cjs" %*',
].join('\n');

describe('npm shim parser', () => {
  it('解析 exe shim（opencode 形式）', () => {
    const shimDir = 'C:\\Users\\me\\AppData\\Roaming\\npm';
    const resolved = parseNpmShim(exeShim, shimDir);
    expect(resolved?.command).toBe(
      path.resolve(shimDir, 'node_modules/opencode-ai/bin/opencode.exe'),
    );
    expect(resolved?.args).toEqual([]);
  });

  it('解析 node 脚本 shim（tsx 形式）', () => {
    const shimDir = path.resolve('D:/repo/node_modules/.bin');
    const resolved = parseNpmShim(nodeScriptShim, shimDir);
    expect(resolved?.command).toBe('node');
    expect(resolved?.args).toEqual([path.resolve('D:/repo/node_modules/tsx/dist/cli.mjs')]);
  });

  it('解析 %_prog% shim（pnpm 形式）', () => {
    const shimDir = 'C:\\Users\\me\\AppData\\Roaming\\npm';
    const resolved = parseNpmShim(progVarShim, shimDir);
    expect(resolved?.command).toBe('node');
    expect(resolved?.args).toEqual([
      path.resolve(shimDir, 'node_modules/pnpm/bin/pnpm.cjs'),
    ]);
  });

  it('非 shim 内容返回 null', () => {
    expect(parseNpmShim('hello world', 'C:\\x')).toBeNull();
  });
});
