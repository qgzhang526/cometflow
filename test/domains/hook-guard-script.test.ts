import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { hookGuardPath, installHook } from '../../domains/guard/hook-install.js';

const IS_WINDOWS = process.platform === 'win32';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

interface Fixture {
  root: string;
  /** `COMETFLOW_CLI` 的值：Windows 上守卫会把它当命令行前缀，POSIX 上必须是可执行文件。 */
  cliCommand: string;
}

/**
 * 造一个「已安装写保护」的项目，外加一个假的 cometflow CLI。
 *
 * 假 CLI 只复刻 `cometflow hook check` 的对外契约（越界 → 非零退出码 + 一行原因），
 * 让这些用例专注于**守卫脚本本身**：stdin 怎么读、路径怎么传给 CLI、退出码怎么映射。
 * 判定规则本身由 hook-guard.test.ts 覆盖。
 */
async function makeFixture(prefix: string): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  await installHook(root, 'claude-code');

  const stub = path.join(root, 'stub-cli.mjs');
  await fs.writeFile(
    stub,
    [
      '#!/usr/bin/env node',
      "// 守卫调用形态：<cli> hook check <target> <projectRoot> --event write",
      "const args = process.argv.slice(2);",
      "const target = args[args.indexOf('check') + 1] ?? '';",
      "if (target.includes('rogue')) {",
      "  process.stdout.write('denied: outside-module-scope\\n');",
      '  process.exit(1);',
      '}',
      'process.exit(0);',
      '',
    ].join('\n'),
  );
  if (!IS_WINDOWS) await fs.chmod(stub, 0o755);

  return {
    root,
    cliCommand: IS_WINDOWS ? 'node "' + stub.replace(/\\/g, '/') + '"' : stub,
  };
}

function writePayload(projectRoot: string, filePath: string): string {
  return JSON.stringify({
    session_id: 'test-session',
    transcript_path: path.join(projectRoot, 'transcript.jsonl'),
    cwd: projectRoot,
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: 'export const login = 1;\n' },
  });
}

/**
 * 用**真实的 cometflow CLI** 造一个 fixture（而不是上面的假 CLI）：
 * 一个 build 阶段的 change，模块声明为 `src/auth`。这样守卫的判定链是完整的
 * `生成的守卫脚本 → 真实 CLI → evaluateHook`。
 *
 * CLI 直接用仓库源码跑（`tsx app/cli/index.ts`），因此不依赖 `dist/` 是否构建过。
 * 启动方式做成 shim：Windows 走 `node "<shim>"`，POSIX 直接执行 shim。
 */
async function makeRealCliFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-guard-real-'));
  temporaryRoots.push(root);

  const changeDir = path.join(root, 'changes', 'hook-demo');
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(
    path.join(changeDir, 'comet-state.yaml'),
    [
      'schema: cometflow.change.v1',
      'name: hook-demo',
      'goal: G1',
      'task: T1',
      'phase: build',
      'status: active',
      'spec_ref: specs/auth/spec.md',
      'spec_anchor: POST /api/auth/email-login',
      'acceptance_ids:',
      '  - A1',
      'spec_version: 1',
      'spec_hash: null',
      'spec_base_hash: null',
      'anchor_hash: null',
      'module: src/auth',
      'base_commit: null',
      'base_branch: null',
      'created_at: "2026-01-01T00:00:00.000Z"',
      'archived: false',
      '',
    ].join('\n'),
  );
  await installHook(root, 'claude-code');

  const shim = path.join(root, 'cli-shim.mjs');
  await fs.writeFile(
    shim,
    [
      '#!/usr/bin/env node',
      "import { spawnSync } from 'node:child_process';",
      'const tsx = ' + JSON.stringify(path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')) + ';',
      'const entry = ' + JSON.stringify(path.join(REPO_ROOT, 'app', 'cli', 'index.ts')) + ';',
      'const result = spawnSync(process.execPath, [tsx, entry, ...process.argv.slice(2)], { stdio: "inherit" });',
      'process.exit(result.status ?? 1);',
      '',
    ].join('\n'),
  );
  if (!IS_WINDOWS) await fs.chmod(shim, 0o755);

  return {
    root,
    cliCommand: IS_WINDOWS ? 'node "' + shim.replace(/\\/g, '/') + '"' : shim,
  };
}

interface GuardRun {
  code: number | null;
  stderr: string;
}

interface RunOptions {
  payload: string;
  /** 平台写完 payload 却不关管道：守卫不能因此挂死。 */
  keepStdinOpen?: boolean;
  cli?: string;
  projectRoot?: string;
}

/**
 * 直接执行 `hook install` 生成的那份守卫脚本。
 *
 * 测试对象是**落到用户项目里的产物**，不是生成它的 TypeScript——只有这样才能守住
 * 「生成的脚本在真实 payload 下真的拦得住」这类回归（stdin 阻塞、路径被空格切碎都属于这一类）。
 */
