import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';
import { runCommand } from '../../platform/process/spawn-command.js';
import { hashSpecText } from '../spec/spec-hash.js';
import {
  findLefthookFile,
  huskyBlockSource,
  HUSKY_BLOCK_END,
  HUSKY_BLOCK_START,
  LEFTHOOK_COMMAND,
  LEFTHOOK_MARKER,
  looksLikeHusky,
  readTextOrNull,
  removeHuskyBlock,
  removeLefthookCommand,
  upsertHuskyBlock,
  upsertLefthookCommand,
  writeHookFile,
  type GitHookHost,
  type GitHookHostKind,
} from './hook-host.js';

/**
 * 把只读门禁装进 git 的提交链路。
 *
 * 三条硬约束（都来自踩过的坑）：
 * 1. **装到工具承认的位置**：裸仓库写 `.git/hooks/pre-commit`；husky 项目写 `.husky/pre-commit`；
 *    lefthook 项目写 `lefthook.yml`（详见 hook-host.ts 的说明）；
 * 2. **可逆**：安装前的内容备份下来，未被用户改动就逐字还原；改过则只摘自己的托管块；
 * 3. **不吞掉用户已有的检查**：裸仓库链式执行原 hook，husky / lefthook 则把调用**插进**用户自己的配置里。
 */
export const GIT_HOOK_NAME = 'pre-commit';
/** 卸载时靠这一行判断「这个文件里有没有我们的东西」。 */
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
 * 裸仓库用的 pre-commit 包装脚本。
 *
 * 用 LF：Windows 上 git 用自带的 sh 执行 hook，CRLF 会让 `#!/bin/sh` 带上 `\r` 而直接失效
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
  /** 集成方式：裸仓库 / husky / lefthook。 */
  host: GitHookHostKind;
  hooksDir: string | null;
  /** `core.hooksPath` 被设过（husky / lefthook）时给出原值。 */
  hooksPathOverride: string | null;
  /** 被管理的文件：裸仓库是 hooks/pre-commit，husky 是 .husky/pre-commit，lefthook 是 lefthook.yml。 */
  hookPath: string | null;
  installed: boolean;
  /** 用户原有的检查仍会执行（裸仓库的链式备份 / husky、lefthook 的既有内容）。 */
  chained: boolean;
  /** 已安装但托管内容与当前生成器不一致（升级后没重装）。 */
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

async function hooksPathOverride(projectRoot: string): Promise<string | null> {
  const override = await git(projectRoot, ['config', '--get', 'core.hooksPath']);
  return override.code === 0 && override.stdout !== '' ? override.stdout : null;
}

/**
 * 探测宿主：lefthook（有 yml）> husky（有 .husky / 依赖 / hooksPath 指向 `_`）> 裸仓库。
 * 两者同时存在时以显式 yml 为准，并在 note 里说明。
 */
export async function detectHookHost(projectRoot: string): Promise<GitHookHost | null> {
  const hooksDir = await resolveHooksDir(projectRoot);
  if (hooksDir === null) return null;
  const override = await hooksPathOverride(projectRoot);

  const lefthookFile = await findLefthookFile(projectRoot);
  const husky = await looksLikeHusky(projectRoot, override);
  if (lefthookFile !== null) {
    return {
      kind: 'lefthook',
      filePath: lefthookFile,
      display: path.relative(projectRoot, lefthookFile).split(path.sep).join('/'),
      note: husky ? '同时检测到 husky；本次按显式存在的 lefthook 配置来装' : null,
    };
  }
  if (husky) {
    const filePath = path.join(projectRoot, '.husky', GIT_HOOK_NAME);
    const huskyPathActive =
      override !== null && path.resolve(projectRoot, override) === path.join(projectRoot, '.husky', '_');
    return {
      kind: 'husky',
      filePath,
      display: '.husky/' + GIT_HOOK_NAME,
      note: huskyPathActive
        ? null
        : 'husky 尚未接管 git hooks（core.hooksPath 未指向 .husky/_）：跑一次 npx husky 或 ' +
          'git config core.hooksPath .husky/_，否则 git 不会执行这个文件',
    };
  }
  return {
    kind: 'plain',
    filePath: gitHookPath(hooksDir),
    display: path.relative(projectRoot, gitHookPath(hooksDir)).split(path.sep).join('/'),
    note: null,
  };
}

interface HookRecord {
  host?: GitHookHostKind;
  hookPath?: string;
  existed?: boolean;
  content?: string | null;
  installed_hash?: string;
}

async function readRecord(projectRoot: string): Promise<HookRecord | null> {
  try {
    return JSON.parse(await fs.readFile(gitHookRecordPath(projectRoot), 'utf8')) as HookRecord;
  } catch {
    return null;
  }
}

