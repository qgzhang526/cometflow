import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listSpecFiles } from '../spec/spec-index.js';
import { validateSpecs } from '../spec/spec-validate.js';
import { listChangeStates } from '../workflow/change-list.js';
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

  const specFiles = await listSpecFiles(projectRoot);
  if (specFiles.length === 0) {
    findings.push({ severity: 'warning', code: 'no-specs', message: 'specs/ directory is empty or missing' });
  } else {
    const validation = await validateSpecs(projectRoot);
    if (!validation.valid) {
      findings.push({ severity: 'error', code: 'invalid-specs', message: 'spec validate failed with ' + validation.findings.length + ' finding(s)' });
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

  return { healthy: findings.every((finding) => finding.severity !== "error"), findings };
}
