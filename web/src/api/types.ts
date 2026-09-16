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
  /** H3-1：连续相同失败结论的计数与指纹，用于「停滞停机」判定。 */
  repair_attempts?: number;
  last_verdict_hash?: string | null;
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
  schema: string;
  change: string;
  module: string | null;
  allow: string[];
  baseline_captured_at: string | null;
  complete: boolean;
  file_count: number;
  changes: Array<{ path: string; kind: string; attributed: boolean; attribution: string }>;
  attributed: string[];
  unattributed: string[];
  /** H2：被跳过的文件（大小/数量上限），跳过什么、为什么、跳过多少都要留痕。 */
  omitted: ScopeOmission[];
  omittedCount: number;
  omissionOverflow: { count: number; hash: string } | null;
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
  /** 并发写策略的实时状态（ADR 0021 的两段式上线）。 */
  concurrencyPolicy?: {
    mode: 'warn' | 'fail';
    warnUntil: string | null;
    warnReason: string | null;
    expired: boolean;
    daysUntilExpiry: number | null;
  };
  concurrencyConflicts?: number;
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

// ---------- spec 内核：验收覆盖 / 门禁 / 版本 / 影响 ----------

export interface AcceptanceItem {
  id: string;
  text: string;
  /** null = 只能由独立 Verifier 或人工判定（ADR 0013）。 */
  check: string | null;
}

export interface AcceptanceCheckAnchor {
  path: string;
  anchor: string;
  acceptance: AcceptanceItem[];
}

export interface AcceptanceCheckCoverage {
  anchors: AcceptanceCheckAnchor[];
  total: number;
  checked: number;
  unchecked: number;
}

export interface SpecVerifyFinding {
  severity: 'error' | 'warning';
  code: string;
  subject: string;
  message: string;
}

export interface SpecVerifyResult {
  schema: string;
  valid: boolean;
  findings: SpecVerifyFinding[];
}

export interface SpecLockEntry {
  path: string;
  hash: string;
}

export interface SpecDiffResult {
  added: SpecLockEntry[];
  modified: SpecLockEntry[];
  removed: SpecLockEntry[];
  unchanged: SpecLockEntry[];
}

export type SpecDriftSeverity = 'low' | 'medium' | 'high';

export interface SpecDriftEntry {
  goal: string;
  task: string;
  task_status: string;
  spec_ref: string;
  spec_anchor: string | null;
  frozen_hash: string;
  current_hash: string;
  kind: string;
  severity: SpecDriftSeverity;
  renamed_to: string | null;
  acceptance_added: string[];
  acceptance_removed: string[];
  frozen_source: string | null;
  message: string;
}

export interface SpecDriftReport {
  drift: SpecDriftEntry[];
  scannedTasks: number;
  unresolvable: Array<{ goal: string; task: string; spec_ref: string; frozen_hash: string }>;
}

export interface SpecImpactAnchor {
  heading: string;
  change: string;
  severity: SpecDriftSeverity;
  detail: string;
  renamed_to?: string;
}

export interface SpecImpactTask {
  goal: string;
  task: string;
  task_status: string;
  anchor: string | null;
  change: string;
  severity: SpecDriftSeverity;
  message: string;
  acceptance_added: string[];
  acceptance_removed: string[];
}

export interface SpecImpactFile {
  path: string;
  file_change: 'added' | 'modified' | 'removed';
  anchors: SpecImpactAnchor[];
  affected_tasks: SpecImpactTask[];
  severity: 'none' | SpecDriftSeverity;
}

export interface SpecImpactReport {
  schema: string;
  generated_at: string;
  files: SpecImpactFile[];
  affected_tasks: SpecImpactTask[];
  untracked_changes: string[];
  summary: {
    files_changed: number;
    anchors_changed: number;
    tasks_affected: number;
    highest_severity: 'none' | SpecDriftSeverity;
  };
}

export interface SpecVersionRecord {
  spec_version: number;
  hash: string;
  recorded_at: string;
  change: string | null;
  parent: string | null;
  note: string | null;
}

export interface SpecHistoryResponse {
  schema: string;
  specs: Record<string, SpecVersionRecord[]>;
}

export interface SpecVersionContent {
  path: string;
  record: SpecVersionRecord;
  content: string;
}

export interface SpecLockResult {
  lock: { files: SpecLockEntry[] };
  recorded: Array<{ path: string; spec_version: number; hash: string }>;
}

export interface SpecRestoreResult {
  path: string;
  restoredFrom: number;
  spec_version: number | null;
  hash: string | null;
}

// ---------- change 审计：实现范围 / 流水 / 证据 / 恢复路径 ----------

export type ScopeOmissionReason = 'file-size-limit' | 'file-count-limit';

