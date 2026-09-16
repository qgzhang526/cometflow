import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathExists } from '../../platform/fs/read-file.js';
import { capabilitySpecPath } from '../project/scaffold.js';
import { readDocxBlocks, type DocBlock } from './docx.js';
import { validateSpecs } from './spec-validate.js';
import type { SpecValidationResult } from './types.js';

// Normalized interface inventory. Every input form (CSV export, markdown table,
// Word table, PDF/OCR output) is reduced to this shape first; rendering spec
// markdown from it stays deterministic, so only the extraction step is heuristic.
export interface InterfaceRow {
  capability: string;
  /** Code module boundary for the spec front-matter, e.g. `internal/auth`. */
  module: string;
  method: string;
  path: string;
  auth: string;
  request: string;
  response: string;
  errors: string[];
  notes: string;
  line: number;
}

export interface ImportIssue {
  line: number;
  reason: string;
}

export interface SpecImportResult {
  source: string;
  capabilities: string[];
  written: string[];
  skipped: string[];
  issues: ImportIssue[];
  validation: SpecValidationResult;
}

type ImportField = 'capability' | 'module' | 'method' | 'path' | 'auth' | 'request' | 'response' | 'errors' | 'notes';

const HEADER_ALIASES: Record<string, ImportField> = {
  能力: 'capability', 模块: 'capability', 功能: 'capability', 领域: 'capability',
  capability: 'capability', module: 'capability', domain: 'capability',
  代码模块: 'module', 模块路径: 'module', 代码路径: 'module',
  codemodule: 'module', code_module: 'module', codepath: 'module', code_path: 'module',
  方法: 'method', 请求方法: 'method', http方法: 'method', method: 'method',
  路径: 'path', 接口: 'path', 接口路径: 'path', 接口地址: 'path', url: 'path', path: 'path', endpoint: 'path',
  认证: 'auth', 鉴权: 'auth', 认证方式: 'auth', auth: 'auth',
  请求: 'request', 请求参数: 'request', 入参: 'request', 请求体: 'request', request: 'request',
  响应: 'response', 响应参数: 'response', 出参: 'response', 响应体: 'response', response: 'response',
  错误码: 'errors', 异常: 'errors', errors: 'errors', error: 'errors',
  说明: 'notes', 描述: 'notes', 备注: 'notes', notes: 'notes', description: 'notes',
};

export const DEFAULT_CAPABILITY = 'api';

