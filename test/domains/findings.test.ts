import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectFindings,
  dedupeFindings,
  formatFinding,
  type Finding,
} from '../../domains/gates/findings.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = path.join(REPO_ROOT, 'experiments', 'regression-fixture');

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function copyFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-findings-'));
  temporaryRoots.push(root);
  const target = path.join(root, 'project');
  await fs.cp(FIXTURE, target, { recursive: true });
  return target;
}

function finding(partial: Partial<Finding> & { code: string }): Finding {
  return {
    source: 'doctor',
    severity: 'error',
    subject: '',
    message: 'm',
    ...partial,
  };
}

describe('dedupeFindings', () => {
  it('同 code 同 subject 只留一条，按严重级别排序', () => {
    const result = dedupeFindings([
      finding({ code: 'stale-lock', severity: 'warning' }),
      finding({ code: 'stale-lock', severity: 'warning' }),
      finding({ code: 'invalid-specs', severity: 'error' }),
    ]);

    expect(result.map((entry) => entry.code)).toEqual(['invalid-specs', 'stale-lock']);
  });

  it('同 code 不同 subject 必须分别列出——两个 change 各自漂移是两个问题', () => {
    const result = dedupeFindings([
      finding({ code: 'anchor-drift', subject: 'specs/a.md', source: 'spec-verify' }),
      finding({ code: 'anchor-drift', subject: 'specs/b.md', source: 'spec-verify' }),
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((entry) => entry.subject).sort()).toEqual(['specs/a.md', 'specs/b.md']);
  });
});

describe('formatFinding', () => {
  it('带 subject 与不带 subject 都能读', () => {
    expect(
      formatFinding(finding({ code: 'anchor-drift', subject: 'specs/a.md', message: '锚点不见了', source: 'spec-verify' })),
    ).toBe('ERROR spec-verify anchor-drift specs/a.md — 锚点不见了');
    expect(formatFinding(finding({ code: 'hook-not-installed', severity: 'info', message: '未安装' }))).toBe(
      'INFO doctor hook-not-installed 未安装',
    );
  });
});

describe('collectFindings', () => {
  it('合并两个来源、带上 source、按严重级别排序', async () => {
    const findings = await collectFindings(FIXTURE);

    expect(findings.length).toBeGreaterThan(0);
    expect(
      findings.every((entry) => entry.source === 'spec-verify' || entry.source === 'doctor'),
    ).toBe(true);
    const order = findings.map((entry) => entry.severity);
    expect(order).toEqual([...order].sort((left, right) =>
      ['error', 'warning', 'info'].indexOf(left) - ['error', 'warning', 'info'].indexOf(right),
    ));
  });

  it('不重复呈现 doctor 对 spec verify 的镜像（spec-verify:<code>）', async () => {
    const findings = await collectFindings(FIXTURE);

    expect(findings.some((entry) => entry.code.startsWith('spec-verify:'))).toBe(false);
  });

  it('(code, subject) 不重复', async () => {
    const findings = await collectFindings(FIXTURE);
    const keys = findings.map((entry) => entry.code + '|' + entry.subject);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('spec 结构坏了时，两边各自的问题都出现且归属正确', async () => {
    const project = await copyFixture();
    // init-manifest 声明 errors 是 present：删掉它 → doctor 报 invalid-specs，spec verify 报 lock 不一致。
    await fs.rm(path.join(project, 'specs', 'errors.md'), { force: true });

    const findings = await collectFindings(project);

    expect(findings.some((entry) => entry.source === 'doctor' && entry.code === 'invalid-specs')).toBe(true);
    expect(findings.some((entry) => entry.source === 'spec-verify')).toBe(true);
  });
});
