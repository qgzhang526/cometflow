import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { builtInAgentRunners } from '../../platform/agents/registry.js';
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

export interface ProjectConfig {
  schema: string;
  default_workflow?: string;
  plan_review?: string;
  agent?: string;
  model?: string;
  agents?: Record<string, AgentModelConfig>;
  scheduler?: SchedulerConfig;
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
