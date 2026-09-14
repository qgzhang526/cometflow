export interface EntityDef {
  name: string;
  line: number;
}

export interface ProcessDef {
  name: string;
  line: number;
}

export interface ApiReference {
  method: string;
  path: string;
  refFile: string | null;
}

export interface FlowStep {
  step: string;
  apiRefs: ApiReference[];
}

export type SpecRefKind = 'model' | 'error' | 'config' | 'header' | 'status' | 'api';

/**
 * 一行里的一个可解析引用。
 *
 * `value` 是归一化后的引用目标（如 `Colony` / `E001` / `POST /buildings`），
 * `start`/`end` 是它在**该行内**的位置（左闭右开），供编辑器高亮与图的定位使用。
 * 引用图（spec-graph）与编辑器高亮（spec references）都从这里取值，避免两套语法。
 */
export interface SpecRefSpan {
  kind: SpecRefKind;
  value: string;
  start: number;
  end: number;
}

const API_CALL_PATTERN = /调用\s*`?([A-Z]{3,8})\s+([^\s`]+)`?/gu;

/** 每个引用类型：匹配整段的模式 + 从匹配里取出「值」与它在行内的区间。 */
const REF_RULES: Array<{
  kind: SpecRefKind;
  pattern: RegExp;
  extract: (match: RegExpExecArray) => { value: string; start: number; end: number } | null;
}> = [
  {
    kind: 'model',
    pattern: /^\s*(?:[-*]\s+)?(?:模型|实体)[:：]\s*([^\s，,]+)/u,
    extract: (match) => valueSpan(match, 1),
  },
  {
    kind: 'error',
    pattern: /^\s*(?:[-*]\s+)?(?:错误码|错误)[:：]\s*([A-Z0-9_]+)/u,
    extract: (match) => valueSpan(match, 1),
  },
  {
    kind: 'config',
    pattern: /^\s*(?:[-*]\s+)?(?:配置键|配置)[:：]\s*([A-Za-z0-9_.]+)/u,
    extract: (match) => valueSpan(match, 1),
  },
  {
    kind: 'header',
    pattern: /^\s*(?:[-*]\s+)?协议头[:：]\s*([^\s，,]+)/u,
    extract: (match) => valueSpan(match, 1),
  },
  {
    kind: 'status',
    pattern: /^\s*(?:[-*]\s+)?状态码[:：]\s*(\d{3})/u,
    extract: (match) => valueSpan(match, 1),
  },
  {
    kind: 'api',
    // 值归一化为 `METHOD /path`，与 capability 锚点标题的归一化结果一致，便于解析。
    pattern: API_CALL_PATTERN,
    extract: (match) => {
      const methodStart = match.index + match[0].indexOf(match[1]);
      const pathStart = match.index + match[0].lastIndexOf(match[2]);
      return {
        value: match[1].toUpperCase() + ' ' + match[2],
        start: methodStart,
        end: pathStart + match[2].length,
      };
    },
  },
];

function valueSpan(match: RegExpExecArray, group: number): { value: string; start: number; end: number } | null {
  const value = match[group];
  if (value === undefined) return null;
  const offset = match[0].lastIndexOf(value);
  if (offset < 0) return null;
  return { value, start: match.index + offset, end: match.index + offset + value.length };
}

/** 按出现顺序返回一行里的全部引用（同一位置只算一次）。 */
export function extractRefSpans(line: string): SpecRefSpan[] {
  const spans: SpecRefSpan[] = [];
  for (const rule of REF_RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const span = rule.extract(match);
      if (span !== null) spans.push({ kind: rule.kind, ...span });
      if (match[0] === '') pattern.lastIndex += 1;
    }
  }
  return spans.sort((left, right) => left.start - right.start);
}

function valuesOfKind(content: string, kind: SpecRefKind): string[] {
  const values: string[] = [];
  for (const line of content.split(/\r?\n/u)) {
    for (const span of extractRefSpans(line)) {
      if (span.kind === kind) values.push(span.value);
    }
  }
  return values;
}

export function extractEntities(content: string): EntityDef[] {
  const out: EntityDef[] = [];
  content.split(/\r?\n/u).forEach((line, index) => {
    const match = /^##\s+实体[:：]\s*(.+?)\s*$/u.exec(line.trim());
    if (match) out.push({ name: match[1], line: index + 1 });
  });
  return out;
}

export function extractProcesses(content: string): ProcessDef[] {
  const out: ProcessDef[] = [];
  content.split(/\r?\n/u).forEach((line, index) => {
    const match = /^##\s+进程[:：]\s*(.+?)\s*$/u.exec(line.trim());
    if (match) out.push({ name: match[1], line: index + 1 });
  });
  return out;
}

export function extractHeadings(content: string, level: 2 | 3 = 2): string[] {
  const pattern = level === 2 ? /^##\s+(.+?)\s*$/u : /^###\s+(.+?)\s*$/u;
  return content
    .split(/\r?\n/u)
    .map((line) => {
      const match = pattern.exec(line.trim());
      return match ? match[1] : null;
    })
    .filter((heading): heading is string => heading !== null);
}

export function extractApiReferencesFromLine(line: string): ApiReference[] {
  const refs: ApiReference[] = [];
  const callPattern = /调用\s*`?([A-Z]{3,8})\s+([^\s`]+)`?/gu;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(line)) !== null) {
    const refMatch = /参考\s*([^\s）]+)/u.exec(line);
    refs.push({
      method: match[1].toUpperCase(),
      path: match[2],
      refFile: refMatch ? refMatch[1] : null,
    });
  }
  return refs;
}