function normalizeHeader(raw: string): ImportField | null {
  const key = raw.replace(/[\s*＊]/gu, '').replace(/[（(].*?[)）]/gu, '').toLowerCase();
  return HEADER_ALIASES[key] ?? null;
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char !== '"') current += char;
      else if (line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

export interface RawTable {
  header: string[];
  rows: { cells: string[]; line: number }[];
}

function extractTable(content: string): RawTable | null {
  const lines = content
    .split(/\r?\n/u)
    .map((text, index) => ({ text: text.trim(), line: index + 1 }))
    .filter((entry) => entry.text !== '');
  if (lines.length < 2) return null;

  const pipeLines = lines.filter((entry) => entry.text.includes('|'));
  if (pipeLines.length >= 2) {
    const toCells = (text: string) => text.replace(/^\|/u, '').replace(/\|$/u, '').split('|').map((cell) => cell.trim());
    const isSeparator = (cells: string[]) => cells.every((cell) => /^:?-+:?$/u.test(cell));
    const [header, ...rest] = pipeLines;
    const rows = rest
      .map((entry) => ({ cells: toCells(entry.text), line: entry.line }))
      .filter((entry) => !isSeparator(entry.cells));
    return { header: toCells(header.text), rows };
  }

  const delimiter = lines[0].text.includes('\t') || !lines[0].text.includes(',') ? '\t' : ',';
  const header = splitDelimitedLine(lines[0].text, delimiter);
  if (header.length < 2) return null;
  return { header, rows: lines.slice(1).map((entry) => ({ cells: splitDelimitedLine(entry.text, delimiter), line: entry.line })) };
}

function rowsFromTable(table: RawTable, defaultCapability = ''): { rows: InterfaceRow[]; issues: ImportIssue[] } {
  const fields = table.header.map(normalizeHeader);
  if (!fields.includes('path')) {
    return { rows: [], issues: [{ line: 1, reason: '缺少必需列：路径 / path（可用列名：' + Object.keys(HEADER_ALIASES).join('、') + '）' }] };
  }

  const rows: InterfaceRow[] = [];
  const issues: ImportIssue[] = [];

  for (const row of table.rows) {
    if (row.cells.every((cell) => cell === '')) continue;
    const value = (field: ImportField): string => {
      const index = fields.indexOf(field);
      return index === -1 ? '' : (row.cells[index] ?? '').trim();
    };

    const rawMethod = value('method');
    const method = rawMethod.toUpperCase();
    const rawPath = value('path');

    if (!/^[A-Z]{3,8}$/u.test(method)) {
      issues.push({ line: row.line, reason: '方法无效或缺失：' + (rawMethod === '' ? '(空)' : rawMethod) });
      continue;
    }
    if (rawPath === '') {
      issues.push({ line: row.line, reason: '路径为空' });
      continue;
    }

    rows.push({
      capability: value('capability') !== '' ? value('capability') : defaultCapability,
      module: value('module'),
      method,
      path: rawPath.startsWith('/') ? rawPath : '/' + rawPath,
      auth: value('auth'),
      request: value('request'),
      response: value('response'),
      errors: value('errors').split(/[,，、;；\s]+/u).filter((code) => code !== ''),
      notes: value('notes'),
      line: row.line,
    });
  }

  return { rows, issues };
}

export function parseInterfaceTable(content: string): { rows: InterfaceRow[]; issues: ImportIssue[] } {
  const table = extractTable(content);
  if (!table) {
    return { rows: [], issues: [{ line: 1, reason: '未找到表格：需要一个带表头的 markdown 表格或 CSV/TSV' }] };
  }
  return rowsFromTable(table);
}

const METHOD_LABEL = /(?:请求方式|请求方法|http\s*方法|方法)[:：]\s*([A-Za-z]{3,8})/iu;
const PATH_LABEL = /(?:请求地址|接口地址|接口路径|资源路径|接口\s*url|url|路径|地址|接口)[:：]\s*(\/\S*)/iu;
const METHOD_LABEL_ONLY = /^(?:请求方式|请求方法|http\s*方法|方法)\s*[:：]?\s*$/iu;
const PATH_LABEL_ONLY = /^(?:请求地址|接口地址|接口路径|资源路径|接口\s*url|url|路径|地址|接口)\s*[:：]?\s*$/iu;
const FIELD_LABEL = /^(请求参数|请求体|请求报文|请求数据|请求字段|入参|响应参数|响应体|响应报文|响应数据|响应字段|出参)\s*[:：]?\s*(.*)$/u;
const FIELD_HEADER = /^(字段|字段名|参数|参数名|名称|序号|field|name|no\.?)$/iu;

function normalizeEndpointPath(raw: string): string {
  const trimmed = raw.trim().replace(/[，,；;。、）)]+$/u, '');
  if (trimmed === '') return '';
  return trimmed.startsWith('/') ? trimmed : '/' + trimmed;
}

