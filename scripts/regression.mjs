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
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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
    // ADR 0030 的反向引用检查：夹具自身必须是"模范"——声明的实体与规则都被行为层引用。
    check(
      '夹具没有悬空声明（unreferenced-*）',
      !(validateResult.stdout + validateResult.stderr).includes('unreferenced-'),
      (validateResult.stdout ?? '').trim().slice(0, 160),
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
const scaffoldRun = expectOk('spec scaffold', ['spec', 'scaffold', '.'], project);
check('scaffold 重建 constraints.md', existsSync(path.join(project, 'specs', 'constraints.md')));
// 脚手架是幂等的：已存在的文件不能被覆盖（fixture 里 models.md 现在是 present kind，带交叉引用内容）
check('scaffold 不覆盖已存在的 models.md', readFileSync(modelsPath, 'utf8') === modelsBefore);
// 12-kind 状态按磁盘事实校正：capability 推不出来（由目标或外部标准决定），只能由磁盘证据判。
// fixture 的 manifest 写着 absent，而 specs/auth、specs/core… 都在，所以这一步必须回显它被校正。
check(
  'scaffold 按磁盘事实校正 init-manifest 的 capability',
  scaffoldRun.stdout.includes('init-manifest updated: capability → present'),
  scaffoldRun.stdout.trim().slice(0, 200),
);

// capability 骨架（G3）：root kind 靠项目类型推导，capability 只能点名。
// 探针验完即删——多出来的 spec 文件会让后续 spec verify 的 lock 基线失真。
expectOk('spec scaffold --capability', ['spec', 'scaffold', '.', '--capability', 'regression-probe'], project);
const probeSpec = path.join(project, 'specs', 'regression-probe', 'spec.md');
check('capability 骨架已生成', existsSync(probeSpec));
check('capability 骨架带 module front-matter', fileContains(probeSpec, 'module: internal/regression-probe'));
const probeBefore = existsSync(probeSpec) ? readFileSync(probeSpec, 'utf8') : '';
expectOk('spec scaffold --capability（幂等）', ['spec', 'scaffold', '.', '--capability', 'regression-probe'], project);
check('已存在的 capability spec 不被覆盖', existsSync(probeSpec) && readFileSync(probeSpec, 'utf8') === probeBefore);
expectDenied(
  'spec scaffold --capability ../escape',
  ['spec', 'scaffold', '.', '--capability', '../escape'],
  project,
  'invalid capability name',
);
check('非法 capability 名不落盘', !existsSync(path.join(project, 'escape')));
removeWithRetry(path.join(project, 'specs', 'regression-probe'));
check('capability 探针已清理', !existsSync(probeSpec));

expectOk('spec index', ['spec', 'index', '.'], project);
check('spec index 产出 apis.yaml', existsSync(path.join(project, '.cometflow', 'spec-index', 'apis.yaml')));

// 拆解审核策略（G2）：fixture 的 plan_review 是 auto，生成之后应该直达 approved。
expectOk('plan generate G3', ['plan', 'generate', 'G3', '.'], project);
check(
  'auto 策略让 generate 直达 approved',
  fileContains(path.join(project, '.cometflow', 'plans', 'G3.task-plan.yaml'), 'status: approved'),
);
expectOk('plan validate G3', ['plan', 'validate', 'G3', '.'], project);

// 草案契约（G1）：改成 draft 后冻结必须被拒，approve 之后才放行。
const reportSpec = path.join(project, 'specs', 'report', 'spec.md');
const reportSpecBefore = readFileSync(reportSpec, 'utf8');
writeFileSync(reportSpec, '---\nstatus: draft\n---\n\n' + reportSpecBefore);
expectDenied('草案 spec 不能冻结', ['plan', 'freeze', 'G3', '.'], project, '仍是草案');
expectOk('spec approve', ['spec', 'approve', 'specs/report/spec.md', '.'], project);
check('approve 后 front-matter 是 approved', fileContains(reportSpec, 'status: approved'));
expectOk('approve 后 plan freeze G3', ['plan', 'freeze', 'G3', '.'], project);

expectOk('eval', ['eval', '.'], project);
// 一次性试跑（C13）：唯一不绑 change 的 agent 会话，用 mock 只验证「能跑一轮」。
expectOk('run（一次性试跑 mock）', ['run', '.', '--agent', 'mock'], project);
expectOk('skill add', ['skill', 'add', 'skills/safe-skill', '--project', '.'], project);
expectOk('skill list', ['skill', 'list', '--project', '.'], project);
expectOk('skill import', ['skill', 'import', 'skills/risky-skill', 'risky-skill', '--project', '.'], project);

expectOk('bundle compile', ['bundle', 'compile', '.'], project);
for (const platform of ['opencode', 'claude-code', 'codex']) {
  expectOk('bundle distribute ' + platform, ['bundle', 'distribute', '.', '--platform', platform], project);
}
// 分发必须真的落到平台的 skill 目录（界面上的「一键分发」走的就是这个函数）。
check(
  'bundle distribute 把 skill 拷进平台目录',
  existsSync(path.join(project, '.opencode', 'skills', 'safe-skill')) &&
    existsSync(path.join(project, '.claude', 'skills', 'safe-skill')),
);

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

// P2 提交门禁：装进 .git/hooks/pre-commit，commit 时按门禁结论放行/拦截，卸载后逐字还原。
// 这里用 stub 顶替 cometflow 控制结论——测的是「hook 有没有正确接线」，判定本身由 spec-gates 覆盖。
expectOk('gate status（安装前）', ['gate', 'status', '.', '--json'], project);
expectOk('gate install --git-hooks', ['gate', 'install', '.', '--git-hooks'], project);
const gateStub = path.join(project, 'gate-stub.mjs');
writeFileSync(gateStub, 'const fail = process.env.STUB_GATE_STATUS === "1";\nprocess.exit(fail ? 1 : 0);\n');
const gateStubCli = 'node "' + gateStub.replace(/\\/g, '/') + '"';
const blockedCommit = spawnSync(
  'git',
  [...GIT_IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'gate-blocked'],
  {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, COMETFLOW_CLI: gateStubCli, STUB_GATE_STATUS: '1' },
  },
);
check(
  '门禁不通过时 commit 被拒',
  blockedCommit.status !== 0,
  'status=' + blockedCommit.status + ' ' + (blockedCommit.stderr ?? '').trim().slice(0, 200),
);
const allowedCommit = spawnSync(
  'git',
  [...GIT_IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'gate-allowed'],
  {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, COMETFLOW_CLI: gateStubCli, STUB_GATE_STATUS: '0' },
  },
);
check(
  '门禁通过时 commit 成功',
  allowedCommit.status === 0,
  'status=' + allowedCommit.status + ' ' + (allowedCommit.stderr ?? '').trim().slice(0, 200),
);
expectOk('gate uninstall --git-hooks', ['gate', 'uninstall', '.', '--git-hooks'], project);
check(
  '卸载后 pre-commit 被还原（安装前不存在）',
  !existsSync(path.join(project, '.git', 'hooks', 'pre-commit')),
);

