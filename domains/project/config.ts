import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { builtInAgentRunners } from '../../platform/agents/registry.js';
import { parseMetricsGateConfig } from '../metrics/metric-gates.js';
import type { SchedulerMode } from '../scheduler/idle-governor.js';

export const CONFIG_SCHEMA = 'cometflow.project.v1';

export interface AgentModelConfig {
  model?: string;
}

export interface SchedulerConfig {
  mode?: SchedulerMode;
  intervalMs?: number;
  budgetMs?: number;
  idleCpuThreshold?: number;
  scheduleStartMinutes?: number;
  scheduleEndMinutes?: number;
}

export interface ScopeConfig {
  /**
   * 允许在 spec 声明的模块之外改动的路径（项目相对，支持目录前缀）。
   * 典型用途：package.json / lockfile / tsconfig.json 这类仓库级共享文件。
   */
  allow?: string[];
  /**
   * 快照存在 omission（超大文件、超出文件数上限等）时的处理级别。
   * warn：只提示（默认，兼容老项目）；fail：视为越界，验证与归档都会被拒。
   */
  omission_policy?: 'warn' | 'fail';
}

export interface ProjectConfig {
  schema: string;
  default_workflow?: string;
  plan_review?: string;
  agent?: string;
  model?: string;
  agents?: Record<string, AgentModelConfig>;
  scheduler?: SchedulerConfig;
  scope?: ScopeConfig;
  concurrency?: ConcurrencyConfig;
  verification?: VerificationConfig;
  git?: GitConfig;
  gates?: GatesConfig;
}

/**
 * 门禁配置（P3）。目前只有指标阈值一节：
 * `gates.metrics.<指标名>: { min | max | direction | tolerance }`。
 * 不配就是「不新增约束」，与这一批之前的行为逐字一致。
 */
export interface GatesConfig {
  metrics?: Record<string, unknown>;
}

/**
 * 并发写策略（ADR 0021）。
 *
 * `warn` 是**有期限**的过渡态：必须带一个未来的 `warnUntil`，到期由 `doctor` 与 `spec verify` 报
 * error（CI 因此变红），只能「切 fail」或「显式延长并写下理由」。
 * `fail` 时不允许保留 `warnUntil`，避免「已经严了却还挂着到期日」的歧义状态。
 */
export interface ConcurrencyConfig {
  specWrites?: 'warn' | 'fail';
  warnUntil?: string;
  warnReason?: string;
}

export interface GitConfig {
  /**
   * 允许在 git 来源漂移（历史回退/分叉）时继续推进。
   * 默认 false：漂移必须显式确认，避免在错误的历史上白跑。
   */
  allow_drift?: boolean;
}

export type VerificationMode = 'checks' | 'checks+agent' | 'agent-required';

/**
 * 独立 Verifier 不可用时的策略。
 *
 * - skip：静默降级（旧行为，保留给不想被打扰的项目）
 * - warn：验证继续，但把「本轮没有独立验证」写进 verification.md 与 journal（默认）
 * - fail：直接判定失败，要求必须有人/agent 独立判定
 */
export type VerifierPolicy = 'skip' | 'warn' | 'fail';

export interface VerificationConfig {
  /**
   * checks：只跑确定性 acceptance 检查（默认，可离线）。
   * checks+agent：确定性检查 + 独立 Verifier agent 复核未覆盖项。
   * agent-required：必须由独立 Verifier agent 给出完整结论，agent 不可用即失败。
   */
  mode?: VerificationMode;
  /** 独立 Verifier 使用的 agent id，默认与 Builder 相同（但用独立会话与只读提示词）。 */
  agent?: string;
  model?: string;
  /**
   * 连续同一失败结论的最大轮数；超过即把 change 置为 blocked（默认 3）。
   * 设为 1 表示「只要一次失败就停机」，适合无人值守场景。
   */
  max_repair_attempts?: number;
  /**
   * 无人值守前置检查：验收项既没有可执行 `check:`、也没有 eval / 独立 Verifier 兜底时怎么办。
   *
   * 这类任务跑到最后必然是 blocked（`needs an independent verifier or a human verdict`），
   * 所以默认**不执行**：直接判失败并停机，把预算留给人把 spec 补成可判定的。
   *
   * - `fail`（默认，未配置即此值）：不执行，任务失败，daemon 停机交人工；
   * - `warn`：照常执行，只在结论里记一笔（人工在场时可用）；
   * - `off`：不检查。
   */
  unattended_preflight?: 'fail' | 'warn' | 'off';
  /** 仅在 mode 为 checks+agent / agent-required 时生效。 */
  verifier_policy?: VerifierPolicy;
}

