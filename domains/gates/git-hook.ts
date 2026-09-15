import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';
import { runCommand } from '../../platform/process/spawn-command.js';
import { hashSpecText } from '../spec/spec-hash.js';

/**
 * 把只读门禁装进 git 的 `pre-commit`。
 *
 * 三条硬约束（都来自踩过的坑）：
 * 1. **可逆**：用户原有的 pre-commit 一字不改地备份，卸载时逐字还原（同 ADR 0023 的 hook 卸载语义）；
 * 2. **不吞掉原来的门禁**：链式调用——先跑原 hook，它失败就不再往下跑；
 * 3. **写对地方**：用 `git rev-parse --git-path hooks` 解析，尊重 `core.hooksPath`（husky / lefthook 会改它），
 *    而不是想当然地写 `.git/hooks`。
 */
export const GIT_HOOK_NAME = 'pre-commit';
/** 卸载时靠这一行判断「这个 hook 是不是我们写的」。 */
export const GIT_HOOK_MARKER = 'cometflow-git-gate';

export function gitHookRecordPath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'git-hook', 'pre-commit.json');
}

export function gitHookPath(hooksDir: string): string {
  return path.join(hooksDir, GIT_HOOK_NAME);
}

export function gitHookBackupPath(hooksDir: string): string {
  return path.join(hooksDir, GIT_HOOK_NAME + '.cometflow-orig');
}

/**
 * 生成 pre-commit 包装脚本。
 *
 * 用 LF：Windows 上 git 用自带的 sh 执行 hook，CRLF 会让 `#!/bin/sh` 行带上 `\r` 而直接失效
 * （hook 静默不生效，看起来「装了」）。
 */
export function gitHookSource(projectRoot: string): string {
  void projectRoot;
  return [
    '#!/bin/sh',
    '# ' + GIT_HOOK_MARKER + '（由 `cometflow gate install --git-hooks` 生成，不要手改）',
    '# 重新生成：cometflow gate install --git-hooks；卸载：cometflow gate uninstall --git-hooks',
    '',
    'HOOK_DIR=$(dirname "$0")',
    'ORIG="$HOOK_DIR/' + GIT_HOOK_NAME + '.cometflow-orig"',
    'if [ -f "$ORIG" ]; then',
    '  # 先跑用户原有的 pre-commit：它失败就保持原样失败，不替它做决定。',
    '  sh "$ORIG" "$@"',
    '  ORIG_STATUS=$?',
    '  if [ "$ORIG_STATUS" -ne 0 ]; then',
    '    exit "$ORIG_STATUS"',
    '  fi',
    'fi',
    '',
    '# COMETFLOW_CLI 允许是命令行前缀（如 node "/path/cli.js"），所以走 sh -c。',
    'COMETFLOW="${COMETFLOW_CLI:-cometflow}"',
    'sh -c "$COMETFLOW gate check ."',
    '',
  ].join('\n');
}

export interface GitHookStatus {
  isRepository: boolean;
  hooksDir: string | null;
  /** `core.hooksPath` 被设过（husky / lefthook）时给出原值，提醒用户写这里是否真的会生效。 */
  hooksPathOverride: string | null;
  hookPath: string | null;
  installed: boolean;
  /** 链式调用了用户原有 hook。 */
  chained: boolean;
  /** 已安装但与当前生成器不一致（升级后没重装）。 */
  drifted: boolean;
  note: string | null;
}

async function git(projectRoot: string, args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const result = await runCommand('git', args, { cwd: projectRoot, timeoutMs: 10_000 });
    return { code: result.exitCode, stdout: result.stdout.trim() };
  } catch {
    return { code: 1, stdout: '' };
  }
}

/**
 * 解析真正生效的 hooks 目录。
 * `git rev-parse --git-path hooks` 在 worktree 子目录、`core.hooksPath` 场景下都会给出正确位置。
 */
