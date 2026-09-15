import path from 'node:path';
import { runSpecGates } from '../../domains/gates/spec-gates.js';
import {
  gitHookStatus,
  installGitHook,
  uninstallGitHook,
} from '../../domains/gates/git-hook.js';

export interface GateCheckOptions {
  json?: boolean;
  updateBaseline?: boolean;
}

/**
 * `cometflow gate check`：CI 与本地提交门禁共用的入口。
 *
 * 判定逻辑在 `domains/gates/spec-gates.ts`，这里只负责输出与退出码——
 * 退出码即结论（`--json` 也一样，机器可读不等于可以吞掉结论）。
 */
export async function gateCheckCommand(
  targetPath: string,
  options: GateCheckOptions = {},
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const result = await runSpecGates(projectRoot, { updateBaseline: options.updateBaseline === true });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const step of result.steps) {
      console.log((step.ok ? 'PASS ' : 'FAIL ') + step.name + (step.detail ? ' — ' + step.detail : ''));
    }
    console.log(result.ok ? 'gate check: PASS' : 'gate check: FAILED');
  }
  if (!result.ok) process.exitCode = 1;
}

export interface GateInstallOptions {
  gitHooks?: boolean;
}

/**
 * `cometflow gate install --git-hooks`：把门禁装进 `.git/hooks/pre-commit`。
 *
 * 目标必须显式指定：将来还会有别的安装点（CI 配置、husky 目录……），
 * 猜用户想装哪儿是这类工具最容易被讨厌的地方。
 */
export async function gateInstallCommand(
  targetPath: string,
  options: GateInstallOptions = {},
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  if (options.gitHooks !== true) {
    console.error('请指定安装目标：cometflow gate install . --git-hooks');
    process.exitCode = 1;
    return;
  }
  const result = await installGitHook(projectRoot);
  if (result.status === 'skipped') {
    console.error(result.reason);
    process.exitCode = 1;
    return;
  }
  console.log(result.reason);
  console.log('  hook: ' + result.hookPath);
  if (result.chained) {
    console.log(
      result.host === 'plain'
        ? '  原有 pre-commit 已备份为 pre-commit.cometflow-orig，卸载时逐字还原'
        : '  原有内容保留，卸载时逐字还原',
    );
  }
  const status = await gitHookStatus(projectRoot);
  if (status.note !== null) console.log('  注意：' + status.note);
  console.log('  每次提交会跑 `cometflow gate check .`；临时跳过用 git 原生的 --no-verify');
}

export async function gateStatusCommand(
  targetPath: string,
  options: { json?: boolean } = {},
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const status = await gitHookStatus(projectRoot);
  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  if (!status.isRepository) {
    console.log('git 提交门禁：不适用 — ' + (status.note ?? '不是 git 仓库'));
    return;
  }
  console.log('hooks 目录：' + status.hooksDir);
  console.log(
    'git 提交门禁（' +
      status.host +
      '）：' +
      (status.installed ? '已安装' : '未安装') +
      (status.chained ? '（链式：原有 pre-commit 会先执行）' : '') +
      (status.drifted ? '（内容与当前版本不一致，建议重装）' : ''),
  );
  if (status.hookPath !== null) console.log('  管理文件：' + status.hookPath);
  if (status.note !== null) console.log('提示：' + status.note);
}

export async function gateUninstallCommand(
  targetPath: string,
  options: GateInstallOptions = {},
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  if (options.gitHooks !== true) {
    console.error('请指定卸载目标：cometflow gate uninstall . --git-hooks');
    process.exitCode = 1;
    return;
  }
  const result = await uninstallGitHook(projectRoot);
  console.log(result.reason);
  if (result.status === 'modified') process.exitCode = 1;
}
