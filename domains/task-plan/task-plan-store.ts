import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';
import { hashTaskPlan } from '../state/canonical-hash.js';
import type { TaskPlan } from './types.js';

export function planFilePath(projectRoot: string, goalId: string): string {
  return path.join(projectRoot, '.cometflow', 'plans', goalId + '.task-plan.yaml');
}

export async function readTaskPlan(projectRoot: string, goalId: string): Promise<TaskPlan> {
  const filePath = planFilePath(projectRoot, goalId);
  const source = await fs.readFile(filePath, 'utf8');
  return parse(source) as TaskPlan;
}

export async function writeTaskPlan(projectRoot: string, plan: TaskPlan): Promise<string> {
  const filePath = planFilePath(projectRoot, plan.goal);
  // 写盘即盖章：先算内容哈希，再连同哈希一起落盘（哈希本身不参与计算）。
  const stamped: TaskPlan = { ...plan, plan_hash: hashTaskPlan(plan as unknown as Record<string, unknown>) };
  await atomicWriteText(filePath, stringify(stamped));
  return filePath;
}

export function markTaskPlanReviewed(plan: TaskPlan): TaskPlan {
  if (plan.status !== 'draft') {
    throw new Error('Only draft task plans can be reviewed');
  }
  return { ...plan, status: 'validated' };
}

export function markTaskPlanApproved(plan: TaskPlan): TaskPlan {
  if (plan.status !== 'validated' && plan.status !== 'draft') {
    throw new Error('Only draft or validated task plans can be approved');
  }
  return { ...plan, status: 'approved' };
}
