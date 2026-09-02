import path from 'node:path';
import { runLocalEval } from '../../domains/eval/eval-service.js';

export async function evalCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const report = await runLocalEval(projectRoot);
  for (const result of report.results) {
    console.log(result.name + ': ' + (result.passed ? 'PASS' : 'FAIL') + ' (' + result.passedRuns + '/' + result.runs + ')');
  }
  for (const item of report.rubric) {
    console.log('rubric ' + item.id + ' [' + item.task + ']: ' + (item.passed ? 'PASS' : 'FAIL') + ' passRate=' + item.passRate.toFixed(2));
  }
  console.log('pass@k rate: ' + report.passAtKRate.toFixed(2) + ' (k=' + report.passAtK + ')');
  console.log('pass^k rate: ' + report.passAllKRate.toFixed(2) + ' (k=' + report.passAllK + ')');
  console.log(report.passed ? 'eval: PASS' : 'eval: FAIL');
  if (!report.passed) process.exitCode = 1;
}
