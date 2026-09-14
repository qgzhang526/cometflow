import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../../platform/fs/atomic-write.js';

export interface BudgetOptions {
  budgetMs: number;
  startedAt?: number;
}

export class Budget {
  readonly budgetMs: number;
  readonly startedAt: number;

  constructor(options: BudgetOptions) {
    this.budgetMs = options.budgetMs;
    this.startedAt = options.startedAt ?? Date.now();
  }

  elapsedMs(now = Date.now()): number {
    return Math.max(0, now - this.startedAt);
  }

  isExhausted(now = Date.now()): boolean {
    return this.budgetMs > 0 && this.elapsedMs(now) >= this.budgetMs;
  }
}

export interface BudgetUsage {
  schema: 'cometflow.budget.v1';
  used_ms: number;
  updated_at: string;
}

export function budgetUsagePath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'budget.json');
}

/**
 * 已用预算要跨重启累计：daemon 的预算通常是「每天/每次运行多少分钟」，
 * 而进程重启是常态（手动停、崩溃、机器重启），只存在内存里等于没有预算。
 */
export async function readBudgetUsage(projectRoot: string): Promise<BudgetUsage> {
  try {
    const parsed = JSON.parse(await fs.readFile(budgetUsagePath(projectRoot), 'utf8')) as Partial<BudgetUsage>;
    return {
      schema: 'cometflow.budget.v1',
      used_ms: typeof parsed.used_ms === 'number' ? parsed.used_ms : 0,
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : new Date(0).toISOString(),
    };
  } catch {
    return { schema: 'cometflow.budget.v1', used_ms: 0, updated_at: new Date(0).toISOString() };
  }
}

export async function addBudgetUsage(
  projectRoot: string,
  deltaMs: number,
  options: { now?: Date } = {},
): Promise<BudgetUsage> {
  const current = await readBudgetUsage(projectRoot);
  const next: BudgetUsage = {
    schema: 'cometflow.budget.v1',
    used_ms: current.used_ms + Math.max(0, deltaMs),
    updated_at: (options.now ?? new Date()).toISOString(),
  };
  await atomicWriteJson(budgetUsagePath(projectRoot), next);
  return next;
}

export async function resetBudgetUsage(projectRoot: string, options: { now?: Date } = {}): Promise<BudgetUsage> {
  const next: BudgetUsage = {
    schema: 'cometflow.budget.v1',
    used_ms: 0,
    updated_at: (options.now ?? new Date()).toISOString(),
  };
  await atomicWriteJson(budgetUsagePath(projectRoot), next);
  return next;
}
