#!/usr/bin/env node
/**
 * 跨平台回归执行器。
 *
 * 与 `experiments/regression-fixture/run-regression.sh` 等价，但用 Node 实现：
 * bash 版只能在 Linux/macOS 跑，而这个项目的主要开发环境是 Windows，
 * 「本地跑不了、只能等 CI」是回归脚本最容易失效的方式。
 *
 * 只读检查直接在 fixture 上跑；所有会写文件的步骤都在临时副本里跑，
 * 保证仓库里的 fixture 状态（作为提交基线）不被污染。
 *
 * 用法：node scripts/regression.mjs [fixturePath]
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ROOT, runSpecGates } from './spec-gates.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(ROOT, process.argv[2] ?? path.join('experiments', 'regression-fixture'));
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = path.join(ROOT, 'app', 'cli', 'index.ts');
const GIT_IDENTITY = ['-c', 'user.email=cf@example.com', '-c', 'user.name=cf'];

let failures = 0;
let steps = 0;

function cli(args, options = {}) {
  const result = spawnSync(process.execPath, [TSX, CLI, ...args], {
    cwd: options.cwd ?? FIXTURE,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if ((result.status ?? 1) !== 0) {
    throw new Error('git ' + args.join(' ') + ' failed: ' + (result.stderr ?? ''));
  }
  return (result.stdout ?? '').trim();
}

/** 断言某条 CLI 调用成功。 */
function expectOk(label, args, cwd) {
  steps += 1;
  const result = cli(args, { cwd });
  if (result.code !== 0) {
    failures += 1;
    console.error('FAIL ' + label);
    console.error((result.stdout + result.stderr).trim());
  }
  return result;
}

/**
 * 断言某条 CLI 调用失败，并且失败原因符合预期。
 *
 * 只断言「非零退出」是不够的：一个命令可能因为完全无关的理由失败
 * （例如阶段不对），那样门禁其实是坏的却看起来通过了。
 */
function expectDenied(label, args, cwd, marker = null) {
  steps += 1;
  const result = cli(args, { cwd });
  const output = result.stdout + result.stderr;
  if (result.code === 0) {
    failures += 1;
    console.error('FAIL ' + label + '（期望被拒绝，但成功了）');
  } else if (marker !== null && !output.includes(marker)) {
    failures += 1;
    console.error(
      'FAIL ' + label + '（拒绝原因不含 "' + marker + '"）：' + output.trim().slice(0, 300),
    );
  }
  return result;
}

function check(label, condition, detail = '') {
  steps += 1;
  if (!condition) {
    failures += 1;
    console.error('FAIL ' + label + (detail ? ' — ' + detail : ''));
  }
}

function fileContains(file, needle) {
  try {
    return readFileSync(file, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

/** Windows 上刚跑过 git / 子进程的目录会被句柄短暂占用。 */
function removeWithRetry(directory) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error?.code ?? '';
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY', 'EMFILE'].includes(code)) throw error;
      const until = Date.now() + 25 * (attempt + 1);
      while (Date.now() < until) {
        // 同步等待：这个脚本是串行执行器，不需要异步调度。
      }
    }
  }
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch {
    console.error('WARN 无法删除临时目录：' + directory);
  }
}

console.log('== read-only checks on ' + FIXTURE + ' ==');
const gates = runSpecGates(FIXTURE);
for (const entry of gates.results) {
  steps += 1;
  if (!entry.ok) {
    failures += 1;
    console.error('FAIL ' + entry.name + (entry.detail ? ' — ' + entry.detail : ''));
  }
}

