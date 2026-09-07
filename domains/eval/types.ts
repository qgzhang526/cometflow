export interface EvalAssertion {
  target: 'stdout' | 'stderr';
  operator: 'contains' | 'not_contains';
  value: string;
}

export interface EvalTask {
  name: string;
  command: string;
  args: string[];
  assertions?: EvalAssertion[];
}

export interface EvalRubricItem {
  id: string;
  description: string;
  task: string;
}

export interface LlmJudgeConfig {
  provider: 'mock' | 'langsmith' | 'langfuse';
  model?: string;
  api_key_env?: string;
  project?: string;
}

export interface EvalManifest {
  schema: 'cometflow.eval.v1';
  tasks: EvalTask[];
  sampling?: number;
  pass_at_k?: number;
  pass_all_k?: number;
  rubric?: EvalRubricItem[];
  judge?: LlmJudgeConfig;
}

export interface EvalTaskResult {
  name: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface EvalTaskSummary {
  name: string;
  passed: boolean;
  runs: number;
  passedRuns: number;
  passAtK: boolean;
  passAllK: boolean;
  runResults: EvalTaskResult[];
}

export interface EvalRubricSummary {
  id: string;
  description: string;
  task: string;
  passRate: number;
  passed: boolean;
}

export interface LlmJudgeSummary {
  provider: string;
  verdict: 'pass' | 'fail' | 'blocked';
  notes: string[];
}

export interface EvalReport {
  schema: 'cometflow.eval-report.v1';
  passed: boolean;
  sampling: number;
  passAtK: number;
  passAllK: number;
  passAtKRate: number;
  passAllKRate: number;
  results: EvalTaskSummary[];
  rubric: EvalRubricSummary[];
  judge?: LlmJudgeSummary;
}
