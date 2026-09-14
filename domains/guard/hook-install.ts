import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';
import { hashSpecText } from '../spec/spec-hash.js';

export const HOOK_PLATFORMS = ['claude-code', 'opencode', 'codex'] as const;
export type HookPlatform = (typeof HOOK_PLATFORMS)[number];

/**
 * 目前只实现 Claude Code：它的 hooks 格式有明确契约
 * （`settings.json` → `hooks.PreToolUse[]`，条目 `{ matcher, hooks: [{ type: 'command', command }] }`），
 * 且拦截语义清晰（命令退出码 2 = 拒绝该次工具调用）。
 *
 * opencode / codex 的 hook 配置格式我们没有可依据的实现参照，
 * **宁可显式报「不支持」，也不写一份猜出来的配置**——猜错会在用户机器上静默失效。
 */
export const SUPPORTED_HOOK_PLATFORMS: readonly HookPlatform[] = ['claude-code'];

export const HOOK_GUARD_FILENAME = 'cometflow-guard.mjs';
export const HOOK_MATCHER = 'Write|Edit|MultiEdit';

export function claudeSettingsPath(projectRoot: string): string {
  return path.join(projectRoot, '.claude', 'settings.json');
}

export function hookGuardPath(projectRoot: string): string {
  return path.join(projectRoot, '.claude', 'hooks', HOOK_GUARD_FILENAME);
}

/** 安装前的原始文件备份：卸载时若用户没再改过，就逐字还原。 */
export function hookBackupPath(projectRoot: string, platform: HookPlatform): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'hook-install', platform + '.json');
}

/**
 * 平台 hook 脚本：从 stdin 读工具调用 JSON，取出被写入的路径，
 * 交给 `cometflow hook check` 判定；被判非法时以退出码 2 阻止这次写入。
 */
export function hookGuardSource(): string {
  return [
    '#!/usr/bin/env node',
    '// 由 `cometflow hook install` 生成，不要手工编辑（重新安装会覆盖）。',
    '// 职责：把平台传来的写入事件转成 `cometflow hook check` 的判定，阻止越界写入。',
    "import { spawnSync } from 'node:child_process';",
    "import process from 'node:process';",
    '',
    'const chunks = [];',
    'for await (const chunk of process.stdin) chunks.push(chunk);',
    'let payload = {};',
    'try {',
    "  payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');",
    '} catch {',
    '  process.exit(0); // 解析不了就放行：守卫不负责猜',
    '}',
    '',
    'const input = payload?.tool_input ?? payload?.toolInput ?? {};',
    'const target = input.file_path ?? input.filePath ?? input.path ?? null;',
    'if (typeof target !== "string" || target === "") process.exit(0);',
    '',
    'const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();',
    'const cli = process.env.COMETFLOW_CLI ?? "cometflow";',
    'const result = spawnSync(cli, ["hook", "check", target, projectRoot, "--event", "write"], {',
    '  cwd: projectRoot,',
    '  encoding: "utf8",',
    '  shell: process.platform === "win32",',
    '});',
    '',
    'if (result.error) process.exit(0); // CLI 不可用时放行，避免把开发环境锁死',
    'if (result.status === 0) process.exit(0);',
    '',
    'const reason = (result.stdout ?? "").trim() || (result.stderr ?? "").trim();',
    'console.error("CometFlow 阻止了这次写入：" + reason);',
    'process.exit(2); // Claude Code: 退出码 2 = 阻止工具调用并把 stderr 反馈给模型',
    '',
  ].join('\n');
}

interface ClaudeHookEntry {
  matcher?: string;
  hooks: { type: string; command: string }[];
}

export interface HookInstallResult {
  status: 'installed' | 'unsupported' | 'failed';
  platform: HookPlatform;
  settingsPath: string | null;
  guardPath: string | null;
  reason: string;
}

function isManagedEntry(entry: ClaudeHookEntry): boolean {
  return (entry.hooks ?? []).some((hook) => (hook.command ?? '').includes(HOOK_GUARD_FILENAME));
}

