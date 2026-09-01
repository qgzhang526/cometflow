import path from 'node:path';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { validateTaskPlan } from '../../domains/task-plan/task-plan-validate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { traceTaskPlan } from '../../domains/task-plan/task-plan-trace.js';
import { readTaskPlan, writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';

function projectRoot(targetPath: string): string {
  return path.resolve(targetPath);
}

export async function planGenerateCommand(goalId: string, targetPath: string): Promise<void> {
  const root = projectRoot(targetPath);
  const plan = await generateTaskPlan(root, goalId);
  const filePath = await writeTaskPlan(root, plan);
  console.log('wrote ' + filePath);
}

export async function planValidateCommand(goalId: string, targetPath: string): Promise<void> {
  const root = projectRoot(targetPath);
  const plan = await readTaskPlan(root, goalId);
  const result = await validateTaskPlan(root, plan);
  for (const finding of result.findings) {
    console.log([finding.severity.toUpperCase(), finding.code, finding.taskId ?? '', finding.message].join(' '));
  }
  console.log(result.valid ? 'plan validate: OK' : 'plan validate: FAILED');
}

export async function planFreezeCommand(goalId: string, targetPath: string): Promise<void> {
  const root = projectRoot(targetPath);
  const plan = await readTaskPlan(root, goalId);
  const frozen = await freezeTaskPlan(root, plan);
  const filePath = await writeTaskPlan(root, frozen);
  console.log('wrote ' + filePath);
}

export async function planTraceCommand(goalId: string, targetPath: string): Promise<void> {
  const root = projectRoot(targetPath);
  const plan = await readTaskPlan(root, goalId);
  const lines = traceTaskPlan(plan);
  for (const line of lines) console.log(line);
}
