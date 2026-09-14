import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listSpecFiles } from '../spec/spec-index.js';
import { validateSpecs } from '../spec/spec-validate.js';
import { verifySpecIntegrity } from '../spec/spec-verify.js';
import { listIncompleteSpecTransactions } from '../workflow/change-execution.js';
import { listChangeStates } from '../workflow/change-list.js';
import { loadProjectContext, validateProjectContext } from '../project/context.js';
import { collectProjectStatus } from './collector.js';

export interface DoctorFinding {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface DoctorReport {
  healthy: boolean;
  findings: DoctorFinding[];
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

export async function runDoctor(projectRoot: string): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];

  if (!(await exists(path.join(projectRoot, 'COMETFLOW.md')))) {
    findings.push({ severity: 'error', code: 'missing-mission', message: 'COMETFLOW.md not found' });
  }

  const context = await loadProjectContext(projectRoot);
  if (!context) {
    findings.push({ severity: 'error', code: 'missing-project-context', message: 'project context is missing; run cometflow context sync' });
  } else {
    for (const error of validateProjectContext(context)) {
      findings.push({ severity: 'error', code: 'invalid-project-context', message: error });
    }
  }

  const specFiles = await listSpecFiles(projectRoot);
  if (specFiles.length === 0) {
    findings.push({ severity: 'warning', code: 'no-specs', message: 'specs/ directory is empty or missing' });
  } else {
    const validation = await validateSpecs(projectRoot);
    if (!validation.valid) {
      findings.push({ severity: 'error', code: 'invalid-specs', message: 'spec validate failed with ' + validation.findings.length + ' finding(s)' });
    }
    // spec 版本一致性：缺 lock 只是基线未建立（warning），其余不一致都是 error。
    const integrity = await verifySpecIntegrity(projectRoot);
    for (const finding of integrity.findings) {
      findings.push({
        severity:
          finding.code === 'missing-spec-lock' || finding.severity === 'warning' ? 'warning' : 'error',
        code: 'spec-verify:' + finding.code,
        message: finding.subject + ' — ' + finding.message,
      });
    }
  }

  const status = await collectProjectStatus(projectRoot);
  if (status.plans.length === 0) {
    findings.push({ severity: 'warning', code: 'no-plans', message: 'no task plans found' });
  }
  const activeChanges = (await listChangeStates(projectRoot)).filter((change) => !change.archived);
  if (activeChanges.length > 1) {
    findings.push({ severity: 'warning', code: 'multiple-active-changes', message: activeChanges.length + ' active changes' });
  }

  // 归档事务停在 staged（进程被杀）时 specs/ 可能处于中间态，必须人工确认。
  for (const tx of await listIncompleteSpecTransactions(projectRoot)) {
    findings.push({
      severity: 'error',
      code: 'incomplete-spec-transaction',
      message:
        'change ' +
        tx.change +
        ' 的 spec 归档事务未完成 (' +
        tx.txId +
        ')：检查 specs/ 是否处于中间态，备份位于 ' +
        tx.dir,
    });
  }

  return { healthy: findings.every((finding) => finding.severity !== "error"), findings };
}