// 引用关系图（N1）：fixture 现在带跨文件引用，图上必须能解析出这些边，且没有未解析项。
// 只做投影、不设退出码——门禁仍归 spec validate（这里同时用它交叉验证「图与门禁同源」）。
{
  const graphResult = cli(['spec', 'graph', '.', '--json']);
  check(
    'spec graph --json 可解析',
    graphResult.code === 0,
    (graphResult.stdout + graphResult.stderr).trim().slice(0, 200),
  );
  let graph = null;
  try {
    graph = JSON.parse(graphResult.stdout);
  } catch {
    graph = null;
  }
  check('spec graph 产出规范投影', graph?.schema === 'cometflow.spec-graph.v1');
  if (graph) {
    check('graph 无未解析引用', graph.summary.unresolved === 0, JSON.stringify(graph.unresolved.slice(0, 3)));
    const kindEdges = new Set(
      graph.edges
        .filter((edge) => edge.level === 'reference' && edge.from.startsWith('kind:'))
        .map((edge) => edge.from + '->' + edge.to),
    );
    for (const expected of [
      'kind:capability->kind:models',
      'kind:capability->kind:errors',
      'kind:capability->kind:protocol',
      'kind:flow->kind:capability',
      'kind:flow->kind:models',
      'kind:flow->kind:config',
      'kind:rules->kind:models',
    ]) {
      check('graph 含引用边 ' + expected, kindEdges.has(expected));
    }
    const targetIds = new Set(graph.nodes.filter((node) => node.level === 'target').map((node) => node.id));
    check('graph 含实体目标 Session', targetIds.has('target:model:Session'));
    check('graph 含接口目标 GET /session', targetIds.has('target:api:GET /session'));
    // 同源断言：图说「没有未解析引用」时，validate 侧也不应有 unresolved-* finding。
    const validateResult = cli(['spec', 'validate', '.']);
    check(
      'graph 与 spec validate 同源（无 unresolved-* finding）',
      !(validateResult.stdout + validateResult.stderr).includes('unresolved-'),
    );
  }
}

console.log('== mutating checks in a temp copy ==');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cometflow-regression-'));
const project = path.join(tempRoot, 'fixture');
cpSync(FIXTURE, project, { recursive: true });
process.on('exit', () => removeWithRetry(tempRoot));

// spec kind scaffolding：删掉一个 present 的 kind，再补回来（幂等）
const modelsPath = path.join(project, 'specs', 'models.md');
const modelsBefore = readFileSync(modelsPath, 'utf8');
rmSync(path.join(project, 'specs', 'constraints.md'), { force: true });
expectOk('spec scaffold', ['spec', 'scaffold', '.'], project);
check('scaffold 重建 constraints.md', existsSync(path.join(project, 'specs', 'constraints.md')));
// 脚手架是幂等的：已存在的文件不能被覆盖（fixture 里 models.md 现在是 present kind，带交叉引用内容）
check('scaffold 不覆盖已存在的 models.md', readFileSync(modelsPath, 'utf8') === modelsBefore);

expectOk('spec index', ['spec', 'index', '.'], project);
check('spec index 产出 apis.yaml', existsSync(path.join(project, '.cometflow', 'spec-index', 'apis.yaml')));

expectOk('plan generate G3', ['plan', 'generate', 'G3', '.'], project);
expectOk('plan validate G3', ['plan', 'validate', 'G3', '.'], project);
expectOk('plan freeze G3', ['plan', 'freeze', 'G3', '.'], project);

expectOk('eval', ['eval', '.'], project);
expectOk('skill add', ['skill', 'add', 'skills/safe-skill', '--project', '.'], project);
expectOk('skill list', ['skill', 'list', '--project', '.'], project);
expectOk('skill import', ['skill', 'import', 'skills/risky-skill', 'risky-skill', '--project', '.'], project);

expectOk('bundle compile', ['bundle', 'compile', '.'], project);
for (const platform of ['opencode', 'claude-code', 'codex']) {
  expectOk('bundle distribute ' + platform, ['bundle', 'distribute', '.', '--platform', platform], project);
}

expectOk('change run build-change', ['change', 'run', 'build-change', '.', '--agent', 'mock'], project);
expectOk('change verify verify-change', ['change', 'verify', 'verify-change', '.'], project);
expectOk('change archive archive-change', ['change', 'archive', 'archive-change', '.'], project);

// 两阶段迁移：正常提交后不应残留 pending 记录
check(
  'shape-change 无残留 pending',
  !existsSync(path.join(project, '.cometflow', 'runtime', 'changes', 'shape-change', 'transition-pending.json')),
);
expectOk('change transition shape-change', ['change', 'transition', 'shape-change', 'confirm-acceptance', '.'], project);
check(
  '迁移完成后 pending 被清除',
  !existsSync(path.join(project, '.cometflow', 'runtime', 'changes', 'shape-change', 'transition-pending.json')),
);
expectOk('spec verify（迁移后）', ['spec', 'verify', '.'], project);