// P3：指标阈值可配。gate check 在这份副本上是否整体通过取决于回归改动，所以只断言
// 「配置的阈值真的被采纳」——挑一个必然是数字的指标（specs = spec 数量），把上限设成 -1，
// 它必定被触发；文案里必须出现这条判定。
const gateConfigPath = path.join(project, '.cometflow', 'config.yaml');
const gateConfigBefore = readFileSync(gateConfigPath, 'utf8');
writeFileSync(
  gateConfigPath,
  (gateConfigBefore.endsWith('\n') ? gateConfigBefore : gateConfigBefore + '\n') +
    'gates:\n  metrics:\n    specs:\n      max: -1\n',
);
const gatedCheck = cli(['gate', 'check', '.', '--json'], { cwd: project });
check(
  'gates.metrics 的绝对阈值被 gate check 采纳',
  (gatedCheck.stdout ?? '').includes('specs 超过上限'),
  (gatedCheck.stdout ?? '').trim().slice(0, 200),
);
writeFileSync(gateConfigPath, gateConfigBefore);

// P4：宿主自适应——同一个命令，在 husky 项目里必须落到 .husky/pre-commit（写 .git/hooks 会被 husky 覆盖）。
const huskyDir = path.join(project, '.husky');
mkdirSync(huskyDir, { recursive: true });
const huskyHook = path.join(huskyDir, 'pre-commit');
const huskyOriginal = '#!/bin/sh\necho husky-user-hook\n';
writeFileSync(huskyHook, huskyOriginal);
const huskyInstall = cli(['gate', 'install', '.', '--git-hooks'], { cwd: project });
check(
  'husky 项目里安装到 .husky/pre-commit 且保留用户内容',
  huskyInstall.code === 0 &&
    readFileSync(huskyHook, 'utf8').includes('cometflow-git-gate:start') &&
    readFileSync(huskyHook, 'utf8').includes('echo husky-user-hook'),
  (huskyInstall.stdout + huskyInstall.stderr).trim().slice(0, 200),
);
const huskyUninstall = cli(['gate', 'uninstall', '.', '--git-hooks'], { cwd: project });
check(
  'husky 卸载逐字还原用户 hook',
  huskyUninstall.code === 0 && readFileSync(huskyHook, 'utf8') === huskyOriginal,
  (huskyUninstall.stdout + huskyUninstall.stderr).trim().slice(0, 200),
);
rmSync(huskyDir, { recursive: true, force: true });

