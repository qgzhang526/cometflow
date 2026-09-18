import path from 'node:path';
import { pathExists, readTextFile } from '../../platform/fs/read-file.js';
import { readInitManifest } from '../project/scaffold.js';
import { SPEC_KINDS, kindForSpecFile, type SpecKind } from './kind.js';
import { listSpecFiles } from './spec-index.js';
import { parseSpecContent } from './spec-parse.js';
import { parseModels } from './spec-model.js';
import {
  extractConfigKeys,
  extractErrorCodes,
  extractHeadings,
  extractProtocolHeaders,
  extractProtocolStatusCodes,
  extractRefSpans,
  extractSectionErrorCodes,
  type SpecRefKind,
  type SpecRefSpan,
} from './spec-structure.js';

export const SPEC_GRAPH_SCHEMA = 'cometflow.spec-graph.v1';

export type { SpecRefKind, SpecRefSpan };

/**
 * 009 的引用方向表：行为层 → 数据/契约层（永不反向）。
 *
 * `project → capability` 来自 008 §8.6 的图（目标派生 capability 任务）；009 的表述层表未列 project，
 * 这里保留它并只在两端都存在时画边。
 */
const KIND_REFERENCES: Array<{ from: SpecKind; to: SpecKind }> = [
  { from: 'project', to: 'capability' },
  { from: 'capability', to: 'models' },
  { from: 'capability', to: 'errors' },
  { from: 'capability', to: 'protocol' },
  { from: 'flow', to: 'capability' },
  { from: 'flow', to: 'models' },
  { from: 'flow', to: 'config' },
  { from: 'process', to: 'capability' },
  { from: 'process', to: 'models' },
  { from: 'process', to: 'config' },
  { from: 'rules', to: 'models' },
  { from: 'permissions', to: 'capability' },
  // capability / flow / process → rules：行为层必须声明它遵守哪些领域规则（ADR 0030 的反向引用检查
  // 就是按这条边建索引的——规则没人引用 = 悬空声明）。
  { from: 'capability', to: 'rules' },
  { from: 'flow', to: 'rules' },
  { from: 'process', to: 'rules' },
];

/** 引用类型 → 它归属的 kind（用于 kind 层聚合，以及判断「目标文件是否存在」）。 */
const OWNER_KIND: Record<SpecRefKind, SpecKind> = {
  api: 'capability',
  model: 'models',
  rule: 'rules',
  error: 'errors',
  config: 'config',
  header: 'protocol',
  status: 'protocol',
};

const REF_LABEL: Record<SpecRefKind, string> = {
  model: '模型',
  rule: '规则',
  error: '错误码',
  config: '配置',
  header: '协议头',
  status: '状态码',
  api: '接口',
};

export type SpecGraphNodeLevel = 'kind' | 'file' | 'anchor' | 'target';
export type SpecGraphNodeStatus = 'present' | 'deferred' | 'absent';

export interface SpecGraphNode {
  id: string;
  level: SpecGraphNodeLevel;
  /** kind 节点是自己的 kind；文件/锚点节点是所属 kind；目标节点是 'reference-target'。 */
  kind: SpecKind | 'reference-target';
  label: string;
  status: SpecGraphNodeStatus;
  path?: string;
  anchor?: string;
  line?: number;
  acceptance?: number;
  hasCheck?: boolean;
  value?: string;
}

export interface SpecGraphEdge {
  from: string;
  to: string;
  /** containment：kind→file→anchor 的静态层级；reference：真实的跨文件引用。 */
  level: 'containment' | 'reference';
  resolved: boolean;
  refKind?: SpecRefKind;
  site?: { path: string; line: number };
  /** containment/reference 边的引用条数（UI 折叠与权重用）。 */
  count?: number;
}

export interface SpecGraphUnresolved {
  path: string;
  line: number;
  refKind: SpecRefKind;
  value: string;
  /** 与 `spec validate` 完全相同的 code / severity。 */
  code: string;
  severity: 'error' | 'warning';
}

export interface SpecGraphProjection {
  schema: typeof SPEC_GRAPH_SCHEMA;
  nodes: SpecGraphNode[];
  edges: SpecGraphEdge[];
  unresolved: SpecGraphUnresolved[];
  summary: {
    kinds: number;
    files: number;
    anchors: number;
    targets: number;
    edges: number;
    unresolved: number;
  };
}