// A 独立验证默认化：用 mock 固定住「Verifier 真的被调用」这条路径（本机/CI 是否装了
// opencode、claude 会影响默认解析结果，所以这里显式指定 agent，保证回归跨环境确定）。
// mock 返回的不是可解析的验证 YAML → 结论无效，但判定仍由 check 决定（checks+agent 下 check 优先）。
expectOk('change new agent-policy-demo', ['change', 'new', 'agent-policy-demo', '--goal', 'G1', '--task', 'T1', '--path', '.'], project);
expectOk('agent-policy-demo -> build', ['change', 'transition', 'agent-policy-demo', 'confirm-acceptance', '.'], project);
expectOk('agent-policy-demo -> verify', ['change', 'transition', 'agent-policy-demo', 'submit-candidate', '.'], project);
expectOk(
  'checks+agent 调用 Verifier 后仍按 check 判定',
  ['change', 'verify', 'agent-policy-demo', '.', '--mode', 'checks+agent', '--agent', 'mock'],
  project,
);
check(
  'verification.md 记录 Verifier 与耗时（成本记账）',
  fileContains(path.join(project, 'changes', 'agent-policy-demo', 'verification.md'), 'verifier: mock') &&
    fileContains(path.join(project, 'changes', 'agent-policy-demo', 'verification.md'), 'verifier_ms:'),
);
check(
  'verification.md 记录 verifier_policy',
  fileContains(path.join(project, 'changes', 'agent-policy-demo', 'verification.md'), 'verifier_policy: warn'),
);
check(
  '结论仍来自 check（Verifier 未产出可解析结论时不改变判定）',
  fileContains(path.join(project, 'changes', 'agent-policy-demo', 'verification.md'), 'A1: passed [check]'),
);

// 证据回收：apply 只能删 runtime 下可推导的内容
expectOk('change gc dry-run', ['change', 'gc', '.', '--json'], project);
expectOk('change gc apply', ['change', 'gc', '.', '--apply'], project);
expectOk('doctor --clean-temp', ['doctor', '.', '--clean-temp'], project);
check(
  'gc 之后 journal 仍在',
  existsSync(path.join(project, '.cometflow', 'runtime', 'changes', 'archive-change', 'journal.jsonl')),
);
expectOk('spec verify（gc 后）', ['spec', 'verify', '.'], project);

// 有界修复循环：改坏实现 → 连续同一失败结论 → 停机 → 解封
const authIndex = path.join(project, 'src', 'auth', 'index.ts');
const authBackup = path.join(tempRoot, 'auth-index.bak');
cpSync(authIndex, authBackup);
writeFileSync(authIndex, 'export function login(): boolean {\n  return false;\n}\n', 'utf8');
expectOk('change new stall-demo', ['change', 'new', 'stall-demo', '--goal', 'G2', '--task', 'T1', '--path', '.'], project);
expectOk('stall-demo -> build', ['change', 'transition', 'stall-demo', 'confirm-acceptance', '.'], project);
for (let attempt = 0; attempt < 3; attempt += 1) {
  expectOk('stall-demo -> verify', ['change', 'transition', 'stall-demo', 'submit-candidate', '.'], project);
  expectDenied(
    'stall-demo verify 应失败',
    ['change', 'verify', 'stall-demo', '.'],
    project,
    'reportPassed=false',
  );
}
check(
  'stall-demo 达到上限后 blocked',
  fileContains(path.join(project, 'changes', 'stall-demo', 'comet-state.yaml'), 'status: blocked'),
);
expectDenied(
  'blocked 的 change 不能 run',
  ['change', 'run', 'stall-demo', '.', '--agent', 'mock'],
  project,
  'is blocked',
);
expectOk('change unblock', ['change', 'unblock', 'stall-demo', '.', '--note', 'regression: reset the loop'], project);
check(
  'unblock 后恢复 active',
  fileContains(path.join(project, 'changes', 'stall-demo', 'comet-state.yaml'), 'status: active'),
);
cpSync(authBackup, authIndex);

// git 来源绑定：分叉到无关历史后必须阻断，显式放行才继续
git(['init', '-q', '.'], project);
git([...GIT_IDENTITY, 'add', '-A'], project);
git([...GIT_IDENTITY, 'commit', '-qm', 'regression baseline'], project);
expectOk('change new git-demo', ['change', 'new', 'git-demo', '--goal', 'G2', '--task', 'T1', '--path', '.'], project);
// run/verify/archive 需要 build 阶段；少了这一步，「被阻断」会因为阶段不对而误判为通过。
expectOk('git-demo -> build', ['change', 'transition', 'git-demo', 'confirm-acceptance', '.'], project);
git([...GIT_IDENTITY, 'checkout', '-q', '--orphan', 'unrelated'], project);
git([...GIT_IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'unrelated history'], project);
expectDenied(
  'git 漂移后 run 应被阻断',
  ['change', 'run', 'git-demo', '.', '--agent', 'mock'],
  project,
  'git provenance drift',
);
expectOk('--allow-drift 放行', ['change', 'run', 'git-demo', '.', '--agent', 'mock', '--allow-drift'], project);

