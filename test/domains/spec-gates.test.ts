import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { compareToBaseline, runSpecGates } from '../../domains/gates/spec-gates.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = path.join(REPO_ROOT, 'experiments', 'regression-fixture');

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function copyFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-gates-'));
  temporaryRoots.push(root);
  const target = path.join(root, 'project');
  await fs.cp(FIXTURE, target, { recursive: true });
  return target;
}

function step(result: Awaited<ReturnType<typeof runSpecGates>>, name: string) {
  return result.steps.find((entry) => entry.name === name);
}

describe('spec gates（CI 与本地提交门禁的唯一实现）', () => {
  it('在回归夹具上通过，并列出全部判定项', async () => {
    const result = await runSpecGates(FIXTURE);
    const names = result.steps.map((entry) => entry.name);

    expect(result.ok).toBe(true);
    expect(names).toEqual(
      expect.arrayContaining(['spec validate', 'spec verify', 'doctor', 'change gc (dry-run)', 'metrics baseline']),
    );
    expect(names.filter((name) => name.startsWith('plan validate ')).length).toBeGreaterThan(0);
  });

  it('spec validate 真的会失败——它以前永远退出 0，门禁里等于没有判定力', async () => {
    const project = await copyFixture();
    // init-manifest 声明 errors 这个 kind「present」；删掉文件就是结构性缺失。
    await fs.rm(path.join(project, 'specs', 'errors.md'), { force: true });

    const result = await runSpecGates(project);
    const validation = step(result, 'spec validate');

    expect(result.ok).toBe(false);
    expect(validation?.ok).toBe(false);
    expect(validation?.detail).toContain('missing-kind-file');
  });

  it('缺少基线时失败并说明怎么建立', async () => {
    const project = await copyFixture();
    await fs.rm(path.join(project, 'metrics-baseline.json'), { force: true });

    const result = await runSpecGates(project);

    expect(result.ok).toBe(false);
    expect(step(result, 'metrics baseline')?.detail).toContain('--update-baseline');
  });

  it('指标相对基线退化时失败，并指出是哪个指标、往哪个方向变了', async () => {
    const project = await copyFixture();
    const baselinePath = path.join(project, 'metrics-baseline.json');
    const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
    baseline.metrics.anchor_coverage_rate = 0.99; // 越大越好，实际 0.75 → 退化
    await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2) + '\n');

    const result = await runSpecGates(project);

    expect(result.ok).toBe(false);
    expect(step(result, 'metrics baseline')?.detail).toContain('anchor_coverage_rate 退化');
  });

  it('--update-baseline 只重写基线，不改变判定项集合', async () => {
    const project = await copyFixture();
    await fs.rm(path.join(project, 'metrics-baseline.json'), { force: true });

    const result = await runSpecGates(project, { updateBaseline: true });

    expect(step(result, 'metrics baseline')?.ok).toBe(true);
    await expect(fs.access(path.join(project, 'metrics-baseline.json'))).resolves.toBeUndefined();
  });

  it('P3：配了绝对阈值就按阈值判（默认不做任何新增约束）', async () => {
    const project = await copyFixture();
    const configPath = path.join(project, '.cometflow', 'config.yaml');
    await fs.appendFile(configPath, 'gates:\n  metrics:\n    anchor_coverage_rate:\n      min: 0.8\n');

    const result = await runSpecGates(project);

    expect(result.ok).toBe(false);
    expect(step(result, 'metrics thresholds')?.ok).toBe(true);
    expect(step(result, 'metrics baseline')?.detail).toContain('anchor_coverage_rate 低于下限');
  });

  it('P3：阈值配置本身有问题要报错，不能当成没配', async () => {
    const project = await copyFixture();
    await fs.appendFile(
      path.join(project, '.cometflow', 'config.yaml'),
      'gates:\n  metrics:\n    coverage_rate:\n      min: 1\n',
    );

    const result = await runSpecGates(project);
    const thresholds = step(result, 'metrics thresholds');

    expect(result.ok).toBe(false);
    expect(thresholds?.ok).toBe(false);
    expect(thresholds?.detail).toContain('不是已知指标');
  });
});

describe('compareToBaseline', () => {
  it('越大越好的指标下降算退化，越小越好的指标上升算升高', () => {
    const failures = compareToBaseline(
      { acceptance_checkable_rate: 1, drift_count: 0 },
      { acceptance_checkable_rate: 0.5, drift_count: 2 },
    );

    expect(failures).toHaveLength(2);
    expect(failures.join(' ')).toContain('acceptance_checkable_rate 退化');
    expect(failures.join(' ')).toContain('drift_count 升高');
  });

  it('缺数据（null）与缺字段都跳过，不当成退化', () => {
    expect(compareToBaseline({ specs: 3 }, { specs: null })).toEqual([]);
    expect(compareToBaseline({}, { specs: 3 })).toEqual([]);
  });
});
