import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  gitHookBackupPath,
  gitHookPath,
  gitHookStatus,
  installGitHook,
  uninstallGitHook,
} from '../../domains/gates/git-hook.js';

const temporaryRoots: string[] = [];
const GIT_IDENTITY = ['-c', 'user.email=cf@example.com', '-c', 'user.name=cf'];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

async function makeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-githook-'));
  temporaryRoots.push(root);
  const init = git(root, ['init', '-q', '.']);
  if (init.status !== 0) throw new Error('git init 失败：' + (init.stderr ?? ''));
  const commit = git(root, [...GIT_IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'init']);
  if (commit.status !== 0) throw new Error('git commit 失败：' + (commit.stderr ?? ''));
  return root;
}

async function hooksDirOf(root: string): Promise<string> {
  const status = await gitHookStatus(root);
  return status.hooksDir!;
}

describe('git 提交门禁的安装与卸载', () => {
  it('安装后 status 报已安装，且 hook 带标记与 LF 换行', async () => {
    const root = await makeRepo();

    const result = await installGitHook(root);
    const status = await gitHookStatus(root);
    const content = await fs.readFile(gitHookPath(await hooksDirOf(root)), 'utf8');

    expect(result.status).toBe('installed');
    expect(result.chained).toBe(false);
    expect(status.installed).toBe(true);
    expect(status.drifted).toBe(false);
    expect(content).toContain('cometflow-git-gate');
    // Windows 上 CRLF 会让 `#!/bin/sh` 失效，hook 静默不生效。
    expect(content.includes('\r')).toBe(false);
  });

  it('已有 pre-commit 时先备份再链式调用，卸载逐字还原', async () => {
    const root = await makeRepo();
    const hooksDir = await hooksDirOf(root);
    const original = '#!/bin/sh\necho original > original-ran.txt\nexit 0\n';
    await fs.mkdir(hooksDir, { recursive: true });
    await fs.writeFile(gitHookPath(hooksDir), original);

    const installed = await installGitHook(root);
    expect(installed.chained).toBe(true);
    expect(await fs.readFile(gitHookBackupPath(hooksDir), 'utf8')).toBe(original);

    const removed = await uninstallGitHook(root);
    expect(removed.restored).toBe(true);
    expect(await fs.readFile(gitHookPath(hooksDir), 'utf8')).toBe(original);
    await expect(fs.access(gitHookBackupPath(hooksDir))).rejects.toThrow();
  });

  it('安装前没有 pre-commit 时，卸载把文件删掉', async () => {
    const root = await makeRepo();
    const hooksDir = await hooksDirOf(root);
    await installGitHook(root);

    const removed = await uninstallGitHook(root);

    expect(removed.restored).toBe(true);
    await expect(fs.access(gitHookPath(hooksDir))).rejects.toThrow();
  });

  it('重复安装不会把自家包装脚本当成用户的 hook 备份', async () => {
    const root = await makeRepo();
    const hooksDir = await hooksDirOf(root);
    await installGitHook(root);
    await installGitHook(root);

    await expect(fs.access(gitHookBackupPath(hooksDir))).rejects.toThrow();
    expect((await gitHookStatus(root)).installed).toBe(true);
  });

  it('hook 被改过之后 status 报漂移，卸载不覆盖用户改动', async () => {
    const root = await makeRepo();
    const hooksDir = await hooksDirOf(root);
    await installGitHook(root);
    await fs.writeFile(gitHookPath(hooksDir), '#!/bin/sh\n# cometflow-git-gate\n# 用户改过\n');

    const status = await gitHookStatus(root);
    const removed = await uninstallGitHook(root);

    expect(status.installed).toBe(true);
    expect(status.drifted).toBe(true);
    expect(removed.status).toBe('modified');
    expect(removed.restored).toBe(false);
    // 用户改动仍在。
    expect(await fs.readFile(gitHookPath(hooksDir), 'utf8')).toContain('用户改过');
  });

  it('不是 git 仓库时明确拒绝，而不是写到别处', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-githook-nogit-'));
    temporaryRoots.push(root);

    const installed = await installGitHook(root);
    const status = await gitHookStatus(root);

    expect(installed.status).toBe('skipped');
    expect(installed.reason).toContain('不是 git 仓库');
    expect(status.isRepository).toBe(false);
  });
});

