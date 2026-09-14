import { runCommand } from './spawn-command.js';

/**
 * 极薄的 git 只读封装。
 *
 * 设计前提：**任何一步都不能因为 git 不存在/不可用而抛错**。
 * 非 git 目录、浅克隆、CI 临时 checkout 都要能正常工作，只是拿不到来源信息。
 */
export interface GitProvenance {
  head: string;
  branch: string | null;
  isRepository: boolean;
}

const TIMEOUT_MS = 10_000;

async function git(projectRoot: string, args: string[]): Promise<string | null> {
  const result = await runCommand('git', args, { cwd: projectRoot, timeoutMs: TIMEOUT_MS });
  if (result.exitCode !== 0) return null;
  return result.stdout.trim();
}

export async function isGitRepository(projectRoot: string): Promise<boolean> {
  const value = await git(projectRoot, ['rev-parse', '--is-inside-work-tree']);
  return value === 'true';
}

export async function gitHead(projectRoot: string): Promise<string | null> {
  const value = await git(projectRoot, ['rev-parse', 'HEAD']);
  // 空仓库（还没有 commit）时 HEAD 解析失败，按「无来源信息」处理。
  return value && /^[a-f0-9]{40}$/iu.test(value) ? value : null;
}

export async function gitBranch(projectRoot: string): Promise<string | null> {
  return git(projectRoot, ['symbolic-ref', '--short', '-q', 'HEAD']);
}

export async function captureGitProvenance(projectRoot: string): Promise<GitProvenance> {
  if (!(await isGitRepository(projectRoot))) {
    return { head: '', branch: null, isRepository: false };
  }
  const head = await gitHead(projectRoot);
  if (head === null) return { head: '', branch: null, isRepository: false };
  return { head, branch: await gitBranch(projectRoot), isRepository: true };
}

/** 提交是否存在于仓库中（浅克隆里可能没有）。 */
export async function gitCommitExists(projectRoot: string, commit: string): Promise<boolean> {
  const value = await git(projectRoot, ['cat-file', '-e', commit + '^{commit}']);
  return value !== null;
}

/**
 * 判断 ancestor 是否为 descendant 的祖先。
 * 注意语义：`merge-base --is-ancestor A B` 在 A === B 时也返回 0（真）。
 */
export async function gitIsAncestor(
  projectRoot: string,
  ancestor: string,
  descendant: string,
): Promise<boolean | null> {
  const result = await runCommand('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd: projectRoot,
    timeoutMs: TIMEOUT_MS,
  });
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1) return false;
  // 128 = 命令本身失败（对象不存在等），无法判定。
  return null;
}
