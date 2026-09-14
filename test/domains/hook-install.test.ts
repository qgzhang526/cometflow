import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claudeSettingsPath,
  hookGuardPath,
  hookStatus,
  installHook,
  uninstallHook,
} from '../../domains/guard/hook-install.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-hook-install-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function readSettings(): Promise<Record<string, any>> {
  return JSON.parse(await fs.readFile(claudeSettingsPath(tmp), 'utf8'));
}

describe('hook install (claude-code)', () => {
  it('installs the guard script and one PreToolUse entry', async () => {
    const result = await installHook(tmp, 'claude-code');
    expect(result.status).toBe('installed');

    const settings = await readSettings();
    const entries = settings.hooks.PreToolUse;
    expect(entries).toHaveLength(1);
    expect(entries[0].matcher).toBe('Write|Edit|MultiEdit');
    expect(entries[0].hooks[0].command).toContain('cometflow-guard.mjs');
    expect(entries[0].hooks[0].command).toContain('$CLAUDE_PROJECT_DIR');

    const guard = await fs.readFile(hookGuardPath(tmp), 'utf8');
    expect(guard).toContain('hook');
    expect(guard).toContain('exit(2)');
  });

  it('is idempotent and preserves unrelated user configuration', async () => {
    await fs.mkdir(path.dirname(claudeSettingsPath(tmp)), { recursive: true });
    await fs.writeFile(
      claudeSettingsPath(tmp),
      JSON.stringify(
        {
          permissions: { allow: ['Bash(ls:*)'] },
          hooks: {
            PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'echo user-hook' }] }],
            PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo post' }] }],
          },
        },
        null,
        2,
      ) + '\n',
    );

    await installHook(tmp, 'claude-code');
    await installHook(tmp, 'claude-code');

    const settings = await readSettings();
    const entries = settings.hooks.PreToolUse;
    expect(entries).toHaveLength(2);
    expect(entries.filter((entry: any) => entry.hooks[0].command.includes('cometflow-guard.mjs'))).toHaveLength(1);
    expect(entries.some((entry: any) => entry.hooks[0].command === 'echo user-hook')).toBe(true);
    expect(settings.permissions).toEqual({ allow: ['Bash(ls:*)'] });
    expect(settings.hooks.PostToolUse).toHaveLength(1);
  });

  it('restores the previous settings byte-for-byte when the user did not touch them', async () => {
    await fs.mkdir(path.dirname(claudeSettingsPath(tmp)), { recursive: true });
    const original = '{\n  "permissions": { "allow": ["Bash(ls:*)"] }\n}\n';
    await fs.writeFile(claudeSettingsPath(tmp), original);

    await installHook(tmp, 'claude-code');
    const result = await uninstallHook(tmp, 'claude-code');

    expect(result.status).toBe('removed');
    expect(result.restored).toBe(true);
    expect(await fs.readFile(claudeSettingsPath(tmp), 'utf8')).toBe(original);
    await expect(fs.access(hookGuardPath(tmp))).rejects.toThrow();
  });

  it('removes the file it created when there was no settings.json before', async () => {
    await installHook(tmp, 'claude-code');
    const result = await uninstallHook(tmp, 'claude-code');

    expect(result.restored).toBe(true);
    await expect(fs.access(claudeSettingsPath(tmp))).rejects.toThrow();
  });

  it('keeps user edits made after install and only removes its own entries', async () => {
    await installHook(tmp, 'claude-code');
    const settings = await readSettings();
    settings.permissions = { allow: ['Bash(git:*)'] };
    await fs.writeFile(claudeSettingsPath(tmp), JSON.stringify(settings, null, 2) + '\n');

    const result = await uninstallHook(tmp, 'claude-code');

    expect(result.status).toBe('removed');
    expect(result.restored).toBe(false);
    const after = await readSettings();
    expect(after.permissions).toEqual({ allow: ['Bash(git:*)'] });
    expect(after.hooks).toBeUndefined();
  });

  it('reports status, including drift when the guard script is missing', async () => {
    expect((await hookStatus(tmp, 'claude-code')).installed).toBe(false);

    await installHook(tmp, 'claude-code');
    expect((await hookStatus(tmp, 'claude-code')).installed).toBe(true);

    await fs.rm(hookGuardPath(tmp), { force: true });
    const drifted = await hookStatus(tmp, 'claude-code');
    expect(drifted.installed).toBe(false);
    expect(drifted.drift).toContain('守卫脚本缺失');
  });

  it('refuses to guess unsupported platform formats', async () => {
    for (const platform of ['opencode', 'codex'] as const) {
      const result = await installHook(tmp, platform);
      expect(result.status).toBe('unsupported');
      expect(result.reason).toContain('尚未支持');
      expect((await hookStatus(tmp, platform)).supported).toBe(false);
    }
  });
});