describe('git 提交门禁真的会拦提交', () => {
  it('门禁失败 → commit 被拒；门禁通过 → commit 成功，且原有 hook 先跑过', async () => {
    const root = await makeRepo();
    const hooksDir = await hooksDirOf(root);
    await fs.mkdir(hooksDir, { recursive: true });
    await fs.writeFile(
      gitHookPath(hooksDir),
      '#!/bin/sh\necho ran > original-ran.txt\nexit 0\n',
    );
    await installGitHook(root);

    // 用一个真实的 stub 顶替 cometflow：门禁结论由 STUB_GATE_STATUS 控制，
    // 这样测的是「hook 有没有正确接线」，而不是门禁判定本身。
    const stub = path.join(root, 'gate-stub.mjs');
    await fs.writeFile(
      stub,
      'const fail = process.env.STUB_GATE_STATUS === "1";\nprocess.exit(fail ? 1 : 0);\n',
    );
    const env = {
      ...process.env,
      COMETFLOW_CLI: 'node "' + stub.replace(/\\/g, '/') + '"',
      STUB_GATE_STATUS: '1',
    };

    const blocked = spawnSync('git', [...GIT_IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'blocked'], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    expect(blocked.status).not.toBe(0);

    const allowed = spawnSync('git', [...GIT_IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'allowed'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, STUB_GATE_STATUS: '0' },
    });
    expect(allowed.status).toBe(0);
    expect(await fs.readFile(path.join(root, 'original-ran.txt'), 'utf8')).toContain('ran');
  }, 30000);
});

/** husky v9 的布局：hooksPath 指向自动生成的 `_`，真正属于用户的是 `.husky/pre-commit`。 */
async function makeHuskyRepo(): Promise<string> {
  const root = await makeRepo();
  const huskyDir = path.join(root, '.husky');
  await fs.mkdir(path.join(huskyDir, '_'), { recursive: true });
  const shim = path.join(huskyDir, '_', 'pre-commit');
  await fs.writeFile(shim, '#!/bin/sh\nexec sh "$(dirname "$0")/../pre-commit" "$@"\n');
  // POSIX 上 git 只执行**有可执行位**的 hook：少了这一步，Linux 上 git 会静默跳过它
  // （只在 stderr 留一句 hint），于是「应该被拦下」的提交照样成功——CI 上就是这么红的。
  await fs.chmod(shim, 0o755);
  git(root, ['config', 'core.hooksPath', '.husky/_']);
  return root;
}

const HUSKY_USER_HOOK = '#!/bin/sh\necho user > user-hook-ran.txt\n';

describe('husky 集成', () => {
  it('写进 .husky/pre-commit 的托管块，保留用户内容，status 报 husky', async () => {
    const root = await makeHuskyRepo();
    await fs.writeFile(path.join(root, '.husky', 'pre-commit'), HUSKY_USER_HOOK);

    const result = await installGitHook(root);
    const status = await gitHookStatus(root);
    const content = await fs.readFile(path.join(root, '.husky', 'pre-commit'), 'utf8');

    expect(result.host).toBe('husky');
    expect(status.host).toBe('husky');
    expect(status.installed).toBe(true);
    expect(status.drifted).toBe(false);
    expect(content).toContain(HUSKY_USER_HOOK.trim());
    expect(content).toContain('cometflow-git-gate:start');
    expect(content.includes('\r')).toBe(false);
  });

  it('重复安装只留一个托管块', async () => {
    const root = await makeHuskyRepo();
    await fs.writeFile(path.join(root, '.husky', 'pre-commit'), HUSKY_USER_HOOK);

    await installGitHook(root);
    await installGitHook(root);

    const content = await fs.readFile(path.join(root, '.husky', 'pre-commit'), 'utf8');
    expect(content.split('cometflow-git-gate:start')).toHaveLength(2);
  });

  it('卸载逐字还原用户的 .husky/pre-commit', async () => {
    const root = await makeHuskyRepo();
    const hookPath = path.join(root, '.husky', 'pre-commit');
    await fs.writeFile(hookPath, HUSKY_USER_HOOK);
    await installGitHook(root);

    const removed = await uninstallGitHook(root);

    expect(removed.status).toBe('removed');
    expect(removed.restored).toBe(true);
    expect(await fs.readFile(hookPath, 'utf8')).toBe(HUSKY_USER_HOOK);
  });

  it('装进 husky 的位置之后，commit 真的会被拦下（走 husky 的 shim）', async () => {
    const root = await makeHuskyRepo();
    await fs.writeFile(path.join(root, '.husky', 'pre-commit'), HUSKY_USER_HOOK);
    await installGitHook(root);

    const stub = path.join(root, 'gate-stub.mjs');
    await fs.writeFile(
      stub,
      'const fail = process.env.STUB_GATE_STATUS === "1";\nprocess.exit(fail ? 1 : 0);\n',
    );
    const env = {
      ...process.env,
      COMETFLOW_CLI: 'node "' + stub.replace(/\\/g, '/') + '"',
      STUB_GATE_STATUS: '1',
    };

    const blocked = spawnSync('git', [...GIT_IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'blocked'], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    expect(blocked.status).not.toBe(0);

    const allowed = spawnSync('git', [...GIT_IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'allowed'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, STUB_GATE_STATUS: '0' },
    });
    expect(allowed.status).toBe(0);
    // 用户自己的 hook 仍然执行。
    expect(await fs.readFile(path.join(root, 'user-hook-ran.txt'), 'utf8')).toContain('user');
  }, 30000);
});