// P5：findings 统一呈现。默认输出逐字不变，显式要求时才把另一个 scope 的发现列出来。
const verifyDefault = cli(['spec', 'verify', '.'], { cwd: project });
const verifyWithDoctor = cli(['spec', 'verify', '.', '--with-doctor'], { cwd: project });
check(
  'spec verify 默认输出不带 doctor 段（默认语义不变）',
  !(verifyDefault.stdout ?? '').includes('以下是 doctor 的发现'),
  (verifyDefault.stdout ?? '').trim().slice(0, 200),
);
check(
  '--with-doctor 附上 doctor 发现且不改变结论（退出码一致）',
  verifyWithDoctor.code === verifyDefault.code &&
    (verifyWithDoctor.stdout ?? '').includes('以下是 doctor 的发现'),
  'code=' + verifyDefault.code + '/' + verifyWithDoctor.code,
);
const gateFindings = cli(['gate', 'check', '.', '--findings'], { cwd: project });
check(
  'gate check --findings 列出合并去重后的清单',
  (gateFindings.stdout ?? '').includes('findings（spec-verify + doctor'),
  (gateFindings.stdout ?? '').trim().slice(0, 200),
);

expectOk('classic status', ['classic', 'status', 'classic-open', '.'], project);
for (const event of ['open-complete', 'design-complete', 'build-complete', 'verify-pass', 'archive-complete']) {
  expectOk('classic ' + event, ['classic', 'transition', 'classic-open', event, '.'], project);
}

