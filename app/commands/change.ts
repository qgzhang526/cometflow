import path from 'node:path';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import {
  archiveChange,
  rebaseChange,
  runChange,
  unblockChange,
  verifyChange,
} from '../../domains/workflow/change-execution.js';
import {
  collectImplementationScope,
  resolveScopeAllow,
} from '../../domains/workflow/implementation-scope.js';
import { readChangeJournal } from '../../domains/workflow/change-journal.js';
import {
  applyEvidenceGc,
  collectEvidenceUsage,
  formatBytes,
  planEvidenceGc,
} from '../../domains/workflow/evidence-retention.js';
import { readProjectConfig, type VerificationMode } from '../../domains/project/config.js';
import { listChangeStates } from '../../domains/workflow/change-list.js';
import { resumeChange } from '../../domains/workflow/change-resume.js';
import {
  commitTransition,
  readChangeState,
  writeChangeState,
} from '../../domains/workflow/change-store.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import type { ChangeEvent } from '../../domains/workflow/change-types.js';
import { getBuiltInAgentRunner } from '../../platform/agents/registry.js';
import { resolveAgentId } from '../../domains/scheduler/flow-run.js';

function root(targetPath: string): string {
  return path.resolve(targetPath);
}

export async function changeNewCommand(
  name: string,
  options: { goal: string; task: string; path?: string },
): Promise<void> {
  const projectRoot = root(options.path ?? '.');
  const state = await createChangeFromTask({
    projectRoot,
    goalId: options.goal,
    taskId: options.task,
    changeName: name,
  });
  console.log('created change ' + state.name + ' phase=' + state.phase);
}

export async function changeListCommand(
  targetPath: string,
  options: { all?: boolean; json?: boolean },
): Promise<void> {
  const projectRoot = root(targetPath);
  const states = await listChangeStates(projectRoot);
  const visible = options.all ? states : states.filter((state) => !state.archived);
  if (options.json) {
    console.log(JSON.stringify(visible, null, 2));
    return;
  }
  for (const state of visible) {
    console.log([state.name, state.phase, state.status, state.archived ? 'archived' : 'active'].join(' '));
  }
}

export async function changeResumeCommand(
  name: string,
  targetPath: string,
  options: { json?: boolean },
): Promise<void> {
  const projectRoot = root(targetPath);
  const state = await readChangeState(projectRoot, name);
  const resume = resumeChange(state);
  if (options.json) {
    console.log(JSON.stringify(resume, null, 2));
    return;
  }
  console.log(resume.message);
  if (resume.nextEvent) {
    console.log('command: cometflow change transition ' + name + ' ' + resume.nextEvent);
  }
}

export async function changeStatusCommand(name: string, targetPath: string): Promise<void> {
  const state = await readChangeState(root(targetPath), name);
  console.log(JSON.stringify(state, null, 2));
}

export async function changeRunCommand(
  name: string,
  targetPath: string,
  options: { agent?: string },
): Promise<void> {
  const projectRoot = root(targetPath);
  const agentId = options.agent ?? (await resolveAgentId(projectRoot));
  const runner = getBuiltInAgentRunner(agentId);
  const outcome = await runChange(projectRoot, name, runner);
  console.log('change ' + name + ' phase=' + outcome.state.phase + ' agentExit=' + outcome.agentExitCode);
  if (outcome.agentExitCode !== 0) process.exitCode = outcome.agentExitCode;
}

export async function changeVerifyCommand(
  name: string,
  targetPath: string,
  options: { agent?: string; mode?: string } = {},
): Promise<void> {
  const projectRoot = root(targetPath);
  const config = await readProjectConfig(projectRoot);
  const mode = (options.mode ?? config.verification?.mode) as VerificationMode | undefined;
  const verifierId = options.agent ?? config.verification?.agent;
  const runner = verifierId ? getBuiltInAgentRunner(verifierId) : undefined;
  const outcome = await verifyChange(projectRoot, name, { runner, mode });
  for (const verdict of outcome.verdicts) {
    console.log(
      [verdict.result.toUpperCase(), verdict.id, '[' + verdict.source + ']', verdict.reason].join(' '),
    );
  }
  if (outcome.scope && outcome.scope.unattributed.length > 0) {
    console.log('unattributed changes: ' + outcome.scope.unattributed.join(', '));
  }
  console.log(
    'change ' +
      name +
      ' phase=' +
      outcome.state.phase +
      ' reportPassed=' +
      outcome.reportPassed +
      ' verifier=' +
      (outcome.verifierAgent ?? '(none)') +
      ' repair_attempts=' +
      (outcome.state.repair_attempts ?? 0),
  );
  if (outcome.state.status === 'blocked') {
    console.log(
      'blocked: 连续同一失败结论，已停机等待人工；查看 changes/' +
        name +
        '/verification.md 后运行 cometflow change unblock ' +
        name,
    );
  }
  if (!outcome.reportPassed) process.exitCode = 1;
}

export async function changeUnblockCommand(
  name: string,
  targetPath: string,
  options: { note?: string } = {},
): Promise<void> {
  const projectRoot = root(targetPath);
  const outcome = await unblockChange(projectRoot, name, { note: options.note });
  console.log(
    'unblocked ' +
      name +
      ' phase=' +
      outcome.state.phase +
      ' previous_repair_attempts=' +
      outcome.previousAttempts,
  );
  console.log('下一步：cometflow change resume ' + name + ' ' + targetPath);
}