const LEFTHOOK_YML = [
  '# 团队约定：提交前先跑 lint',
  'pre-commit:',
  '  commands:',
  '    lint:',
  '      run: npm run lint',
  '',
].join('\n');

describe('lefthook 集成', () => {
  it('往 lefthook.yml 插一条命令，注释与其它 task 保留', async () => {
    const root = await makeRepo();
    const ymlPath = path.join(root, 'lefthook.yml');
    await fs.writeFile(ymlPath, LEFTHOOK_YML);

    const result = await installGitHook(root);
    const status = await gitHookStatus(root);
    const content = await fs.readFile(ymlPath, 'utf8');

    expect(result.host).toBe('lefthook');
    expect(status.host).toBe('lefthook');
    expect(status.installed).toBe(true);
    expect(content).toContain('# 团队约定：提交前先跑 lint');
    expect(content).toContain('run: npm run lint');
    expect(content).toContain('cometflow-gate:');
    expect(content.indexOf('cometflow-gate:')).toBeLessThan(content.indexOf('lint:'));
  });

  it('重复安装幂等，卸载逐字还原', async () => {
    const root = await makeRepo();
    const ymlPath = path.join(root, 'lefthook.yml');
    await fs.writeFile(ymlPath, LEFTHOOK_YML);

    await installGitHook(root);
    await installGitHook(root);
    expect((await fs.readFile(ymlPath, 'utf8')).split('cometflow-gate:')).toHaveLength(2);

    const removed = await uninstallGitHook(root);
    expect(removed.restored).toBe(true);
    expect(await fs.readFile(ymlPath, 'utf8')).toBe(LEFTHOOK_YML);
  });

  it('结构不受支持（extends）时明确拒绝，且不改文件', async () => {
    const root = await makeRepo();
    const ymlPath = path.join(root, 'lefthook.yml');
    const original = 'pre-commit:\n  extends: ./base.yml\n';
    await fs.writeFile(ymlPath, original);

    const result = await installGitHook(root);

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('手工加入');
    expect(await fs.readFile(ymlPath, 'utf8')).toBe(original);
  });

  it('用户改过文件后卸载只摘托管块，不覆盖用户改动', async () => {
    const root = await makeRepo();
    const ymlPath = path.join(root, 'lefthook.yml');
    await fs.writeFile(ymlPath, LEFTHOOK_YML);
    await installGitHook(root);
    await fs.appendFile(ymlPath, '    types:\n      run: npm run typecheck\n');

    const removed = await uninstallGitHook(root);
    const content = await fs.readFile(ymlPath, 'utf8');

    expect(removed.restored).toBe(false);
    expect(content).not.toContain('cometflow-gate:');
    expect(content).toContain('npm run typecheck');
    expect(content).toContain('# 团队约定');
  });
});
