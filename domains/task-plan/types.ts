export type TaskStatus = 'draft' | 'validated' | 'approved' | 'frozen' | 'cancelled';
export type TaskKind = 'implementation' | 'spec-authoring';

export interface TaskRecord {
  id: string;
  title: string;
  kind: TaskKind;
  capability: string;
  spec_ref: string | null;
  spec_anchor: string | null;
  acceptance_ids: string[];
  spec_version: number | null;
  spec_hash: string | null;
  /**
   * 该任务绑定 anchor 的段落哈希（不含标题行与 Acceptance 段）。
   * 用于把漂移定位到「哪个接口/流程变了」，而不是整份文件变了。
   */
  anchor_hash?: string | null;
  depends_on: string[];
  /** 由 spec front-matter `module` 声明的代码模块边界。 */
  module?: string | null;
  test_scope: string;
  definition_of_done: string[];
  status: TaskStatus;
}

export interface TaskPlan {
  schema: 'cometflow.task-plan.v1';
  goal: string;
  status: 'draft' | 'validated' | 'approved' | 'frozen';
  tasks: TaskRecord[];
  /** 规范化内容哈希；由 writeTaskPlan 盖章，用于发现手工改写的计划。 */
  plan_hash?: string;
}

export interface PlanFinding {
  taskId: string | null;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface PlanValidationResult {
  valid: boolean;
  findings: PlanFinding[];
}
