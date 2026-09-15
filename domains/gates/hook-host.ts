import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';

/**
 * 提交门禁要装到**哪个工具承认的位置**。
 *
 * 裸仓库写 `.git/hooks/pre-commit` 就完事，但这两类项目会把那个文件重新生成：
 * husky v9 用 `core.hooksPath=.husky/_`（自动生成的 shim），真正属于用户的是 `.husky/pre-commit`；
 * lefthook 的集成点是 `lefthook.yml`，`.git/hooks/pre-commit` 只是它生成的转发脚本。
 * 装错地方的后果不是报错，而是**下次工具一跑就被覆盖**——静默失效，正是这一批一直在防的那类问题。
 */
export type GitHookHostKind = 'plain' | 'husky' | 'lefthook';

export interface GitHookHost {
  kind: GitHookHostKind;
  /** 被管理的文件（husky: .husky/pre-commit；lefthook: lefthook.yml） */
  filePath: string;
  /** 给人看的相对路径 */
  display: string;
  /** 需要提示的前提条件（例如 husky 的 hooksPath 还没生效） */
  note: string | null;
}

const LEFTHOOK_FILES = ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml'];

export const HUSKY_BLOCK_START = '# cometflow-git-gate:start';
export const HUSKY_BLOCK_END = '# cometflow-git-gate:end';
export const LEFTHOOK_MARKER = '# cometflow-git-gate';
export const LEFTHOOK_COMMAND = 'cometflow-gate';

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

async function packageJsonDeps(projectRoot: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
    return [
      ...Object.keys(parsed?.dependencies ?? {}),
      ...Object.keys(parsed?.devDependencies ?? {}),
    ];
  } catch {
    return [];
  }
}

/** `.husky` 目录存在、依赖里有 husky、或 hooksPath 指向 husky 生成的 `_` 目录。 */
export async function looksLikeHusky(
  projectRoot: string,
  hooksPathOverride: string | null,
): Promise<boolean> {
  if (await exists(path.join(projectRoot, '.husky'))) return true;
  if (hooksPathOverride !== null && /(^|[\\/])_$/u.test(hooksPathOverride.replace(/[\\/]+$/u, ''))) {
    return true;
  }
  return (await packageJsonDeps(projectRoot)).includes('husky');
}

export async function findLefthookFile(projectRoot: string): Promise<string | null> {
  for (const name of LEFTHOOK_FILES) {
    const candidate = path.join(projectRoot, name);
    if (await exists(candidate)) return candidate;
  }
  return null;
}

/** husky 的托管块：带 `|| exit $?`，保证后面还有别的行时也不会被掩盖掉退出码。 */
export function huskyBlockSource(): string {
  return [
    HUSKY_BLOCK_START,
    '# 由 cometflow gate install --git-hooks 生成（husky 集成）；卸载：cometflow gate uninstall --git-hooks',
    'COMETFLOW="${COMETFLOW_CLI:-cometflow}"',
    'sh -c "$COMETFLOW gate check ." || exit $?',
    HUSKY_BLOCK_END,
  ].join('\n');
}

export interface FileEditResult {
  content: string;
  changed: boolean;
  /** 结构超出支持范围时的说明；非 null 表示**不要写**这个文件。 */
  unsupported: string | null;
}

/** 追加/替换 husky 托管块，保留用户原有内容。 */
export function upsertHuskyBlock(original: string | null): FileEditResult {
  const block = huskyBlockSource();
  if (original === null) {
    return { content: '#!/bin/sh\n\n' + block + '\n', changed: true, unsupported: null };
  }
  const start = original.indexOf(HUSKY_BLOCK_START);
  const end = original.indexOf(HUSKY_BLOCK_END);
  if (start !== -1 && end !== -1 && end > start) {
    const replaced = original.slice(0, start) + block + original.slice(end + HUSKY_BLOCK_END.length);
    return { content: replaced, changed: replaced !== original, unsupported: null };
  }
  const prefix = original.endsWith('\n') ? original : original + '\n';
  return { content: prefix + '\n' + block + '\n', changed: true, unsupported: null };
}

