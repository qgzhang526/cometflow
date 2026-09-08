import path from 'node:path';
import { runFlowRun, resolveAgentId } from '../../domains/scheduler/flow-run.js';
import { resolveModel } from '../../domains/project/config.js';
import { getBuiltInAgentRunner } from '../../platform/agents/registry.js';

export async function runCommand(targetPath: string, options: { agent?: string; model?: string; timeout?: number }): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const agentId = options.agent ?? (await resolveAgentId(projectRoot));
  const runner = getBuiltInAgentRunner(agentId);
  const outcome = await runFlowRun(runner, {
    projectRoot,
    agentId,
    model: options.model ?? (await resolveModel(projectRoot, agentId)),
    timeoutMs: options.timeout,
  });
  process.stdout.write(outcome.result.stdout);
  if (outcome.result.stderr) process.stderr.write(outcome.result.stderr);
  if (outcome.result.timedOut) {
    console.error("cometflow run: agent timed out");
    process.exitCode = 124;
    return;
  }
  if (outcome.result.exitCode !== 0) {
    process.exitCode = outcome.result.exitCode;
  }
  console.error(
    'cometflow run: agent=' + outcome.agentId +
    ' exit=' + outcome.result.exitCode +
    (outcome.result.timedOut ? ' (timed out)' : ''),
  );
}