async function runGuard(fixture: Fixture, options: RunOptions): Promise<GuardRun> {
  const projectRoot = options.projectRoot ?? fixture.root;
  const child = spawn(process.execPath, [hookGuardPath(projectRoot)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectRoot,
      COMETFLOW_CLI: options.cli ?? fixture.cliCommand,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  child.stdin.write(options.payload);
  if (!options.keepStdinOpen) child.stdin.end();

  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('守卫没有在 6s 内退出（可能又阻塞在 stdin 上了）'));
    }, 6000);
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });

  return { code, stderr };
}

describe('生成的守卫脚本（端到端）', () => {
  it('越界写入以退出码 2 被拦下，并把原因写进 stderr', async () => {
    const fixture = await makeFixture('cometflow-guard-e2e-');
    const run = await runGuard(fixture, { payload: writePayload(fixture.root, 'rogue/outside.ts') });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain('CometFlow 阻止了这次写入：denied: outside-module-scope');
  });

  it('模块内写入放行，且不产生任何噪音', async () => {
    const fixture = await makeFixture('cometflow-guard-e2e-');
    const run = await runGuard(fixture, { payload: writePayload(fixture.root, 'src/auth/login.ts') });

    expect(run.code).toBe(0);
    expect(run.stderr).toBe('');
  });

  it('项目路径含空格时依然正确拦截（Windows 下参数不再被空格切碎）', async () => {
    const fixture = await makeFixture('cometflow hook space e2e-');
    expect(fixture.root).toContain(' ');

    // 绝对路径 + 反斜杠：真实会话里 `Write` 传的通常就是这个形态。
    const outOfScope = path.join(fixture.root, 'rogue', 'outside.ts');
    const blocked = await runGuard(fixture, { payload: writePayload(fixture.root, outOfScope) });
    expect(blocked.code).toBe(2);
    expect(blocked.stderr).toContain('denied: outside-module-scope');

    const inScope = await runGuard(fixture, {
      payload: writePayload(fixture.root, path.join(fixture.root, 'src', 'auth', 'login.ts')),
    });
    expect(inScope.code).toBe(0);
  });

  it('平台不关闭 stdin 时守卫也能退出，不会挂死工具调用', async () => {
    const fixture = await makeFixture('cometflow-guard-e2e-');
    const run = await runGuard(fixture, {
      payload: writePayload(fixture.root, 'rogue/outside.ts'),
      keepStdinOpen: true,
    });

    expect(run.code).toBe(2);
  }, 20000);

  it('payload 解析不了就放行（守卫不负责猜）', async () => {
    const fixture = await makeFixture('cometflow-guard-e2e-');
    const run = await runGuard(fixture, { payload: 'not json at all' });

    expect(run.code).toBe(0);
  });

  it('payload 里没有文件路径就放行', async () => {
    const fixture = await makeFixture('cometflow-guard-e2e-');
    const run = await runGuard(fixture, {
      payload: JSON.stringify({ tool_name: 'Write', tool_input: {} }),
    });

    expect(run.code).toBe(0);
  });

  it('兼容 toolInput.filePath 与 path 两种字段名', async () => {
    const fixture = await makeFixture('cometflow-guard-e2e-');

    const camel = await runGuard(fixture, {
      payload: JSON.stringify({ toolInput: { filePath: 'rogue/outside.ts' } }),
    });
    expect(camel.code).toBe(2);

    const plain = await runGuard(fixture, {
      payload: JSON.stringify({ toolInput: { path: 'rogue/outside.ts' } }),
    });
    expect(plain.code).toBe(2);
  });

  it('NotebookEdit 走 notebook_path 字段，同样拦得住', async () => {
    const fixture = await makeFixture('cometflow-guard-e2e-');
    const run = await runGuard(fixture, {
      payload: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'NotebookEdit',
        tool_input: { notebook_path: 'rogue/outside.ipynb', new_source: 'print(1)' },
      }),
    });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain('denied: outside-module-scope');
  });

  it('CLI 不可用时放行，避免把开发环境锁死', async () => {
    const fixture = await makeFixture('cometflow-guard-e2e-');
    const run = await runGuard(fixture, {
      payload: writePayload(fixture.root, 'rogue/outside.ts'),
      cli: 'definitely-not-a-real-cometflow-cli-xyz',
    });

    expect(run.code).toBe(0);
  });
});

describe('生成的守卫脚本 + 真实 cometflow CLI', () => {
  it(
    'build 阶段写模块外文件：守卫以退出码 2 拦下，并带上真实判定原因',
    async () => {
      const fixture = await makeRealCliFixture();
      const run = await runGuard(fixture, {
        payload: writePayload(fixture.root, path.join(fixture.root, 'rogue', 'outside.ts')),
      });

      expect(run.code).toBe(2);
      expect(run.stderr).toContain('CometFlow 阻止了这次写入：denied: outside-module-scope');
    },
    40000,
  );

  it(
    'build 阶段写声明模块内文件：守卫放行',
    async () => {
      const fixture = await makeRealCliFixture();
      const run = await runGuard(fixture, {
        payload: writePayload(fixture.root, path.join(fixture.root, 'src', 'auth', 'login.ts')),
      });

      expect(run.code).toBe(0);
      expect(run.stderr).toBe('');
    },
    40000,
  );
});
