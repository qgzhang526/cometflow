import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectMetrics } from '../../domains/metrics/metrics-service.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { verifyChange } from '../../domains/workflow/change-execution.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';

const FIXED_NOW = new Date('2026-09-14T12:00:00.000Z');

// 这个文件要为每个 change 反复 spawn 验收 check（node 子进程），
// 并行跑整套时会超过 5s 默认超时。
vi.setConfig({ testTimeout: 30_000 });

const mission = [
  '# 项目使命',
  '',
  '内部平台。',
  '',
  '## 技术栈',
  '',
  '| 维度 | 值 |',
  '|------|-----|',
  '| 后端 | Node.js |',
  '| 数据库 | 无 |',
  '| 测试框架 | vitest |',
  '| 构建工具 | tsc |',
  '',
  '## 运行环境',
  '',
  '| 维度 | 值 |',
  '|------|-----|',
  '| 操作系统 | Linux |',
  '| 语言版本 | Node.js 22 |',
  '',
  '## 任务目标',
  '',
  '### G1：认证',
  '- 目标：支持邮箱验证码登录',
  '- 范围：auth',
  '- 成功标准：',
  '  - 验证码错误返回 401',
  '',
].join('\n');

const spec = [
  '---',
  'capability: auth',
  'module: src/auth',
  '---',
  '',
  '# auth capability',
  '',
  '## POST /api/auth/email-login',
  '',
  '使用邮箱验证码登录。',
  '',
  '## Acceptance',
  '',
  '- A1：验证码正确时可以登录',
  '  - check: node -e "process.exit(Number(process.env.CHECK_A1 || 0))"',
  '',
].join('\n');

let tmp: string;

async function setupProject(): Promise<void> {
  await fs.mkdir(path.join(tmp, 'specs', 'auth'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'COMETFLOW.md'), mission);
  await fs.writeFile(path.join(tmp, 'specs', 'auth', 'spec.md'), spec);
  const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1'));
  await writeTaskPlan(tmp, plan);
  process.env.CHECK_A1 = '0';
}

async function newChange(name: string): Promise<void> {
  await createChangeFromTask({ projectRoot: tmp, goalId: 'G1', taskId: 'T1', changeName: name });
  const state = await readChangeState(tmp, name);
  await writeChangeState(tmp, applyChangeTransition(state, 'confirm-acceptance'));
}

async function toVerify(name: string): Promise<void> {
  const state = await readChangeState(tmp, name);
  await writeChangeState(tmp, applyChangeTransition(state, 'submit-candidate'));
}

async function verify(name: string): Promise<boolean> {
  return (await verifyChange(tmp, name)).reportPassed;
}

/** 跑完整链路直到归档：verify-pass → archive。 */
async function archive(name: string): Promise<void> {
  // verifyChange 通过时内部已经做了 verify-pass 转换，阶段已是 archive。
  const { archiveChange } = await import('../../domains/workflow/change-execution.js');
  await archiveChange(tmp, name);
}

