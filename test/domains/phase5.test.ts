import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentRunner } from '../../platform/agents/types.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import { archiveChange, runChange, verifyChange } from '../../domains/workflow/change-execution.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');

async function makeTemp(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-phase5-'));
  await fs.cp(fixture, tmp, { recursive: true });
  const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1'));
  await writeTaskPlan(tmp, plan);
  await createChangeFromTask({ projectRoot: tmp, goalId: 'G1', taskId: 'T1', changeName: 'auth-email-login' });
  return tmp;
}

function fakeRunner(exitCode: number): AgentRunner {
  return {
    id: 'fake',
    name: 'fake',
    buildCommand(input) { return { command: 'fake', args: [input.prompt], cwd: input.cwd }; },
    async run(input) { return { exitCode, stdout: '', stderr: '', timedOut: false }; },
    async check() { return true; },
    subagentTool() { return 'task'; },
    configTemplate() { return 'none'; },
  };
}

async function toBuild(tmp: string): Promise<void> {
  const state = await readChangeState(tmp, 'auth-email-login');
  await writeChangeState(tmp, applyChangeTransition(state, 'confirm-acceptance'));
}

async function writeEval(tmp: string, pass: boolean): Promise<void> {
  await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
  await fs.writeFile(path.join(tmp, '.cometflow', 'eval.yaml'), [
    'schema: cometflow.eval.v1',
    'tasks:',
    '  - name: check',
    '    command: ' + JSON.stringify(process.execPath),
    '    args: ["-e", "process.exit(' + (pass ? '0' : '1') + ')"]',
  ].join('\n'));
}

describe('phase 5 native workflow', () => {
  it('runs builder, verifies pass, and archives with spec apply', async () => {
    const tmp = await makeTemp();
    await toBuild(tmp);

    const runOutcome = await runChange(tmp, 'auth-email-login', fakeRunner(0));
    expect(runOutcome.state.phase).toBe('verify');

    await writeEval(tmp, true);
    const verifyOutcome = await verifyChange(tmp, 'auth-email-login');
    expect(verifyOutcome.state.phase).toBe('archive');
    await fs.access(path.join(tmp, 'changes', 'auth-email-login', 'verification.md'));

    await fs.mkdir(path.join(tmp, 'changes', 'auth-email-login', 'specs', 'auth'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'changes', 'auth-email-login', 'specs', 'auth', 'spec.md'), 'proposed auth spec');
    const archived = await archiveChange(tmp, 'auth-email-login');
    expect(archived.archived).toBe(true);
    expect(await fs.readFile(path.join(tmp, 'specs', 'auth', 'spec.md'), 'utf8')).toContain('proposed auth spec');

    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('returns to build when verification fails', async () => {
    const tmp = await makeTemp();
    await toBuild(tmp);
    await runChange(tmp, 'auth-email-login', fakeRunner(0));
    await writeEval(tmp, false);
    const outcome = await verifyChange(tmp, 'auth-email-login');
    expect(outcome.state.phase).toBe('build');
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
