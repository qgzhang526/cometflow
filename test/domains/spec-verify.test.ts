import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifySpecIntegrity } from '../../domains/spec/spec-verify.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import {
  hasSpecBlob,
  latestSpecVersion,
  specVersionBlobCandidates,
} from '../../domains/spec/spec-version.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');
const specPath = 'specs/auth/spec.md';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-spec-verify-'));
  await fs.cp(fixture, tmp, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function freeze(projectRoot: string) {
  const plan = await freezeTaskPlan(projectRoot, await generateTaskPlan(projectRoot, 'G1'));
  await writeTaskPlan(projectRoot, plan);
  return plan;
}

describe('spec integrity gate', () => {
  it('passes on a freshly frozen project', async () => {
    await freeze(tmp);
    const result = await verifySpecIntegrity(tmp);
    expect(result.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('fails when the spec no longer matches the recorded baseline', async () => {
    await freeze(tmp);
    await fs.appendFile(path.join(tmp, specPath), '\n## POST /api/auth/logout\n\n登出。\n');
    const result = await verifySpecIntegrity(tmp);
    expect(result.valid).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain('stale-spec-lock');
  });

  it('fails when the frozen content is missing from the version store', async () => {
    await freeze(tmp);
    const version = await latestSpecVersion(tmp, specPath);
    // 用领域 API 取候选路径，而不是硬编码目录：版本仓曾从 .cometflow/ 迁到 .cometflow-history/，
    // 硬编码旧路径的写法只在「本地恰好有旧副本」时才成立，干净检出上会直接失败。
    for (const candidate of specVersionBlobCandidates(tmp, version!.hash)) {
      await fs.rm(candidate, { force: true });
    }
    // 前置断言：删干净了才谈得上「缺失」，否则测试会静默验证错误的前提。
    expect(await hasSpecBlob(tmp, version!.hash)).toBe(false);

    const result = await verifySpecIntegrity(tmp);
    expect(result.valid).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain('missing-version-blob');
  });

  it('fails when a frozen anchor has drifted', async () => {
    await freeze(tmp);
    const file = path.join(tmp, specPath);
    const source = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, source.replace('使用邮箱验证码登录。', '使用邮箱验证码或密码登录。'));
    const result = await verifySpecIntegrity(tmp);
    const codes = result.findings.map((finding) => finding.code);
    expect(codes).toContain('stale-spec-lock');
    expect(codes).toContain('anchor-drift');
  });

  it('fails when an acceptance item is rewritten under the same id', async () => {
    await freeze(tmp);
    const file = path.join(tmp, specPath);
    const source = await fs.readFile(file, 'utf8');
    await fs.writeFile(
      file,
      source.replace('未注册邮箱可以获取验证码', '任何邮箱都可以获取验证码'),
    );
    const result = await verifySpecIntegrity(tmp);
    expect(result.findings.map((finding) => finding.code)).toContain('acceptance-drift');
  });

  it('fails when two anchors share a heading', async () => {
    await freeze(tmp);
    await fs.appendFile(
      path.join(tmp, specPath),
      '\n## POST /api/auth/register\n\n重复标题。\n',
    );
    const result = await verifySpecIntegrity(tmp);
    expect(result.findings.map((finding) => finding.code)).toContain('duplicate-anchor');
  });

  it('fails when an active change baseline conflicts with the canonical spec', async () => {
    const plan = await freeze(tmp);
    await createChangeFromTask({
      projectRoot: tmp,
      goalId: 'G1',
      taskId: plan.tasks[0].id,
      changeName: 'auth-email-login',
    });
    await fs.appendFile(path.join(tmp, specPath), '\n## POST /api/auth/logout\n\n登出。\n');

    const result = await verifySpecIntegrity(tmp);
    expect(result.valid).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain('change-base-conflict');
  });
});
