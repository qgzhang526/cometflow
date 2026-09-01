import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(root, '..', '..');

function loadEsbuild() {
  try {
    return require('esbuild');
  } catch {
    // esbuild 是 vitest 的传递依赖，未提升到根；从 pnpm store 里找
    const store = path.join(repoRoot, 'node_modules', '.pnpm');
    const entry = fs.readdirSync(store).find((name) => name.startsWith('esbuild@'));
    if (!entry) throw new Error('esbuild not found in ' + store);
    return require(path.join(store, entry, 'node_modules', 'esbuild'));
  }
}

const esbuild = loadEsbuild();
await esbuild.build({
  entryPoints: [path.join(root, 'src', 'web', 'ui.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  outfile: path.join(root, 'web', '2048.js'),
  logLevel: 'info',
});
console.log('web build written to web/2048.js');
