import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evaluateHook } from '../../domains/guard/hook-guard.js';

/**
 * 守卫的**模块归属**（ADR 0028 的守卫扩容）。
 *
 * 多个活跃 change 并存时，旧逻辑一律要求 current-change 指针，否则 fail closed——
 * 于是"并发跑两个 change"在装了守卫的项目里不可能成立。现在先看这次写入落在谁的 module 里：
 * 落在唯一一个 module 内就归它，谁都不落在里面、或同时落在多个里，才回落到指针与 fail closed。
 */

let root: string;

async function writeChange(name: string, module: string, phase = 'build'): Promise<void> {
  const dir = path.join(root, 'changes', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'comet-state.yaml'),
    [
      'schema: cometflow.change.v1',
      'name: ' + name,
      'goal: G1',
      'task: T1',
      'phase: ' + phase,
      'status: active',
      'module: ' + module,
      'archived: false',
      '',
    ].join('\n'),
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-guard-module-'));
  await fs.mkdir(path.join(root, '.cometflow'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('守卫按 module 归属（并发前提）', () => {
  it('两个 build 中的 change、没有指针：写各自的 module 都放行', async () => {
    await writeChange('a-work', 'src/a');
    await writeChange('b-work', 'src/b');

    const inA = await evaluateHook(root, 'write', path.join(root, 'src', 'a', 'index.ts'));
    const inB = await evaluateHook(root, 'write', path.join(root, 'src', 'b', 'index.ts'));
    expect(inA.allowed).toBe(true);
    expect(inB.allowed).toBe(true);
  });

  it('落在谁的 module 里都不是：仍然 fail closed 并给出人话提示', async () => {
    await writeChange('a-work', 'src/a');
    await writeChange('b-work', 'src/b');

    const outside = await evaluateHook(root, 'write', path.join(root, 'src', 'c', 'index.ts'));
    expect(outside.allowed).toBe(false);
    expect(outside.reason).toBe('multiple-active-changes');
    expect(outside.hint).toContain('module');
    expect(outside.hint).toContain('change select');
  });

  it('module 互相包含（归属有歧义）：回落到指针语义，缺指针就拒绝', async () => {
    await writeChange('outer', 'src');
    await writeChange('inner', 'src/inner');

    const ambiguous = await evaluateHook(root, 'write', path.join(root, 'src', 'inner', 'index.ts'));
    expect(ambiguous.allowed).toBe(false);
    expect(ambiguous.reason).toBe('multiple-active-changes');
  });
});