const manualRun = expectOk(
  'daemon manual run',
  ['daemon', 'start', '.', '--mode', 'manual', '--budget', '1', '--safety-bundle'],
  project,
);
// 循环结束时必须给出可解释的 reason（CLI 与内嵌调度器的 job result 同源）。
check('daemon 结束时打印 reason', /reason=[a-z-]+/u.test(manualRun.stdout), manualRun.stdout.trim().slice(-120));
// 调度器状态投影（C5）：面板上的「最近一次决策」读的就是它，必须由 daemon 自己写下来。
check(
  'daemon 写下状态投影 daemon-state.json',
  fileContains(path.join(project, '.cometflow', 'runtime', 'daemon-state.json'), 'cometflow.daemon-state.v1'),
);

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
const guardShimSource = [
  '#!/usr/bin/env node',
  "import { spawnSync } from 'node:child_process';",
  'const result = spawnSync(process.execPath, ' +
    JSON.stringify([TSX, CLI]) +
    '.concat(process.argv.slice(2)), { stdio: "inherit" });',
  'process.exit(result.status ?? 1);',
  '',
].join('\n');
writeFileSync(guardShim, guardShimSource);
if (process.platform !== 'win32') chmodSync(guardShim, 0o755);
const guardCli = process.platform === 'win32' ? 'node "' + guardShim + '"' : guardShim;
const guardScript = path.join(project, '.claude', 'hooks', 'cometflow-guard.mjs');
function runGuardScript(filePath, cli = guardCli) {
  return spawnSync(process.execPath, [guardScript], {
    cwd: project,
    encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: filePath, content: 'export const x = 1;\n' },
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, COMETFLOW_CLI: cli },
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

// CLI 自己也是命令行 token：`COMETFLOW_CLI` 带空格却没加引号时，cmd 会把路径切碎 →
// 「命令不存在」→ 又一个静默放行。这里把 shim 放进带空格的目录，确认守卫仍拦得住。
const spacedCliDir = path.join(project, 'cli dir');
mkdirSync(spacedCliDir, { recursive: true });
const spacedShim = path.join(spacedCliDir, 'guard-cli-shim.mjs');
writeFileSync(spacedShim, guardShimSource);
if (process.platform !== 'win32') chmodSync(spacedShim, 0o755);
// Windows 不能直接把 .mjs 当命令执行：包一层 .cmd，保持「裸路径 + 含空格」这个形态。
const spacedCli = process.platform === 'win32' ? path.join(spacedCliDir, 'cometflow-cli.cmd') : spacedShim;
if (process.platform === 'win32') {
  writeFileSync(spacedCli, '@echo off\r\nnode "%~dp0guard-cli-shim.mjs" %*\r\n');
}
const guardBlockedSpacedCli = runGuardScript(path.join(project, 'rogue', 'outside.ts'), spacedCli);
check(
  'CLI 路径含空格时守卫仍以退出码 2 拦下',
  guardBlockedSpacedCli.status === 2 && (guardBlockedSpacedCli.stderr ?? '').includes('outside-module-scope'),
  'status=' + guardBlockedSpacedCli.status + ' stderr=' + (guardBlockedSpacedCli.stderr ?? '').trim().slice(0, 200),
);

// doctor 必须能回答「写保护还在不在生效」——装了要看得见，失效要报 error。
const doctorReady = cli(['doctor', '.', '--json'], { cwd: project, env: { COMETFLOW_CLI: guardCli } });
check(
  'doctor 报告 hook 已安装可用',
  (doctorReady.stdout ?? '').includes('"hook-installed"'),
  (doctorReady.stdout ?? '').trim().slice(0, 200),
);
rmSync(guardScript, { force: true });
const doctorMissingGuard = cli(['doctor', '.', '--json'], { cwd: project, env: { COMETFLOW_CLI: guardCli } });
check(
  '守卫脚本被删后 doctor 报 error hook-guard-missing',
  doctorMissingGuard.code !== 0 && (doctorMissingGuard.stdout ?? '').includes('"hook-guard-missing"'),
  'code=' + doctorMissingGuard.code + ' ' + (doctorMissingGuard.stdout ?? '').trim().slice(0, 200),
);
expectOk('hook install（复原守卫脚本）', ['hook', 'install', '.', '--platform', 'claude-code'], project);
const doctorBadCli = cli(['doctor', '.', '--json'], {
  cwd: project,
  env: { COMETFLOW_CLI: path.join(project, 'nope', 'cometflow') },
});
check(
  'CLI 失效时 doctor 报 error hook-cli-missing（守卫会放行，写保护等于没有）',
  doctorBadCli.code !== 0 && (doctorBadCli.stdout ?? '').includes('"hook-cli-missing"'),
  'code=' + doctorBadCli.code + ' ' + (doctorBadCli.stdout ?? '').trim().slice(0, 200),
);

expectOk('change select --clear', ['change', 'select', 'stall-demo', '.', '--clear'], project);
// C3 准入（第三轮修订）：这个项目此刻装着写保护守卫（前面几行刚复原）。守卫按 module 判归属，
// 并发单元因此是 **module**——不再"有守卫就拒绝开并发"，而是"module 冲突的串行"。
// 这条断言钉的正是准入的形态：单元是 module，且把会串行的任务点出来。
const concurrentRun = expectOk(
  '装了守卫也能开并发（并发单元 = module）',
  ['daemon', 'start', '.', '--mode', 'manual', '--agent', 'mock', '--concurrency', '2'],
  project,
);
check(
  '并发准入按 module 判定（日志给出单元与依据）',
  concurrentRun.stdout.includes('unit=module') && concurrentRun.stdout.includes('module 归属'),
  concurrentRun.stdout.trim().slice(0, 200),
);
expectDenied(
  // 目标故意选在所有 module 之外（docs/）：guard 现在先按 module 判归属，
  // 写进某个活跃 change 的模块会被放行（那是并发的前提），"谁都不认领"才是 fail closed 的场景。
  '无指针时拒绝归属不明的写入（路径不在任何 module 内）',
  ['hook', 'check', path.join('docs', 'unattributed.md'), '.', '--event', 'write'],
  project,
  'denied: multiple-active-changes',
);

// 起草类任务（G4）：goal 的 capability 还没有 spec 时，generate 产出 spec-authoring 任务。
// 这条任务过去被两处卡死：change 缺 acceptance 无法 shape → build；验收/归档也不看产物。
writeFileSync(
  path.join(project, 'COMETFLOW.md'),
  readFileSync(path.join(project, 'COMETFLOW.md'), 'utf8') +
    '\n### G9：drafting 能力\n- 目标：验证起草任务护栏\n- 范围：drafting\n- 成功标准：\n  - 起草任务的产物必须通过 spec validate\n',
);
expectOk('goal sync（新增 G9）', ['goal', 'sync', '.'], project);
expectOk('plan generate G9（产出起草任务）', ['plan', 'generate', 'G9', '.'], project);
expectOk('plan freeze G9', ['plan', 'freeze', 'G9', '.'], project);
expectOk('change new drafting-demo', ['change', 'new', 'drafting-demo', '--goal', 'G9', '--task', 'T1', '--path', '.'], project);
expectOk('起草 change 缺 acceptance 也能进 build', ['change', 'transition', 'drafting-demo', 'confirm-acceptance', '.'], project);
expectOk('起草 change → verify 阶段', ['change', 'transition', 'drafting-demo', 'submit-candidate', '.'], project);
expectDenied(
  '起草 change 缺产物时验收被拒',
  ['change', 'verify', 'drafting-demo', '.'],
  project,
  '产物还不存在',
);
// 补上产物（带验收清单）后，验收不再被这条护栏挡住：起草物本身就是「通过 spec validate 的 spec」。
expectOk('spec scaffold --capability drafting', ['spec', 'scaffold', '.', '--capability', 'drafting'], project);
const draftedSpec = path.join(project, 'specs', 'drafting', 'spec.md');
check('起草产物已落盘', existsSync(draftedSpec));
check('起草产物是草案（status: draft）', fileContains(draftedSpec, 'status: draft'));

// P4：daemon 现在走 change 交付通道（S1），队列是可重建的派生视图（S3），
// 进程仍由 CLI 持有、控制走控制文件（S4 / ADR 0026）。
const archivedChangeCount = () => {
  const dir = path.join(project, 'changes');
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) => fileContains(path.join(dir, name, 'comet-state.yaml'), 'archived: true')).length;
};
const rebuilt = expectOk('daemon queue rebuild', ['daemon', 'queue', 'rebuild', '.'], project);
check('rebuild 打印待办计数', /queued=\d+/u.test(rebuilt.stdout), rebuilt.stdout.trim().slice(0, 120));