export function removeHuskyBlock(content: string): string {
  const start = content.indexOf(HUSKY_BLOCK_START);
  const end = content.indexOf(HUSKY_BLOCK_END);
  if (start === -1 || end === -1 || end < start) return content;
  let before = content.slice(0, start);
  let after = content.slice(end + HUSKY_BLOCK_END.length);
  // 收拾掉插入时加的那一行空行，避免留下两个连续空行。
  before = before.replace(/\n\n$/u, '\n');
  after = after.replace(/^\n\n/u, '\n');
  return before + after;
}

interface LefthookInsert {
  content: string;
  changed: boolean;
  unsupported: string | null;
}

/**
 * 往 `lefthook.yml` 的 `pre-commit.commands` 里插一条命令。
 *
 * **文本插入而不是 YAML 重新序列化**：`yaml` 库会把用户注释全部丢掉，而 lefthook.yml
 * 往往写满了注释。结构超出支持范围（流式写法、`extends`）时明确拒绝——宁可不装，也不写坏用户的配置文件。
 */
export function upsertLefthookCommand(original: string | null): LefthookInsert {
  const block = (indent: string): string =>
    [indent + LEFTHOOK_MARKER, indent + LEFTHOOK_COMMAND + ':', indent + '  run: cometflow gate check .'].join('\n');

  if (original === null || original.trim() === '') {
    return {
      content: ['pre-commit:', '  commands:', block('    '), ''].join('\n'),
      changed: true,
      unsupported: null,
    };
  }
  if (original.includes(LEFTHOOK_COMMAND)) {
    return { content: original, changed: false, unsupported: null };
  }
  const lines = original.split('\n');
  const preCommitIndex = lines.findIndex((line) => /^pre-commit:\s*(#.*)?$/u.test(line));
  if (preCommitIndex === -1) {
    const prefix = original.endsWith('\n') ? original : original + '\n';
    return {
      content: prefix + ['pre-commit:', '  commands:', block('    '), ''].join('\n'),
      changed: true,
      unsupported: null,
    };
  }
  // 找 pre-commit 块内第一个子键，判断块结构是否受支持。
  let commandsIndex = -1;
  let commandsIndent = '';
  for (let index = preCommitIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const indent = line.slice(0, line.length - line.trimStart().length);
    if (indent === '') break; // 回到顶层，块结束
    if (/^\s*extends:/u.test(line)) {
      return {
        content: original,
        changed: false,
        unsupported:
          'lefthook.yml 的 pre-commit 用了 extends，超出本工具支持的插入范围；请手工加入：' +
          block('    ').replace(/^ {4}/gmu, ''),
      };
    }
    if (/^\s*commands:\s*(#.*)?$/u.test(line)) {
      commandsIndex = index;
      commandsIndent = indent;
      break;
    }
  }
  if (commandsIndex === -1) {
    lines.splice(preCommitIndex + 1, 0, '  commands:', block('    '));
  } else {
    lines.splice(commandsIndex + 1, 0, block(commandsIndent + '  '));
  }
  return { content: lines.join('\n'), changed: true, unsupported: null };
}

/** 只摘掉我们自己插的那三行；用户其它改动保留。 */
export function removeLefthookCommand(content: string): string {
  const lines = content.split('\n');
  const markerIndex = lines.findIndex((line) => line.trim() === LEFTHOOK_MARKER);
  if (markerIndex === -1) return content;
  const following = lines.slice(markerIndex + 1, markerIndex + 3);
  const shapeOk =
    following.length === 2 &&
    /^\s*cometflow-gate:\s*$/u.test(following[0]) &&
    /^\s*run:\s*cometflow gate check \.\s*$/u.test(following[1]);
  if (!shapeOk) return content;
  lines.splice(markerIndex, 3);
  return lines.join('\n');
}

export async function readTextOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

export async function writeHookFile(filePath: string, content: string): Promise<void> {
  await atomicWriteText(filePath, content);
  if (process.platform !== 'win32') await fs.chmod(filePath, 0o755);
}
