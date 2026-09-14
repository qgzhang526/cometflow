import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractZipEntry, parseDocumentXml } from '../../domains/spec/docx.js';
import { docxInterfaceRows, headingCapability, importSpecsFromFile } from '../../domains/spec/spec-import.js';

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

const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds a minimal store-or-deflate ZIP so the reader is exercised without a real .docx. */
function buildZip(files: { name: string; content: Buffer }[], deflate = false): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = deflate ? zlib.deflateRawSync(file.content) : file.content;
    const method = deflate ? 8 : 0;
    const checksum = crc32(file.content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(file.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(file.content.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += 30 + name.length + data.length;
  }

  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, centralBuffer, eocd]);
}

function paragraph(text: string, style?: string): string {
  const properties = style === undefined ? '' : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`;
  return `<w:p>${properties}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function wordTable(rows: string[][]): string {
  const trs = rows
    .map((cells) => `<w:tr>${cells.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join('')}</w:tr>`)
    .join('');
  return `<w:tbl>${trs}</w:tbl>`;
}

function buildDocx(blocks: string[], deflate = true): Buffer {
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + blocks.join('')
    + '</w:body></w:document>';
  return buildZip([
    { name: '[Content_Types].xml', content: Buffer.from('<?xml version="1.0"?><Types/>', 'utf8') },
    { name: 'word/document.xml', content: Buffer.from(xml, 'utf8') },
  ], deflate);
}

async function tmpProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-docx-'));
  await fs.writeFile(path.join(root, 'COMETFLOW.md'), COMETFLOW);
  return root;
}

describe('docx container', () => {
  it('reads word/document.xml from a stored and a deflated entry', () => {
    const entries = [{ name: 'word/document.xml', content: Buffer.from('<w:document/>', 'utf8') }];
    expect(extractZipEntry(buildZip(entries, false), 'word/document.xml')?.toString('utf8')).toBe('<w:document/>');
    expect(extractZipEntry(buildZip(entries, true), 'word/document.xml')?.toString('utf8')).toBe('<w:document/>');
  });

  it('returns null for a missing entry and throws for a non-zip file', () => {
    const entries = [{ name: 'word/document.xml', content: Buffer.from('<w:document/>', 'utf8') }];
    expect(extractZipEntry(buildZip(entries), 'word/styles.xml')).toBeNull();
    expect(() => extractZipEntry(Buffer.from('这不是压缩包'), 'word/document.xml')).toThrow(/docx|zip/u);
  });
});