expectOk('classic status', ['classic', 'status', 'classic-open', '.'], project);
for (const event of ['open-complete', 'design-complete', 'build-complete', 'verify-pass', 'archive-complete']) {
  expectOk('classic ' + event, ['classic', 'transition', 'classic-open', event, '.'], project);
}

expectOk('daemon manual run', ['daemon', 'start', '.', '--mode', 'manual', '--budget', '1', '--safety-bundle'], project);

// hook guard：有指针时按指针路由，没有指针时必须 fail closed
// B hook 接线：安装后写入平台配置，卸载后逐字还原
expectOk('hook status（安装前）', ['hook', 'status', '.', '--json'], project);
expectOk('hook install claude-code', ['hook', 'install', '.', '--platform', 'claude-code'], project);
check(
  'claude settings 含 PreToolUse 条目',
  fileContains(path.join(project, '.claude', 'settings.json'), 'cometflow-guard.mjs'),
);
expectDenied(
  'opencode 缺少可依据的格式，显式拒绝',
  ['hook', 'install', '.', '--platform', 'opencode'],
  project,
  '尚未支持',
);
expectOk('hook uninstall claude-code', ['hook', 'uninstall', '.', '--platform', 'claude-code'], project);
check('卸载后 settings.json 被还原（安装前不存在）', !existsSync(path.join(project, '.claude', 'settings.json')));

expectOk('change select stall-demo', ['change', 'select', 'stall-demo', '.'], project);
expectOk(
  '指针路由允许模块内写入',
  ['hook', 'check', path.join('src', 'auth', 'index.ts'), '.', '--event', 'write'],
  project,
);

// 上面几步只跑 `hook check`（判定函数）。这里再跑一遍**装进项目的那份守卫脚本**：
// stdin → 取路径 → 调 CLI → 退出码 2。Windows 上「参数被空格切碎」和「平台不关 stdin
// 就永久阻塞」这两个缺陷都曾在这里静默放行（配置看着装好了，实际从不生效），所以这段别删。
expectOk('hook install（复装，供守卫脚本回归）', ['hook', 'install', '.', '--platform', 'claude-code'], project);
const guardShim = path.join(project, 'guard-cli-shim.mjs');
writeFileSync(
  guardShim,
  [
    '#!/usr/bin/env node',
    "import { spawnSync } from 'node:child_process';",
    'const result = spawnSync(process.execPath, ' +
      JSON.stringify([TSX, CLI]) +
      '.concat(process.argv.slice(2)), { stdio: "inherit" });',
    'process.exit(result.status ?? 1);',
    '',
  ].join('\n'),
);
if (process.platform !== 'win32') chmodSync(guardShim, 0o755);
const guardCli = process.platform === 'win32' ? 'node "' + guardShim + '"' : guardShim;
const guardScript = path.join(project, '.claude', 'hooks', 'cometflow-guard.mjs');
function runGuardScript(filePath) {
  return spawnSync(process.execPath, [guardScript], {
    cwd: project,
    encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: filePath, content: 'export const x = 1;\n' },
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, COMETFLOW_CLI: guardCli },
    timeout: 60000,
  });
}
const guardBlocked = runGuardScript(path.join(project, 'rogue', 'outside.ts'));
check(
  '守卫脚本以退出码 2 拦下模块外写入',
  guardBlocked.status === 2 && (guardBlocked.stderr ?? '').includes('outside-module-scope'),
  'status=' + guardBlocked.status + ' stderr=' + (guardBlocked.stderr ?? '').trim().slice(0, 200),
);
const guardAllowed = runGuardScript(path.join(project, 'src', 'auth', 'index.ts'));
check(
  '守卫脚本放行模块内写入',
  guardAllowed.status === 0 && (guardAllowed.stderr ?? '') === '',
  'status=' + guardAllowed.status + ' stderr=' + (guardAllowed.stderr ?? '').trim().slice(0, 200),
);

expectOk('change select --clear', ['change', 'select', 'stall-demo', '.', '--clear'], project);
expectDenied(
  '无指针时拒绝归属不明的写入',
  ['hook', 'check', path.join('src', 'auth', 'index.ts'), '.', '--event', 'write'],
  project,
  'denied: multiple-active-changes',
);

console.log('');
if (failures > 0) {
  console.error('regression: FAILED（' + failures + '/' + steps + ' 步失败）');
  process.exitCode = 1;
} else {
  console.log('regression: PASS（' + steps + ' 步）');
}
