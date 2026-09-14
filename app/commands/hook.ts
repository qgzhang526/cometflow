import path from 'node:path';
import { evaluateHook, type HookEvent } from '../../domains/guard/hook-guard.js';
import {
  HOOK_PLATFORMS,
  hookStatus,
  installHook,
  uninstallHook,
  type HookPlatform,
} from '../../domains/guard/hook-install.js';

export async function hookCheckCommand(targetPath: string, options: { event: string; target: string }): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const decision = await evaluateHook(projectRoot, options.event as HookEvent, path.resolve(options.target));
  console.log(decision.allowed ? "allowed" : "denied" + ": " + decision.reason);
  if (!decision.allowed) process.exitCode = 1;
}

function parsePlatform(value: string): HookPlatform {
  if (!(HOOK_PLATFORMS as readonly string[]).includes(value)) {
    throw new Error('unknown platform: ' + value + '（支持：' + HOOK_PLATFORMS.join(', ') + '）');
  }
  return value as HookPlatform;
}

export async function hookInstallCommand(
  targetPath: string,
  options: { platform?: string },
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  if (!options.platform) throw new Error('缺少 --platform（支持：' + HOOK_PLATFORMS.join(', ') + '）');
  const result = await installHook(projectRoot, parsePlatform(options.platform));
  if (result.status !== 'installed') {
    console.error(result.status + ': ' + result.reason);
    process.exitCode = 1;
    return;
  }
  console.log('installed ' + result.platform + ' hook');
  console.log('  settings: ' + result.settingsPath);
  console.log('  guard:    ' + result.guardPath);
  console.log('  提示：platform hook 会调用 `cometflow hook check`，确保 cometflow 在 PATH 上（或用 COMETFLOW_CLI 指定）');
}

export async function hookStatusCommand(
  targetPath: string,
  options: { platform?: string; json?: boolean },
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const platforms: HookPlatform[] = options.platform
    ? [parsePlatform(options.platform)]
    : [...HOOK_PLATFORMS];
  const results = [];
  for (const platform of platforms) results.push(await hookStatus(projectRoot, platform));

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  for (const entry of results) {
    console.log(
      [
        entry.platform,
        entry.supported ? (entry.installed ? 'installed' : 'not-installed') : 'unsupported',
        'entries=' + entry.entries,
        entry.drift ?? '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }
  if (results.some((entry) => entry.drift !== null)) process.exitCode = 1;
}

export async function hookUninstallCommand(
  targetPath: string,
  options: { platform?: string },
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  if (!options.platform) throw new Error('缺少 --platform（支持：' + HOOK_PLATFORMS.join(', ') + '）');
  const result = await uninstallHook(projectRoot, parsePlatform(options.platform));
  console.log(result.status + ': ' + result.reason + (result.restored ? '（已逐字还原）' : ''));
  if (result.status === 'unsupported') process.exitCode = 1;
}