/** 托管内容是否符合当前生成器（裸仓库比整份脚本，husky / lefthook 比托管块）。 */
function managedContentOf(host: GitHookHostKind, content: string | null): string | null {
  if (content === null) return null;
  if (host === 'plain') return content;
  if (host === 'husky') {
    const start = content.indexOf(HUSKY_BLOCK_START);
    const end = content.indexOf(HUSKY_BLOCK_END);
    return start !== -1 && end !== -1 ? content.slice(start, end + HUSKY_BLOCK_END.length) : null;
  }
  const lines = content.split('\n');
  const index = lines.findIndex((line) => line.trim() === LEFTHOOK_MARKER);
  return index === -1 ? null : lines.slice(index, index + 3).join('\n');
}

function expectedManagedContent(host: GitHookHostKind): string | null {
  if (host === 'plain') return null; // 由 gitHookSource 提供
  if (host === 'husky') return huskyBlockSource();
  return [LEFTHOOK_MARKER, LEFTHOOK_COMMAND + ':', '  run: cometflow gate check .'].join('\n');
}

/** husky / lefthook 的托管块缩进过，比对时按行 trim 后再比。 */
function normalizeBlock(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

export async function gitHookStatus(projectRoot: string): Promise<GitHookStatus> {
  const host = await detectHookHost(projectRoot);
  if (host === null) {
    return {
      isRepository: false,
      host: 'plain',
      hooksDir: null,
      hooksPathOverride: null,
      hookPath: null,
      installed: false,
      chained: false,
      drifted: false,
      note: projectRoot + ' 不是 git 仓库（或 git 不可用），提交门禁无处可装',
    };
  }
  const override = await hooksPathOverride(projectRoot);
  const hooksDir = await resolveHooksDir(projectRoot);
  const content = await readTextOrNull(host.filePath);
  const managed = managedContentOf(host.kind, content);
  const installed = managed !== null;
  const chained =
    host.kind === 'plain'
      ? (await readTextOrNull(gitHookBackupPath(hooksDir!))) !== null
      : installed && content!.replace(managed!, '').trim() !== '';
  const expectedManaged =
    host.kind === 'plain' ? gitHookSource(projectRoot) : expectedManagedContent(host.kind)!;
  // husky / lefthook 的托管块会被缩进，按行 trim 后再比，避免误报漂移。
  const drifted = installed && normalizeBlock(managed!) !== normalizeBlock(expectedManaged);

  return {
    isRepository: true,
    host: host.kind,
    hooksDir,
    hooksPathOverride: override,
    hookPath: host.filePath,
    installed,
    chained,
    drifted,
    note: host.note,
  };
}

export interface GitHookInstallResult {
  status: 'installed' | 'skipped';
  host: GitHookHostKind;
  hooksDir: string | null;
  hookPath: string | null;
  chained: boolean;
  reason: string;
}

async function writeRecord(projectRoot: string, record: Record<string, unknown>): Promise<void> {
  await atomicWriteText(
    gitHookRecordPath(projectRoot),
    JSON.stringify({ schema: 'cometflow.git-hook.v1', ...record }, null, 2) + '\n',
  );
}

export async function installGitHook(projectRoot: string): Promise<GitHookInstallResult> {
  const host = await detectHookHost(projectRoot);
  if (host === null) {
    return {
      status: 'skipped',
      host: 'plain',
      hooksDir: null,
      hookPath: null,
      chained: false,
      reason: projectRoot + ' 不是 git 仓库（或 git 不可用），提交门禁无处可装',
    };
  }
  const hooksDir = await resolveHooksDir(projectRoot);

  if (host.kind === 'plain') {
    await fs.mkdir(hooksDir!, { recursive: true });
    const hookPath = gitHookPath(hooksDir!);
    const backupPath = gitHookBackupPath(hooksDir!);
    const existing = await readTextOrNull(hookPath);
    const ours = existing !== null && existing.includes(GIT_HOOK_MARKER);
    if (existing !== null && !ours && (await readTextOrNull(backupPath)) === null) {
      await atomicWriteText(backupPath, existing);
    }
    const chained = (await readTextOrNull(backupPath)) !== null;
    const source = gitHookSource(projectRoot);
    await writeHookFile(hookPath, source);
    await writeRecord(projectRoot, {
      host: 'plain',
      hooksDir,
      hookPath,
      backup: chained ? backupPath : null,
      installed_hash: hashSpecText(source),
    });
    return {
      status: 'installed',
      host: 'plain',
      hooksDir,
      hookPath,
      chained,
      reason: chained ? '已安装（原有 pre-commit 会先执行）' : '已安装',
    };
  }

  const original = await readTextOrNull(host.filePath);
  const edit = host.kind === 'husky' ? upsertHuskyBlock(original) : upsertLefthookCommand(original);
  if (edit.unsupported !== null) {
    return {
      status: 'skipped',
      host: host.kind,
      hooksDir,
      hookPath: host.filePath,
      chained: false,
      reason: edit.unsupported,
    };
  }
  if (edit.changed) await writeHookFile(host.filePath, edit.content);
  // 重复安装时**必须保留第一次安装前的备份**：否则「原始内容」会被覆盖成含托管块的版本，
  // 卸载时就把我们的块也一起还原回去（测试先抓到过这个）。
  const previous = await readRecord(projectRoot);
  // 记录里存的是 hookPath（与 writeRecord 的字段名一致），别写成 filePath——写错就不会复用备份。
  const sameTarget = previous?.host === host.kind && previous?.hookPath === host.filePath;
  await writeRecord(
    projectRoot,
    edit.changed || !sameTarget
      ? {
          host: host.kind,
          hooksDir,
          hookPath: host.filePath,
          existed: original !== null,
          content: edit.changed ? original : null,
          installed_hash: hashSpecText(edit.content),
        }
      : { ...previous, hooksDir, hookPath: host.filePath, installed_hash: hashSpecText(edit.content) },
  );
  const chained = original !== null && original.trim() !== '';
  return {
    status: 'installed',
    host: host.kind,
    hooksDir,
    hookPath: host.filePath,
    chained,
    reason:
      '已安装（' +
      (host.kind === 'husky' ? 'husky：写进 .husky/pre-commit' : 'lefthook：写进 lefthook.yml') +
      (chained ? '，原有内容保留' : '') +
      '）',
  };
}

export interface GitHookUninstallResult {
  status: 'removed' | 'noop' | 'modified';
  restored: boolean;
  reason: string;
}

export async function uninstallGitHook(projectRoot: string): Promise<GitHookUninstallResult> {
  const host = await detectHookHost(projectRoot);
  if (host === null) {
    return { status: 'noop', restored: false, reason: '不是 git 仓库，没有可卸载的 hook' };
  }
  const hooksDir = (await resolveHooksDir(projectRoot))!;
  const current = await readTextOrNull(host.filePath);
  const record = await readRecord(projectRoot);

  if (host.kind === 'plain') {
    if (current === null || !current.includes(GIT_HOOK_MARKER)) {
      return { status: 'noop', restored: false, reason: '没有找到由 CometFlow 安装的 pre-commit' };
    }
    // 用户改过我们写的包装脚本：不猜他的意图，也不覆盖他的改动。
    if (record?.installed_hash === undefined || hashSpecText(current) !== record.installed_hash) {
      return {
        status: 'modified',
        restored: false,
        reason: 'pre-commit 在安装之后被修改过，不自动还原；请手工合并或删除 ' + host.filePath,
      };
    }
    const backupPath = gitHookBackupPath(hooksDir);
    const backup = await readTextOrNull(backupPath);
    if (backup !== null) {
      await writeHookFile(host.filePath, backup);
      await fs.rm(backupPath, { force: true });
      await fs.rm(gitHookRecordPath(projectRoot), { force: true });
      return { status: 'removed', restored: true, reason: 'removed（逐字还原原有 pre-commit）' };
    }
    await fs.rm(host.filePath, { force: true });
    await fs.rm(gitHookRecordPath(projectRoot), { force: true });
    return { status: 'removed', restored: true, reason: 'removed（安装前没有 pre-commit）' };
  }

  if (current === null) {
    return { status: 'noop', restored: false, reason: '没有找到由 CometFlow 写入的托管块' };
  }
  // 未被改动 → 逐字还原；改过 → 只摘我们自己的块，保留用户其它改动（绝不整体覆盖）。
  if (record?.installed_hash !== undefined && hashSpecText(current) === record.installed_hash) {
    if (record.existed === true && typeof record.content === 'string') {
      await writeHookFile(host.filePath, record.content);
      await fs.rm(gitHookRecordPath(projectRoot), { force: true });
      return {
        status: 'removed',
        restored: true,
        reason: 'removed（逐字还原 ' + host.display + '）',
      };
    }
    await fs.rm(host.filePath, { force: true });
    await fs.rm(gitHookRecordPath(projectRoot), { force: true });
    return { status: 'removed', restored: true, reason: 'removed（安装前没有 ' + host.display + '）' };
  }
  const trimmed =
    host.kind === 'husky' ? removeHuskyBlock(current) : removeLefthookCommand(current);
  if (trimmed === current) {
    return { status: 'noop', restored: false, reason: '托管块已被移除或结构不符合预期' };
  }
  await writeHookFile(host.filePath, trimmed);
  await fs.rm(gitHookRecordPath(projectRoot), { force: true });
  return {
    status: 'removed',
    restored: false,
    reason: 'removed（' + host.display + ' 在安装后被改过，只摘除托管块，保留你的改动）',
  };
}
