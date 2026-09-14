import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';
import { commitChangeTransition, settlePendingTransition } from './change-transition-journal.js';
import { hashChangeState } from '../state/canonical-hash.js';
import type { ChangeState } from './change-types.js';
import type { ChangeEvent } from './change-types.js';

export function changeDir(projectRoot: string, name: string): string {
  return path.join(projectRoot, 'changes', name);
}

export function changeStateFile(projectRoot: string, name: string): string {
  return path.join(changeDir(projectRoot, name), 'comet-state.yaml');
}

export async function readChangeState(projectRoot: string, name: string): Promise<ChangeState> {
  // 先收敛未完成的迁移：调用方看到的永远是「迁移前」或「迁移后」，不会是中间态。
  await settlePendingTransition(projectRoot, name);
  const source = await fs.readFile(changeStateFile(projectRoot, name), "utf8");
  return parse(source) as ChangeState;
}

export async function writeChangeState(projectRoot: string, state: ChangeState): Promise<string> {
  const filePath = changeStateFile(projectRoot, state.name);
  await atomicWriteText(filePath, stringify(stampState(state)));
  return filePath;
}

/** 写入前盖上内容哈希；哈希本身不参与计算。 */
export function stampState(state: ChangeState): ChangeState {
  return {
    ...state,
    state_hash: hashChangeState(state as unknown as Record<string, unknown>),
  };
}

/**
 * 迁移状态的唯一提交入口（两阶段）。
 *
 * 直接 writeChangeState 只用于「非迁移」的字段更新；阶段变化一律走这里，
 * 以便崩溃后能被 settlePendingTransition 收敛。
 */
export async function commitTransition(
  projectRoot: string,
  event: ChangeEvent,
  fromState: ChangeState,
  nextState: ChangeState,
): Promise<string> {
  await commitChangeTransition(projectRoot, fromState.name, event, fromState, nextState);
  return changeStateFile(projectRoot, nextState.name);
}
