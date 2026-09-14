#!/usr/bin/env node
/**
 * todoscan 的验收执行器。
 *
 * 这个文件是 spec 的判据实现：每个 capability spec 里 Acceptance 项的
 * `- check: node tests/acceptance.mjs A<n>` 都指向这里的一个场景。
 * 种子项目本身不含实现代码，所以在 `bin/todoscan.mjs` 被实现之前，
 * 这些 check 会失败——这正是 spec 驱动想要的信号：判据先于实现。
 *
 * 用法：node tests/acceptance.mjs A1
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_NAME = 'bin/todoscan.mjs';
// 用绝对路径调用 CLI：A6/A7 会把 cwd 切到临时目录去验证配置加载，
// 相对路径在那种 cwd 下会解析失败，看起来像「实现不存在」。
const CLI = path.join(PROJECT_ROOT, CLI_NAME);
const FIXTURES = 'tests/fixtures';
const EXPECTED_ORDER = ['app.js', 'lib/util.js', 'notes.md', 'vendor/legacy.js'];

function fail(message) {
  console.error('FAIL ' + message);
  process.exit(1);
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
  });
  const stderr = result.stderr ?? '';
  const missingCli =
    (result.error && result.error.code === 'ENOENT') ||
    /Cannot find module|MODULE_NOT_FOUND/u.test(stderr);
  if (missingCli) {
    fail('缺少实现：' + CLI_NAME + ' 尚不存在（这是 spec 先行的种子项目的预期状态）');
  }
  return { code: result.status, stdout: result.stdout ?? '', stderr };
}

/** 解析 `<path>:<line>:<TAG> <text>`，忽略末尾的 `total: N`。 */
function parseText(stdout) {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.trim() !== '');
  const items = [];
  let total = null;
  for (const line of lines) {
    const totalMatch = /^total:\s*(\d+)$/u.exec(line.trim());
    if (totalMatch) {
      total = Number.parseInt(totalMatch[1], 10);
      continue;
    }
    const match = /^(.*?):(\d+):([A-Za-z]+)\s+(.*)$/u.exec(line);
    if (!match) fail('输出行不符合 <path>:<line>:<TAG> <text>：' + JSON.stringify(line));
    items.push({ path: match[1], line: Number.parseInt(match[2], 10), tag: match[3].toUpperCase(), text: match[4] });
  }
  return { items, total };
}

