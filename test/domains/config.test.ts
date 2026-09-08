import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SchedulerMode } from '../../domains/scheduler/idle-governor.js';
import {
  CONFIG_SCHEMA,
  DEFAULT_CONFIG,
  globalConfigPath,
  projectConfigPath,
  readGlobalConfig,
  readProjectConfig,
  resolveAgentId,
  resolveModel,
  validateProjectConfig,
  writeGlobalConfig,
  writeProjectConfig,
} from '../../domains/project/config.js';

describe('project config service', () => {
  it('returns defaults when config.yaml is missing', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-config-'));
    const config = await readProjectConfig(tmp);
    expect(config.schema).toBe(CONFIG_SCHEMA);
    expect(config.agent).toBe('opencode');
    expect(config.plan_review).toBe('high-risk');
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('reads an existing config.yaml and merges defaults', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-config-'));
    await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
    await fs.writeFile(projectConfigPath(tmp), [
      'schema: cometflow.project.v1',
      'default_workflow: native',
      'agent: claude-code',
      'model: claude-sonnet-4-5',
    ].join('\n'));
    const config = await readProjectConfig(tmp);
    expect(config.agent).toBe('claude-code');
    expect(config.model).toBe('claude-sonnet-4-5');
    expect(config.plan_review).toBe(DEFAULT_CONFIG.plan_review);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('write/read round-trips', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-config-'));
    const config = {
      ...DEFAULT_CONFIG,
      agent: 'opencode',
      model: 'deepseek-v4-flash',
      scheduler: { mode: 'idle' as SchedulerMode, intervalMs: 60000 },
    };
    await writeProjectConfig(tmp, config);
    const loaded = await readProjectConfig(tmp);
    expect(loaded.agent).toBe('opencode');
    expect(loaded.model).toBe('deepseek-v4-flash');
    expect(loaded.scheduler?.mode).toBe('idle');
    expect(loaded.scheduler?.intervalMs).toBe(60000);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('validates agent/model/scheduler', () => {
    const agentErrors = validateProjectConfig({ ...DEFAULT_CONFIG, agent: 'nope' });
    expect(agentErrors.some((error) => error.includes('agent must be one of'))).toBe(true);

    const modelErrors = validateProjectConfig({ ...DEFAULT_CONFIG, model: '  ' });
    expect(modelErrors.some((error) => error.includes('model must be a non-empty string'))).toBe(true);

    const modeErrors = validateProjectConfig({ ...DEFAULT_CONFIG, scheduler: { mode: 'bogus' as SchedulerMode } });
    expect(modeErrors.some((error) => error.includes('scheduler.mode must be one of'))).toBe(true);

    const intervalErrors = validateProjectConfig({ ...DEFAULT_CONFIG, scheduler: { intervalMs: -1 } });
    expect(intervalErrors.some((error) => error.includes('scheduler.intervalMs must be a non-negative number'))).toBe(true);

    expect(validateProjectConfig({ ...DEFAULT_CONFIG, agent: 'opencode', model: 'gpt-5' })).toHaveLength(0);
  });

  it('resolves agent from env > config > default', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-config-'));
    expect(await resolveAgentId(tmp, { COMETFLOW_AGENT: 'claude-code' })).toBe('claude-code');
    await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
    await fs.writeFile(projectConfigPath(tmp), 'schema: cometflow.project.v1\nagent: claude-code\n');
    expect(await resolveAgentId(tmp, {})).toBe('claude-code');
    await fs.rm(projectConfigPath(tmp));
    expect(await resolveAgentId(tmp, {})).toBe('opencode');
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('reads global config defaults', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-home-'));
    const previous = process.env.COMETFLOW_HOME;
    process.env.COMETFLOW_HOME = home;
    try {
      expect(await readGlobalConfig()).toMatchObject({ agent: 'opencode' });
      await writeGlobalConfig({ ...DEFAULT_CONFIG, agent: 'claude-code', model: 'global-model' });
      expect((await readGlobalConfig()).agent).toBe('claude-code');
      expect(globalConfigPath().endsWith(path.join('.cometflow', 'config.yaml'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.COMETFLOW_HOME; else process.env.COMETFLOW_HOME = previous;
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it('merges global defaults and project overrides', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-home-'));
    const previous = process.env.COMETFLOW_HOME;
    process.env.COMETFLOW_HOME = home;
    try {
      await writeGlobalConfig({ ...DEFAULT_CONFIG, agent: 'claude-code', model: 'global-model' });
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-proj-'));
      expect((await readProjectConfig(tmp)).agent).toBe('claude-code');

      await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
      await fs.writeFile(projectConfigPath(tmp), 'schema: cometflow.project.v1\nagent: opencode\n');
      expect((await readProjectConfig(tmp)).agent).toBe('opencode');
      expect((await readProjectConfig(tmp)).model).toBe('global-model');
      await fs.rm(tmp, { recursive: true, force: true });
    } finally {
      if (previous === undefined) delete process.env.COMETFLOW_HOME; else process.env.COMETFLOW_HOME = previous;
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it('merges per-agent models from global and project', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-home-'));
    const previous = process.env.COMETFLOW_HOME;
    process.env.COMETFLOW_HOME = home;
    try {
      await writeGlobalConfig({ ...DEFAULT_CONFIG, agents: { opencode: { model: 'global-opencode' } } });
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-proj-'));
      await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
      await fs.writeFile(projectConfigPath(tmp), 'schema: cometflow.project.v1\nagents:\n  claude-code: { model: project-claude }\n');
      const config = await readProjectConfig(tmp);
      expect(config.agents?.opencode?.model).toBe('global-opencode');
      expect(config.agents?.['claude-code']?.model).toBe('project-claude');
      await fs.rm(tmp, { recursive: true, force: true });
    } finally {
      if (previous === undefined) delete process.env.COMETFLOW_HOME; else process.env.COMETFLOW_HOME = previous;
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it('resolves model: per-agent > global > undefined', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-config-'));
    await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
    await fs.writeFile(projectConfigPath(tmp), [
      'schema: cometflow.project.v1',
      'agent: opencode',
      'model: global-model',
      'agents:',
      '  opencode: { model: opencode-model }',
      '  claude-code: { model: claude-model }',
    ].join('\n'));
    expect(await resolveModel(tmp, 'opencode')).toBe('opencode-model');
    expect(await resolveModel(tmp, 'claude-code')).toBe('claude-model');

    await fs.writeFile(projectConfigPath(tmp), 'schema: cometflow.project.v1\nagent: opencode\nmodel: global-model\n');
    expect(await resolveModel(tmp, 'opencode')).toBe('global-model');

    await fs.writeFile(projectConfigPath(tmp), 'schema: cometflow.project.v1\nagent: opencode\n');
    expect(await resolveModel(tmp, 'opencode')).toBeUndefined();
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