export const DEFAULT_CONFIG: ProjectConfig = {
  schema: CONFIG_SCHEMA,
  default_workflow: 'native',
  plan_review: 'high-risk',
  agent: 'opencode',
};

export function projectConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'config.yaml');
}

function globalConfigDir(): string {
  const home = process.env.COMETFLOW_HOME ?? os.homedir();
  return path.join(home, '.cometflow');
}

export function globalConfigPath(): string {
  return path.join(globalConfigDir(), 'config.yaml');
}

export function knownAgentIds(): string[] {
  return builtInAgentRunners().map((runner) => runner.id);
}

function toConfig(raw: unknown): ProjectConfig {
  const record = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { ...DEFAULT_CONFIG, ...record } as ProjectConfig;
}

function mergeConfigs(global: ProjectConfig, project: ProjectConfig): ProjectConfig {
  const merged: ProjectConfig = { ...DEFAULT_CONFIG, ...global, ...project };
  merged.agents = { ...(global.agents ?? {}), ...(project.agents ?? {}) };
  return merged;
}

export async function readGlobalConfig(): Promise<ProjectConfig> {
  const filePath = globalConfigPath();
  let parsed: unknown;
  try {
    const source = await fs.readFile(filePath, 'utf8');
    parsed = parse(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_CONFIG };
    throw error;
  }
  return toConfig(parsed);
}

export async function writeGlobalConfig(config: ProjectConfig): Promise<string> {
  const filePath = globalConfigPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringify(config));
  return filePath;
}

export async function readProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  const global = await readGlobalConfig();
  const filePath = projectConfigPath(projectRoot);
  let parsed: unknown;
  try {
    const source = await fs.readFile(filePath, 'utf8');
    parsed = parse(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return mergeConfigs(global, {} as ProjectConfig);
    throw error;
  }
  return mergeConfigs(global, toConfig(parsed));
}

/**
 * 只读项目文件本身写了什么，不叠加全局默认。
 *
 * 用途有两个：一是增量写入时以它为基底，避免把「全局默认」固化成项目值；
 * 二是让界面能回答「这个字段到底是被项目覆盖了，还是继承全局」。
 */
