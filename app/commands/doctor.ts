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
    // `--json` 只改变**输出格式**，不改变结论：机器可读模式同样要能用退出码判断健康，
    // 否则调用方（脚本、门禁）拿到一份 healthy:false 的报告却看到退出码 0。
    if (!report.healthy) process.exitCode = 1;
    return;
  }
  for (const finding of report.findings) {
    console.log([finding.severity.toUpperCase(), finding.code, finding.message].join(' '));
  }
  console.log(report.healthy ? 'doctor: OK' : 'doctor: NEEDS ATTENTION');
  if (!report.healthy) process.exitCode = 1;
}
