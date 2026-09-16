import path from 'node:path';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { validateTaskPlan } from '../../domains/task-plan/task-plan-validate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { traceTaskPlan } from '../../domains/task-plan/task-plan-trace.js';
import { regenerateTaskPlan } from '../../domains/task-plan/task-plan-regenerate.js';
import { applyPlanReviewPolicy } from '../../domains/task-plan/plan-review-policy.js';
import {
  markTaskPlanApproved,
  markTaskPlanReviewed,
  readTaskPlan,
  writeTaskPlan,
} from '../../domains/task-plan/task-plan-store.js';

function projectRoot(targetPath: string): string {
  return path.resolve(targetPath);
}

export async function planGenerateCommand(goalId: string, targetPath: string): Promise<void> {
  const root = projectRoot(targetPath);
  const generated = await generateTaskPlan(root, goalId);
  // 拆解审核策略（ADR 0003）：auto 时校验通过就自动 review + approve，其余停在 draft。
  const review = await applyPlanReviewPolicy(root, generated);
  const filePath = await writeTaskPlan(root, review.plan);
  console.log('wrote ' + filePath);
  console.log('plan review: ' + review.note);
}

export async function planRegenerateCommand(
  goalId: string,
  targetPath: string,
  options: { preserveApproved?: boolean },
): Promise<void> {
  const root = projectRoot(targetPath);
  const previous = await readTaskPlan(root, goalId);
  const regenerated = await regenerateTaskPlan(root, goalId, previous, {
    preserveApproved: options.preserveApproved === true,
  });
  const review = await applyPlanReviewPolicy(root, regenerated);
  const filePath = await writeTaskPlan(root, review.plan);
  console.log('wrote ' + filePath);
  console.log('plan review: ' + review.note);
}

export async function planReviewCommand(goalId: string, targetPath: string): Promise<void> {
  const root = projectRoot(targetPath);
  const plan = markTaskPlanReviewed(await readTaskPlan(root, goalId));
  const filePath = await writeTaskPlan(root, plan);
  console.log('wrote ' + filePath);
}

export async function planApproveCommand(goalId: string, targetPath: string): Promise<void> {
  const root = projectRoot(targetPath);
  const plan = markTaskPlanApproved(await readTaskPlan(root, goalId));
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
  // 退出码即结论（同 spec validate）：门禁按退出码判定，只打印等于没有判定力。
  if (!result.valid) process.exitCode = 1;
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
