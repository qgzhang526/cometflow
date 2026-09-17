import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preflightTask } from '../../domains/scheduler/daemon-preflight.js';
import { runTaskThroughChange } from '../../domains/scheduler/daemon-run-change.js';
import { DEFAULT_CONFIG } from '../../domains/project/config.js';
import type { AgentRunner } from '../../platform/agents/types.js';

/**
 * 无人值守前置检查：**验收判不出来的任务不执行**。
 *
 * 之前的行为是「先跑 builder、验收阶段才发现所有项 blocked」，白烧预算并且把
 * 「spec 不可判定」这个项目级问题伪装成一次任务失败。现在它在执行前就判掉。
 */

let root: string;

function runner(): AgentRunner {
  return {
    id: 'mock',
    name: 'mock',
    buildCommand: (input) => ({ command: 'mock', args: [input.prompt], cwd: input.cwd }),
    run: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    check: async () => true,
    subagentTool: () => 'task',
    configTemplate: () => 'none',
  };
}

async function writeSpec(withCheck: boolean): Promise<void> {
  await fs.mkdir(path.join(root, 'specs', 'core'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'specs', 'core', 'spec.md'),
    [
      '---',
      'capability: core',
      'module: src/core',
      '---',
      '',
      '# core',
      '',
      '## CORE-001 add',
      '',
      '需求。',
      '',
      '## Acceptance',
      '',
      '- A1：可用',
      ...(withCheck ? ['  - check: node -e "process.exit(0)"'] : []),
      '',
    ].join('\n'),
  );
}

async function writeConfig(extra: string): Promise<void> {
  await fs.writeFile(
    path.join(root, '.cometflow', 'config.yaml'),
    'schema: cometflow.project.v1\nplan_review: auto\nagent: mock\n' + extra,
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-preflight-'));
  await fs.mkdir(path.join(root, '.cometflow'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('无人值守前置检查', () => {
  it('每条验收都有 check：放行', async () => {
    await writeSpec(true);
    const result = await preflightTask({
      projectRoot: root,
      task: { kind: 'implementation', spec_ref: 'specs/core/spec.md', spec_anchor: 'CORE-001 add', spec_hash: null },
      config: DEFAULT_CONFIG,
    });
    expect(result.verdict).toBe('ok');
    expect(result.uncovered).toEqual([]);
  });

  it('只有文字验收、又没有 eval / verifier：判为不可判定', async () => {
    await writeSpec(false);
    const result = await preflightTask({
      projectRoot: root,
      task: { kind: 'implementation', spec_ref: 'specs/core/spec.md', spec_anchor: 'CORE-001 add', spec_hash: null },
      config: DEFAULT_CONFIG,
    });
    expect(result.verdict).toBe('unverifiable');
    expect(result.uncovered).toEqual(['A1']);
    expect(result.policy).toBe('fail');
    expect(result.reason).toContain('无法自动判定');
  });

  it('有 eval 兜底 或 配了可用的独立 Verifier：放行', async () => {
    await writeSpec(false);
    await fs.writeFile(path.join(root, '.cometflow', 'eval.yaml'), 'tasks: []\n');
    const withEval = await preflightTask({
      projectRoot: root,
      task: { kind: 'implementation', spec_ref: 'specs/core/spec.md', spec_anchor: 'CORE-001 add', spec_hash: null },
      config: DEFAULT_CONFIG,
    });
    expect(withEval.verdict).toBe('ok');
    expect(withEval.fallbacks).toContain('eval');

    await fs.rm(path.join(root, '.cometflow', 'eval.yaml'));
    const withVerifier = await preflightTask({
      projectRoot: root,
      task: { kind: 'implementation', spec_ref: 'specs/core/spec.md', spec_anchor: 'CORE-001 add', spec_hash: null },
      // mode 要求独立 Verifier，且 mock agent 可用 → 算兜底。
      config: { ...DEFAULT_CONFIG, verification: { mode: 'checks+agent', agent: 'mock' } },
    });
    expect(withVerifier.verdict).toBe('ok');
    expect(withVerifier.fallbacks.some((entry) => entry.startsWith('verifier:'))).toBe(true);
  });

  it('开关：off 直接跳过；warn 时照常执行', async () => {
    await writeSpec(false);
    await writeConfig('verification:\n  mode: checks\n  unattended_preflight: off\n');
    const off = await preflightTask({
      projectRoot: root,
      task: { kind: 'implementation', spec_ref: 'specs/core/spec.md', spec_anchor: 'CORE-001 add', spec_hash: null },
      config: { ...DEFAULT_CONFIG, verification: { unattended_preflight: 'off' } },
    });
    expect(off.verdict).toBe('skipped');

    const warn = await preflightTask({
      projectRoot: root,
      task: { kind: 'implementation', spec_ref: 'specs/core/spec.md', spec_anchor: 'CORE-001 add', spec_hash: null },
      config: { ...DEFAULT_CONFIG, verification: { unattended_preflight: 'warn' } },
    });
    expect(warn.verdict).toBe('unverifiable');
    expect(warn.policy).toBe('warn');
  });

  it('daemon 侧：不可判定 → 不执行、任务失败、停机（不建 change）', async () => {
    await writeSpec(false);
    await writeConfig('verification:\n  mode: checks\n');

    const outcome = await runTaskThroughChange({
      projectRoot: root,
      goal: 'G1',
      task: 'T1',
      runner: runner(),
      taskKind: 'implementation',
      specRef: 'specs/core/spec.md',
      specAnchor: 'CORE-001 add',
    });

    expect(outcome.verdict).toBe('unverifiable');
    expect(outcome.needsHuman).toBe(true);
    expect(outcome.detail).toContain('unattended_preflight');
    // 关键：连 change 都没建——预算一点没烧。
    expect(await fs.access(path.join(root, 'changes', 'G1-T1')).then(() => true, () => false)).toBe(false);
  });
});
