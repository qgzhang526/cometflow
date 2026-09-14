import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { readTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { regenerateTaskPlan } from '../../domains/task-plan/task-plan-regenerate.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import {
  archiveChange,
  buildChangePrompt,
  rebaseChange,
} from '../../domains/workflow/change-execution.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';
import { readSpecLock, diffSpecs } from '../../domains/spec/spec-lock.js';
import { latestSpecVersion } from '../../domains/spec/spec-version.js';
import { verifySpecIntegrity } from '../../domains/spec/spec-verify.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');
const specPath = 'specs/auth/spec.md';
const changeName = 'auth-email-login';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-change-spec-'));
  await fs.cp(fixture, tmp, { recursive: true });
  const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1'));
  await writeTaskPlan(tmp, plan);
  await createChangeFromTask({ projectRoot: tmp, goalId: 'G1', taskId: 'T1', changeName });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function toArchivePhase(): Promise<void> {
  let state = await readChangeState(tmp, changeName);
  const events = ['confirm-acceptance', 'submit-candidate', 'verify-pass'] as const;
  for (const event of events) {
    const expectedPhase = event === 'confirm-acceptance' ? 'shape' : event === 'submit-candidate' ? 'build' : 'verify';
    if (state.phase !== expectedPhase) continue;
    state = applyChangeTransition(state, event);
    await writeChangeState(tmp, state);
  }
}

async function writeProposedSpec(content: string): Promise<void> {
  const dir = path.join(tmp, 'changes', changeName, 'specs', 'auth');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'spec.md'), content);
}

describe('change spec lifecycle', () => {
  it('archives, records a new spec version, and keeps the lock fresh', async () => {
    await toArchivePhase();
    await writeProposedSpec('# auth capability\n\n## POST /api/auth/email-login\n\n新实现。\n');

    const outcome = await archiveChange(tmp, changeName);
    expect(outcome.state.archived).toBe(true);
    expect(outcome.specVersions.map((entry) => entry.path)).toEqual([specPath]);
    expect(outcome.specVersions[0].spec_version).toBe(2);
    expect(outcome.state.applied_spec_version).toBe(2);

    const diff = await diffSpecs(tmp);
    expect(diff.modified).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(1);
    const lock = await readSpecLock(tmp);
    expect(lock?.files.some((entry) => entry.path === specPath)).toBe(true);
  });

  it('blocks archiving when the canonical spec moved after the change was created', async () => {
    await toArchivePhase();
    await writeProposedSpec('# auth capability\n\n## POST /api/auth/email-login\n\n新实现。\n');
    await fs.appendFile(path.join(tmp, specPath), '\n## POST /api/auth/logout\n\n登出。\n');

    await expect(archiveChange(tmp, changeName)).rejects.toThrow(/spec conflict/u);
    expect((await readChangeState(tmp, changeName)).archived).toBe(false);
    // 冲突时不得覆盖 canonical spec。
    expect(await fs.readFile(path.join(tmp, specPath), 'utf8')).toContain('POST /api/auth/logout');
  });

  it('re-frozen baseline after rebase lets the change archive', async () => {
    await toArchivePhase();
    await writeProposedSpec('# auth capability\n\n## POST /api/auth/email-login\n\n新实现。\n');
    await fs.appendFile(path.join(tmp, specPath), '\n## POST /api/auth/logout\n\n登出。\n');

    const rebased = await rebaseChange(tmp, changeName);
    expect(rebased.specVersion).toBe(2);
    expect(rebased.state.phase).toBe('build');
    expect(rebased.state.acceptance_ids).toEqual(['A1', 'A2']);

    await toArchivePhase();
    const outcome = await archiveChange(tmp, changeName);
    expect(outcome.state.archived).toBe(true);
  });

  it('carries the frozen spec into the builder prompt even if the spec file disappears', async () => {
    await fs.rm(path.join(tmp, specPath));
    const prompt = await buildChangePrompt(tmp, changeName);

    expect(prompt).toContain('## Frozen spec');
    expect(prompt).toContain('spec_version: 1');
    expect(prompt).toContain('POST /api/auth/email-login');
    expect(prompt).toContain('使用邮箱验证码登录');
    expect(prompt).toContain('- A1: 未注册邮箱可以获取验证码');
    expect(prompt).toContain('- A2: 验证码错误返回 401 INVALID_CODE');
  });

  it('reports a missing frozen blob instead of silently building from a drifted file', async () => {
    const version = await latestSpecVersion(tmp, specPath);
    await fs.rm(path.join(tmp, '.cometflow', 'spec-versions', version!.hash + '.md'));
    await fs.appendFile(path.join(tmp, specPath), '\n## Changed\n');

    const prompt = await buildChangePrompt(tmp, changeName);
    expect(prompt).toContain('WARNING: 版本仓缺少冻结内容');
  });

  it('surfaces drift after a spec-changing archive and returns to green after regeneration', async () => {
    await toArchivePhase();
    await writeProposedSpec(
      [
        '# auth capability',
        '',
        '## POST /api/auth/email-login',
        '',
        '使用邮箱验证码或密码登录。',
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
      ].join('\n'),
    );
    await archiveChange(tmp, changeName);

    // 归档改动了 login anchor，绑在旧版本上的 T1 必须被判定为漂移，而不是静默通过。
    const drifted = await verifySpecIntegrity(tmp);
    expect(drifted.valid).toBe(false);
    expect(drifted.findings.map((finding) => finding.code)).toContain('anchor-drift');

    const previous = await readTaskPlan(tmp, 'G1');
    await writeTaskPlan(
      tmp,
      await regenerateTaskPlan(tmp, 'G1', previous, { preserveApproved: true }),
    );

    const recovered = await verifySpecIntegrity(tmp);
    expect(recovered.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
  });
});