/** Turns a Word heading such as "3.2 订单接口" into a usable capability name. */
export function headingCapability(text: string, fallback: string): string {
  const stripped = text
    .replace(/^第\s*[0-9一二三四五六七八九十]+\s*[章节条]\s*/u, '')
    .replace(/^[0-9]+(?:[.．][0-9]+)*[.．、]?\s*/u, '')
    .replace(/[（(][^（()）]*[)）]\s*$/u, '')
    .trim();
  const name = stripped.replace(/[\s/\\:*?"<>|]+/gu, '-').replace(/^[-.]+|[-.]+$/gu, '');
  return capabilitySpecPath(name) !== null ? name : fallback;
}

function firstColumnValues(table: RawTable): string[] {
  return table.rows
    .map((row) => (row.cells[0] ?? '').trim())
    .filter((cell) => cell !== '' && !FIELD_HEADER.test(cell));
}

/**
 * Extracts interface rows from a Word document. Two shapes are recognized:
 * tables that already look like an interface list, and label-style sections
 * ("请求方式：POST" / "请求地址：/api/x") whose parameter tables feed 请求/响应.
 */
export function docxInterfaceRows(
  blocks: DocBlock[],
  fallbackCapability: string = DEFAULT_CAPABILITY,
): { rows: InterfaceRow[]; issues: ImportIssue[]; headings: string[] } {
  const rows: InterfaceRow[] = [];
  const issues: ImportIssue[] = [];
  const headings: string[] = [];

  let capability = fallbackCapability;
  let pending: InterfaceRow | null = null;
  let fieldTarget: 'request' | 'response' | null = null;
  let awaiting: 'method' | 'path' | null = null;

  const flush = (): void => {
    if (pending !== null) {
      rows.push(pending);
      pending = null;
    }
  };

  const ensurePending = (): InterfaceRow => {
    pending ??= { capability, module: '', method: '', path: '', auth: '', request: '', response: '', errors: [], notes: '', line: 0 };
    return pending;
  };

  // Assignments above happen inside closures, so a plain `pending !== null` check
  // would be narrowed to `never` by control-flow analysis.
  const currentPending = (): InterfaceRow | null => pending;

  // Consecutive label lines ("请求方式：POST" then "请求地址：/pay") describe one
  // endpoint, so only close the current row once it already has both method and path.
  const startEndpoint = (): InterfaceRow => {
    const current = currentPending();
    if (current !== null && current.method !== '' && current.path !== '') flush();
    return ensurePending();
  };

  for (const block of blocks) {
    if (block.kind === 'table') {
      awaiting = null;
      const table: RawTable = { header: block.rows[0] ?? [], rows: block.rows.slice(1).map((cells) => ({ cells, line: 0 })) };
      const mapped = rowsFromTable(table, capability);
      if (mapped.rows.length > 0) {
        flush();
        rows.push(...mapped.rows);
        continue;
      }

      const values = firstColumnValues(table);
      if (values.length > 0 && (pending !== null || fieldTarget !== null)) {
        const target = fieldTarget ?? 'request';
        const row = ensurePending();
        row[target] = row[target] === '' ? values.join(', ') : row[target] + ', ' + values.join(', ');
        continue;
      }

      issues.push({ line: 0, reason: '未识别的表格（缺 路径/path 列，且不在某个接口的请求/响应参数下），已跳过' });
      continue;
    }

    if (block.headingLevel !== null) {
      flush();
      capability = headingCapability(block.text, fallbackCapability);
      headings.push(block.text);
      fieldTarget = null;
      awaiting = null;
      continue;
    }

    const text = block.text;
    if (awaiting === 'method') {
      ensurePending().method = text.toUpperCase();
      awaiting = null;
      continue;
    }
    if (awaiting === 'path') {
      ensurePending().path = normalizeEndpointPath(text);
      awaiting = null;
      continue;
    }

    const methodMatch = METHOD_LABEL.exec(text);
    const pathMatch = PATH_LABEL.exec(text);
    if (methodMatch || pathMatch) {
      const row = startEndpoint();
      if (methodMatch) row.method = methodMatch[1].toUpperCase();
      if (pathMatch) row.path = normalizeEndpointPath(pathMatch[1]);
      continue;
    }

    const shorthand = /^([A-Za-z]{3,8})\s+(\/\S+)$/u.exec(text);
    if (shorthand) {
      const row = startEndpoint();
      row.method = shorthand[1].toUpperCase();
      row.path = normalizeEndpointPath(shorthand[2]);
      continue;
    }

    if (METHOD_LABEL_ONLY.test(text)) {
      awaiting = 'method';
      continue;
    }
    if (PATH_LABEL_ONLY.test(text)) {
      awaiting = 'path';
      continue;
    }

    const fieldLabel = FIELD_LABEL.exec(text);
    if (fieldLabel) {
      const target = /^(?:响应|出参)/u.test(fieldLabel[1]) ? 'response' : 'request';
      fieldTarget = target;
      const inline = fieldLabel[2].trim();
      const row = currentPending();
      if (inline !== '' && row !== null) {
        row[target] = row[target] === '' ? inline : row[target] + ', ' + inline;
      }
      continue;
    }
  }

  flush();

  const usable: InterfaceRow[] = [];
  for (const row of rows) {
    if (row.method === '' || row.path === '') {
      issues.push({ line: 0, reason: '接口缺少方法或路径，已跳过：' + (row.path === '' ? row.method : row.path) });
      continue;
    }
    usable.push(row);
  }

  return { rows: usable, issues, headings };
}

export function renderCapabilitySpec(capability: string, rows: InterfaceRow[], source: string, module?: string): string {
  const lines: string[] = [
    '---',
    'capability: ' + capability,
  ];
  if (module !== undefined && module !== '') lines.push('module: ' + module);
  // 表格导入也是机器产出：生成物先算草案，人工对照原始标准确认后 `cometflow spec approve <path>`。
  lines.push('status: draft');
  lines.push('---', '');
  lines.push(
    '# ' + capability,
    '',
    '> 由 `cometflow spec import` 从 ' + source + ' 生成；请对照原始标准人工审核，确认后 `cometflow spec approve specs/'
      + capability + '/spec.md`（草案不能参与 `plan freeze`）。',
  );

  let index = 0;
  for (const row of rows) {
    index += 1;
    lines.push('', '## ' + row.method + ' ' + row.path, '');
    if (row.auth !== '') lines.push('- 认证：' + row.auth);
    if (row.request !== '') lines.push('- 请求：' + row.request);
    if (row.response !== '') lines.push('- 响应：' + row.response);
    for (const code of row.errors) lines.push('- 错误码：' + code);
    if (row.notes !== '') lines.push('- 说明：' + row.notes);
    lines.push('', '## Acceptance', '', '- A' + index + '：' + row.method + ' ' + row.path + ' 按契约实现并通过验收');
  }

  return lines.join('\n') + '\n';
}

async function writeImportedSpecs(
  projectRoot: string,
  source: string,
  parsed: { rows: InterfaceRow[]; issues: ImportIssue[] },
  options: { force?: boolean; module?: string },
): Promise<SpecImportResult> {
  const { rows, issues } = parsed;
  const grouped = groupRowsByCapability(rows);

  const written: string[] = [];
  const skipped: string[] = [];

  for (const [capability, entries] of grouped) {
    const relativePath = capabilitySpecPath(capability);
    if (!relativePath) {
      issues.push({ line: 0, reason: '能力名不合法，已跳过：' + capability });
      continue;
    }
    const absolutePath = path.join(projectRoot, relativePath);
    if ((await pathExists(absolutePath)) && options.force !== true) {
      skipped.push(relativePath);
      continue;
    }
    const declaredModule = entries.find((entry) => entry.module !== '')?.module;
    const codeModule = declaredModule ?? options.module ?? '';
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, renderCapabilitySpec(capability, entries, source, codeModule));
    written.push(relativePath);
  }

  return {
    source,
    capabilities: [...grouped.keys()],
    written,
    skipped,
    issues,
    validation: await validateSpecs(projectRoot),
  };
}

/** 按 capability 分组（空能力名回退到 `DEFAULT_CAPABILITY`）——预览与写入必须是同一份规则。 */
function groupRowsByCapability(rows: InterfaceRow[]): Map<string, InterfaceRow[]> {
  const grouped = new Map<string, InterfaceRow[]>();
  for (const row of rows) {
    const capability = row.capability === '' ? DEFAULT_CAPABILITY : row.capability;
    const entries = grouped.get(capability);
    if (entries) entries.push(row);
    else grouped.set(capability, [row]);
  }
  return grouped;
}

export interface SpecImportPreview {
  source: string;
  /** 解析出的接口行数。 */
  rows: number;
  issues: ImportIssue[];
  /** 能力名非法、写入时会被跳过的项。 */
  invalid: string[];
  /** 已存在对应 capability spec 的能力（不带 force 时会被跳过，避免覆盖人工修改）。 */
  existing: string[];
  /** 本次会新写入的能力。 */
  writable: string[];
}

/**
 * 导入预览（Web 的「粘贴 → 预览」用它）。
 *
 * 复用的正是写入路径的解析与分组规则：如果预览说「会写 3 个能力」，实际导入就必须是这 3 个。
 */
export async function previewSpecImport(
  projectRoot: string,
  source: string,
  content: string,
): Promise<SpecImportPreview> {
  const { rows, issues } = parseInterfaceTable(content);
  const grouped = groupRowsByCapability(rows);
  const invalid: string[] = [];
  const existing: string[] = [];
  const writable: string[] = [];

  for (const capability of grouped.keys()) {
    const relativePath = capabilitySpecPath(capability);
    if (relativePath === null) {
      invalid.push(capability);
      continue;
    }
    if (await pathExists(path.join(projectRoot, relativePath))) existing.push(capability);
    else writable.push(capability);
  }

  return { source, rows: rows.length, issues, invalid, existing, writable };
}

/**
 * 从**内容**导入（Web 的「粘贴表格 → 预览 → 导入」用它）。
 *
 * `source` 只参与来源标注与 issue 归因，不参与解析——解析规则只有 `parseInterfaceTable` 一份，
 * 所以浏览器里粘贴的内容与 `spec import <file>` 走的是同一条路径。
 */
export async function importSpecsFromContent(
  projectRoot: string,
  source: string,
  content: string,
  options: { force?: boolean; module?: string } = {},
): Promise<SpecImportResult> {
  return writeImportedSpecs(projectRoot, source, parseInterfaceTable(content), options);
}

export async function importSpecsFromTable(
  projectRoot: string,
  sourcePath: string,
  options: { force?: boolean; module?: string } = {},
): Promise<SpecImportResult> {
  const content = await fs.readFile(sourcePath, 'utf8');
  return importSpecsFromContent(projectRoot, path.basename(sourcePath), content, options);
}

/** Dispatches on file type: `.docx` goes through the Word extractor, everything else is read as a table. */
export async function importSpecsFromFile(
  projectRoot: string,
  sourcePath: string,
  options: { force?: boolean; module?: string } = {},
): Promise<SpecImportResult> {
  if (path.extname(sourcePath).toLowerCase() !== '.docx') {
    return importSpecsFromTable(projectRoot, sourcePath, options);
  }
  const blocks = await readDocxBlocks(sourcePath);
  return writeImportedSpecs(projectRoot, path.basename(sourcePath), docxInterfaceRows(blocks), options);
}