export interface SpecAnchorRange {
  id: string;
  heading: string;
  /** 1-based，含首行；end 为该锚点覆盖段的最后一行（下一个同级标题前一行）。 */
  start: number;
  end: number;
}

/**
 * 引用解析的事实索引。
 *
 * 图（spec-graph）与编辑器高亮（spec references）都从这里取值：同一批正则
 * （`extractRefSpans`）、同一套目标索引、同一套 code/severity，避免两处各自维护判断。
 */
export interface SpecReferenceIndex {
  present: Map<SpecRefKind, Set<string>>;
  /** targetId → 目标来源（文件路径与展示名）。 */
  meta: Map<string, { path: string; label: string }>;
  filesExist: { models: boolean; errors: boolean; config: boolean; protocol: boolean; rules: boolean };
  filesByKind: Map<SpecKind, string[]>;
  anchorsByFile: Map<string, SpecAnchorRange[]>;
  fileContents: Map<string, string>;
}

export interface SpecReferenceToken extends SpecRefSpan {
  /** 1-based 行号。 */
  line: number;
  resolved: boolean;
}

function targetId(refKind: SpecRefKind, value: string): string {
  return 'target:' + refKind + ':' + value;
}

function missingId(refKind: SpecRefKind, value: string): string {
  return 'missing:' + refKind + ':' + value;
}

async function readOptional(projectRoot: string, relativePath: string): Promise<string | null> {
  const absolute = path.join(projectRoot, relativePath);
  if (!(await pathExists(absolute))) return null;
  return readTextFile(absolute);
}

/** 扫描项目，构造引用解析所需的索引（目标定义 + 文件/锚点结构）。 */
export async function buildSpecReferenceIndex(projectRoot: string): Promise<SpecReferenceIndex> {
  const files = await listSpecFiles(projectRoot);
  const modelsContent = await readOptional(projectRoot, 'specs/models.md');
  const errorsContent = await readOptional(projectRoot, 'specs/errors.md');
  const protocolContent = await readOptional(projectRoot, 'specs/protocol.md');
  const configContent = await readOptional(projectRoot, 'specs/config.md');
  const rulesContent = await readOptional(projectRoot, 'specs/rules.md');

  const present = new Map<SpecRefKind, Set<string>>([
    ['model', new Set<string>()],
    ['rule', new Set<string>()],
    ['error', new Set<string>()],
    ['config', new Set<string>()],
    ['header', new Set<string>()],
    ['status', new Set<string>()],
    ['api', new Set<string>()],
  ]);
  const meta = new Map<string, { path: string; label: string }>();
  const filesByKind = new Map<SpecKind, string[]>();
  const anchorsByFile = new Map<string, SpecAnchorRange[]>();
  const fileContents = new Map<string, string>();
  if (rulesContent !== null) {
    // 规则目标 = `## 规则：<name>` 的 <name>，与引用语法 `- 规则：<name>` 的值对齐（ADR 0030）。
    for (const heading of extractHeadings(rulesContent)) {
      const name = /^规则[:：]\s*(.+?)\s*$/u.exec(heading)?.[1];
      if (name === undefined) continue;
      present.get('rule')!.add(name);
      meta.set(targetId('rule', name), { path: 'specs/rules.md', label: name });
    }
  }

  if (modelsContent !== null) {
    for (const entity of parseModels(modelsContent).entities) {
      present.get('model')!.add(entity.name);
      meta.set(targetId('model', entity.name), { path: 'specs/models.md', label: entity.name });
    }
  }
  if (errorsContent !== null) {
    for (const code of extractErrorCodes(errorsContent)) {
      present.get('error')!.add(code);
      meta.set(targetId('error', code), { path: 'specs/errors.md', label: code });
    }
  }
  if (protocolContent !== null) {
    for (const code of extractSectionErrorCodes(protocolContent)) {
      present.get('error')!.add(code);
      if (!meta.has(targetId('error', code))) meta.set(targetId('error', code), { path: 'specs/protocol.md', label: code });
    }
    for (const header of extractProtocolHeaders(protocolContent)) {
      present.get('header')!.add(header);
      meta.set(targetId('header', header), { path: 'specs/protocol.md', label: header });
    }
    for (const status of extractProtocolStatusCodes(protocolContent)) {
      present.get('status')!.add(status);
      meta.set(targetId('status', status), { path: 'specs/protocol.md', label: status });
    }
  }
  if (configContent !== null) {
    for (const key of extractConfigKeys(configContent)) {
      present.get('config')!.add(key);
      meta.set(targetId('config', key), { path: 'specs/config.md', label: key });
    }
  }

  for (const relativePath of files) {
    const kind = kindForSpecFile(relativePath);
    const bucket = filesByKind.get(kind) ?? [];
    bucket.push(relativePath);
    filesByKind.set(kind, bucket);

    const content = await readTextFile(path.join(projectRoot, relativePath));
    fileContents.set(relativePath, content);
    const parsed = parseSpecContent(content, relativePath);
    const ranges: SpecAnchorRange[] = parsed.anchors.map((anchor, index) => ({
      id: 'anchor:' + relativePath + '#' + anchor.heading,
      heading: anchor.heading,
      start: anchor.line,
      end: index + 1 < parsed.anchors.length ? parsed.anchors[index + 1].line - 1 : Number.MAX_SAFE_INTEGER,
    }));
    anchorsByFile.set(relativePath, ranges);

    // capability 的接口标题就是「接口」目标：flow/process 的「调用 METHOD /path」按它解析。
    for (const anchor of parsed.anchors) {
      const api = /^([A-Z]{3,8})\s+(\/\S+)$/u.exec(anchor.heading.trim());
      if (api === null) continue;
      const value = api[1].toUpperCase() + ' ' + api[2];
      present.get('api')!.add(value);
      meta.set(targetId('api', value), { path: relativePath, label: value });
    }
  }

  return {
    present,
    meta,
    filesExist: {
      models: modelsContent !== null,
      errors: errorsContent !== null,
      config: configContent !== null,
      protocol: protocolContent !== null,
      rules: rulesContent !== null,
    },
    filesByKind,
    anchorsByFile,
    fileContents,
  };
}