export interface ScopeOmission {
  path: string;
  reason: ScopeOmissionReason;
  size: number | null;
}

export interface ChangeJournalEvent {
  schema: string;
  at: string;
  change: string;
  event: string;
  phase?: string;
  data?: Record<string, unknown>;
}

export interface ChangeEvidence {
  artifacts: Array<{ name: string; bytes: number; content: string }>;
  staleVerification: string[];
  proposedSpecs: string[];
  incompleteTransactions: Array<{ txId: string; status: string; dir: string }>;
}

export interface ChangeRebaseOutcome {
  state: ChangeState;
  baselineFiles: number;
  specVersion: number | null;
  acceptanceIds: string[];
}

export interface ChangeUnblockOutcome {
  state: ChangeState;
  previousAttempts: number;
}

export interface SpecConflictDetail {
  path: string;
  expected: string | null;
  actual: string | null;
  kind: string;
}

// ---------- 调度 / 资产 / 写入门禁（W5） ----------

export type QueueTaskStatus = 'queued' | 'running' | 'done' | 'failed';

export interface QueueTask {
  id: string;
  goal: string;
  task: string;
  title: string;
  status: QueueTaskStatus;
  attempts: number;
  updated_at: string;
}

export interface SchedulerQueue {
  schema: string;
  tasks: QueueTask[];
}

export interface SchedulerResponse {
  /** daemon 实际写下的队列；没跑过 daemon 时为 null。 */
  queue: SchedulerQueue | null;
  /** 按已冻结计划推导的待办，用于「还没建过队列」时的可用视图。 */
  derived: SchedulerQueue;
  next: QueueTask | null;
  scheduler: ProjectConfig['scheduler'] | null;
}

export interface SkillSummary {
  name: string;
  description: string;
  version: string;
  author: string | null;
  files: string[];
}

export interface SkillsResponse {
  skills: SkillSummary[];
}

export interface SkillDetail {
  definition: { name: string; description: string; version: string; author?: string };
  files: string[];
  content: string | null;
}

export interface BundleResponse {
  manifest: { schema: string; name: string; version: string; skills: Array<{ name: string; path: string }> } | null;
  compiled: { name: string; version: string; files: string[] } | null;
  platforms: string[];
  error: string | null;
}

export interface HookDecision {
  allowed: boolean;
  reason: string;
  hint?: string;
}

export interface HookCheckResponse {
  target: string;
  event: string;
  decision: HookDecision;
}

export interface ClassicState {
  schema: string;
  name: string;
  goal: string;
  task: string;
  profile: string;
  phase: string;
  archived: boolean;
  created_at: string;
}

export interface ClassicResponse {
  changes: ClassicState[];
}

// ---------- 引用关系图与引用高亮（N1/N2） ----------

export type SpecRefKind = 'model' | 'error' | 'config' | 'header' | 'status' | 'api';

export interface SpecRefSpan {
  kind: SpecRefKind;
  value: string;
  start: number;
  end: number;
}

export interface SpecReferenceToken extends SpecRefSpan {
  line: number;
  resolved: boolean;
}

export interface SpecReferencesResponse {
  tokens: SpecReferenceToken[];
}

export interface SpecGraphNode {
  id: string;
  level: 'kind' | 'file' | 'anchor' | 'target';
  kind: string;
  label: string;
  status: 'present' | 'deferred' | 'absent';
  path?: string;
  anchor?: string;
  line?: number;
  acceptance?: number;
  hasCheck?: boolean;
  value?: string;
}

export interface SpecGraphEdge {
  from: string;
  to: string;
  level: 'containment' | 'reference';
  resolved: boolean;
  refKind?: SpecRefKind;
  site?: { path: string; line: number };
  count?: number;
}

export interface SpecGraphUnresolved {
  path: string;
  line: number;
  refKind: SpecRefKind;
  value: string;
  code: string;
  severity: 'error' | 'warning';
}

export interface SpecGraphProjection {
  schema: string;
  nodes: SpecGraphNode[];
  edges: SpecGraphEdge[];
  unresolved: SpecGraphUnresolved[];
  summary: {
    kinds: number;
    files: number;
    anchors: number;
    targets: number;
    edges: number;
    unresolved: number;
  };
}

export interface SpecProposal {
  change: string;
  path: string;
  /** 仅当查询带 `path` 时返回（编辑器对比用）。 */
  content?: string;
}

export interface SpecProposalsResponse {
  proposals: SpecProposal[];
}

// ---- V1 可见性批次：把「后端算出来了、但只能敲命令」的结论搬到界面 ----

/** 统一 findings 投影（`GET /findings`，与 `cometflow gate check --findings` 同源）。 */
export type FindingSource = 'spec-verify' | 'doctor';
export type FindingSeverity = 'error' | 'warning' | 'info';

