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
  depends_on: string[];
  test_scope: string;
  definition_of_done: string[];
  status: TaskStatus;
}

export interface TaskPlan {
  schema: 'cometflow.task-plan.v1';
  goal: string;
  status: 'draft' | 'validated' | 'approved' | 'frozen';
  tasks: TaskRecord[];
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
