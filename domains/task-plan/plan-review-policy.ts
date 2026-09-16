import { readProjectConfig } from '../project/config.js';
import { markTaskPlanApproved, markTaskPlanReviewed } from './task-plan-store.js';
import { validateTaskPlan } from './task-plan-validate.js';
import type { TaskPlan } from './types.js';

/**
 * 拆解审核策略（ADR 0003）：`auto | high-risk | human`。
 *
 * 这一层只回答「刚生成的草稿要不要自动往下推」，不改变状态机本身——
 * 推进仍然走 `plan review` / `plan approve` 那两条迁移，不新开状态。
 *
 * 未配置、或配了不认识的值，一律按 `human` 处理：宁可多一道人，不可少一道。
 * `high-risk` 的高风险识别规则尚未实现，同样按 `human` 兜底（停在 draft 更保守，
 * 不会把本该人工确认的拆解自动放行），并在 note 里显式说明「未实现」。
 */
export type PlanReviewPolicy = 'auto' | 'high-risk' | 'human';

export interface PlanReviewOutcome {
  policy: PlanReviewPolicy;
  /** 配置里的原文（`plan_review` 未配置时为 null），用于把「写了什么」原样回显。 */
  declared: string | null;
  /** 自动推进后的计划；未推进时原样返回。 */
  plan: TaskPlan;
  /** 是否发生了自动推进。 */
  applied: boolean;
  /** 人话说明：CLI 与界面直接显示它，避免各写一套文案。 */
  note: string;
}

export function normalizePlanReviewPolicy(value: string | null | undefined): PlanReviewPolicy {
  if (value === 'auto' || value === 'high-risk' || value === 'human') return value;
  return 'human';
}

function unknownPolicyNote(declared: string | null): string {
  return declared === null ? '' : '未知的 plan_review 值「' + declared + '」，';
}

export async function applyPlanReviewPolicy(projectRoot: string, plan: TaskPlan): Promise<PlanReviewOutcome> {
  const config = await readProjectConfig(projectRoot);
  const declared = config.plan_review ?? null;
  const policy = normalizePlanReviewPolicy(declared);

  // 只有草稿才需要策略介入：validated / approved / frozen 都是人（或上一次 auto）已经定过的状态。
  if (plan.status !== 'draft') {
    return {
      policy,
      declared,
      plan,
      applied: false,
      note: '计划已是 ' + plan.status + '，策略不介入',
    };
  }

  if (policy === 'auto') {
    const validation = await validateTaskPlan(projectRoot, plan);
    if (!validation.valid) {
      const errors = validation.findings.filter((finding) => finding.severity === 'error').length;
      // 校验没过就不放行：auto 的语义是「机器校验 + 评审通过才自动」，不是「一律自动」。
      return {
        policy,
        declared,
        plan,
        applied: false,
        note: '策略 auto，但机器校验有 ' + errors + ' 条 error，停在 draft',
      };
    }
    return {
      policy,
      declared,
      plan: markTaskPlanApproved(markTaskPlanReviewed(plan)),
      applied: true,
      note: '策略 auto：机器校验通过，已自动 review + approve',
    };
  }

  if (policy === 'high-risk') {
    return {
      policy,
      declared,
      plan,
      applied: false,
      note: unknownPolicyNote(declared) + '策略 high-risk 的高风险识别规则尚未实现，按 human 处理（停在 draft）',
    };
  }

  return {
    policy,
    declared,
    plan,
    applied: false,
    note: unknownPolicyNote(declared) + '策略 human：停在 draft，等评审 / 批准',
  };
}
