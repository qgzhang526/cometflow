import { promises as fs } from 'node:fs';
import path from 'node:path';
import { hashSpecText } from '../spec/spec-hash.js';
import { pathExists, readTextFile } from '../../platform/fs/read-file.js';
import { readTaskPlan } from '../task-plan/task-plan-store.js';
import { captureChangeSpecBaseline } from './change-spec-baseline.js';
import { captureGitProvenance } from '../../platform/process/git.js';
import { captureImplementationBaseline } from './implementation-scope.js';
import { appendChangeEvent } from './change-journal.js';
import { changeDir, changeStateFile, writeChangeState } from './change-store.js';
import type { ChangeState } from './change-types.js';

/**
 * change 启动时锁定 canonical spec 的基线内容。
 *
 * 归档时会重新读取，如果与基线不一致，说明 spec 在 change 存续期间被其他人改过：
 * 这时直接覆盖会丢掉那次变更，所以必须报冲突并走 rebase 或 reconciliation。
 */
async function specBaselineHash(projectRoot: string, specRef: string | null): Promise<string | null> {
  if (!specRef) return null;
  const absolute = path.join(projectRoot, specRef);
  if (!(await pathExists(absolute))) return null;
  return hashSpecText(await readTextFile(absolute));
}

export async function createChangeFromTask(options: {
  projectRoot: string;
  goalId: string;
  taskId: string;
  changeName: string;
}): Promise<ChangeState> {
  const plan = await readTaskPlan(options.projectRoot, options.goalId);
  const task = plan.tasks.find((entry) => entry.id === options.taskId);
  if (!task) throw new Error('Unknown task: ' + options.taskId);
  if (task.status !== 'frozen') throw new Error('Only frozen tasks can create changes');

  const dir = changeDir(options.projectRoot, options.changeName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'brief.md'), '# ' + task.title + '\n\n' + task.definition_of_done.join('\n') + '\n');

  const baseHash = await specBaselineHash(options.projectRoot, task.spec_ref);
  // 记录来源：change 基于哪个提交开工。非 git 项目留空，后续校验自动降级。
  const provenance = await captureGitProvenance(options.projectRoot);
  const state: ChangeState = {
    schema: 'cometflow.change.v1',
    name: options.changeName,
    goal: options.goalId,
    task: task.id,
    phase: 'shape',
    status: 'active',
    spec_ref: task.spec_ref,
    spec_anchor: task.spec_anchor,
    acceptance_ids: task.acceptance_ids,
    spec_version: task.spec_version,
    spec_hash: task.spec_hash,
    spec_base_hash: baseHash,
    anchor_hash: task.anchor_hash ?? null,
    module: task.module ?? null,
    base_commit: provenance.isRepository ? provenance.head : null,
    base_branch: provenance.branch,
    created_at: new Date().toISOString(),
    archived: false,
  };
  await writeChangeState(options.projectRoot, state);
  await appendChangeEvent(options.projectRoot, options.changeName, 'change-created', {
    goal: options.goalId,
    task: options.taskId,
    spec_ref: state.spec_ref,
    spec_anchor: state.spec_anchor,
    spec_version: state.spec_version,
    module: state.module ?? null,
    base_commit: state.base_commit ?? null,
    base_branch: state.base_branch ?? null,
  }, { phase: state.phase });
  // 全量 spec 基线快照：归档时用它做 compare-and-swap，避免覆盖别人的 spec 改动。
  await captureChangeSpecBaseline(options.projectRoot, options.changeName);
  await appendChangeEvent(options.projectRoot, options.changeName, 'spec-baseline-captured');
  // 实现范围基线：验证/归档时用它判断改动是否越出 spec 声明的模块。
  const implBaseline = await captureImplementationBaseline(options.projectRoot, options.changeName);
  await appendChangeEvent(options.projectRoot, options.changeName, 'implementation-baseline-captured', {
    files: implBaseline.fileCount,
    complete: implBaseline.complete,
  });
  return state;
}
