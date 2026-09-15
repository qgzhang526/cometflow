import path from 'node:path';
import { runDoctor } from '../../domains/dashboard/doctor.js';

export async function doctorCommand(
  targetPath: string,
  options: { json?: boolean; cleanTemp?: boolean; cleanJobs?: boolean; forceUnlock?: boolean } = {},
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const report = await runDoctor(projectRoot, {
    cleanTemp: options.cleanTemp === true,
    cleanJobs: options.cleanJobs === true,
    forceUnlock: options.forceUnlock === true,
  });
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  for (const finding of report.findings) {
    console.log([finding.severity.toUpperCase(), finding.code, finding.message].join(' '));
  }
  console.log(report.healthy ? 'doctor: OK' : 'doctor: NEEDS ATTENTION');
  if (!report.healthy) process.exitCode = 1;
}