async function readSettings(filePath: string): Promise<Record<string, unknown>> {
  try {
    const source = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(source) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(filePath + ' 不是 JSON 对象，拒绝自动修改');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function preToolUseOf(settings: Record<string, unknown>): ClaudeHookEntry[] {
  const hooks = settings.hooks;
  if (hooks === null || typeof hooks !== 'object') return [];
  const list = (hooks as Record<string, unknown>).PreToolUse;
  return Array.isArray(list) ? (list as ClaudeHookEntry[]) : [];
}

export async function installHook(
  projectRoot: string,
  platform: HookPlatform,
): Promise<HookInstallResult> {
  if (!SUPPORTED_HOOK_PLATFORMS.includes(platform)) {
    return {
      status: 'unsupported',
      platform,
      settingsPath: null,
      guardPath: null,
      reason:
        'platform "' +
        platform +
        '" 的 hook 配置格式缺少可依据的实现参照，尚未支持（当前支持：' +
        SUPPORTED_HOOK_PLATFORMS.join(', ') +
        '）；不会写入猜测出来的配置',
    };
  }

  const settingsPath = claudeSettingsPath(projectRoot);
  const guardPath = hookGuardPath(projectRoot);

  // 先备份原始 settings.json（含「原本不存在」这一事实），供卸载逐字还原。
  let original: string | null = null;
  try {
    original = await fs.readFile(settingsPath, 'utf8');
  } catch {
    original = null;
  }
  await atomicWriteText(
    hookBackupPath(projectRoot, platform),
    JSON.stringify(
      {
        existed: original !== null,
        content: original,
        hash: original === null ? null : hashSpecText(original),
      },
      null,
      2,
    ) + '\n',
  );

  const settings = await readSettings(settingsPath);
  const existing = preToolUseOf(settings).filter((entry) => !isManagedEntry(entry));
  const command = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/' + HOOK_GUARD_FILENAME + '"';
  const merged: ClaudeHookEntry[] = [
    ...existing,
    { matcher: HOOK_MATCHER, hooks: [{ type: 'command', command }] },
  ];

  await atomicWriteText(guardPath, hookGuardSource());
  const nextSettings: Record<string, unknown> = {
    ...settings,
    hooks: { ...(settings.hooks as Record<string, unknown> ?? {}), PreToolUse: merged },
  };
  const written = JSON.stringify(nextSettings, null, 2) + '\n';
  await atomicWriteText(settingsPath, written);
  // 记录「我们写进去的内容」的哈希：卸载时用它与当前文件比对，才能判断用户是否改过。
  await atomicWriteText(
    hookBackupPath(projectRoot, platform),
    JSON.stringify(
      {
        existed: original !== null,
        content: original,
        hash: original === null ? null : hashSpecText(original),
        installed_hash: hashSpecText(written),
      },
      null,
      2,
    ) + '\n',
  );

  return { status: 'installed', platform, settingsPath, guardPath, reason: 'installed' };
}

export interface HookStatusResult {
  platform: HookPlatform;
  supported: boolean;
  installed: boolean;
  guardExists: boolean;
  settingsPath: string | null;
  entries: number;
  drift: string | null;
}

export async function hookStatus(
  projectRoot: string,
  platform: HookPlatform,
): Promise<HookStatusResult> {
  const supported = SUPPORTED_HOOK_PLATFORMS.includes(platform);
  if (!supported) {
    return { platform, supported: false, installed: false, guardExists: false, settingsPath: null, entries: 0, drift: null };
  }
  const settingsPath = claudeSettingsPath(projectRoot);
  const guardPath = hookGuardPath(projectRoot);
  let guardExists = true;
  try {
    await fs.access(guardPath);
  } catch {
    guardExists = false;
  }
  let entries = 0;
  try {
    entries = preToolUseOf(await readSettings(settingsPath)).filter(isManagedEntry).length;
  } catch {
    entries = 0;
  }
  const installed = entries > 0 && guardExists;
  return {
    platform,
    supported: true,
    installed,
    guardExists,
    settingsPath,
    entries,
    drift: entries > 0 && !guardExists ? 'hook 条目存在但守卫脚本缺失，请重新安装' : null,
  };
}

export interface HookUninstallResult {
  status: 'removed' | 'unsupported' | 'noop';
  platform: HookPlatform;
  restored: boolean;
  reason: string;
}

export async function uninstallHook(
  projectRoot: string,
  platform: HookPlatform,
): Promise<HookUninstallResult> {
  if (!SUPPORTED_HOOK_PLATFORMS.includes(platform)) {
    return { status: 'unsupported', platform, restored: false, reason: 'unsupported platform' };
  }
  const settingsPath = claudeSettingsPath(projectRoot);
  const guardPath = hookGuardPath(projectRoot);

  let backup: { existed: boolean; content: string | null; hash: string | null } | null = null;
  let installedHash: string | null = null;
  try {
    const parsed = JSON.parse(await fs.readFile(hookBackupPath(projectRoot, platform), 'utf8'));
    backup = parsed;
    installedHash = typeof parsed.installed_hash === 'string' ? parsed.installed_hash : null;
  } catch {
    backup = null;
  }

  let current: string | null = null;
  try {
    current = await fs.readFile(settingsPath, 'utf8');
  } catch {
    current = null;
  }

  // 优先逐字还原：只有当 settings.json 与我们安装时写入的内容完全一致（用户没再改过）才这么做。
  const untouched =
    backup !== null && installedHash !== null && current !== null && hashSpecText(current) === installedHash;
  if (untouched && backup && backup.existed === false) {
    await fs.rm(settingsPath, { force: true });
    await fs.rm(guardPath, { force: true });
    await fs.rm(hookBackupPath(projectRoot, platform), { force: true });
    return { status: 'removed', platform, restored: true, reason: 'removed（安装前不存在该文件）' };
  }
  if (untouched && backup && backup.existed === true && backup.content !== null) {
    await atomicWriteText(settingsPath, backup.content);
    await fs.rm(guardPath, { force: true });
    await fs.rm(hookBackupPath(projectRoot, platform), { force: true });
    return { status: 'removed', platform, restored: true, reason: 'removed（逐字还原安装前内容）' };
  }

  // 用户改过配置：只摘掉我们自己的条目，保留用户改动。
  const settings = await readSettings(settingsPath);
  const remaining = preToolUseOf(settings).filter((entry) => !isManagedEntry(entry));
  if (remaining.length === preToolUseOf(settings).length) {
    await fs.rm(guardPath, { force: true });
    return { status: 'noop', platform, restored: false, reason: '没有找到可摘除的条目' };
  }
  const nextHooks = { ...(settings.hooks as Record<string, unknown>) };
  if (remaining.length > 0) nextHooks.PreToolUse = remaining;
  else delete nextHooks.PreToolUse;
  const nextSettings: Record<string, unknown> = { ...settings };
  if (Object.keys(nextHooks).length > 0) nextSettings.hooks = nextHooks;
  else delete nextSettings.hooks;
  await atomicWriteText(settingsPath, JSON.stringify(nextSettings, null, 2) + '\n');
  await fs.rm(guardPath, { force: true });
  await fs.rm(hookBackupPath(projectRoot, platform), { force: true });
  return {
    status: 'removed',
    platform,
    restored: false,
    reason: 'removed（用户改过配置，仅摘除 CometFlow 条目）',
  };
}