/** 把实现输出的路径归一化到夹具根目录之下，兼容绝对/相对两种写法。 */
function relativeToFixtures(itemPath) {
  const normalized = itemPath.replace(/\\/gu, '/');
  const root = path.resolve(FIXTURES).replace(/\\/gu, '/');
  if (normalized.startsWith(root + '/')) return normalized.slice(root.length + 1);
  return normalized.replace(/^\.\//u, '').replace(/^tests\/fixtures\//u, '');
}

function scenarioA1() {
  const result = run([FIXTURES]);
  if (result.code !== 0) fail('A1 期望退出码 0，实际 ' + result.code);
  const { items, total } = parseText(result.stdout);
  if (total !== 6) fail('A1 期望 total: 6，实际 ' + total);
  if (items.length !== 6) fail('A1 期望 6 条命中，实际 ' + items.length);
  const order = [...new Set(items.map((item) => relativeToFixtures(item.path)))];
  if (JSON.stringify(order) !== JSON.stringify(EXPECTED_ORDER)) {
    fail('A1 路径顺序应为 ' + EXPECTED_ORDER.join(' → ') + '，实际 ' + order.join(' → '));
  }
  console.log('A1 ok: 6 hits in deterministic order');
}

function scenarioA2() {
  const result = run(['no-such-dir']);
  if (result.code !== 2) fail('A2 期望退出码 2，实际 ' + result.code);
  if (!result.stderr.includes('E_NO_PATH')) fail('A2 stderr 缺少 E_NO_PATH：' + JSON.stringify(result.stderr));
  console.log('A2 ok: E_NO_PATH with exit code 2');
}

function scenarioA3() {
  const byTag = run([FIXTURES, '--tag', 'FIXME']);
  if (byTag.code !== 0) fail('A3 --tag FIXME 期望退出码 0，实际 ' + byTag.code);
  const tagged = parseText(byTag.stdout);
  if (tagged.items.length !== 1) fail('A3 --tag FIXME 期望 1 条，实际 ' + tagged.items.length);

  const excluded = run([FIXTURES, '--exclude', 'vendor']);
  const kept = parseText(excluded.stdout);
  if (kept.items.length !== 5) fail('A3 --exclude vendor 期望 5 条，实际 ' + kept.items.length);
  console.log('A3 ok: filter by tag and path');
}

function scenarioA4() {
  const result = run([FIXTURES]);
  const { items, total } = parseText(result.stdout);
  for (const item of items) {
    if (!/^[A-Z]+$/u.test(item.tag) || item.line < 1) fail('A4 命中项字段不合法：' + JSON.stringify(item));
  }
  if (total !== items.length) fail('A4 最后一行 total 应等于命中数：' + total + ' vs ' + items.length);
  if (total !== 6) fail('A4 期望 total: 6，实际 ' + total);
  console.log('A4 ok: text format and total line');
}

function scenarioA5() {
  const result = run([FIXTURES, '--json']);
  if (result.code !== 0) fail('A5 期望退出码 0，实际 ' + result.code);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    fail('A5 stdout 不是合法 JSON：' + JSON.stringify(result.stdout.slice(0, 120)));
  }
  if (!Array.isArray(parsed.items)) fail('A5 缺少 items 数组');
  if (parsed.items.length !== parsed.total) fail('A5 items 长度应等于 total');
  if (parsed.total !== 6) fail('A5 期望 total 6，实际 ' + parsed.total);
  console.log('A5 ok: machine readable json');
}

function scenarioA6() {
  const dir = mkdtempSync(path.join(tmpdir(), 'todoscan-a6-'));
  try {
    writeFileSync(path.join(dir, '.todoscanrc.json'), '{ not json');
    const result = run([path.resolve(FIXTURES)], { cwd: dir });
    if (result.code !== 2) fail('A6 期望退出码 2，实际 ' + result.code);
    if (!result.stderr.includes('E_BAD_CONFIG')) fail('A6 stderr 缺少 E_BAD_CONFIG：' + JSON.stringify(result.stderr));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('A6 ok: E_BAD_CONFIG with exit code 2');
}

function scenarioA7() {
  const dir = mkdtempSync(path.join(tmpdir(), 'todoscan-a7-'));
  try {
    writeFileSync(path.join(dir, '.todoscanrc.json'), JSON.stringify({ exclude: ['vendor'] }));
    const fromConfig = run([path.resolve(FIXTURES)], { cwd: dir });
    const kept = parseText(fromConfig.stdout);
    if (kept.items.length !== 5) fail('A7 配置文件 exclude=vendor 期望 5 条，实际 ' + kept.items.length);

    const overridden = run([path.resolve(FIXTURES), '--exclude', 'lib'], { cwd: dir });
    const overriddenItems = parseText(overridden.stdout);
    if (overriddenItems.items.length !== 4) {
      fail('A7 命令行 --exclude lib 应覆盖配置，期望 4 条，实际 ' + overriddenItems.items.length);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('A7 ok: config file and CLI precedence');
}

const scenarios = { A1: scenarioA1, A2: scenarioA2, A3: scenarioA3, A4: scenarioA4, A5: scenarioA5, A6: scenarioA6, A7: scenarioA7 };
const id = process.argv[2];
if (!id || !scenarios[id]) {
  console.error('usage: node tests/acceptance.mjs <' + Object.keys(scenarios).join('|') + '>');
  process.exit(64);
}
scenarios[id]();
