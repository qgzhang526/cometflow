import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { syncProjectContext } from '../../domains/project/context.js';
import { syncGoals } from '../../domains/goal/goal-sync.js';
import { validateSpecs } from '../../domains/spec/spec-validate.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';

/**
 * `experiments/cbb-emergency-access` 是方案 C 的演示种子：契约 + 判据随仓库分发，
 * 实现由 Agent 产出。它不在任何 CI job 的射程里，所以特别容易「看起来还在、其实已经跑不通」——
 * 这个用例把它钉住三件事：
 *
 * 1. spec 校验通过，且**每条验收都有可执行 check**（没有 check 的任务在无人值守模式下会被
 *    preflight 直接判 unverifiable 停机，这正是这个种子过去不能用来演示 daemon 的原因）；
 * 2. 拆解结果稳定（G1 4 / G2 3 / G3 1 = 8 个任务，A18 绑在 tunnel open 上）；
 * 3. 判据是可满足的：把 reference/src 贴进去后全部 18 条 check 变绿。
 *
 * 判据执行器用 Node 24 的 `node:sqlite`（种子的 COMETFLOW.md 就是这么声明运行环境的）；
 * 运行在更老的 Node 上时第 3 条跳过，其余两条照常。
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEED = path.join(REPO_ROOT, 'experiments', 'cbb-emergency-access');

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// 用子进程探测：在主进程里 import('node:sqlite') 会把 ExperimentalWarning 混进测试输出。
const sqliteAvailable =
  spawnSync(process.execPath, ['-e', "require('node:sqlite')"], { encoding: 'utf8' }).status === 0;

async function seedProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-cbb-seed-'));
  temporaryRoots.push(root);
  const project = path.join(root, 'project');
  await fs.mkdir(path.join(project, '.cometflow'), { recursive: true });
  await fs.cp(path.join(SEED, 'COMETFLOW.md'), path.join(project, 'COMETFLOW.md'));
  await fs.cp(path.join(SEED, 'specs'), path.join(project, 'specs'), { recursive: true });
  await fs.cp(path.join(SEED, 'tests'), path.join(project, 'tests'), { recursive: true });
  await fs.writeFile(path.join(project, '.cometflow', 'config.yaml'), 'schema: cometflow.project.v1\n');
  await syncProjectContext(project);
  await syncGoals(project);
  return project;
}

describe('experiments/cbb-emergency-access（方案 C：契约 + 可执行判据）', () => {
  it('spec 校验通过，且没有「验收项缺可执行 check」的发现', async () => {
    const project = await seedProject();
    const result = await validateSpecs(project);
    const errors = result.findings.filter((finding) => finding.severity === 'error');
    expect(errors.map((finding) => finding.code + ' ' + finding.path + ' ' + finding.message)).toEqual([]);
    const withoutCheck = result.findings.filter((finding) => finding.code === 'acceptance-without-check');
    expect(withoutCheck.map((finding) => finding.path)).toEqual([]);
  });

  it('拆解出 8 个任务：G1 4 个、G2 3 个、G3 1 个，A18 绑在 tunnel open 上', async () => {
    const project = await seedProject();
    const g1 = await freezeTaskPlan(project, await generateTaskPlan(project, 'G1'));
    const g2 = await freezeTaskPlan(project, await generateTaskPlan(project, 'G2'));
    const g3 = await freezeTaskPlan(project, await generateTaskPlan(project, 'G3'));
    expect([g1.tasks.length, g2.tasks.length, g3.tasks.length]).toEqual([4, 3, 1]);
    const open = g2.tasks.find((task) => task.spec_anchor === 'POST /api/emergency/tunnel/open');
    expect(open?.acceptance_ids).toEqual(['A9', 'A10', 'A11', 'A18']);
    expect(open?.module).toBe('src/tunnel');
    for (const plan of [g1, g2, g3]) {
      for (const task of plan.tasks) {
        expect(task.status).toBe('frozen');
        expect(task.spec_hash).not.toBeNull();
      }
    }
  });

  it.skipIf(!sqliteAvailable)('reference/src 能让全部 18 条判据变绿', async () => {
    const project = await seedProject();
    await fs.cp(path.join(SEED, 'reference', 'src'), path.join(project, 'src'), { recursive: true });
    const result = spawnSync(process.execPath, ['tests/acceptance.mjs'], { cwd: project, encoding: 'utf8' });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('acceptance: OK (18/18)');
  });
});
