import { createClaudeCodeRunner } from './claude-code.js';
import { createOpenCodeRunner } from './opencode.js';
import type { AgentRunner } from './types.js';

export function builtInAgentRunners(): AgentRunner[] {
  return [createOpenCodeRunner(), createClaudeCodeRunner()];
}

export function getBuiltInAgentRunner(id: string): AgentRunner {
  const runner = builtInAgentRunners().find((entry) => entry.id === id);
  if (!runner) throw new Error('Unknown built-in agent: ' + id);
  return runner;
}
