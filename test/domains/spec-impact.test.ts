import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyzeSpecImpact } from '../../domains/spec/spec-impact.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');
const specPath = 'specs/auth/spec.md';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-spec-impact-'));
  await fs.cp(fixture, tmp, { recursive: true });
  await writeTaskPlan(tmp, await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1')));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeSpec(content: string): Promise<void> {
  await fs.writeFile(path.join(tmp, specPath), content);
}

const base = [
  '# auth capability',
  '',
  '## POST /api/auth/email-login',
  '',
  '使用邮箱验证码登录。',
  '',
  '## POST /api/auth/register',
  '',
  '注册新用户。',
  '',
  '## Acceptance',
  '',
  '- A1：未注册邮箱可以获取验证码',
  '- A2：验证码错误返回 401 INVALID_CODE',
  '',
].join('\n');

describe('spec impact analysis', () => {
  it('reports nothing when specs match the recorded baseline', async () => {
    const report = await analyzeSpecImpact(tmp);
    expect(report.files).toHaveLength(0);
    expect(report.summary.highest_severity).toBe('none');
  });

  it('flags a changed acceptance item as high severity and ties it to the frozen task', async () => {
    await writeSpec(base.replace('- A2：验证码错误返回 401 INVALID_CODE', '- A2：验证码错误返回 403 FORBIDDEN'));
    const report = await analyzeSpecImpact(tmp);

    const file = report.files.find((entry) => entry.path === specPath);
    expect(file).toBeDefined();
    expect(file!.anchors.map((anchor) => anchor.change)).toContain('acceptance-changed');
    expect(report.summary.highest_severity).toBe('high');
    expect(report.affected_tasks.map((task) => task.task).sort()).toEqual(['T1', 'T2']);
  });

  it('distinguishes a renamed anchor from a deleted one', async () => {
    await writeSpec(base.replace('## POST /api/auth/register', '## POST /api/auth/sign-up'));
    const report = await analyzeSpecImpact(tmp);
    const file = report.files.find((entry) => entry.path === specPath);
    const rename = file!.anchors.find((anchor) => anchor.heading === 'POST /api/auth/register');

    expect(rename?.change).toBe('renamed');
    expect(rename?.renamed_to).toBe('POST /api/auth/sign-up');
    expect(rename?.severity).toBe('medium');
  });

  it('marks an anchor body edit as medium impact and leaves the other anchor alone', async () => {
    await writeSpec(base.replace('使用邮箱验证码登录。', '使用邮箱验证码或密码登录。'));
    const report = await analyzeSpecImpact(tmp);
    const file = report.files.find((entry) => entry.path === specPath);

    expect(file!.anchors).toHaveLength(1);
    expect(file!.anchors[0].change).toBe('modified');
    expect(file!.anchors[0].severity).toBe('medium');
  });

  it('detects a brand new spec file as an untracked change', async () => {
    await fs.mkdir(path.join(tmp, 'specs', 'billing'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, 'specs', 'billing', 'spec.md'),
      '# billing\n\n## POST /api/billing/pay\n\n支付。\n',
    );
    const report = await analyzeSpecImpact(tmp);

    expect(report.files.map((entry) => entry.path)).toContain('specs/billing/spec.md');
    expect(report.untracked_changes).toContain('specs/billing/spec.md');
  });

  it('reports a deleted spec file as high severity for its frozen tasks', async () => {
    await fs.rm(path.join(tmp, specPath));
    const report = await analyzeSpecImpact(tmp);
    expect(report.summary.highest_severity).toBe('high');
    expect(report.affected_tasks).toHaveLength(2);
  });

  it('previews a proposed spec overlay without touching the canonical file', async () => {
    const proposed = base.replace('使用邮箱验证码登录。', '使用邮箱验证码或密码登录。');
    const report = await analyzeSpecImpact(tmp, { overlay: { [specPath]: proposed } });

    const file = report.files.find((entry) => entry.path === specPath);
    expect(file?.anchors.map((anchor) => anchor.heading)).toEqual(['POST /api/auth/email-login']);
    expect(file?.anchors[0].change).toBe('modified');
    expect(report.affected_tasks.map((task) => task.task)).toEqual(['T1']);
    // canonical 文件必须保持不变，预览不能有副作用。
    expect(await fs.readFile(path.join(tmp, specPath), 'utf8')).toBe(base);
  });

  it('treats an overlay for an unknown spec path as a new file', async () => {
    const report = await analyzeSpecImpact(tmp, {
      overlay: { 'specs/billing/spec.md': '# billing\n\n## POST /api/billing/pay\n\n支付。\n' },
    });
    const file = report.files.find((entry) => entry.path === 'specs/billing/spec.md');
    expect(file?.file_change).toBe('added');
    expect(file?.anchors[0].change).toBe('added');
  });
});
