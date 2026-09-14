import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listSpecFiles } from '../spec/spec-index.js';
import { validateSpecs } from '../spec/spec-validate.js';
import { verifySpecIntegrity } from '../spec/spec-verify.js';
import { listIncompleteSpecTransactions } from '../workflow/change-execution.js';
import { listPendingTransitions } from '../workflow/change-transition-journal.js';
import { checkGitDrift } from '../workflow/git-provenance.js';
import { readCurrentChange } from '../workflow/current-change.js';
import { listChangeStates } from '../workflow/change-list.js';
import { loadProjectContext, validateProjectContext } from '../project/context.js';
import { findOrphanTempFiles, removeOrphanTempFiles } from '../../platform/fs/atomic-write.js';
import { collectEvidenceUsage, formatBytes, planEvidenceGc } from '../workflow/evidence-retention.js';
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

export interface DoctorOptions {
  /** 清理残留的原子写入临时文件（默认只报告不删除）。 */
  cleanTemp?: boolean;
}

export async function runDoctor(projectRoot: string, options: DoctorOptions = {}): Promise<DoctorReport> {
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
    const pointer = await readCurrentChange(projectRoot);
    const pointsAtActive = pointer
      ? activeChanges.some((change) => change.name === pointer.change)
      : false;
    findings.push({
      severity: pointsAtActive ? 'info' : 'warning',
      code: 'multiple-active-changes',
      message:
        activeChanges.length +
        ' active changes' +
        (pointsAtActive
          ? '；current-change = ' + pointer!.change + '，hook 按该指针路由写入'
          : '；未指定 current-change，hook 会拒绝归属不明的写入，运行 cometflow change select <name>'),
    });
  }

  // git 来源漂移：历史回退/分叉会让 change 在错误的基础上继续推进。
  for (const change of activeChanges) {
    const drift = await checkGitDrift(projectRoot, change);
    if (drift.blocking) {
      findings.push({
        severity: 'error',
        code: 'git-provenance-drift',
        message: 'change ' + change.name + ': ' + drift.detail + '；run/verify/archive 会被阻断',
      });
    }
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

  // 残留临时文件 = 上次写到一半被打断。默认只报告，`--clean-temp` 才删除。
  // 滞留的两阶段迁移 = 崩溃在「已 prepare、未完成」之间，需要人工确认状态归属。
  for (const pending of await listPendingTransitions(projectRoot)) {
    findings.push({
      severity: 'error',
      code: 'pending-change-transition',
      message:
        'change ' +
        pending.change +
        ' 有未完成的迁移 ' +
        pending.from +
        ' → ' +
        pending.to +
        '（event=' +
        pending.event +
        '，prepared ' +
        pending.preparedAt +
        '）；当前状态与该迁移不匹配，请人工确认后删除 ' +
        pending.path,
    });
  }

  const orphans = await findOrphanTempFiles(path.join(projectRoot, '.cometflow'));
  if (orphans.length > 0) {
    if (options.cleanTemp) {
      const removed = await removeOrphanTempFiles(orphans);
      findings.push({
        severity: 'info',
        code: 'cleaned-atomic-temp',
        message: '已清理 ' + removed.length + ' 个残留临时文件',
      });
    } else {
      findings.push({
        severity: 'warning',
        code: 'orphan-atomic-temp',
        message:
          '发现 ' +
          orphans.length +
          ' 个残留的写入临时文件（上次写入被中断）：' +
          orphans.slice(0, 3).map((entry) => entry.path).join(', ') +
          (orphans.length > 3 ? ' 等' : '') +
          '；确认无需保留后运行 cometflow doctor . --clean-temp',
      });
    }
  }

  // 证据保留：报告占用与可回收量，具体清理交给 `change gc --apply`。
  const plan = await planEvidenceGc(projectRoot);
  const usage = await collectEvidenceUsage(projectRoot);
  if (plan.totalBytes > 0) {
    const top = usage
      .slice(0, 3)
      .map((entry) => entry.change + '=' + formatBytes(entry.bytes))
      .join(', ');
    findings.push({
      severity: 'info',
      code: 'evidence-usage',
      message:
        'change 运行证据 ' +
        formatBytes(plan.totalBytes) +
        '（' +
        usage.length +
        ' 个 change；' +
        top +
        '）；可回收 ' +
        formatBytes(plan.reclaimableBytes) +
        '，运行 cometflow change gc . --apply 清理',
    });
  }

  return { healthy: findings.every((finding) => finding.severity !== "error"), findings };
}
