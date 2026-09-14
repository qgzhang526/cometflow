import {
  captureGitProvenance,
  gitCommitExists,
  gitIsAncestor,
} from '../../platform/process/git.js';
import type { ChangeState } from './change-types.js';

export type GitDriftStatus =
  /** 不是 git 仓库：无法判定，降级为提示 */
  | 'not-a-repo'
  /** 老 change 没记录基准提交（来源绑定机制之前创建的） */
  | 'unbound'
  /** 基准提交在当前仓库里不存在（浅克隆、换机器） */
  | 'unknown-base'
  /** 当前 HEAD 就是基准，或基准仍是当前 HEAD 的祖先 */
  | 'ok'
  /** 历史被回退：当前 HEAD 是基准的祖先 */
  | 'head-rewound'
  /** 分叉到与基准无共同演进关系的历史 */
  | 'diverged';

export interface GitDriftReport {
  status: GitDriftStatus;
  base_commit: string | null;
  base_branch: string | null;
  current_head: string | null;
  current_branch: string | null;
  /** 是否阻断推进。not-a-repo / unbound / unknown-base 只提示不阻断。 */
  blocking: boolean;
  detail: string;
}

/**
 * 判断 change 的 git 来源是否还成立。
 *
 * 关键取舍：**只按祖先关系判定，不按分支名判定**。
 * 基于 main 开一个特性分支、在 change 里正常提交，都是合法推进；
 * 真正危险的是「历史被回退」和「漂到不认识的历史上」，那时 ancestry 会失败。
 */
export async function checkGitDrift(
  projectRoot: string,
  state: ChangeState,
): Promise<GitDriftReport> {
  const base = state.base_commit ?? null;
  const baseBranch = state.base_branch ?? null;
  const current = await captureGitProvenance(projectRoot);

  if (!current.isRepository) {
    return {
      status: 'not-a-repo',
      base_commit: base,
      base_branch: baseBranch,
      current_head: null,
      current_branch: null,
      blocking: false,
      detail: '项目不是 git 仓库，跳过来源校验',
    };
  }
  if (!base) {
    return {
      status: 'unbound',
      base_commit: null,
      base_branch: baseBranch,
      current_head: current.head,
      current_branch: current.branch,
      blocking: false,
      detail: '该 change 未记录基准提交（在来源绑定机制之前创建），跳过校验',
    };
  }
  if (!(await gitCommitExists(projectRoot, base))) {
    return {
      status: 'unknown-base',
      base_commit: base,
      base_branch: baseBranch,
      current_head: current.head,
      current_branch: current.branch,
      blocking: false,
      detail: '基准提交 ' + base.slice(0, 12) + ' 在当前仓库中不存在（浅克隆或换机器），无法判定',
    };
  }
  if (current.head === base) {
    return {
      status: 'ok',
      base_commit: base,
      base_branch: baseBranch,
      current_head: current.head,
      current_branch: current.branch,
      blocking: false,
      detail: 'HEAD 仍停在基准提交',
    };
  }

  const baseIsAncestor = await gitIsAncestor(projectRoot, base, current.head);
  if (baseIsAncestor === true) {
    const branchNote =
      baseBranch && current.branch && baseBranch !== current.branch
        ? '（分支已从 ' + baseBranch + ' 切到 ' + current.branch + '，但历史连续）'
        : '';
    return {
      status: 'ok',
      base_commit: base,
      base_branch: baseBranch,
      current_head: current.head,
      current_branch: current.branch,
      blocking: false,
      detail: 'HEAD 在基准提交之后推进' + branchNote,
    };
  }

  const headIsAncestor = await gitIsAncestor(projectRoot, current.head, base);
  const status: GitDriftStatus = headIsAncestor === true ? 'head-rewound' : 'diverged';
  return {
    status,
    base_commit: base,
    base_branch: baseBranch,
    current_head: current.head,
    current_branch: current.branch,
    blocking: true,
    detail:
      status === 'head-rewound'
        ? '当前 HEAD ' +
          current.head.slice(0, 12) +
          ' 早于 change 的基准提交 ' +
          base.slice(0, 12) +
          '（历史被回退）'
        : '当前 HEAD ' +
          current.head.slice(0, 12) +
          ' 与基准提交 ' +
          base.slice(0, 12) +
          ' 没有演进关系（分叉或切换到了不相关分支）',
  };
}

export interface DriftEnforcement {
  report: GitDriftReport;
  /** 是否放行（配置或 --allow-drift 显式允许时不阻断）。 */
  allowed: boolean;
  /** 放行时的说明，用于写入审核流水。 */
  override: 'config' | 'flag' | null;
}

export async function enforceGitProvenance(
  projectRoot: string,
  state: ChangeState,
  options: { allowDrift?: boolean; configAllowsDrift?: boolean } = {},
): Promise<DriftEnforcement> {
  const report = await checkGitDrift(projectRoot, state);
  if (!report.blocking) return { report, allowed: true, override: null };
  if (options.allowDrift === true) return { report, allowed: true, override: 'flag' };
  if (options.configAllowsDrift === true) return { report, allowed: true, override: 'config' };
  return { report, allowed: false, override: null };
}

export function describeDriftFailure(
  name: string,
  report: GitDriftReport,
): string {
  return (
    'git provenance drift for ' +
    name +
    ': ' +
    report.detail +
    '。恢复路径：git checkout ' +
    (report.base_commit ?? '<base>').slice(0, 12) +
    ' 回到基准，或从基准拉出分支重做；确实要忽略时加 --allow-drift（或在 .cometflow/config.yaml 设 git.allow_drift: true）'
  );
}
