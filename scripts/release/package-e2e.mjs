import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const checks = [
  ['package.json', existsSync(resolve(root, 'package.json'))],
  ['tsconfig.json', existsSync(resolve(root, 'tsconfig.json'))],
  ['vitest.config.ts', existsSync(resolve(root, 'vitest.config.ts'))],
  ['dist/app/cli/index.js', existsSync(resolve(root, 'dist/app/cli/index.js'))],
  // 前端产物也是发布内容：缺了它 `cometflow serve` 打开就是空白页（N6）。
  ['web/dist/index.html', existsSync(resolve(root, 'web/dist/index.html'))],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
  if (!ok) failed = true;
}

if (!failed) {
  const typecheck = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit'], { cwd: root, stdio: 'inherit' });
  const tests = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], { cwd: root, stdio: 'inherit' });
  if (typecheck.status !== 0 || tests.status !== 0) failed = true;
}

if (failed) {
  console.error('package-e2e: FAILED');
  process.exit(1);
}
console.log('package-e2e: PASS');
