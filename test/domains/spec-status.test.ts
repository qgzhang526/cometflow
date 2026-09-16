import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSpecMeta, setSpecStatus } from '../../domains/spec/spec-meta.js';
import { approveSpec } from '../../domains/spec/spec-approval.js';
import { verifySpecIntegrity } from '../../domains/spec/spec-verify.js';
import { refreshSpecBaseline } from '../../domains/spec/spec-version.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';

/**
 * spec 的定稿状态（G1）：机器可以起草，但契约必须有人点头。
 *
 * 三条断言对应三处机制：缺省不算草案（存量项目不被误伤）、草案进 findings（看得见）、
 * 草案不能冻结（拦得住）。
 */

const SPEC_BODY = ['# a capability', '', '## H1 核心', '', '需求。', '', '## 验收', '', '- A001：第一条', ''].join('\n');

let root: string;

async function makeProject(specContent: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-spec-status-'));
  await fs.mkdir(path.join(dir, '.cometflow'), { recursive: true });
  await fs.writeFile(path.join(dir, '.cometflow', 'config.yaml'), 'schema: cometflow.project.v1\nplan_review: auto\n');
  await fs.writeFile(
    path.join(dir, 'COMETFLOW.md'),
    ['# 项目使命', '', '## 任务目标', '', '### G1：核心', '- 目标：把 a 做出来', '- 范围：a', ''].join('\n'),
  );
  await fs.mkdir(path.join(dir, 'specs', 'a'), { recursive: true });
  await fs.writeFile(path.join(dir, 'specs', 'a', 'spec.md'), specContent);
  return dir;
}

function specPath(): string {
  return path.join(root, 'specs', 'a', 'spec.md');
}

beforeEach(async () => {
  root = await makeProject(SPEC_BODY);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('spec status', () => {
  it('缺省视为已定稿，只有显式 draft 才算草案', () => {
    expect(parseSpecMeta(SPEC_BODY).status).toBe('approved');
    expect(parseSpecMeta('---\ncapability: a\n---\n\n# a\n').status).toBe('approved');
    expect(parseSpecMeta('---\ncapability: a\nstatus: draft\n---\n\n# a\n').status).toBe('draft');
    // 不认识的值不能把 spec 悄悄变成草案（那会让冻结无缘无故失败）。
    expect(parseSpecMeta('---\nstatus: whatever\n---\n\n# a\n').status).toBe('approved');
  });

  it('setSpecStatus 只动 status 一个键，正文逐字保留', () => {
    const withoutFrontmatter = setSpecStatus(SPEC_BODY, 'draft');
    expect(withoutFrontmatter).toBe('---\nstatus: draft\n---\n\n' + SPEC_BODY);

    const replaced = setSpecStatus('---\ncapability: a\nstatus: approved\nmodule: internal/a\n---\n' + SPEC_BODY, 'draft');
    expect(replaced).toContain('capability: a');
    expect(replaced).toContain('module: internal/a');
    expect(replaced).toContain('status: draft');
    expect(replaced).not.toContain('status: approved');
    expect(replaced.endsWith(SPEC_BODY)).toBe(true);

    const appended = setSpecStatus('---\ncapability: a\n---\n' + SPEC_BODY, 'approved');
    expect(appended).toContain('status: approved');
    expect(appended.endsWith(SPEC_BODY)).toBe(true);
  });

  it('approveSpec 把草案定稿、刷新基线，且重复调用不再改动', async () => {
    await fs.writeFile(specPath(), setSpecStatus(SPEC_BODY, 'draft'));

    const first = await approveSpec(root, 'specs/a/spec.md');
    expect(first.changed).toBe(true);
    expect(first.previous).toBe('draft');
    expect(first.spec_version).not.toBeNull();
    expect(parseSpecMeta(await fs.readFile(specPath(), 'utf8')).status).toBe('approved');

    const contentAfterApprove = await fs.readFile(specPath(), 'utf8');
    const second = await approveSpec(root, 'specs/a/spec.md');
    expect(second.changed).toBe(false);
    expect(await fs.readFile(specPath(), 'utf8')).toBe(contentAfterApprove);
  });

  it('spec verify 对草案报 spec-is-draft 警告，但不因此判失败', async () => {
    await fs.writeFile(specPath(), setSpecStatus(SPEC_BODY, 'draft'));
    await refreshSpecBaseline(root, { note: 'test' });

    const draft = await verifySpecIntegrity(root);
    expect(draft.valid).toBe(true);
    const finding = draft.findings.find((entry) => entry.code === 'spec-is-draft');
    expect(finding?.severity).toBe('warning');
    expect(finding?.subject).toBe('specs/a/spec.md');
    expect(finding?.message).toContain('spec approve');

    await approveSpec(root, 'specs/a/spec.md');
    const approved = await verifySpecIntegrity(root);
    expect(approved.findings.some((entry) => entry.code === 'spec-is-draft')).toBe(false);
  });

  it('草案 spec 不能冻结：报错指路 spec approve', async () => {
    await fs.writeFile(specPath(), setSpecStatus(SPEC_BODY, 'draft'));
    const plan = await generateTaskPlan(root, 'G1');
    await expect(freezeTaskPlan(root, plan)).rejects.toThrow(/仍是草案/);
    await expect(freezeTaskPlan(root, plan)).rejects.toThrow(/spec approve specs\/a\/spec\.md/);

    await approveSpec(root, 'specs/a/spec.md');
    const frozen = await freezeTaskPlan(root, plan);
    expect(frozen.tasks[0].status).toBe('frozen');
    expect(frozen.tasks[0].acceptance_ids).toEqual(['A001']);
  });
});