export async function readProjectConfigOverride(projectRoot: string): Promise<Partial<ProjectConfig>> {
  const filePath = projectConfigPath(projectRoot);
  let parsed: unknown;
  try {
    const source = await fs.readFile(filePath, 'utf8');
    parsed = parse(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Partial<ProjectConfig>;
}

/**
 * 把一次配置写入合并进项目文件，而不是整体覆盖。
 *
 * 覆盖写会让「只改 agent 的界面」顺手删掉 verification / scope 这些它没渲染的字段，
 * 所以这里做两层合并：顶层键覆盖，嵌套对象逐键覆盖。
 */
export function mergeProjectConfigOverride(
  base: Partial<ProjectConfig>,
  patch: Partial<ProjectConfig>,
): ProjectConfig {
  const merged: ProjectConfig = {
    ...base,
    ...patch,
    schema: CONFIG_SCHEMA,
  };
  merged.agents = { ...(base.agents ?? {}), ...(patch.agents ?? {}) };
  if (Object.keys(merged.agents).length === 0) delete merged.agents;
  merged.scheduler = { ...(base.scheduler ?? {}), ...(patch.scheduler ?? {}) };
  if (Object.keys(merged.scheduler).length === 0) delete merged.scheduler;
  merged.scope = { ...(base.scope ?? {}), ...(patch.scope ?? {}) };
  if (Object.keys(merged.scope).length === 0) delete merged.scope;
  merged.verification = { ...(base.verification ?? {}), ...(patch.verification ?? {}) };
  if (Object.keys(merged.verification).length === 0) delete merged.verification;
  merged.gates = { ...(base.gates ?? {}), ...(patch.gates ?? {}) };
  if (Object.keys(merged.gates).length === 0) delete merged.gates;
  return merged;
}

export async function writeProjectConfig(projectRoot: string, config: ProjectConfig): Promise<string> {
  const filePath = projectConfigPath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringify(config));
  return filePath;
}

export function validateProjectConfig(config: ProjectConfig): string[] {
  const errors: string[] = [];

  if (config.schema && config.schema !== CONFIG_SCHEMA) {
    errors.push('schema must be ' + CONFIG_SCHEMA + ', got ' + config.schema);
  }

  const agentIds = new Set(knownAgentIds());
  if (config.agent && !agentIds.has(config.agent)) {
    errors.push('agent must be one of: ' + [...agentIds].join(', ') + ', got ' + config.agent);
  }

  if (config.model !== undefined && (typeof config.model !== 'string' || config.model.trim() === '')) {
    errors.push('model must be a non-empty string');
  }

  if (config.agents !== undefined) {
    for (const [agentId, agentConfig] of Object.entries(config.agents)) {
      if (!agentIds.has(agentId)) {
        errors.push('agents.' + agentId + ' is not a known agent');
      }
      const model = agentConfig?.model;
      if (model !== undefined && (typeof model !== 'string' || model.trim() === '')) {
        errors.push('agents.' + agentId + '.model must be a non-empty string');
      }
    }
  }

  if (config.scheduler) {
    const scheduler = config.scheduler;
    const modes: SchedulerMode[] = ['always', 'idle', 'schedule', 'manual'];
    if (scheduler.mode !== undefined && !modes.includes(scheduler.mode)) {
      errors.push('scheduler.mode must be one of: ' + modes.join(', '));
    }
    const numericKeys = ['intervalMs', 'budgetMs', 'idleCpuThreshold', 'scheduleStartMinutes', 'scheduleEndMinutes'] as const;
    for (const key of numericKeys) {
      const value = scheduler[key];
      if (value !== undefined && (typeof value !== 'number' || Number.isNaN(value) || value < 0)) {
        errors.push('scheduler.' + key + ' must be a non-negative number');
      }
    }
  }

  if (config.scope?.allow !== undefined) {
    if (!Array.isArray(config.scope.allow) || config.scope.allow.some((entry) => typeof entry !== 'string')) {
      errors.push('scope.allow must be an array of project-relative paths');
    }
  }

  if (config.scope?.omission_policy !== undefined) {
    if (config.scope.omission_policy !== 'warn' && config.scope.omission_policy !== 'fail') {
      errors.push('scope.omission_policy must be one of: warn, fail');
    }
  }

  if (config.concurrency !== undefined) {
    const specWrites = config.concurrency.specWrites;
    const warnUntil = config.concurrency.warnUntil;
    if (specWrites !== undefined && specWrites !== 'warn' && specWrites !== 'fail') {
      errors.push('concurrency.specWrites must be one of: warn, fail');
    }
    if (warnUntil !== undefined && Number.isNaN(new Date(warnUntil).getTime())) {
      errors.push('concurrency.warnUntil must be an ISO date');
    }
    if (specWrites === 'warn' && warnUntil === undefined) {
      errors.push('concurrency.warnUntil is required while concurrency.specWrites is warn（warn 是有期限的过渡态）');
    }
    if (specWrites === 'fail' && warnUntil !== undefined) {
      errors.push('concurrency.warnUntil must be removed when concurrency.specWrites is fail');
    }
  }

  if (config.verification) {
    const modes: VerificationMode[] = ['checks', 'checks+agent', 'agent-required'];
    const mode = config.verification.mode;
    if (mode !== undefined && !modes.includes(mode)) {
      errors.push('verification.mode must be one of: ' + modes.join(', '));
    }
    const verifierAgent = config.verification.agent;
    if (verifierAgent !== undefined && !agentIds.has(verifierAgent)) {
      errors.push('verification.agent must be one of: ' + [...agentIds].join(', '));
    }
    const maxAttempts = config.verification.max_repair_attempts;
    if (
      maxAttempts !== undefined &&
      (!Number.isInteger(maxAttempts) || maxAttempts < 1)
    ) {
      errors.push('verification.max_repair_attempts must be an integer >= 1');
    }
    const policy = config.verification.verifier_policy;
    if (policy !== undefined && !['skip', 'warn', 'fail'].includes(policy)) {
      errors.push('verification.verifier_policy must be one of: skip, warn, fail');
    }
  }

  if (config.git?.allow_drift !== undefined && typeof config.git.allow_drift !== 'boolean') {
    errors.push('git.allow_drift must be a boolean');
  }

  // 指标阈值：未知指标名 / 非数字 / min > max 都要报出来（静默忽略等于给出一条假约束）。
  if (config.gates !== undefined) {
    if (config.gates.metrics !== undefined) {
      errors.push(...parseMetricsGateConfig(config.gates.metrics).errors);
    }
  }

  return errors;
}

export async function resolveAgentId(projectRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.COMETFLOW_AGENT) return env.COMETFLOW_AGENT;
  const config = await readProjectConfig(projectRoot);
  if (config.agent) return config.agent;
  return 'opencode';
}

export async function resolveModel(projectRoot: string, agentId: string): Promise<string | undefined> {
  const config = await readProjectConfig(projectRoot);
  const specific = config.agents?.[agentId]?.model;
  if (specific) return specific;
  return config.model;
}
