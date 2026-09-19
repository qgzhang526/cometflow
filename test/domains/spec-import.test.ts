import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectKindNeeds, readInitManifest, writeInitManifest } from '../../domains/project/scaffold.js';
import { importSpecsFromTable, parseInterfaceTable, renderCapabilitySpec } from '../../domains/spec/spec-import.js';
import { readSpecHistory, specVersionsFor } from '../../domains/spec/spec-version.js';
import { verifySpecIntegrity } from '../../domains/spec/spec-verify.js';

const COMETFLOW = [
  '# 项目使命',
  '',
  'demo',
  '',
  '## 技术栈',
  '',
  '| 维度 | 值 |',
  '|------|-----|',
  '| 前端 | 无 |',
  '| 后端 | TypeScript |',
  '| 数据库 | 无 |',
  '| 缓存 | 无 |',
  '| 测试框架 | vitest |',
  '| 构建工具 | tsc |',
  '',
  '## 运行环境',
  '',
  '| 维度 | 值 |',
  '|------|-----|',
  '| 操作系统 | Linux |',
  '| 部署方式 | 本地 |',
  '| 语言版本 | Node 22+ |',
].join('\n');

const MARKDOWN_TABLE = [
  '| 模块 | 方法 | 路径 | 认证 | 请求 | 响应 | 错误码 | 说明 |',
  '|------|------|------|------|------|------|--------|------|',
  '| order | POST | /api/orders | 机机 | items[] | orderId | DUP_ORDER | 下单 |',
  '| order | GET | /api/orders/{id} | 机机 | | orderId, status | NOT_FOUND | 查询 |',
  '| payment | POST | /pay | 角色 | amount | ok | | 支付 |',
].join('\n');

async function tmpProject(files: Record<string, string> = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-import-'));
  await fs.writeFile(path.join(root, 'COMETFLOW.md'), COMETFLOW);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
  }
  return root;
}

