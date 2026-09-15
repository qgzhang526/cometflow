import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';
import { resolveCommand, type CommandResolution } from '../../platform/process/resolve-command.js';
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
/**
 * 覆盖 Claude Code 所有会落盘的内置工具。
 * `NotebookEdit` 也必须在内：它写的是 notebook，工具输入里叫 `notebook_path`
 * 而不是 `file_path`（两个字段名都实测存在于 2.1.237 的二进制里）。
 */
export const HOOK_MATCHER = 'Write|Edit|MultiEdit|NotebookEdit';

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
    '// 读取 stdin 必须带超时：有的平台不会在写完 payload 后关闭管道，',
    '// 而「读不到 EOF 就永远等」会让工具调用直接挂死。宁可拿不到路径就放行。',
    'const chunks = [];',
    'const readAll = (async () => {',
    '  for await (const chunk of process.stdin) chunks.push(chunk);',
    '})();',
    'await Promise.race([readAll, new Promise((resolve) => setTimeout(resolve, 1500))]);',
    'let payload = {};',
    'try {',
    "  payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');",
    '} catch {',
    '  process.exit(0); // 解析不了就放行：守卫不负责猜',
    '}',
    '',
    'const input = payload?.tool_input ?? payload?.toolInput ?? {};',
    'const target = input.file_path ?? input.filePath ?? input.notebook_path ?? input.path ?? null;',
    'if (typeof target !== "string" || target === "") process.exit(0);',
    '',
    'const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();',
    'const cli = process.env.COMETFLOW_CLI ?? "cometflow";',
    '',
    '// 不要写 spawnSync(cli, args, { shell: true })：shell 模式下 Node 只把参数用空格拼接，',
    '// 不做任何转义。项目路径里一旦有空格，参数会被切碎成好几段，守卫于是把一条**截断的**',
    '// 路径交给 CLI，判定退化成 outside-project 而静默放行——比不装 hook 更危险。',
    '// 因此 shell 模式下自己拼命令行并逐个加引号，顺带避开 Node 的 DEP0190 警告。',
    'const spawnOptions = { cwd: projectRoot, encoding: "utf8", timeout: 20000 };',
    'const cliArgs = ["hook", "check", target, projectRoot, "--event", "write"];',
    'let result;',
    'if (process.platform === "win32") {',
    '  const dq = String.fromCharCode(34); // 双引号：省掉这一层源码里的多重转义',
    '  const quote = (value) => dq + String(value).split(dq).join(dq + dq) + dq;',
    '  // CLI 自己也是命令行的第一个 token：`COMETFLOW_CLI` 若是带空格的裸路径',
    '  // （`C:\\Program Files\\...` 很常见），不引号同样会被空格切碎，',
    '  // 而「命令不存在」在这个脚本里是放行分支——最终仍是越界写入静默放行。',
    '  // 已经自带引号的值（例如 `node "C:/x/stub.mjs"`）原样使用，不再套一层。',
    '  const cliNeedsQuote = !cli.includes(dq) && /\\s/.test(cli);',
    '  const cliToken = cliNeedsQuote ? quote(cli) : cli;',
    '  // 不要再往整行外面套一层引号：`shell: true` 时 Node 自己已经加了一层，',
    '  // cmd 剥掉的是 Node 那层；多套一层反而会被切成 `"\\"C:...` 这类碎参数（实测）。',
    '  const commandLine = [cliToken, "hook", "check", quote(target), quote(projectRoot), "--event", "write"].join(" ");',
    '  result = spawnSync(commandLine, { ...spawnOptions, shell: true });',
    '} else {',
    '  result = spawnSync(cli, cliArgs, spawnOptions);',
    '}',
    '',
    '// CLI 不可用时放行（避免把开发环境锁死），但这个判定必须**窄**：误判成「CLI 不在」',
    '// 等于越界写入静默放行，比不装 hook 更危险。三个条件同时成立才算：',
    '// ① 进程起来了；② stdout 为空；③ stderr 是 shell 的「命令不存在」措辞。',
    '// 关键是 ②——CLI 只要真的判定过，就一定在 stdout 留下结论',
    '// （`hook check` 输出 `allowed` / `denied: <reason>`），所以真实判定永远落不进这个分支。',
    '// 只看 stderr 措辞是不够的：CLI 存在却因自身原因失败时，stderr 里也可能带这几个词。',
    'const stderrText = result.stderr ?? "";',
    'const missingCommandWording = /is not recognized as an internal or external command|不是内部或外部命令|command not found/.test(stderrText);',
    'const cliMissing = !result.error && (result.stdout ?? "").trim() === "" && missingCommandWording;',
    'if (result.error || cliMissing) process.exit(0);',
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
  /**
   * 已安装的守卫脚本内容与**当前生成器**的输出是否一致。
   *
   * 升级 `cometflow` 不会自动更新已经装进项目的守卫脚本；本轮修掉的「Windows 参数被空格切碎」
   * 正是生成器缺陷——装了旧版脚本的项目仍在静默放行，而今天没有任何地方能看出来。
   */
  guardOutdated: boolean;
  /**
   * 守卫实际会调用的 CLI（`COMETFLOW_CLI` 或 PATH 上的 `cometflow`）能否解析。
   *
   * 注意：这里读的是**当前进程**的环境变量。平台拉起守卫时的环境可能不同，
   * 所以这是「最接近的可观测代理」，不是等价物。
   */
  cli: CommandResolution;
}

export async function hookStatus(
  projectRoot: string,
  platform: HookPlatform,
): Promise<HookStatusResult> {
  const cliCommand = process.env.COMETFLOW_CLI ?? 'cometflow';
  const cli = resolveCommand(cliCommand, { cwd: projectRoot });
  const supported = SUPPORTED_HOOK_PLATFORMS.includes(platform);
  if (!supported) {
    return {
      platform,
      supported: false,
      installed: false,
      guardExists: false,
      settingsPath: null,
      entries: 0,
      drift: null,
      guardOutdated: false,
      cli,
    };
  }
  const settingsPath = claudeSettingsPath(projectRoot);
  const guardPath = hookGuardPath(projectRoot);
  let guardExists = true;
  let guardOutdated = false;
  try {
    const installed = await fs.readFile(guardPath, 'utf8');
    guardOutdated = hashSpecText(installed) !== hashSpecText(hookGuardSource());
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
    guardOutdated,
    cli,
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
