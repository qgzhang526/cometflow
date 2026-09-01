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
}