/** 引用的目标是否已定义。 */
export function resolveSpecReference(index: SpecReferenceIndex, refKind: SpecRefKind, value: string): boolean {
  return index.present.get(refKind)!.has(value);
}

/** 未解析引用的 code 与 severity，与 `spec validate` 逐字对齐。 */
export function unresolvedRefCode(
  index: SpecReferenceIndex,
  refKind: SpecRefKind,
): { code: string; severity: 'error' | 'warning' } {
  const owner = OWNER_KIND[refKind];
  const targetFileExists =
    owner === 'capability'
      ? true
      : owner === 'errors'
        ? index.filesExist.errors || index.filesExist.protocol
        : owner === 'models'
          ? index.filesExist.models
          : owner === 'config'
            ? index.filesExist.config
            : owner === 'rules'
              ? index.filesExist.rules
              : index.filesExist.protocol;
  if (!targetFileExists) return { code: 'missing-reference-target', severity: 'warning' };
  if (refKind === 'api') return { code: 'unresolved-api-reference', severity: 'warning' };
  return { code: 'unresolved-' + refKind + '-reference', severity: 'error' };
}

/**
 * 对给定正文提取带位置的引用 token（编辑器高亮用）。
 *
 * 接受任意草稿正文，因此编辑器不必先落盘；`line`/`start`/`end` 是渲染镜像层所需的位置。
 */
export function collectSpecReferenceTokens(index: SpecReferenceIndex, content: string): SpecReferenceToken[] {
  const tokens: SpecReferenceToken[] = [];
  const lines = content.split(/\r?\n/u);
  for (let position = 0; position < lines.length; position += 1) {
    for (const span of extractRefSpans(lines[position])) {
      tokens.push({ ...span, line: position + 1, resolved: resolveSpecReference(index, span.kind, span.value) });
    }
  }
  return tokens;
}

/**
 * 汇总 spec 之间的引用关系，供「引用关系图」使用（008 §8.6②）。
 *
 * 解析规则与 `spec validate` 同源：同一批正则、同一套目标索引、同样的 code 与 severity，
 * 因此「图上红色的边」与「validate 报的错」永远是同一件事。
 */
