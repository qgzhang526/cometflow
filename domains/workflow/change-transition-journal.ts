import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { atomicWriteJson, atomicWriteText } from '../../platform/fs/atomic-write.js';
import { appendChangeEvent } from './change-journal.js';
import { changeStateFile, stampState } from './change-store.js';
import type { ChangeEvent, ChangeState } from './change-types.js';

export const PENDING_TRANSITION_SCHEMA = 'cometflow.change-transition.v1';

export interface PendingTransition {
  schema: typeof PENDING_TRANSITION_SCHEMA;
  change: string;
  event: ChangeEvent;
  from_phase: ChangeState['phase'];
  to_phase: ChangeState['phase'];
  prepared_at: string;
  next_state: ChangeState;
}

export type SettleResult = 'none' | 'completed' | 'applied' | 'conflict';

export function changeRuntimeDir(projectRoot: string, name: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'changes', name);
}

/** 待提交的迁移记录。它的存在本身就是「上一次迁移可能没走完」的证据。 */
export function pendingTransitionPath(projectRoot: string, name: string): string {
  return path.join(changeRuntimeDir(projectRoot, name), 'transition-pending.json');
}

async function readStateFile(projectRoot: string, name: string): Promise<ChangeState | null> {
  try {
    const source = await fs.readFile(changeStateFile(projectRoot, name), 'utf8');
    return parse(source) as ChangeState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function sameState(left: ChangeState | null, right: ChangeState): boolean {
  if (!left) return false;
  return left.phase === right.phase && left.status === right.status && left.archived === right.archived;
}

export async function readPendingTransition(
  projectRoot: string,
  name: string,
): Promise<PendingTransition | null> {
  try {
    const source = await fs.readFile(pendingTransitionPath(projectRoot, name), 'utf8');
    return JSON.parse(source) as PendingTransition;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function clearPendingTransition(projectRoot: string, name: string): Promise<void> {
  await fs.rm(pendingTransitionPath(projectRoot, name), { force: true });
}

/**
 * 两阶段迁移的第一步：先把「打算迁移成什么样」落盘。
 *
 * 若在这一步之后崩溃，下一次读取就能凭这条记录把迁移补完；
 * 反过来，如果先写状态再记账，崩溃后就无法区分「没开始」和「写了一半」。
 */
export async function prepareTransition(
  projectRoot: string,
  name: string,
  event: ChangeEvent,
  fromState: ChangeState,
  nextState: ChangeState,
  options: { now?: Date } = {},
): Promise<PendingTransition> {
  const pending: PendingTransition = {
    schema: PENDING_TRANSITION_SCHEMA,
    change: name,
    event,
    from_phase: fromState.phase,
    to_phase: nextState.phase,
    prepared_at: (options.now ?? new Date()).toISOString(),
    next_state: nextState,
  };
  await atomicWriteJson(pendingTransitionPath(projectRoot, name), pending);
  return pending;
}

/**
 * 收敛未完成的迁移。读取状态前调用，保证调用方永远看不到中间态。
 *
 * - 状态已经是目标状态 → 只清记录（迁移其实已完成，只是没来得及清账）；
 * - 状态仍停在起始阶段 → 补做迁移；
 * - 两者都不是 → 冲突，保留记录交给 doctor 与人工判断。
 */
export async function settlePendingTransition(
  projectRoot: string,
  name: string,
): Promise<SettleResult> {
  const pending = await readPendingTransition(projectRoot, name);
  if (!pending) return 'none';

  const current = await readStateFile(projectRoot, name);
  if (sameState(current, pending.next_state)) {
    await clearPendingTransition(projectRoot, name);
    await appendChangeEvent(projectRoot, name, 'transition-settled', {
      event: pending.event,
      result: 'already-applied',
      phase: pending.to_phase,
    });
    return 'completed';
  }

  if (current === null || current.phase === pending.from_phase) {
    await atomicWriteText(changeStateFile(projectRoot, name), stringify(stampState(pending.next_state)));
    await clearPendingTransition(projectRoot, name);
    await appendChangeEvent(projectRoot, name, 'transition-settled', {
      event: pending.event,
      result: 'recovered',
      from: pending.from_phase,
      to: pending.to_phase,
    }, { phase: pending.to_phase });
    return 'applied';
  }

  await appendChangeEvent(projectRoot, name, 'transition-settled', {
    event: pending.event,
    result: 'conflict',
    expected_from: pending.from_phase,
    actual: current.phase,
  }, { phase: current.phase });
  return 'conflict';
}

/**
 * 两阶段迁移的完整提交：prepare → 写状态 → 记账 → 清记录。
 * 任何一步之后崩溃都能被 settlePendingTransition 收敛。
 */
export async function commitChangeTransition(
  projectRoot: string,
  name: string,
  event: ChangeEvent,
  fromState: ChangeState,
  nextState: ChangeState,
  options: { now?: Date } = {},
): Promise<ChangeState> {
  await prepareTransition(projectRoot, name, event, fromState, nextState, options);
  await atomicWriteText(changeStateFile(projectRoot, name), stringify(stampState(nextState)));
  await appendChangeEvent(projectRoot, name, 'transition', {
    event,
    from: fromState.phase,
    to: nextState.phase,
  }, { phase: nextState.phase, now: options.now });
  await clearPendingTransition(projectRoot, name);
  return nextState;
}

export interface PendingTransitionSummary {
  change: string;
  event: ChangeEvent;
  from: ChangeState['phase'];
  to: ChangeState['phase'];
  preparedAt: string;
  path: string;
}

/** 供 doctor 使用：列出仍然滞留的待提交迁移。 */
export async function listPendingTransitions(
  projectRoot: string,
): Promise<PendingTransitionSummary[]> {
  const root = path.join(projectRoot, '.cometflow', 'runtime', 'changes');
  let changes: string[];
  try {
    changes = await fs.readdir(root);
  } catch {
    return [];
  }
  const result: PendingTransitionSummary[] = [];
  for (const change of changes) {
    const pending = await readPendingTransition(projectRoot, change);
    if (!pending) continue;
    result.push({
      change,
      event: pending.event,
      from: pending.from_phase,
      to: pending.to_phase,
      preparedAt: pending.prepared_at,
      path: pendingTransitionPath(projectRoot, change),
    });
  }
  return result.sort((left, right) => left.change.localeCompare(right.change));
}