export function extractApiReferences(content: string): ApiReference[] {
  const refs: ApiReference[] = [];
  for (const line of content.split(/\r?\n/u)) {
    refs.push(...extractApiReferencesFromLine(line));
  }
  return refs;
}

export function extractFlowSteps(content: string): FlowStep[] {
  const lines = content.split(/\r?\n/u);
  const steps: FlowStep[] = [];
  let current: FlowStep | null = null;
  for (const line of lines) {
    const stepMatch = /^###\s+(步骤[^\s：:]*)/u.exec(line.trim());
    if (stepMatch) {
      current = { step: stepMatch[1], apiRefs: [] };
      steps.push(current);
      continue;
    }
    if (current) {
      current.apiRefs.push(...extractApiReferencesFromLine(line));
    }
  }
  return steps;
}

export function normalizeApiHeading(heading: string): string {
  const parts = heading.trim().split(/\s+/u);
  if (parts.length >= 2) return parts[0].toUpperCase() + ' ' + parts.slice(1).join(' ');
  return heading.trim();
}

// Explicit cross-file references, written as "模型：Name" / "错误码：CODE" / "配置：key".
export function extractModelRefs(content: string): string[] {
  return valuesOfKind(content, 'model');
}

export function extractErrorCodeRefs(content: string): string[] {
  return valuesOfKind(content, 'error');
}

export function extractConfigKeyRefs(content: string): string[] {
  return valuesOfKind(content, 'config');
}

export function extractHeaderRefs(content: string): string[] {
  return valuesOfKind(content, 'header');
}

export function extractStatusRefs(content: string): string[] {
  return valuesOfKind(content, 'status');
}

function extractTableFirstColumn(content: string): string[] {
  const cells: string[] = [];
  for (const line of content.split(/\r?\n/u)) {
    const parts = line.split('|').map((part) => part.trim()).filter((part) => part !== '');
    if (parts.length === 0) continue;
    cells.push(parts[0]);
  }
  return cells;
}

export function extractTableSectionFirstColumn(content: string, sectionTitle: string): string[] {
  const lines = content.split(/\r?\n/u);
  const cells: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/u.exec(line.trim());
    if (heading) {
      inSection = heading[1] === sectionTitle;
      continue;
    }
    if (!inSection || !line.includes('|')) continue;
    const parts = line.split('|').map((part) => part.trim()).filter((part) => part !== '');
    if (parts.length === 0) continue;
    cells.push(parts[0]);
  }
  return cells;
}

export function extractProtocolHeaders(content: string): string[] {
  return extractTableSectionFirstColumn(content, '请求头');
}

export function extractProtocolStatusCodes(content: string): string[] {
  return extractTableSectionFirstColumn(content, '状态码总表');
}

export function extractErrorCodes(content: string): string[] {
  return extractTableFirstColumn(content).filter((cell) => /^[A-Z0-9_]+$/u.test(cell));
}

// Small projects keep their error catalogue in the `## 错误码` table of
// specs/protocol.md instead of a dedicated specs/errors.md (see 009 taxonomy).
export function extractSectionErrorCodes(content: string): string[] {
  return extractTableSectionFirstColumn(content, '错误码').filter((cell) => /^[A-Z0-9_]+$/u.test(cell));
}

export function extractConfigKeys(content: string): string[] {
  return extractTableFirstColumn(content).filter((cell) => /^[A-Za-z0-9_.-]+$/u.test(cell) && !/^-+$/u.test(cell));
}

export function extractApiPathRefs(content: string): string[] {
  return extractTableFirstColumn(content).filter((cell) => /^[A-Z]{3,8}\s+\//u.test(cell));
}
