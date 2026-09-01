import path from 'node:path';
import { runLocalEval } from '../../domains/eval/eval-service.js';

export async function evalCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const report = await runLocalEval(projectRoot);
  for (const result of report.results) {
    console.log(result.name + ': ' + (result.passed ? 'PASS' : 'FAIL'));
  }
  console.log(report.passed ? 'eval: PASS' : 'eval: FAIL');
  if (!report.passed) process.exitCode = 1;
}
