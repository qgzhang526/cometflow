#!/usr/bin/env node
/**
 * 演示脚本专用：把一份 spec 的 front-matter status 改成 draft / approved。
 *
 * 用编译产物里的 `setSpecStatus`（与 `cometflow spec approve` 同源的那一份实现），
 * 而不是在 PowerShell 里做正则替换——Windows PowerShell 5.1 的 `Set-Content` 默认按
 * 系统 ANSI 码页写盘，会把带中文的 spec 写坏；而这个文件在演示里代表「人还没点头的契约」，
 * 写坏它等于把桥段本身弄坏。
 *
 * 用法：node scripts/demo/spec-status.mjs <spec-file> draft|approved
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [, , target, status] = process.argv;

if (target === undefined || (status !== 'draft' && status !== 'approved')) {
  console.error('用法：node scripts/demo/spec-status.mjs <spec-file> draft|approved');
  process.exit(1);
}

const metaPath = path.join(ROOT, 'dist', 'domains', 'spec', 'spec-meta.js');
if (!fs.existsSync(metaPath)) {
  console.error('找不到 ' + metaPath + '：先在仓库根目录跑 pnpm build（cometflow 命令本身也是基于 dist 的）');
  process.exit(1);
}
const { parseSpecMeta, setSpecStatus } = await import(pathToFileURL(metaPath).href);

const file = path.resolve(target);
const before = fs.readFileSync(file, 'utf8');
const previous = parseSpecMeta(before).status;
if (previous === status) {
  console.log(file + ': 已经是 ' + status + '，无需改动');
  process.exit(0);
}
fs.writeFileSync(file, setSpecStatus(before, status), 'utf8');
console.log(file + ': ' + previous + ' → ' + status);