export async function resolveHooksDir(projectRoot: string): Promise<string | null> {
  const inside = await git(projectRoot, ['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0 || inside.stdout !== 'true') return null;
  const hooksPath = await git(projectRoot, ['rev-parse', '--git-path', 'hooks']);
  if (hooksPath.code !== 0 || hooksPath.stdout === '') return null;
  return path.resolve(projectRoot, hooksPath.stdout);
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

export async function gitHookStatus(projectRoot: string): Promise<GitHookStatus> {
  const hooksDir = await resolveHooksDir(projectRoot);
  if (hooksDir === null) {
    return {
      isRepository: false,
      hooksDir: null,
      hooksPathOverride: null,
      hookPath: null,
      installed: false,
      chained: false,
      drifted: false,
      note: projectRoot + ' 不是 git 仓库（或 git 不可用），提交门禁无处可装',
    };
  }
  const override = await git(projectRoot, ['config', '--get', 'core.hooksPath']);
  const hooksPathOverride = override.code === 0 && override.stdout !== '' ? override.stdout : null;
  const hookPath = gitHookPath(hooksDir);
  const content = await readFileOrNull(hookPath);
  const installed = content !== null && content.includes(GIT_HOOK_MARKER);
  const chained = (await readFileOrNull(gitHookBackupPath(hooksDir))) !== null;
  const drifted = installed && hashSpecText(content!) !== hashSpecText(gitHookSource(projectRoot));
  return {
    isRepository: true,
    hooksDir,
    hooksPathOverride,
    hookPath,
    installed,
    chained,
    drifted,
    note:
      hooksPathOverride !== null
        ? 'core.hooksPath = ' + hooksPathOverride + '（husky / lefthook 之类会改它）；门禁已写到解析出来的 hooks 目录'
        : null,
  };
}

export interface GitHookInstallResult {
  status: 'installed' | 'skipped';
  hooksDir: string | null;
  hookPath: string | null;
  chained: boolean;
  reason: string;
}

export async function installGitHook(projectRoot: string): Promise<GitHookInstallResult> {
  const hooksDir = await resolveHooksDir(projectRoot);
  if (hooksDir === null) {
    return {
      status: 'skipped',
      hooksDir: null,
      hookPath: null,
      chained: false,
      reason: projectRoot + ' 不是 git 仓库（或 git 不可用），提交门禁无处可装',
    };
  }
  await fs.mkdir(hooksDir, { recursive: true });

  const hookPath = gitHookPath(hooksDir);
  const backupPath = gitHookBackupPath(hooksDir);
  const existing = await readFileOrNull(hookPath);
  const ours = existing !== null && existing.includes(GIT_HOOK_MARKER);

  // 只有「不是我们的」才备份：重复安装不能把自己写的包装脚本当成用户的 hook 存起来。
  if (existing !== null && !ours && (await readFileOrNull(backupPath)) === null) {
    await atomicWriteText(backupPath, existing);
  }
  const chained = (await readFileOrNull(backupPath)) !== null;

  const source = gitHookSource(projectRoot);
  await atomicWriteText(hookPath, source);
  if (process.platform !== 'win32') await fs.chmod(hookPath, 0o755);
  await atomicWriteText(
    gitHookRecordPath(projectRoot),
    JSON.stringify(
      {
        schema: 'cometflow.git-hook.v1',
        hook: GIT_HOOK_NAME,
        hooksDir,
        hookPath,
        backup: chained ? backupPath : null,
        installed_hash: hashSpecText(source),
      },
      null,
      2,
    ) + '\n',
  );

  return {
    status: 'installed',
    hooksDir,
    hookPath,
    chained,
    reason: chained ? '已安装（原有 pre-commit 会先执行）' : '已安装',
  };
}

export interface GitHookUninstallResult {
  status: 'removed' | 'noop' | 'modified';
  restored: boolean;
  reason: string;
}

export async function uninstallGitHook(projectRoot: string): Promise<GitHookUninstallResult> {
  const hooksDir = await resolveHooksDir(projectRoot);
  if (hooksDir === null) {
    return { status: 'noop', restored: false, reason: '不是 git 仓库，没有可卸载的 hook' };
  }
  const hookPath = gitHookPath(hooksDir);
  const backupPath = gitHookBackupPath(hooksDir);
  const current = await readFileOrNull(hookPath);
  if (current === null || !current.includes(GIT_HOOK_MARKER)) {
    return { status: 'noop', restored: false, reason: '没有找到由 CometFlow 安装的 pre-commit' };
  }

  let installedHash: string | null = null;
  try {
    installedHash = JSON.parse(await fs.readFile(gitHookRecordPath(projectRoot), 'utf8')).installed_hash ?? null;
  } catch {
    installedHash = null;
  }
  // 用户改过我们写的包装脚本：不猜他的意图，也不覆盖他的改动。
  if (installedHash === null || hashSpecText(current) !== installedHash) {
    return {
      status: 'modified',
      restored: false,
      reason: 'pre-commit 在安装之后被修改过，不自动还原；请手工合并或删除 ' + hookPath,
    };
  }

  const backup = await readFileOrNull(backupPath);
  if (backup !== null) {
    await atomicWriteText(hookPath, backup);
    if (process.platform !== 'win32') await fs.chmod(hookPath, 0o755);
    await fs.rm(backupPath, { force: true });
    await fs.rm(gitHookRecordPath(projectRoot), { force: true });
    return { status: 'removed', restored: true, reason: 'removed（逐字还原原有 pre-commit）' };
  }
  await fs.rm(hookPath, { force: true });
  await fs.rm(gitHookRecordPath(projectRoot), { force: true });
  return { status: 'removed', restored: true, reason: 'removed（安装前没有 pre-commit）' };
}
