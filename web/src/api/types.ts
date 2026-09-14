/**
 * 与 domains/ 对齐的 API 数据类型。
 *
 * 只声明界面真正消费的字段，避免把领域模型整体复制一遍后失去同步；
 * 领域结构变化时由 typecheck 暴露缺口。
 */

export interface WorkspaceProject {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface ProjectSummary extends WorkspaceProject {
  status: ProjectStatus | null;
  error?: string;
}

export interface ProjectStatus {
  projectRoot: string;
  goals: string[];
  plans: Array<{ goal: string; status: string; tasks: number }>;
  changes: Array<{ name: string; phase: string; archived: boolean }>;
  evolutions: Array<{ name: string; status: string }>;
}

export interface DoctorFinding {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface DoctorReport {
  healthy: boolean;
  findings: DoctorFinding[];
}

export interface GoalRecord {
  id: string;
  title: string;
  summary?: string;
  scope: string[];
  success_criteria: string[];
  non_goals: string[];
  status?: string;
}

export interface SpecEntry {
  path: string;
  kind: string;
}

export interface KindEntry {
  status: 'present' | 'deferred' | 'absent';
  reason: string;
}

export interface InitManifest {
  schema?: string;
  kinds: Record<string, KindEntry>;
}

export interface SpecIndex {
  apis: Array<{ capability: string; heading: string; method: string | null; path: string | null; acceptanceIds: string[] }>;
  models: { entities: Array<{ name: string }>; enums: string[][]; stateMachines: Array<{ name: string }> } | null;
  flows: Array<{ name: string; source: string }>;
  errors: string[];
  config: string[];
}

export interface SpecValidationFinding {
  path: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface SpecValidationResult {
  valid: boolean;
  findings: SpecValidationFinding[];
}

export type TaskStatus = 'draft' | 'validated' | 'approved' | 'frozen' | 'cancelled';

export interface TaskRecord {
  id: string;
  title: string;
  kind: string;
  capability: string;
  spec_ref: string | null;
  spec_anchor: string | null;
  acceptance_ids: string[];
  spec_version: number | null;
  spec_hash: string | null;
  anchor_hash?: string | null;
  depends_on: string[];
  module?: string | null;
  test_scope: string;
  definition_of_done: string[];
  status: TaskStatus;
}

export interface TaskPlan {
  schema: string;
  goal: string;
  status: 'draft' | 'validated' | 'approved' | 'frozen';
  tasks: TaskRecord[];
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

export type ChangePhase = 'shape' | 'build' | 'verify' | 'archive';
export type ChangeStatus = 'active' | 'await-user' | 'blocked' | 'done';

export interface ChangeState {
  schema: string;
  name: string;
  goal: string;
  task: string;
  phase: ChangePhase;
  status: ChangeStatus;
  spec_ref: string | null;
  spec_anchor: string | null;
  acceptance_ids: string[];
  spec_version: number | null;
  spec_hash: string | null;
  spec_base_hash?: string | null;
  applied_spec_version?: number | null;
  anchor_hash?: string | null;
  module?: string | null;
  created_at: string;
  archived: boolean;
  state_hash?: string;
}

export interface ChangeResume {
  message: string;
  nextEvent?: string | null;
}

export type VerdictResult = 'passed' | 'failed' | 'blocked';
export type VerdictSource = 'check' | 'document' | 'agent' | 'eval' | 'uncovered';

export interface AcceptanceVerdict {
  id: string;
  result: VerdictResult;
  source: VerdictSource;
  reason: string;
}

export interface AcceptanceCheckResult {
  id: string;
  text: string;
  check: string | null;
  kind: 'command' | 'none';
  passed: boolean | null;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  reason: string;
}

export interface AcceptanceCheckReport {
  change: string;
  spec_ref: string | null;
  spec_anchor: string | null;
  spec_version: number | null;
  spec_hash: string | null;
  frozen_source: 'version-store' | 'current-file';
  checked_at: string;
  results: AcceptanceCheckResult[];
  uncovered: string[];
  passed: boolean;
}

export interface ImplementationScopeReport {
  change: string;
  module: string | null;
  allow: string[];
  baseline_captured_at: string | null;
  complete: boolean;
  file_count: number;
  changes: Array<{ path: string; kind: string; attributed: boolean; attribution: string }>;
  attributed: string[];
  unattributed: string[];
}

export interface ChangeVerifyOutcome {
  state: ChangeState;
  reportPassed: boolean;
  verdicts: AcceptanceVerdict[];
  checks: AcceptanceCheckReport | null;
  scope: ImplementationScopeReport | null;
  verifierAgent: string | null;
}

export interface ChangeArchiveOutcome {
  change: ChangeState;
  appliedSpecs: string[];
  specVersions?: Array<{ path: string; spec_version: number; hash: string }>;
}

export type EvolutionStatus = 'draft' | 'verifying' | 'verified' | 'ready-for-review' | 'approved' | 'rejected';

export interface EvolutionProposal {
  name: string;
  summary: string;
  risk_plan: string;
  gates: Array<{ name: string; command: string; args: string[] }>;
  status: EvolutionStatus;
  eval?: { passed: boolean; passAtKRate: number; passAllKRate: number; sampling: number };
  created_at: string;
  updated_at: string;
  review_note?: string;
  decision_at?: string;
  rejected_reason?: string;
  merged_commits?: string[];
}

export interface EvalTaskSummary {
  name: string;
  passed: boolean;
  runs: number;
  passedRuns: number;
  passAtK: boolean;
  passAllK: boolean;
  runResults: Array<{ name: string; passed: boolean; exitCode: number; stdout: string; stderr: string; timedOut: boolean }>;
}

export interface EvalReport {
  schema: string;
  passed: boolean;
  sampling: number;
  passAtK: number;
  passAllK: number;
  passAtKRate: number;
  passAllKRate: number;
  results: EvalTaskSummary[];
  rubric: Array<{ id: string; description: string; task: string; passRate: number; passed: boolean }>;
  judge?: { provider: string; verdict: 'pass' | 'fail' | 'blocked'; notes: string[] };
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface JobRecord {
  id: string;
  projectId: string;
  kind: string;
  goal?: string;
  change?: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  logTail: string[];
  result?: unknown;
}

export interface JobEvent {
  type: 'job.queued' | 'job.started' | 'job.log' | 'job.completed' | 'job.failed' | 'state.changed';
  jobId?: string;
  projectId?: string;
  line?: string;
  result?: unknown;
  error?: string;
  path?: string;
  at: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  available: boolean;
}

export type VerificationMode = 'checks' | 'checks+agent' | 'agent-required';

export interface ProjectConfig {
  schema: string;
  default_workflow?: string;
  plan_review?: string;
  agent?: string;
  model?: string;
  agents?: Record<string, { model?: string }>;
  scheduler?: {
    mode?: 'always' | 'idle' | 'schedule' | 'manual';
    intervalMs?: number;
    budgetMs?: number;
    idleCpuThreshold?: number;
    scheduleStartMinutes?: number;
    scheduleEndMinutes?: number;
  };
  scope?: { allow?: string[] };
  verification?: { mode?: VerificationMode; agent?: string; model?: string };
}

export interface ProjectConfigResponse {
  config: ProjectConfig;
  projectOverride: Partial<ProjectConfig>;
}

export interface ScaffoldAnswers {
  network?: boolean;
  runtimeConfig?: boolean;
  crossApiFlow?: boolean;
  backgroundProcess?: boolean;
  domainDsl?: boolean;
  manyErrors?: boolean;
  auth?: 'none' | 'machine' | 'roles';
}

export interface FsListing {
  path: string;
  parent: string | null;
  entries: Array<{ name: string; path: string; isDirectory: boolean }>;
}
