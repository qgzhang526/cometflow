import { describe, expect, it } from 'vitest';
import { createClaudeCodeRunner } from '../../platform/agents/claude-code.js';
import { createOpenCodeRunner } from '../../platform/agents/opencode.js';
import { resolveAgentId, buildFlowPrompt } from '../../domains/scheduler/flow-run.js';

describe('agent adapters', () => {
  it('builds opencode run command', () => {
    const command = createOpenCodeRunner().buildCommand({
      prompt: 'hello',
      cwd: '/repo',
      model: 'gpt-5',
    });
    expect(command.command).toBe('opencode');
    expect(command.args).toEqual(['run', 'hello', '--model', 'gpt-5']);
    expect(command.cwd).toBe('/repo');
  });

  it('builds claude code non-interactive command', () => {
    const command = createClaudeCodeRunner().buildCommand({
      prompt: 'hello',
      cwd: '/repo',
    });
    expect(command.command).toBe('claude');
    expect(command.args).toContain('--dangerously-skip-permissions');
    expect(command.args).toContain('-p');
  });
});

describe('flow run scheduler', () => {
  it('prefers COMETFLOW_AGENT from env', async () => {
    expect(await resolveAgentId('/tmp/nope', { COMETFLOW_AGENT: 'claude-code' })).toBe('claude-code');
  });

  it('builds a prompt containing the project mission', async () => {
    const prompt = await buildFlowPrompt('D:/zqg/github/cometflow/test/fixtures/spec-kernel-project');
    expect(prompt).toContain('构建一个内部数据查询平台');
  });
});
