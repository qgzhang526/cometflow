import { runDoctor } from '../dashboard/doctor.js';
import { verifySpecIntegrity } from '../spec/spec-verify.js';

/**
 * 统一的 finding 模型：**一次运行看全**，但**不合并 scope**。
 *
 * `spec verify` 的 scope 是「spec 还是不是唯一根源」，`doctor` 的 scope 是「这个项目还健康吗」
 * （临时文件、滞留锁、证据占用……）。把后者塞进前者的默认输出，会让 CI 里的红灯失去信号价值；
 * 但让用户跑两个命令、再自己对照，也不合理。折中是：**各自保持 scope，合并只发生在呈现层**。
 */
export type FindingSource = 'spec-verify' | 'doctor';
export type FindingSeverity = 'error' | 'warning' | 'info';

export interface Finding {
  source: FindingSource;
  code: string;
  severity: FindingSeverity;
  /** 出问题的对象（spec 路径 / change 名等）；doctor 来源的没有 subject，用空串。 */
  subject: string;
  message: string;
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };

/**
 * 去重键取 `(code, subject)`：同一个 code 但不同 subject（例如两个 change 各自漂移）必须分别列出，
 * 粗暴按 code 去重会把问题吃掉。
 */
export function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const unique: Finding[] = [];
  for (const finding of findings) {
    const key = finding.code + '\u0000' + finding.subject;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }
  return unique.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      left.source.localeCompare(right.source) ||
      left.code.localeCompare(right.code) ||
      left.subject.localeCompare(right.subject),
  );
}

export async function collectFindings(projectRoot: string): Promise<Finding[]> {
  const [integrity, doctor] = await Promise.all([
    verifySpecIntegrity(projectRoot),
    runDoctor(projectRoot),
  ]);

  const findings: Finding[] = integrity.findings.map((finding) => ({
    source: 'spec-verify',
    code: finding.code,
    severity: finding.severity,
    subject: finding.subject,
    message: finding.message,
  }));

  for (const finding of doctor.findings) {
    // doctor 会把 spec verify 的结论**镜像**成 `spec-verify:<code>`（同一个判定，隔着一次转发）。
    // 保留两份只会让人以为是两个问题，所以这一层镜像直接丢弃，以 spec verify 那份为准。
    if (finding.code.startsWith('spec-verify:')) continue;
    findings.push({
      source: 'doctor',
      code: finding.code,
      severity: finding.severity,
      subject: '',
      message: finding.message,
    });
  }
  return dedupeFindings(findings);
}

/** 人类可读：`ERROR spec-verify stale-spec-lock specs/auth/spec.md — ...` */
export function formatFinding(finding: Finding): string {
  return [
    finding.severity.toUpperCase(),
    finding.source,
    finding.code,
    finding.subject,
    finding.subject === '' ? finding.message : '— ' + finding.message,
  ]
    .filter((part) => part !== '')
    .join(' ');
}
