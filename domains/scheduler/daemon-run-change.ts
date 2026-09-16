import { createChangeFromTask } from '../workflow/change-create.js';
import { commitTransition, readChangeState } from '../workflow/change-store.js';
import { applyChangeTransition } from '../workflow/change-transitions.js';
import { archiveChange, runChange, verifyChange, SpecConflictError } from '../workflow/change-execution.js';
import type { ChangePhase, ChangeState } from '../workflow/change-types.js';
import type { AgentRunner } from '../../platform/agents/types.js';

/**
 * 调度器的**交付通道**（P4 / S1）：把队列里的一个冻结任务推进成一次完整的 change 生命周期。
 *
 * 与旧实现的区别只有一句话：旧路径把任务交给 `runFlowRun`（无绑定会话，按 agent 退出码判成败），
 * 这里走 change 状态机——建 change（自动设 current-change 指针）→ confirm-acceptance → run →
 * verify（独立验收）→ archive（应用 spec 变更）。于是「这个任务做完了没有」有了唯一出处：
 * change 账本里的归档与 acceptance 结论。
 */

export type DaemonTaskVerdict =
  | 'delivered'
  | 'agent-failed'
  | 'verify-failed'
  | 'spec-conflict'
  | 'error';

export interface DaemonTaskOutcome {
  verdict: DaemonTaskVerdict;
  change: string;
  phase: ChangePhase | null;
  archived: boolean;
  detail: string;
  /**
   * true = 需要人工介入，daemon 应当停下而不是继续下一个任务。
   *
   * 判据是「继续跑下去会不会更糟」：spec 冲突与 blocked 之后重跑同一个必然失败的循环没有意义，
   * 而 agent 失败 / 验收不过是可重试的（attempts 有上限），不该拖停整个队列。
   */
  needsHuman: boolean;
}

/**
 * change 名由任务确定性派生（`G1-T1`）。
 *
 * 确定性命名是「断点续作 + 失败重试落在同一个 change 上」的前提：如果每次重试都新开一个 change，
 * 你会得到一串半成品 change，而写保护指针、验收记录、归档都会散在它们之间。
 */
export function changeNameForTask(goal: string, task: string): string {
  return (goal + '-' + task).replace(/[^A-Za-z0-9._-]/gu, '_');
}

export interface RunTaskThroughChangeOptions {
  projectRoot: string;
  goal: string;
  task: string;
  runner: AgentRunner;
  model?: string;
  timeoutMs?: number;
  /** 显式忽略 git 来源漂移（与 CLI `change run --allow-drift` 同义）。 */
  allowDrift?: boolean;
}

export async function runTaskThroughChange(options: RunTaskThroughChangeOptions): Promise<DaemonTaskOutcome> {
  const change = changeNameForTask(options.goal, options.task);
  let state: ChangeState | null = await readChangeState(options.projectRoot, change).catch(() => null);

  if (state !== null && state.archived) {
    // 已经交付过（可能是上一轮 daemon 跑完、也可能是人手工做完）——不重跑。
    return {
      verdict: 'delivered',
      change,
      phase: state.phase,
      archived: true,
      detail: 'change 已归档，跳过',
      needsHuman: false,
    };
  }

  try {
    if (state === null) {
      state = await createChangeFromTask({
        projectRoot: options.projectRoot,
        goalId: options.goal,
        taskId: options.task,
        changeName: change,
      });
    }

    // 按 phase 续作：崩在任意一步都能从这里接着往下走。
    if (state.phase === 'shape') {
      const next = applyChangeTransition(state, 'confirm-acceptance');
      await commitTransition(options.projectRoot, 'confirm-acceptance', state, next);
      state = next;
    }

    if (state.phase === 'build') {
      const run = await runChange(options.projectRoot, change, options.runner, {
        allowDrift: options.allowDrift === true,
        model: options.model,
        // 单任务超时必须一路传到 runner：挂起的 agent 会永久阻塞 daemon（ADR 0024）。
        timeoutMs: options.timeoutMs,
      });
      if (run.agentExitCode !== 0) {
        return {
          verdict: 'agent-failed',
          change,
          phase: run.state.phase,
          archived: false,
          detail: 'builder 退出码 ' + run.agentExitCode,
          needsHuman: false,
        };
      }
      state = run.state;
    }

    if (state.phase === 'verify') {
      const verified = await verifyChange(options.projectRoot, change, {
        model: options.model,
        allowDrift: options.allowDrift === true,
      });
      if (!verified.reportPassed) {
        const blocked = verified.state.status === 'blocked';
        return {
          verdict: 'verify-failed',
          change,
          phase: verified.state.phase,
          archived: false,
          detail:
            '验收未通过（' +
            verified.verdicts.filter((verdict) => verdict.result !== 'passed').length +
            ' 项未过' +
            (blocked
              ? '；已达修复上限，change 置 blocked → 看 changes/' +
                change +
                '/verification.md，改完用 cometflow change unblock ' +
                change +
                ' 重开'
              : '；将按尝试上限重试，细节见 changes/' + change + '/verification.md') +
            '）',
          // blocked 说明「同一失败结论反复出现」，重跑无意义；普通不过则留给 attempts 重试。
          needsHuman: blocked,
        };
      }
      state = verified.state;
    }

    if (state.phase === 'archive') {
      const archived = await archiveChange(options.projectRoot, change, { allowDrift: options.allowDrift === true });
      return {
        verdict: 'delivered',
        change,
        phase: archived.state.phase,
        archived: true,
        detail: '已归档；应用 spec 变更 ' + archived.appliedSpecs.length + ' 个',
        needsHuman: false,
      };
    }

    return {
      verdict: 'error',
      change,
      phase: state.phase,
      archived: false,
      detail: '未预期的阶段：' + state.phase,
      needsHuman: true,
    };
  } catch (error) {
    // spec 基线冲突是「可预期的人工决策点」（ADR 0004）：停在归档前，交人决定 rebase 还是 reconciliation。
    if (error instanceof SpecConflictError) {
      return {
        verdict: 'spec-conflict',
        change,
        phase: state?.phase ?? null,
        archived: false,
        detail:
          'spec 基线冲突（' +
          error.conflicts.map((conflict) => conflict.path).join(', ') +
          '）→ 选 rebase（接受新基线）或建 reconciliation change（ADR 0004），不静默覆盖',
        needsHuman: true,
      };
    }
    const detail = error instanceof Error ? error.message : String(error);
    // blocked 的 change 会在 runChange 里抛错——那是「反复失败、需人工介入」的终止态。
    const blocked = /is blocked after/u.test(detail);
    return {
      verdict: 'error',
      change,
      phase: state?.phase ?? null,
      archived: false,
      detail,
      needsHuman: blocked,
    };
  }
}