export async function changeScopeCommand(
  name: string,
  targetPath: string,
  options: { json?: boolean } = {},
): Promise<void> {
  const projectRoot = root(targetPath);
  const state = await readChangeState(projectRoot, name);
  const scope = await collectImplementationScope(projectRoot, name, {
    module: state.module ?? null,
    allow: await resolveScopeAllow(projectRoot),
  });
  if (options.json) {
    console.log(JSON.stringify(scope, null, 2));
    process.exitCode = scope.unattributed.length > 0 ? 1 : 0;
    return;
  }
  console.log('change: ' + name);
  console.log('module: ' + (scope.module ?? '(unbounded)'));
  console.log('baseline: ' + (scope.baseline_captured_at ?? '(missing)'));
  if (scope.baseline_captured_at === null) {
    console.log(
      '无法判定实现范围：该 change 创建于实现范围基线机制之前；如需校验请重建 change（或对该 change 重新执行 change rebase）。',
    );
    console.log('tracked files: ' + scope.file_count);
    return;
  }
  for (const change of scope.changes) {
    console.log(
      [change.kind, change.path, change.attributed ? '[' + change.attribution + ']' : '[OUTSIDE]'].join(' '),
    );
  }
  if (scope.omittedCount > 0) {
    console.log('omitted: ' + scope.omittedCount + '（未参与比对，快照不完整）');
    for (const entry of scope.omitted.slice(0, 5)) {
      console.log('  - ' + entry.path + ' ' + entry.reason + (entry.size === null ? '' : ' (' + entry.size + ' bytes)'));
    }
    if (scope.omissionOverflow) {
      console.log('  …另有 ' + scope.omissionOverflow.count + ' 条，折叠哈希 ' + scope.omissionOverflow.hash.slice(0, 12));
    }
  }
  console.log('changes: ' + scope.changes.length + ' unattributed: ' + scope.unattributed.length);
  if (scope.unattributed.length > 0) {
    console.log('unattributed: ' + scope.unattributed.join(', '));
    process.exitCode = 1;
  }
}

export async function changeJournalCommand(
  name: string,
  targetPath: string,
  options: { json?: boolean } = {},
): Promise<void> {
  const projectRoot = root(targetPath);
  const events = await readChangeJournal(projectRoot, name);
  if (options.json) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }
  if (events.length === 0) {
    console.log('(no journal events)');
    return;
  }
  for (const event of events) {
    console.log(event.at + ' ' + event.event + (event.phase ? ' phase=' + event.phase : '') + (event.data ? ' ' + JSON.stringify(event.data) : ''));
  }
}

/**
 * 证据回收。
 *
 * 默认只做计划（dry-run）：列出每个 change 的占用与可回收项。
 * `--apply` 才真正删除，且只碰 `.cometflow/runtime/` 下可重新推导的内容。
 */
export async function changeGcCommand(
  targetPath: string,
  options: { apply?: boolean; json?: boolean } = {},
): Promise<void> {
  const projectRoot = root(targetPath);
  const plan = await planEvidenceGc(projectRoot);
  const usage = await collectEvidenceUsage(projectRoot);

  if (options.apply === true) {
    const result = await applyEvidenceGc(projectRoot, plan);
    if (options.json) {
      console.log(JSON.stringify({ plan, result }, null, 2));
      return;
    }
    for (const entry of result.removed) {
      console.log('removed ' + entry.path + ' (' + formatBytes(entry.bytes) + ')');
    }
    for (const change of result.rotatedJournals) {
      console.log('rotated journal for ' + change);
    }
    console.log('freed ' + formatBytes(result.freedBytes));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({ usage, plan }, null, 2));
    return;
  }
  console.log('evidence usage: ' + formatBytes(plan.totalBytes) + ' across ' + usage.length + ' change(s)');
  for (const entry of usage.slice(0, 10)) {
    console.log(
      '  ' +
        entry.change +
        (entry.archived ? ' [archived]' : ' [active]') +
        ' ' +
        formatBytes(entry.bytes) +
        ' / ' +
        entry.files +
        ' files',
    );
  }
  console.log('reclaimable: ' + formatBytes(plan.reclaimableBytes));
  for (const candidate of plan.candidates.slice(0, 20)) {
    console.log('  - ' + candidate.change + ' ' + candidate.reason + ' ' + formatBytes(candidate.bytes) + ' ' + candidate.path);
  }
  if (plan.candidates.length === 0) console.log('  (nothing to reclaim)');
  else console.log('run cometflow change gc . --apply to remove them');
}

export async function changeArchiveCommand(name: string, targetPath: string): Promise<void> {
  const projectRoot = root(targetPath);
  const { state, appliedSpecs, specVersions } = await archiveChange(projectRoot, name);
  for (const applied of appliedSpecs) console.log('applied ' + applied);
  for (const version of specVersions) {
    console.log('versioned ' + version.path + ' @v' + version.spec_version + ' ' + version.hash.slice(0, 12));
  }
  console.log('change ' + name + ' archived=' + state.archived);
}

export async function changeRebaseCommand(name: string, targetPath: string): Promise<void> {
  const projectRoot = root(targetPath);
  const outcome = await rebaseChange(projectRoot, name);
  console.log(
    'change ' +
      name +
      ' rebased to spec v' +
      (outcome.specVersion ?? '(none)') +
      ' phase=' +
      outcome.state.phase +
      ' acceptance=' +
      (outcome.acceptanceIds.join(',') || '(none)'),
  );
  console.log('baseline files: ' + outcome.baselineFiles);
}

export async function changeTransitionCommand(
  name: string,
  event: string,
  targetPath: string,
): Promise<void> {
  const projectRoot = root(targetPath);
  const state = await readChangeState(projectRoot, name);
  const next = applyChangeTransition(state, event as ChangeEvent);
  // 阶段迁移走两阶段提交：崩溃后 `readChangeState` 能自动收敛。
  const filePath = await commitTransition(projectRoot, event as ChangeEvent, state, next);
  console.log('wrote ' + filePath + ' phase=' + next.phase + ' archived=' + next.archived);
}