describe('docx document structure', () => {
  it('keeps headings, paragraphs and tables in document order', () => {
    const xml = '<w:body>'
      + paragraph('3.2 订单模块', '2')
      + paragraph('本节描述订单相关接口。')
      + wordTable([['方法', '路径'], ['POST', '/api/orders']])
      + '</w:body>';

    const blocks = parseDocumentXml(xml);
    expect(blocks.map((block) => block.kind)).toEqual(['text', 'text', 'table']);
    expect(blocks[0]).toMatchObject({ text: '3.2 订单模块', headingLevel: 2 });
    expect(blocks[1]).toMatchObject({ headingLevel: null });
    expect(blocks[2]).toMatchObject({ rows: [['方法', '路径'], ['POST', '/api/orders']] });
  });

  it('does not treat paragraphs inside table cells as body paragraphs', () => {
    const blocks = parseDocumentXml('<w:body>' + wordTable([['方法'], ['GET']]) + '</w:body>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('table');
  });
});

describe('docx interface extraction', () => {
  it('reads an interface table and takes the capability from the enclosing heading', () => {
    const blocks = parseDocumentXml('<w:body>'
      + paragraph('3.2 订单模块', '2')
      + wordTable([['方法', '路径', '认证'], ['POST', '/api/orders', '机机'], ['GET', '/api/orders/{id}', '机机']])
      + '</w:body>');

    const { rows, issues } = docxInterfaceRows(blocks);
    expect(issues).toEqual([]);
    expect(rows.map((row) => row.capability)).toEqual(['订单模块', '订单模块']);
    expect(rows[0]).toMatchObject({ method: 'POST', path: '/api/orders', auth: '机机' });
  });

  it('reads label-style sections and folds the parameter table into 请求', () => {
    const blocks = parseDocumentXml('<w:body>'
      + paragraph('4.1 支付接口', '2')
      + paragraph('请求方式：POST')
      + paragraph('请求地址：/pay')
      + paragraph('请求参数：')
      + wordTable([['字段名', '类型'], ['amount', 'number'], ['currency', 'string']])
      + '</w:body>');

    const { rows, issues } = docxInterfaceRows(blocks);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ capability: '支付接口', method: 'POST', path: '/pay', request: 'amount, currency' });
  });

  it('supports a label and its value on separate lines', () => {
    const blocks = parseDocumentXml('<w:body>'
      + paragraph('接口地址：')
      + paragraph('/api/health')
      + paragraph('请求方法：')
      + paragraph('GET')
      + '</w:body>');

    const { rows } = docxInterfaceRows(blocks);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'GET', path: '/api/health' });
  });

  it('reports tables and endpoints it cannot use instead of dropping them silently', () => {
    const blocks = parseDocumentXml('<w:body>'
      + paragraph('1 概述')
      + wordTable([['项目', '说明'], ['范围', '本文档描述订单系统']])
      + paragraph('请求方式：POST')
      + '</w:body>');

    const { rows, issues } = docxInterfaceRows(blocks);
    expect(rows).toHaveLength(0);
    expect(issues.some((issue) => issue.reason.includes('未识别的表格'))).toBe(true);
    expect(issues.some((issue) => issue.reason.includes('缺少方法或路径'))).toBe(true);
  });

  it('strips chapter numbering when deriving a capability name', () => {
    expect(headingCapability('3.2 订单模块', 'api')).toBe('订单模块');
    expect(headingCapability('第3章 支付（含退款）', 'api')).toBe('支付');
    expect(headingCapability('1.1', 'api')).toBe('api');
  });
});

describe('docx import end to end', () => {
  it('writes capability specs and validates them', async () => {
    const root = await tmpProject();
    const source = path.join(root, 'standard.docx');
    await fs.writeFile(source, buildDocx([
      paragraph('3.2 订单模块', '2'),
      wordTable([['方法', '路径', '认证', '错误码'], ['POST', '/api/orders', '机机', 'DUP_ORDER']]),
      paragraph('4.1 支付接口', '2'),
      wordTable([['方法', '路径'], ['POST', '/pay']]),
    ]));
    await fs.mkdir(path.join(root, 'specs'), { recursive: true });
    await fs.writeFile(path.join(root, 'specs', 'protocol.md'), '# 通信协议\n\n## 错误码\n\n| code | 语义 |\n|------|------|\n| DUP_ORDER | 重复下单 |\n');

    const result = await importSpecsFromFile(root, source, { module: 'internal/orders' });
    expect(result.written.sort()).toEqual(['specs/支付接口/spec.md', 'specs/订单模块/spec.md']);
    expect(result.validation.valid).toBe(true);

    const spec = await fs.readFile(path.join(root, 'specs', '订单模块', 'spec.md'), 'utf8');
    expect(spec).toContain('capability: 订单模块');
    expect(spec).toContain('module: internal/orders');
    expect(spec).toContain('## POST /api/orders');
    expect(spec).toContain('- 错误码：DUP_ORDER');

    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects a file that is not a readable docx', async () => {
    const root = await tmpProject();
    const source = path.join(root, 'broken.docx');
    await fs.writeFile(source, Buffer.from('not a zip'));
    await expect(importSpecsFromFile(root, source)).rejects.toThrow(/docx|zip/u);
    await fs.rm(root, { recursive: true, force: true });
  });
});