export interface Finding {
  source: FindingSource;
  code: string;
  severity: FindingSeverity;
  /** 出问题的对象（spec 路径、change 名）；doctor 来源为空串。 */
  subject: string;
  message: string;
}

export interface FindingsResponse {
  findings: Finding[];
}

export interface RebuildBucket {
  key: string;
  sample_size: number;
  first_pass_rate: number | null;
  mean_attempts_to_pass: number | null;
  blocked_rate: number | null;
}

/** 度量报告（`GET /metrics`）：字段与 `domains/metrics/types.ts` 对齐，只做展示。 */
export interface MetricsReport {
  schema: string;
  generated_at: string;
  project: {
    changes: number;
    active_changes: number;
    archived_changes: number;
    specs: number;
    capabilities: number;
  };
  rebuild: {
    sample_size: number;
    verified_changes: number;
    total_changes: number;
    archived_changes: number;
    first_pass_rate: number | null;
    mean_attempts_to_pass: number | null;
    pass_rate: number | null;
    blocked_rate: number | null;
    verdict_sources: Record<string, number>;
    check_coverage_rate: number | null;
    verifier: { runs: number; total_ms: number; mean_ms: number | null };
    per_capability: RebuildBucket[];
    per_module: RebuildBucket[];
  };
  spec_health: {
    specs: number;
    capabilities: number;
    acceptance_total: number;
    acceptance_with_check: number;
    acceptance_checkable_rate: number | null;
    anchor_total: number;
    anchor_bound: number;
    anchor_coverage_rate: number | null;
    drift: {
      count: number;
      by_kind: Record<string, number>;
      by_severity: Record<string, number>;
      unresolvable: number;
      oldest_spec_change_age_days: number | null;
    };
    versions: {
      specs_tracked: number;
      total_versions: number;
      specs_with_multiple_versions: number;
    };
  };
  notes: string[];
}

/** 生效的门禁阈值：`lines` 始终有值（未配置时是内置方向表），避免出现看不见的约束。 */
export interface MetricsGateInfo {
  thresholds: Record<string, unknown>;
  errors: string[];
  lines: string[];
}

export interface MetricsResponse {
  report: MetricsReport;
  gates: MetricsGateInfo;
}

/** 维护预告（`GET /maintenance`）：三个动作各自「将要删什么」。 */
export interface EvidenceUsageEntry {
  change: string;
  archived: boolean;
  bytes: number;
  files: number;
}

export interface EvidenceReclaimCandidate {
  change: string;
  path: string;
  reason: string;
  bytes: number;
}

export interface MaintenancePlan {
  temp: {
    count: number;
    totalBytes: number;
    sample: Array<{ path: string; size: number }>;
  };
  jobs: {
    files: number;
    bytes: number;
    finished: number;
    running: number;
    candidates: number;
    reclaimableBytes: number;
  };
  lock: {
    held: boolean;
    stale: boolean;
    reason: string | null;
    /** `pid@host@startedAt`：确认时原样回传，服务端据此拒绝「看到的锁」与「要清的锁」不一致。 */
    holder: string | null;
    record: { pid: number; host: string; startedAt: string; action: string; ttlMs: number } | null;
  };
  /** change 运行时证据（`change gc` 的对象）：只回收「可重新推导」的部分。 */
  evidence: {
    totalBytes: number;
    changes: EvidenceUsageEntry[];
    reclaimableBytes: number;
    candidates: EvidenceReclaimCandidate[];
  };
}

/** 写保护（ADR 0023）的安装状态：装没装、条目与脚本是否漂移、守卫调用的 CLI 能否解析。 */
export interface HookCommandResolution {
  command: string;
  executable: string;
  path: string | null;
  resolved: boolean;
  detail: string | null;
}

export interface HookStatus {
  platform: 'claude-code' | 'opencode' | 'codex';
  supported: boolean;
  installed: boolean;
  guardExists: boolean;
  settingsPath: string | null;
  entries: number;
  drift: string | null;
  guardOutdated: boolean;
  cli: HookCommandResolution;
}

export interface HookStatusResponse {
  platforms: HookStatus[];
}

/** `evolve rollback` 的指引（纯投影，不改状态）。 */
export interface EvolveRollbackResponse {
  name: string;
  lines: string[];
}

/** current-change 指针（`GET /current-change`）：多活跃 change 时唯一能解除 hook fail closed 的入口。 */
export interface CurrentChangePointer {
  schema: string;
  change: string;
  selected_at: string;
  source: 'auto' | 'manual';
}

export interface CurrentChangeResponse {
  pointer: CurrentChangePointer | null;
  change: ChangeState | null;
  resolved: boolean;
}
