import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseGoals } from '../../domains/goal/goal-sync.js';
import { compareGoals, parseScheduleOrder } from '../../domains/goal/schedule-order.js';

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
   *
   * `only` 只贴指定的 capability（共享层 app / store 与进程入口 cmd 总是贴）——
   * 「只交付前几个模块」这种半成品仓库就是这么拼出来的。
   */
  async function applyReference(only?: readonly string[]): Promise<void> {
    const shared = ['app', 'store'];
    for (const [from, to] of [
      ['internal', 'internal'] as const,
      ['cmd', 'cmd'] as const,
    ]) {
      const source = path.join(SEED, '_reference', from);
      const target = path.join(dir, to);
      await mkdir(target, { recursive: true });
      for (const entry of await readdir(source)) {
        if (from === 'internal' && only && !only.includes(entry) && !shared.includes(entry)) continue;
        await cp(path.join(source, entry), path.join(target, entry), { recursive: true });
      }
    }
  }

  /** 从 spec 里读某个 capability 声明的验收编号（`- A7：...`）。 */
  async function acceptanceIds(capability: string): Promise<string[]> {
    const spec = await readFile(path.join(dir, 'specs', capability, 'spec.md'), 'utf8');
    return [...spec.matchAll(/^-\s*(A\d+)\s*[：:]/gmu)].map((match) => match[1]);
  }

  /** 按「只交付前 N 个 capability」的方式贴参考实现，跑已交付模块的判据。 */
  async function runChecks(ids: readonly string[]) {
    const pattern = '^(' + ids.map((id) => 'Test' + id).join('|') + ')$';
    const result = spawnSync('go', ['test', './tests/acceptance', '-run', pattern, '-count=1', '-v'], {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    const output = result.stdout + result.stderr;
    const passed = output.match(/^--- PASS: TestA\d+/gm) ?? [];
    return { status: result.status, output, passed: passed.length, expected: ids.length };
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

  /**
   * 判据的边界就是模块的边界（ADR 0031）。
   *
   * daemon 按 COMETFLOW.md 的调度顺序一条条领任务：G1 的 access 先做，G2 的 tunnel / guard 次之。
   * 于是每个 capability 的判据必须**只靠自己和更早交付的模块**就能满足；一旦某条判据断言了
   * 后面那个模块的事实，Agent 想让它变绿就只能越界去改别人的模块——三轮同指纹，停机等人
   * （ADR 0016）。这里按调度顺序逐个 capability 贴参考实现，每一档都跑「已交付模块」的全部判据，
   * 于是把这种跨模块判据钉在测试里。
   *
   * 历史：`access` 的 A7（吊销）原来多写了一句"该令牌无法再建立通道"（那是 tunnel 的 A18），
   * 结果是 G1:T3 在 internal/access 里怎么做都不对，彩排时被停机。
   */
  it('每条判据只靠自己与更早交付的模块就能满足（验收不跨 capability）', async () => {
    await materialize();
    const mission = await readFile(path.join(SEED, 'COMETFLOW.md'), 'utf8');
    const goals = parseGoals(mission);
    const order = parseScheduleOrder(
      mission,
      goals.map((goal) => goal.id),
    );
    const capabilities = [...goals]
      .sort((left, right) => compareGoals(left.id, right.id, order))
      .flatMap((goal) => goal.scope);
    expect(capabilities.length).toBeGreaterThan(1);

    const delivered: string[] = [];
    const ids: string[] = [];
    for (const capability of capabilities) {
      await applyReference(delivered.concat(capability));
      delivered.push(capability);
      ids.push(...(await acceptanceIds(capability)));

      const result = await runChecks(ids);
      const context =
        '已交付 ' + delivered.join('、') + ' 时，判据 ' + ids.join('/') + ' 应当全绿：\n' + result.output;
      // 数量也要对：`go test -run` 匹配不到任何用例时是"ok ... no tests to run"（退出码 0），
      // 只断言退出码会给出假绿。
      expect(result.passed, context).toBe(result.expected);
      expect(result.status, context).toBe(0);
    }
  }, 600_000);
});