export async function collectSpecGraph(projectRoot: string): Promise<SpecGraphProjection> {
  const nodes: SpecGraphNode[] = [];
  const edges: SpecGraphEdge[] = [];
  const unresolved: SpecGraphUnresolved[] = [];

  const manifest = await readInitManifest(projectRoot);
  const index = await buildSpecReferenceIndex(projectRoot);

  for (const [kind, kindFiles] of index.filesByKind) {
    for (const relativePath of kindFiles) {
      nodes.push({
        id: 'file:' + relativePath,
        level: 'file',
        kind,
        label: relativePath.replace(/^specs\//u, ''),
        status: 'present',
        path: relativePath,
      });
      edges.push({
        from: 'kind:' + kind,
        to: 'file:' + relativePath,
        level: 'containment',
        resolved: true,
        count: (index.anchorsByFile.get(relativePath) ?? []).length,
      });
    }
  }

  for (const [relativePath, content] of index.fileContents) {
    const kind = kindForSpecFile(relativePath);
    const parsed = parseSpecContent(content, relativePath);
    for (const anchor of parsed.anchors) {
      nodes.push({
        id: 'anchor:' + relativePath + '#' + anchor.heading,
        level: 'anchor',
        kind,
        label: anchor.heading,
        status: 'present',
        path: relativePath,
        anchor: anchor.heading,
        line: anchor.line,
        acceptance: anchor.acceptance.length,
        hasCheck: anchor.acceptance.some((item) => item.check !== null),
      });
      edges.push({ from: 'file:' + relativePath, to: 'anchor:' + relativePath + '#' + anchor.heading, level: 'containment', resolved: true });
    }
  }

  for (const kind of SPEC_KINDS) {
    const entry = manifest?.kinds[kind];
    const kindFiles = index.filesByKind.get(kind) ?? [];
    const status: SpecGraphNodeStatus =
      kindFiles.length > 0 ? 'present' : entry?.status === 'deferred' ? 'deferred' : entry?.status === 'present' ? 'present' : 'absent';
    nodes.push({ id: 'kind:' + kind, level: 'kind', kind, label: kind, status });
  }

  const seenTargets = new Set<string>();
  for (const [relativePath, content] of index.fileContents) {
    const ranges = index.anchorsByFile.get(relativePath) ?? [];
    const lines = content.split(/\r?\n/u);
    for (let position = 0; position < lines.length; position += 1) {
      const line = position + 1;
      const owner = ranges.find((range) => line >= range.start && line <= range.end);
      const from = owner?.id ?? 'file:' + relativePath;
      for (const span of extractRefSpans(lines[position])) {
        const resolved = resolveSpecReference(index, span.kind, span.value);
        const id = resolved ? targetId(span.kind, span.value) : missingId(span.kind, span.value);
        if (!seenTargets.has(id)) {
          seenTargets.add(id);
          const meta = index.meta.get(id);
          nodes.push({
            id,
            level: 'target',
            kind: 'reference-target',
            label: REF_LABEL[span.kind] + ' ' + span.value,
            status: resolved ? 'present' : 'absent',
            path: meta?.path,
            value: span.value,
          });
        }
        edges.push({
          from,
          to: id,
          level: 'reference',
          resolved,
          refKind: span.kind,
          site: { path: relativePath, line },
        });
        if (!resolved) {
          const { code, severity } = unresolvedRefCode(index, span.kind);
          unresolved.push({ path: relativePath, line, refKind: span.kind, value: span.value, code, severity });
        }
      }
    }
  }

  for (const relation of KIND_REFERENCES) {
    const references = edges.filter(
      (edge) => edge.level === 'reference' && edge.refKind !== undefined && OWNER_KIND[edge.refKind] === relation.to,
    );
    const fromFiles = index.filesByKind.get(relation.from) ?? [];
    const toFiles = index.filesByKind.get(relation.to) ?? [];
    if (fromFiles.length === 0) continue;
    if (references.length === 0 && toFiles.length === 0) continue;
    edges.push({
      from: 'kind:' + relation.from,
      to: 'kind:' + relation.to,
      level: 'reference',
      resolved: toFiles.length > 0,
      count: references.length,
    });
  }

  return {
    schema: SPEC_GRAPH_SCHEMA,
    nodes,
    edges,
    unresolved,
    summary: {
      kinds: nodes.filter((node) => node.level === 'kind').length,
      files: nodes.filter((node) => node.level === 'file').length,
      anchors: nodes.filter((node) => node.level === 'anchor').length,
      targets: nodes.filter((node) => node.level === 'target').length,
      edges: edges.length,
      unresolved: unresolved.length,
    },
  };
}