describe('spec import', () => {
  it('parses a markdown table with Chinese headers', () => {
    const { rows, issues } = parseInterfaceTable(MARKDOWN_TABLE);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ capability: 'order', method: 'POST', path: '/api/orders', auth: '机机', errors: ['DUP_ORDER'] });
    expect(rows[1]).toMatchObject({ method: 'GET', path: '/api/orders/{id}', request: '' });
  });

  it('parses CSV with quoted cells and normalizes the leading slash', () => {
    const csv = [
      'capability,method,path,request',
      'auth,POST,login,"username, password"',
    ].join('\n');
    const { rows, issues } = parseInterfaceTable(csv);
    expect(issues).toEqual([]);
    expect(rows[0]).toMatchObject({ capability: 'auth', method: 'POST', path: '/login', request: 'username, password' });
  });

  it('reports rows with an unusable method or an empty path', () => {
    const table = [
      '| 方法 | 路径 |',
      '|------|------|',
      '| POST | /ok |',
      '| 下单 | /bad-method |',
      '| GET | |',
    ].join('\n');
    const { rows, issues } = parseInterfaceTable(table);
    expect(rows).toHaveLength(1);
    expect(issues).toHaveLength(2);
  });

  it('rejects input without a usable header row', () => {
    expect(parseInterfaceTable('就是一段说明文字，没有任何表格。').rows).toHaveLength(0);
    expect(parseInterfaceTable('| 方法 | 路径 |').issues[0].reason).toContain('未找到表格');
  });

  it('renders canonical capability markdown that the validator accepts', () => {
    const { rows } = parseInterfaceTable(MARKDOWN_TABLE);
    const markdown = renderCapabilitySpec('order', rows.slice(0, 2), 'std.csv', 'internal/order');
    // 导入物是机器誊写的：front-matter 带 status: draft，人工确认后 spec approve 才算定稿（G1）。
    expect(markdown.startsWith('---\ncapability: order\nmodule: internal/order\nstatus: draft\n---\n')).toBe(true);
    expect(markdown).toContain('# order');
    expect(markdown).toContain('## POST /api/orders');
    expect(markdown).toContain('## Acceptance');
    expect(markdown).toContain('- A1：');
    expect(markdown).toContain('- A2：');
  });

  it('takes the code module from a 代码模块 column or the --module default', async () => {
    const withColumn = parseInterfaceTable([
      '| 模块 | 代码模块 | 方法 | 路径 |',
      '|------|----------|------|------|',
      '| order | internal/order | POST | /api/orders |',
    ].join('\n'));
    expect(withColumn.issues).toEqual([]);
    expect(withColumn.rows[0]).toMatchObject({ capability: 'order', module: 'internal/order' });

    const root = await tmpProject();
    const source = path.join(root, 'inventory.csv');
    await fs.writeFile(source, 'method,path\nPOST,/api/orders\n');

    const result = await importSpecsFromTable(root, source, { module: 'internal/api' });
    const written = await fs.readFile(path.join(root, 'specs', 'api', 'spec.md'), 'utf8');
    expect(result.written).toEqual(['specs/api/spec.md']);
    expect(written).toContain('module: internal/api');
    expect(result.validation.findings.some((finding) => finding.code === 'missing-module-declaration')).toBe(false);

    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes one spec per capability and is non-destructive by default', async () => {
    const root = await tmpProject();
    const source = path.join(root, 'inventory.md');
    await fs.writeFile(source, MARKDOWN_TABLE);

    const first = await importSpecsFromTable(root, source);
    expect(first.written.sort()).toEqual(['specs/order/spec.md', 'specs/payment/spec.md']);
    expect(first.validation.valid).toBe(true);

    const rerun = await importSpecsFromTable(root, source);
    expect(rerun.written).toEqual([]);
    expect(rerun.skipped.sort()).toEqual(['specs/order/spec.md', 'specs/payment/spec.md']);

    const forced = await importSpecsFromTable(root, source, { force: true });
    expect(forced.written.sort()).toEqual(['specs/order/spec.md', 'specs/payment/spec.md']);

    await fs.rm(root, { recursive: true, force: true });
  });

  it('falls back to the default capability when the column is absent', async () => {
    const root = await tmpProject({ 'specs/protocol.md': '# 通信协议\n\n## 错误码\n\n| code | 语义 |\n|------|------|\n| DUP_ORDER | 重复下单 |\n' });
    const source = path.join(root, 'inventory.csv');
    await fs.writeFile(source, 'method,path,errors\nPOST,/api/orders,DUP_ORDER\n');

    const result = await importSpecsFromTable(root, source);
    expect(result.written).toEqual(['specs/api/spec.md']);
    expect(result.validation.valid).toBe(true);

    await fs.rm(root, { recursive: true, force: true });
  });

  it('warns about referenced error codes when no catalogue exists yet', async () => {
    const root = await tmpProject();
    const source = path.join(root, 'inventory.csv');
    await fs.writeFile(source, 'method,path,errors\nPOST,/api/orders,GHOST_CODE\n');

    const result = await importSpecsFromTable(root, source);
    expect(result.validation.valid).toBe(true);
    expect(result.validation.findings.some((finding) => finding.code === 'missing-reference-target')).toBe(true);

    await fs.rm(root, { recursive: true, force: true });
  });

  it('fails when a catalogue exists but does not define the imported code', async () => {
    const root = await tmpProject({ 'specs/protocol.md': '# 通信协议\n\n## 错误码\n\n| code | 语义 |\n|------|------|\n| OTHER_CODE | 其他 |\n' });
    const source = path.join(root, 'inventory.csv');
    await fs.writeFile(source, 'method,path,errors\nPOST,/api/orders,GHOST_CODE\n');

    const result = await importSpecsFromTable(root, source);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.findings.some((finding) => finding.code === 'unresolved-error-reference')).toBe(true);

    await fs.rm(root, { recursive: true, force: true });
  });

  it('registers versions, refreshes the baseline and corrects the kind states on import', async () => {
    const root = await tmpProject();
    // 技术栈推不出 capability，所以 manifest 里它恒为 absent——正是导入后要按磁盘事实纠正的那一行。
    await writeInitManifest(root, detectKindNeeds({ frontend: '无', backend: 'TypeScript', database: '无' }));
    const source = path.join(root, 'inventory.md');
    await fs.writeFile(source, MARKDOWN_TABLE);

    const result = await importSpecsFromTable(root, source);
    expect(result.written.sort()).toEqual(['specs/order/spec.md', 'specs/payment/spec.md']);
    expect(result.manifestChanged).toContain('capability');

    // 导入即登记版本 + 建基线：不记账的话 spec verify 会立刻报 stale-spec-lock（界面文案一直这么承诺）。
    const history = await readSpecHistory(root);
    const versions = specVersionsFor(history, 'specs/order/spec.md');
    expect(versions).toHaveLength(1);
    expect(versions[0].note).toBe('spec import');

    const lock = JSON.parse(await fs.readFile(path.join(root, '.cometflow', 'spec-lock.json'), 'utf8')) as {
      files: Array<{ path: string }>;
    };
    expect(lock.files.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(['specs/order/spec.md', 'specs/payment/spec.md']),
    );

    // 端到端的判定：门禁不再因为「没有基线」而失败（草案仍有自己的 warning，那是另一条规则）。
    const verify = await verifySpecIntegrity(root);
    expect(verify.findings.some((finding) => finding.code === 'missing-spec-lock')).toBe(false);
    expect((await readInitManifest(root))?.kinds.capability.status).toBe('present');

    await fs.rm(root, { recursive: true, force: true });
  });
});
