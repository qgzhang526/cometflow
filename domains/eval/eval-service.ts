import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { runCommand } from '../../platform/process/spawn-command.js';
import type { EvalManifest, EvalReport, EvalTaskResult } from './types.js';

export function evalManifestPath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'eval.yaml');
}

export async function readEvalManifest(projectRoot: string): Promise<EvalManifest | null> {
  try {
    const source = await fs.readFile(evalManifestPath(projectRoot), "utf8");
    return parse(source) as EvalManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function runLocalEval(projectRoot: string): Promise<EvalReport> {
  const manifest = await readEvalManifest(projectRoot);
  if (!manifest) {
    throw new Error("Eval manifest not found: " + evalManifestPath(projectRoot));
  }

  const results: EvalTaskResult[] = [];
  for (const task of manifest.tasks) {
    const result = await runCommand(task.command, task.args, { cwd: projectRoot, timeoutMs: 120_000 });
    results.push({
      name: task.name,
      passed: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    });
  }

  const report: EvalReport = {
    schema: 'cometflow.eval-report.v1',
    passed: results.every((result) => result.passed),
    results,
  };

  await fs.mkdir(path.join(projectRoot, ".cometflow"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".cometflow", "eval-report.json"), JSON.stringify(report, null, 2));
  return report;
}
