import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentRunner } from '../../platform/agents/types.js';
import { runLocalEval } from '../eval/eval-service.js';
import { readChangeState, writeChangeState } from './change-store.js';
import { applyChangeTransition } from './change-transitions.js';
import type { ChangeState } from './change-types.js';

export interface ChangeRunOutcome {
  state: ChangeState;
  agentExitCode: number;
}

export async function buildChangePrompt(projectRoot: string, name: string): Promise<string> {
  const state = await readChangeState(projectRoot, name);
  const dir = path.join(projectRoot, 'changes', name);
  let brief = '';
  try { brief = await fs.readFile(path.join(dir, 'brief.md'), 'utf8'); } catch { brief = state.name; }
  return [
    'You are the Builder for a CometFlow change.',
    'Implement the change described in brief.md and satisfy every acceptance criterion.',
    'Do not modify comet-state.yaml or verification.md.',
    '',
    '## Change',
    'name: ' + state.name,
    'task: ' + state.task,
    'spec: ' + (state.spec_ref ?? '(none)') + '#' + (state.spec_anchor ?? ''),
    'acceptance: ' + (state.acceptance_ids.join(', ') || '(none)'),
    '',
    '## brief.md',
    brief,
  ].join('\n');
}

export async function runChange(projectRoot: string, name: string, runner: AgentRunner): Promise<ChangeRunOutcome> {
  const state = await readChangeState(projectRoot, name);
  if (state.phase !== 'build') throw new Error('change run requires build phase');
  const prompt = await buildChangePrompt(projectRoot, name);
  const result = await runner.run({ prompt, cwd: projectRoot });
  if (result.exitCode !== 0) {
    return { state, agentExitCode: result.exitCode };
  }
  const next = applyChangeTransition(state, 'submit-candidate');
  await writeChangeState(projectRoot, next);
  return { state: next, agentExitCode: result.exitCode };
}

export interface ChangeVerifyOutcome {
  state: ChangeState;
  reportPassed: boolean;
}

export async function verifyChange(projectRoot: string, name: string): Promise<ChangeVerifyOutcome> {
  const state = await readChangeState(projectRoot, name);
  if (state.phase !== 'verify') throw new Error('change verify requires verify phase');
  let reportPassed = true;
  let report = null;
  try {
    report = await runLocalEval(projectRoot);
    reportPassed = report.passed;
  } catch {
    reportPassed = false;
  }

  const dir = path.join(projectRoot, 'changes', name);
  const verification = [
    '# Verification',
    '',
    'change: ' + state.name,
    'acceptance: ' + (state.acceptance_ids.length > 0 ? state.acceptance_ids.join(', ') : '(none)'),
    'result: ' + (reportPassed ? 'pass' : 'fail'),
  ];
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'verification.md'), verification.join('\n'));

  const next = applyChangeTransition(state, reportPassed ? 'verify-pass' : 'verify-fail');
  await writeChangeState(projectRoot, next);
  return { state: next, reportPassed };
}

export async function archiveChange(projectRoot: string, name: string): Promise<ChangeState> {
  const state = await readChangeState(projectRoot, name);
  if (state.phase !== 'archive') throw new Error('change archive requires archive phase');

  const changeDir = path.join(projectRoot, 'changes', name);
  const proposedSpecsDir = path.join(changeDir, 'specs');
  try {
    const entries = await fs.readdir(proposedSpecsDir);
    for (const capability of entries) {
      const source = path.join(proposedSpecsDir, capability, 'spec.md');
      const destination = path.join(projectRoot, 'specs', capability, 'spec.md');
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
    }
  } catch {
    // no proposed specs to apply
  }

  const next = applyChangeTransition(state, 'archive-complete');
  await writeChangeState(projectRoot, next);
  return next;
}
