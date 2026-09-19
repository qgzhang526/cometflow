import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRunner } from '../../platform/agents/types.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import { runChange } from '../../domains/workflow/change-execution.js';
import { readChangeJournal } from '../../domains/workflow/change-journal.js';

/**
 * Builder 的模型解析（回归：CLI/Web 过去静默忽略项目配置）。
 *
 * `.cometflow/config.yaml` 里的 `model` / `agents.<id>.model` 必须真的送到 Agent，
 * 否则"项目里配了模型"只是幻觉：daemon 会用它，`change run`（CLI）与 Web 的 run-change 不会，
 * 同一个项目换条路径跑出来的结果就不一样。解析点统一在 `runChange`，这个用例把它钉住。
 */
const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');
const temporaryRoots: string[] = [];
const originalHome = process.env.COMETFLOW_HOME;

afterEach(async () => {
  if (originalHome === undefined) delete process.env.COMETFLOW_HOME;
  else process.env.COMETFLOW_HOME = originalHome;
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

/** 隔离全局配置（`~/.cometflow/config.yaml`），否则用例结果会随开发机而变。 */
async function isolateGlobalConfig(root: string): Promise<void> {
  const home = path.join(root, 'home');
  await fs.mkdir(home, { recursive: true });
  process.env.COMETFLOW_HOME = home;
}

async function makeChangeInBuild(config: Record<string, unknown> = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-builder-model-'));
  temporaryRoots.push(root);
  await isolateGlobalConfig(root);
  const project = path.join(root, 'project');
  await fs.cp(fixture, project, { recursive: true });
  await fs.mkdir(path.join(project, '.cometflow'), { recursive: true });
  await fs.writeFile(
    path.join(project, '.cometflow', 'config.yaml'),
    stringify({ schema: 'cometflow.project.v1', ...config }),
  );
  const plan = await freezeTaskPlan(project, await generateTaskPlan(project, 'G1'));
  await writeTaskPlan(project, plan);
  await createChangeFromTask({
    projectRoot: project,
    goalId: 'G1',
    taskId: 'T1',
    changeName: 'auth-email-login',
  });
  const state = await readChangeState(project, 'auth-email-login');
  await writeChangeState(project, applyChangeTransition(state, 'confirm-acceptance'));
  return project;
}

/** 记录 Builder 实际拿到的 model；id 用 opencode，好让 `agents.opencode.model` 生效。 */
function recordingRunner(seen: Array<string | undefined>): AgentRunner {
  return {
    id: 'opencode',
    name: 'recording',
    buildCommand(input) {
      return { command: 'noop', args: [], cwd: input.cwd };
    },
    async run(input) {
      seen.push(input.model);
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    },
    async check() {
      return true;
    },
    subagentTool() {
      return 'task';
    },
    configTemplate() {
      return 'none';
    },
  };
}

describe('change run 的 Builder 模型解析', () => {
  it('把 .cometflow/config.yaml 的 model 传给 Builder，并写进 journal', async () => {
    const project = await makeChangeInBuild({ model: 'deepseek/deepseek-flash' });
    const seen: Array<string | undefined> = [];
    await runChange(project, 'auth-email-login', recordingRunner(seen));

    expect(seen).toEqual(['deepseek/deepseek-flash']);
    const events = await readChangeJournal(project, 'auth-email-login');
    const started = events.find((event) => event.event === 'run-started');
    expect(started?.data?.model).toBe('deepseek/deepseek-flash');
  });

  it('agents.<id>.model 优先于全局 model', async () => {
    const project = await makeChangeInBuild({
      model: 'global-model',
      agents: { opencode: { model: 'opencode-model' } },
    });
    const seen: Array<string | undefined> = [];
    await runChange(project, 'auth-email-login', recordingRunner(seen));
    expect(seen).toEqual(['opencode-model']);
  });

  it('显式 options.model 覆盖项目配置', async () => {
    const project = await makeChangeInBuild({ model: 'deepseek/deepseek-flash' });
    const seen: Array<string | undefined> = [];
    await runChange(project, 'auth-email-login', recordingRunner(seen), { model: 'explicit-model' });
    expect(seen).toEqual(['explicit-model']);
  });

  it('没配模型时不传 model，交给 Agent 自己的默认值', async () => {
    const project = await makeChangeInBuild();
    const seen: Array<string | undefined> = [];
    await runChange(project, 'auth-email-login', recordingRunner(seen));
    expect(seen).toEqual([undefined]);
  });
});
