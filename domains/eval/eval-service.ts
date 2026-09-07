import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { runCommand } from '../../platform/process/spawn-command.js';
import type { EvalAssertion, EvalManifest, EvalReport, EvalRubricSummary, EvalTaskResult, EvalTaskSummary } from './types.js';
import { runLlmJudge } from './llm-judge.js';

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

function assertionsPassed(assertions: EvalAssertion[] | undefined, result: { stdout: string; stderr: string }): boolean {
  if (!assertions || assertions.length === 0) return true;
  for (const assertion of assertions) {
    const actual = assertion.target === "stdout" ? result.stdout : result.stderr;
    if (assertion.operator === 'contains' && !actual.includes(assertion.value)) return false;
    if (assertion.operator === 'not_contains' && actual.includes(assertion.value)) return false;
  }
  return true;
}

function summarizeTask(
  name: string,
  runs: number,
  passedRuns: number,
  runResults: EvalTaskResult[],
  passAtKValue: number,
  passAllKValue: number,
): EvalTaskSummary {
  const passAtKResult = runResults.slice(0, passAtKValue).some((result) => result.passed);
  const passAllKResult = runResults.slice(0, passAllKValue).every((result) => result.passed);
  return {
    name,
    passed: passAllKResult,
    runs,
    passedRuns,
    passAtK: passAtKResult,
    passAllK: passAllKResult,
    runResults,
  };
}

export async function runLocalEval(projectRoot: string): Promise<EvalReport> {
  const manifest = await readEvalManifest(projectRoot);
  if (!manifest) {
    throw new Error("Eval manifest not found: " + evalManifestPath(projectRoot));
  }

  const sampling = Math.max(1, manifest.sampling ?? 1);
  const passAtKValue = Math.min(sampling, Math.max(1, manifest.pass_at_k ?? sampling));
  const passAllKValue = Math.min(sampling, Math.max(1, manifest.pass_all_k ?? sampling));
  const summaries: EvalTaskSummary[] = [];

  for (const task of manifest.tasks) {
    const runResults: EvalTaskResult[] = [];
    let passedRuns = 0;
    for (let run = 0; run < sampling; run += 1) {
      const result = await runCommand(task.command, task.args, { cwd: projectRoot, timeoutMs: 120_000 });
      const taskResult: EvalTaskResult = {
        name: task.name,
        passed: result.exitCode === 0 && assertionsPassed(task.assertions, result),
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
      };
      if (taskResult.passed) passedRuns += 1;
      runResults.push(taskResult);
    }
    summaries.push(summarizeTask(task.name, sampling, passedRuns, runResults, passAtKValue, passAllKValue));
  }

  const passAtKRate = summaries.length === 0 ? 0 : summaries.filter((summary) => summary.passAtK).length / summaries.length;
  const passAllKRate = summaries.length === 0 ? 0 : summaries.filter((summary) => summary.passAllK).length / summaries.length;

  const rubric: EvalRubricSummary[] = (manifest.rubric ?? []).map((item) => {
    const summary = summaries.find((entry) => entry.name === item.task);
    const passRate = summary ? summary.passedRuns / Math.max(1, summary.runs) : 0;
    return {
      id: item.id,
      description: item.description,
      task: item.task,
      passRate,
      passed: summary ? summary.passAllK : false,
    };
  });

  const report: EvalReport = {
    schema: 'cometflow.eval-report.v1',
    passed: summaries.every((summary) => summary.passAllK),
    sampling,
    passAtK: passAtKValue,
    passAllK: passAllKValue,
    passAtKRate,
    passAllKRate,
    results: summaries,
    rubric,
  };

  if (manifest.judge) {
    report.judge = await runLlmJudge(report, manifest.judge);
  }

  await fs.mkdir(path.join(projectRoot, ".cometflow"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".cometflow", "eval-report.json"), JSON.stringify(report, null, 2));
  return report;
}