const archivedBefore = archivedChangeCount();
expectOk('daemon stop（只写控制文件）', ['daemon', 'stop', '.'], project);
expectOk(
  'daemon start 消费 stop 后立即退出',
  ['daemon', 'start', '.', '--mode', 'always', '--agent', 'mock', '--budget', '60000'],
  project,
);
check(
  '状态投影记录 stopped-by-control',
  fileContains(path.join(project, '.cometflow', 'runtime', 'daemon-state.json'), 'stopped-by-control'),
);
check('stop 期间没有交付任何 change', archivedChangeCount() === archivedBefore, 'archived=' + archivedChangeCount());

expectOk('daemon resume（清掉控制指令）', ['daemon', 'resume', '.'], project);
expectOk(
  'daemon start 驱动一次交付',
  ['daemon', 'start', '.', '--mode', 'always', '--agent', 'mock', '--budget', '120000', '--max-attempts', '1'],
  project,
);
check(
  'daemon 交付了任务（archived change 增加）',
  archivedChangeCount() > archivedBefore,
  'before=' + archivedBefore + ' after=' + archivedChangeCount(),
);
check(
  '队列里记下交付结论',
  fileContains(path.join(project, '.cometflow', 'runtime', 'queue.json'), 'delivered'),
);

// 调度顺序（ADR 0029）：顺序写在 COMETFLOW.md 的 `## 调度顺序` 里，**位置即顺序**。
// `goal sync` 回显它、daemon 的队列推导也读同一份文档——所以改顺序不需要重新 freeze。
writeFileSync(
  path.join(project, 'COMETFLOW.md'),
  readFileSync(path.join(project, 'COMETFLOW.md'), 'utf8') + '\n## 调度顺序\n\n- G2\n- G1\n',
);
const orderSync = expectOk('goal sync（带 ## 调度顺序）', ['goal', 'sync', '.'], project);
check(
  'goal sync 回显生效顺序',
  orderSync.stdout.includes('调度顺序：G2 → G1'),
  orderSync.stdout.trim().slice(-120),
);
const orderedQueue = expectOk('daemon queue rebuild（顺序来自清单）', ['daemon', 'queue', 'rebuild', '.'], project);
check(
  '队列推导打印同一份顺序（同一份文档）',
  orderedQueue.stdout.includes('调度顺序：G2 → G1'),
  orderedQueue.stdout.trim().slice(0, 120),
);

