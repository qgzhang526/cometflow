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
import { applyJobGc, collectJobUsage, planJobGc } from '../server/job-store.js';
import { readCasConflicts, resolveConcurrencyPolicy } from '../project/concurrency.js';
import { forceUnlock, inspectLock } from '../../platform/fs/file-lock.js';
import { hookGuardPath, hookStatus } from '../guard/hook-install.js';

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
  /** 回收超出保留窗口的任务证据（默认只报告）。 */
  cleanJobs?: boolean;
  /** 清理滞留的事务锁（默认只报告）。 */
  forceUnlock?: boolean;
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

  // 写保护（ADR 0023）：只在**装过**的项目里产生需要处理的 findings。
  // 没装只给 info —— 写保护是显式安装的增强，不是项目健康的前提，
  // 否则每个没装 hook 的项目都会「需要关注」，doctor 会被人直接无视。
  const guard = await hookStatus(projectRoot, 'claude-code');
  const installHint = '运行 cometflow hook install . --platform claude-code 重新安装';
  if (guard.entries > 0 && !guard.guardExists) {
    findings.push({
      severity: 'error',
      code: 'hook-guard-missing',
      message:
        'claude-code 的 hook 条目还在，但守卫脚本 ' +
        hookGuardPath(projectRoot) +
        ' 缺失：平台的每次写入都会因为 hook 命令失败而报错；' +
        installHint,
    });
  } else if (guard.entries === 0 && guard.guardExists) {
    findings.push({
      severity: 'warning',
      code: 'hook-entry-missing',
      message: '守卫脚本存在但 settings.json 里没有对应条目：写保护不会生效；' + installHint,
    });
  }
  if (guard.installed && guard.guardOutdated) {
    findings.push({
      severity: 'warning',
      code: 'hook-guard-outdated',
      message:
        '守卫脚本与当前版本的生成器不一致（升级 cometflow 不会自动更新它，旧版可能放过越界写入）：' +
        installHint,
    });
  }
  if (guard.installed && !guard.cli.resolved) {
    findings.push({
      severity: 'error',
      code: 'hook-cli-missing',
      message:
        '守卫要调用的 CLI 解析不到（' +
        guard.cli.command +
        '：' +
        (guard.cli.detail ?? '未知原因') +
        '）：按 ADR 0023 决策 5，守卫在 CLI 不可用时**放行**，写保护等于没有生效；' +
        '把 cometflow 放进 PATH，或用 COMETFLOW_CLI 指定可用的命令',
    });
  }
  if (guard.installed && !guard.guardOutdated && guard.cli.resolved) {
    findings.push({
      severity: 'info',
      code: 'hook-installed',
      message: 'claude-code 写保护已安装且可用（守卫调用 ' + guard.cli.path + '）',
    });
  }
  if (!guard.installed && !guard.guardExists && guard.entries === 0) {
    findings.push({
      severity: 'info',
      code: 'hook-not-installed',
      message: '未安装平台写保护（可选）：装它之后 agent 越界写入会在工具层被拦下',
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

  // 任务证据：默认只报告占用与可回收量，`--clean-jobs` 才真正回收（双阈值：最近 200 条 + 30 天）。
  const jobUsage = await collectJobUsage(projectRoot);
  const jobPlan = await planJobGc(projectRoot);
  if (options.cleanJobs) {
    const cleaned = await applyJobGc(projectRoot, jobPlan);
    findings.push({
      severity: 'info',
      code: 'cleaned-job-evidence',
      message: '已回收 ' + cleaned.removed + ' 个过期任务（' + formatBytes(cleaned.bytes) + '）',
    });
  } else if (jobPlan.candidates.length > 0) {
    findings.push({
      severity: 'warning',
      code: 'job-evidence-reclaimable',
      message:
        '任务证据占用 ' +
        formatBytes(jobUsage.bytes) +
        '（' +
        jobUsage.files +
        ' 个文件），其中 ' +
        jobPlan.candidates.length +
        ' 个已结束任务超出保留窗口，可回收 ' +
        formatBytes(jobPlan.reclaimableBytes) +
        '；确认后运行 cometflow doctor . --clean-jobs',
    });
  }

  // 并发写策略：warn 到期是 error（必须显式决策）；warn 期间的冲突要看得见；完全没配置也要提醒。
  const policy = await resolveConcurrencyPolicy(projectRoot);
  const conflicts = await readCasConflicts(projectRoot);
  if (policy.expired) {
    findings.push({
      severity: 'error',
      code: 'concurrency-warn-expired',
      message:
        '并发写策略的 warn 期已到期（' +
        (policy.warnUntil ?? '?') +
        '）：请切换 concurrency.specWrites: fail，或延长 warnUntil 并写 warnReason（ADR 0021）',
    });
  }
  if (policy.mode === 'warn' && conflicts.length > 0) {
    findings.push({
      severity: 'warning',
      code: 'concurrent-modification-warned',
      message:
        '并发写当前处于 warn 模式，已记录 ' +
        conflicts.length +
        ' 次冲突（最近 ' +
        (conflicts[conflicts.length - 1]?.path ?? '?') +
        '）：确认误报可接受后切换 concurrency.specWrites: fail',
    });
  }
  if (policy.mode === 'warn' && policy.warnUntil === null) {
    findings.push({
      severity: 'info',
      code: 'concurrency-policy-unset',
      message: '并发写策略未显式设置（当前按 warn 处理，且没有到期提醒）：建议选择 fail，或 warn + 到期日',
    });
  }

  // 滞留的事务锁：持有者在 TTL 内或进程还在 → 只提示；确认已死才由 --force-unlock 清理。
  const lock = await inspectLock(projectRoot);
  if (lock.record !== null) {
    if (options.forceUnlock) {
      await forceUnlock(projectRoot);
      findings.push({
        severity: 'info',
        code: 'lock-cleared',
        message: '已清理滞留锁（原持有者 ' + lock.record.pid + '@' + lock.record.host + '，action ' + lock.record.action + '）',
      });
    } else {
      findings.push({
        severity: lock.stale ? 'error' : 'warning',
        code: lock.stale ? 'stale-transaction-lock' : 'transaction-lock-held',
        message:
          '事务锁被 ' +
          lock.record.action +
          ' 持有（pid ' +
          lock.record.pid +
          '@' +
          lock.record.host +
          '，started ' +
          lock.record.startedAt +
          (lock.stale ? '，已判定为陈旧（' + (lock.reason ?? '?') + '）' : '') +
          '）：确认持有进程已退出后运行 cometflow doctor . --force-unlock',
      });
    }
  }

  return { healthy: findings.every((finding) => finding.severity !== "error"), findings };
}
