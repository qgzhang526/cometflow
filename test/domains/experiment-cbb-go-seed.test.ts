import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Go 版 CBB 种子的回归：证明「贴入参考实现后 18 条判据可满足」。
 *
 * 与 Node 版种子那条测试同源（experiment-cbb-seed.test.ts），差别是判据用 go test 执行。
 * 没装 Go 工具链时整条跳过——平台自身的 CI 不强制装 Go，装了才有这条覆盖。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SEED = path.join(REPO, 'experiments', 'cbb-emergency-access-go');

function hasGo(): boolean {
  try {
    execFileSync('go', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const goAvailable = hasGo();

describe.skipIf(!goAvailable)('Go 版 CBB 种子（可被 Agent 重建）', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'cometflow-cbb-go-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function materialize(): Promise<void> {
    for (const entry of ['COMETFLOW.md', 'go.mod', 'go.sum', 'specs', 'tests', 'internal']) {
      await cp(path.join(SEED, entry), path.join(dir, entry), { recursive: true });
    }
  }

  /**
   * 把 _reference 下的内容贴进项目。
   *
   * 注意逐个孩子复制：`cp(src, dest)` 在 dest 已存在目录时会把 src 塞成子目录
   * （dest/src），参考实现就落不到该在的位置上——这个坑在 PowerShell 那边也踩过一次。
   */
  async function applyReference(): Promise<void> {
    for (const [from, to] of [
      ['internal', 'internal'],
      ['cmd', 'cmd'],
    ]) {
      const source = path.join(SEED, '_reference', from);
      const target = path.join(dir, to);
      await mkdir(target, { recursive: true });
      for (const entry of await readdir(source)) {
        await cp(path.join(source, entry), path.join(target, entry), { recursive: true });
      }
    }
  }

  it('种子里没有实现：判据是红的，且报「缺少实现」', async () => {
    await materialize();
    const result = spawnSync('go', ['test', './tests/acceptance', '-run', '^TestA1$', '-count=1'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('缺少实现');
  }, 120_000);

  it('贴入参考实现后：18 条判据全部通过', async () => {
    await materialize();
    // 参考实现放在 _reference/（Go 忽略下划线开头的目录），按种子 README 的方式贴进来。
    await applyReference();

    const result = spawnSync('go', ['test', './tests/acceptance', '-count=1', '-v'], {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    const output = result.stdout + result.stderr;
    expect(output).not.toContain('--- FAIL');
    expect(result.status).toBe(0);

    // go test -v 的输出形如 `--- PASS: TestA1 (0.07s)`，耗时在括号里。
    const passed = output.match(/^--- PASS: TestA\d+/gm) ?? [];
    expect(passed).toHaveLength(18);
  }, 300_000);

  it('技术栈与模块归属声明的是 Go，不是 Node', async () => {
    await materialize();
    const mission = await readFile(path.join(dir, 'COMETFLOW.md'), 'utf8');
    expect(mission).toContain('| 后端 | Go |');
    expect(mission).toContain('go test');
    expect(mission).toContain('internal/store');
    expect(mission).not.toContain('node:sqlite');

    const spec = await readFile(path.join(dir, 'specs', 'access', 'spec.md'), 'utf8');
    expect(spec).toContain('module: internal/access');
    expect(spec).toContain("go test ./tests/acceptance -run '^TestA1$' -count=1");
  }, 120_000);
});
