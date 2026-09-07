import path from 'node:path';
import { evaluateHook, type HookEvent } from '../../domains/guard/hook-guard.js';

export async function hookCheckCommand(targetPath: string, options: { event: string; target: string }): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const decision = await evaluateHook(projectRoot, options.event as HookEvent, path.resolve(options.target));
  console.log(decision.allowed ? "allowed" : "denied" + ": " + decision.reason);
  if (!decision.allowed) process.exitCode = 1;
}