// 反向引用完整性（ADR 0030）：声明的实体必须被行为层引用，否则 spec validate 报 warning——
// 注意**不挡门禁**（还是 `spec validate: OK`），因为"为下个迭代预留实体"是合法需求。
writeFileSync(
  path.join(project, 'specs', 'models.md'),
  readFileSync(path.join(project, 'specs', 'models.md'), 'utf8') + '\n## 实体：Orphan\n',
);
const reverseRefs = expectOk('spec validate（新增一个没人引用的实体）', ['spec', 'validate', '.'], project);
check(
  '悬空实体报 unreferenced-model，且不阻断（validate: OK）',
  reverseRefs.stdout.includes('unreferenced-model') && reverseRefs.stdout.includes('spec validate: OK'),
  reverseRefs.stdout.trim().slice(-160),
);

// 表格导入的收尾（与 Web 导入页签同源）：落盘后立即登记版本 + 刷 `spec-lock` 基线。
// 这一步放在最后跑：导入会多出一份 capability，前面那些以 lock 基线为准的断言不能被它干扰。
const importTable = path.join(tempRoot, 'inventory.md');
writeFileSync(
  importTable,
  ['| 模块 | 方法 | 路径 | 说明 |', '|------|------|------|------|', '| regression-import | POST | /regression-import | 导入探针 |'].join('\n'),
);
const imported = expectOk('spec import', ['spec', 'import', importTable, '.'], project);
check('导入写出 capability spec', existsSync(path.join(project, 'specs', 'regression-import', 'spec.md')));
check(
  '导入即登记版本并刷新基线',
  imported.stdout.includes('spec lock: 已登记版本并刷新'),
  imported.stdout.trim().slice(0, 200),
);
check(
  '导入后 spec-lock 收录新 spec',
  fileContains(path.join(project, '.cometflow', 'spec-lock.json'), 'specs/regression-import/spec.md'),
);

console.log('');
if (failures > 0) {
  console.error('regression: FAILED（' + failures + '/' + steps + ' 步失败）');
  process.exitCode = 1;
} else {
  console.log('regression: PASS（' + steps + ' 步）');
}