async function snapshotRuntime(): Promise<string> {
  const root = path.join(tmp, '.cometflow');
  const entries: string[] = [];
  async function walk(directory: string): Promise<void> {
    let listing;
    try {
      listing = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of listing) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(absolute);
      entries.push(path.relative(tmp, absolute) + ':' + stat.size + ':' + stat.mtimeMs);
    }
  }
  await walk(root);
  return entries.sort().join('\n');
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-metrics-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('rebuild metrics', () => {
  it('derives first-pass rate, attempts to pass and blocked rate from journals', async () => {
    await setupProject();

    // A：一次通过并归档
    await newChange('change-a');
    await toVerify('change-a');
    expect(await verify('change-a')).toBe(true);
    await archive('change-a');

    // B：失败一轮后通过
    await newChange('change-b');
    process.env.CHECK_A1 = '1';
    await toVerify('change-b');
    expect(await verify('change-b')).toBe(false);
    process.env.CHECK_A1 = '0';
    await toVerify('change-b');
    expect(await verify('change-b')).toBe(true);

    // C：连续同一失败结论 → 停机
    await newChange('change-c');
    process.env.CHECK_A1 = '1';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await toVerify('change-c');
      expect(await verify('change-c')).toBe(false);
    }
    // D：创建但从未验证（不应进入样本）
    await newChange('change-d');

    const report = await collectMetrics(tmp, { now: FIXED_NOW });
    expect(report.project.changes).toBe(4);
    expect(report.project.archived_changes).toBe(1);

    const rebuild = report.rebuild;
    expect(rebuild.sample_size).toBe(3);
    expect(rebuild.first_pass_rate).toBeCloseTo(1 / 3, 4);
    expect(rebuild.mean_attempts_to_pass).toBe(0.5);
    expect(rebuild.blocked_rate).toBeCloseTo(1 / 3, 4);
    expect(rebuild.check_coverage_rate).toBe(1);
    expect(rebuild.verdict_sources.check).toBe(3);
    expect(rebuild.per_capability.map((bucket) => bucket.key)).toEqual(['auth']);
    expect(rebuild.per_capability[0].sample_size).toBe(3);
    expect(rebuild.per_module.map((bucket) => bucket.key)).toEqual(['src/auth']);

    const blockedSample = rebuild.samples.find((sample) => sample.change === 'change-c');
    expect(blockedSample?.outcome).toBe('blocked');
    expect(blockedSample?.attempts_to_pass).toBeNull();
    const neverVerified = rebuild.samples.find((sample) => sample.change === 'change-d');
    expect(neverVerified?.outcome).toBe('unverified');
  });

  it('is reproducible: same input and same now produce identical output', async () => {
    await setupProject();
    await newChange('change-a');
    await toVerify('change-a');
    await verify('change-a');

    const first = await collectMetrics(tmp, { now: FIXED_NOW });
    const second = await collectMetrics(tmp, { now: FIXED_NOW });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('is read-only: running it does not touch .cometflow', async () => {
    await setupProject();
    await newChange('change-a');
    await toVerify('change-a');
    await verify('change-a');

    const before = await snapshotRuntime();
    await collectMetrics(tmp, { now: FIXED_NOW });
    expect(await snapshotRuntime()).toBe(before);
  });

  it('reports nulls instead of zeros when there is nothing to measure', async () => {
    // 空项目：既没有 spec 也没有 change。
    const report = await collectMetrics(tmp, { now: FIXED_NOW });
    expect(report.rebuild.sample_size).toBe(0);
    expect(report.rebuild.first_pass_rate).toBeNull();
    expect(report.rebuild.mean_attempts_to_pass).toBeNull();
    expect(report.rebuild.blocked_rate).toBeNull();
    expect(report.spec_health.acceptance_checkable_rate).toBeNull();
    expect(report.notes.length).toBeGreaterThan(0);
  });

  it('flags a sample that is too small to draw conclusions from', async () => {
    await setupProject();
    await newChange('change-a');
    await toVerify('change-a');
    await verify('change-a');

    const report = await collectMetrics(tmp, { now: FIXED_NOW });
    expect(report.notes.some((note) => note.includes('样本量仅 1'))).toBe(true);
  });
});

describe('spec health metrics', () => {
  it('measures acceptance checkability, anchor coverage and version tracking', async () => {
    await setupProject();
    const report = await collectMetrics(tmp, { now: FIXED_NOW });
    const health = report.spec_health;

    expect(health.acceptance_total).toBe(1);
    expect(health.acceptance_with_check).toBe(1);
    expect(health.acceptance_checkable_rate).toBe(1);
    // 计划已冻结，唯一 anchor 被任务绑定。
    expect(health.anchor_total).toBe(1);
    expect(health.anchor_bound).toBe(1);
    expect(health.anchor_coverage_rate).toBe(1);
    expect(health.drift.count).toBe(0);
    // plan freeze 会登记版本。
    expect(health.versions.specs_tracked).toBeGreaterThan(0);
    expect(health.versions.total_versions).toBeGreaterThan(0);
  });

  it('reports unbound anchors and drift after the spec moves', async () => {
    await setupProject();
    await fs.appendFile(
      path.join(tmp, 'specs', 'auth', 'spec.md'),
      '\n## POST /api/auth/logout\n\n登出。\n',
    );

    const report = await collectMetrics(tmp, { now: FIXED_NOW });
    const health = report.spec_health;
    expect(health.anchor_total).toBe(2);
    expect(health.anchor_bound).toBe(1);
    expect(health.entries[0].uncovered_anchors).toContain('POST /api/auth/logout');

    // 改 spec 但没重新冻结 → 冻结任务漂移；新增的是文件里其它位置的 anchor，
    // 所以分类应是 file-changed-anchor-unchanged（低严重度），而不是 anchor-modified。
    expect(health.drift.count).toBe(1);
    expect(health.drift.by_kind['file-changed-anchor-unchanged']).toBe(1);
    expect(health.drift.by_severity.low).toBe(1);
    expect(report.rebuild.total_changes).toBe(0);
  });
});
