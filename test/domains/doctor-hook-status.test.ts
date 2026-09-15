import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../../domains/dashboard/doctor.js';
import { hookGuardPath, hookStatus, installHook } from '../../domains/guard/hook-install.js';

const temporaryRoots: string[] = [];
let savedCli: string | undefined;

beforeEach(() => {
  savedCli = process.env.COMETFLOW_CLI;
  // 测试里把守卫要调的 CLI 固定成 node 本身：一定解析得到，且与是否装了 cometflow 无关。
  process.env.COMETFLOW_CLI = process.execPath;
});

afterEach(async () => {
  if (savedCli === undefined) delete process.env.COMETFLOW_CLI;
  else process.env.COMETFLOW_CLI = savedCli;
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-doctor-hook-'));
  temporaryRoots.push(root);
  await fs.writeFile(path.join(root, 'COMETFLOW.md'), '# mission\n');
  return root;
}

function hookFindings(report: Awaited<ReturnType<typeof runDoctor>>) {
  return report.findings.filter((finding) => finding.code.startsWith('hook-'));
}

function codeOf(report: Awaited<ReturnType<typeof runDoctor>>): string[] {
  return hookFindings(report).map((finding) => finding.code);
}

describe('doctor：hook 安装状态', () => {
  it('未安装 hook 的项目只给 info，不改变健康结论', async () => {
    const root = await makeProject();

    const report = await runDoctor(root);
    const findings = hookFindings(report);

    expect(findings.map((finding) => finding.code)).toEqual(['hook-not-installed']);
    expect(findings.every((finding) => finding.severity === 'info')).toBe(true);
  });

  it('安装且 CLI 可解析时报告 hook-installed', async () => {
    const root = await makeProject();
    await installHook(root, 'claude-code');

    const report = await runDoctor(root);

    expect(codeOf(report)).toEqual(['hook-installed']);
    expect(hookFindings(report)[0].severity).toBe('info');
  });

  it('条目还在但守卫脚本被删 → error hook-guard-missing（doctor 判定不健康）', async () => {
    const root = await makeProject();
    await installHook(root, 'claude-code');
    await fs.rm(hookGuardPath(root), { force: true });

    const report = await runDoctor(root);

    expect(codeOf(report)).toContain('hook-guard-missing');
    expect(hookFindings(report).some((finding) => finding.severity === 'error')).toBe(true);
    expect(report.healthy).toBe(false);
  });

  it('守卫脚本是旧版内容 → warning hook-guard-outdated', async () => {
    const root = await makeProject();
    await installHook(root, 'claude-code');
    await fs.writeFile(hookGuardPath(root), '#!/usr/bin/env node\n// 旧版守卫\n');

    const report = await runDoctor(root);
    const finding = hookFindings(report).find((entry) => entry.code === 'hook-guard-outdated');

    expect(finding?.severity).toBe('warning');
    // 旧版只报 warning，不该把项目判成不健康。
    expect(hookFindings(report).some((entry) => entry.severity === 'error')).toBe(false);
  });

  it('COMETFLOW_CLI 指向不存在的路径 → error hook-cli-missing', async () => {
    const root = await makeProject();
    await installHook(root, 'claude-code');
    process.env.COMETFLOW_CLI = path.join(root, 'gone', 'cometflow');

    const report = await runDoctor(root);
    const finding = hookFindings(report).find((entry) => entry.code === 'hook-cli-missing');

    expect(finding?.severity).toBe('error');
    // 关键语义：CLI 不可用时守卫会放行，所以这必须是 error 而不是提示。
    expect(finding?.message).toContain('放行');
    expect(report.healthy).toBe(false);
  });

  it('守卫脚本存在但配置里没有条目 → warning hook-entry-missing', async () => {
    const root = await makeProject();
    await installHook(root, 'claude-code');
    await fs.rm(path.join(root, '.claude', 'settings.json'), { force: true });

    const report = await runDoctor(root);

    expect(codeOf(report)).toContain('hook-entry-missing');
  });
});

describe('hookStatus：新增字段', () => {
  it('刚安装的守卫脚本不算过期', async () => {
    const root = await makeProject();
    await installHook(root, 'claude-code');

    const status = await hookStatus(root, 'claude-code');

    expect(status.installed).toBe(true);
    expect(status.guardOutdated).toBe(false);
    expect(status.cli.resolved).toBe(true);
  });

  it('内容被改过就报过期，且不影响 installed', async () => {
    const root = await makeProject();
    await installHook(root, 'claude-code');
    await fs.writeFile(hookGuardPath(root), '// stale\n');

    const status = await hookStatus(root, 'claude-code');

    expect(status.installed).toBe(true);
    expect(status.guardOutdated).toBe(true);
  });
});
