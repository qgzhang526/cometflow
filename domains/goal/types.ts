import type { ScheduleOrder } from './schedule-order.js';

export interface GoalRecord {
  schema: 'cometflow.goal.v1';
  id: string;
  title: string;
  summary: string;
  scope: string[];
  success_criteria: string[];
  non_goals: string[];
  source: 'COMETFLOW.md';
  source_hash: string;
  status: 'active';
}

export interface GoalSyncResult {
  goals: GoalRecord[];
  written: string[];
  /**
   * COMETFLOW.md 的 `## 调度顺序`（ADR 0029）：显式清单 + 可读提示。
   * 只回显与校验，不投影进 goal 文件——顺序由调度器读 COMETFLOW.md 时生效。
   */
  order: ScheduleOrder;
}
