import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { toPosix } from '../../platform/paths/relative.js';
import { readTextFile } from '../../platform/fs/read-file.js';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';
import { hashSpecText } from '../spec/spec-hash.js';
import { readProjectConfig } from '../project/config.js';
import { loadProjectContext } from '../project/context.js';

export const IMPLEMENTATION_SCOPE_SCHEMA = 'cometflow.implementation-scope.v1';

/** 单文件上限；超过视为二进制/产物，不纳入实现范围比对。 */
export const MAX_SCOPE_FILE_BYTES = 1024 * 1024;
/** 快照文件数上限，防止在大仓库里被 node_modules 之类的目录拖垮。 */
export const MAX_SCOPE_FILES = 5000;
/** 快照里最多保留多少条 omission 明细；超出后只保留计数与哈希。 */
export const MAX_SCOPE_OMISSIONS = 200;

/**
 * 不参与实现范围的目录：机器状态、变更产物、spec、依赖与构建产物。
 *
 * 注意 `specs/` 与 `COMETFLOW.md` 被排除：它们的改动由 spec 生命周期管理
 * （版本 + 基线 + 冲突检测），不属于「代码实现范围」。
 */
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.cometflow',
  '.cometflow-history',
  'changes',
  'reports',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'offline-npm',
  '.cache',
  '.idea',
  '.vscode',
  '__pycache__',
  '.pytest_cache',
]);

const EXCLUDED_FILES = new Set(['COMETFLOW.md', 'pnpm-workspace.yaml']);

export interface ImplementationFileIdentity {
  hash: string;
  size: number;
}

export interface ImplementationChange {
  path: string;
  kind: 'added' | 'modified' | 'removed';
  before: ImplementationFileIdentity | null;
  after: ImplementationFileIdentity | null;
  /** 是否落在 spec 声明的模块边界（或 allow 列表）内。 */
  attributed: boolean;
  /** 归属原因，便于解释为什么某个文件不算越界。 */
  attribution: 'module' | 'module-prefix' | 'allow-list' | 'unattributed';
}

export interface ImplementationBaseline {
  schema: typeof IMPLEMENTATION_SCOPE_SCHEMA;
  change: string;
  captured_at: string;
  complete: boolean;
  fileCount: number;
  files: Record<string, ImplementationFileIdentity>;
  /** 被跳过的路径及原因；`complete=false` 时这里是「为什么不能宣称完整」的答案。 */
  omitted?: ScopeOmission[];
  omittedCount?: number;
  /** omission 明细超过上限时的折叠信息（只保留计数与哈希）。 */
  omissionOverflow?: { count: number; hash: string };
}

export type ScopeOmissionReason =
  | 'file-too-large'
  | 'file-unreadable'
  | 'directory-unreadable'
  | 'file-count-limit';

export interface ScopeOmission {
  path: string;
  reason: ScopeOmissionReason;
  size: number | null;
}

export interface ImplementationScopeReport {
  schema: typeof IMPLEMENTATION_SCOPE_SCHEMA;
  change: string;
  module: string | null;
  allow: string[];
  baseline_captured_at: string | null;
  complete: boolean;
  file_count: number;
  changes: ImplementationChange[];
  attributed: string[];
  unattributed: string[];
  omitted: ScopeOmission[];
  omittedCount: number;
  omissionOverflow: { count: number; hash: string } | null;
}

export interface ImplementationScopeOptions {
  module: string | null;
  allow?: string[];
  now?: Date;
}

function implementationBaselinePath(projectRoot: string, name: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'changes', name, 'impl-baseline.json');
}

async function walk(
  root: string,
  current: string,
  state: {
    files: Record<string, ImplementationFileIdentity>;
    complete: boolean;
    count: number;
    omitted: ScopeOmission[];
    omittedCount: number;
    omissionHash: ReturnType<typeof createHash>;
  },
): Promise<void> {
  if (state.count >= MAX_SCOPE_FILES) {
    state.complete = false;
    recordOmission(state, { path: toPosix(path.relative(root, current)) || '.', reason: 'file-count-limit', size: null });
    return;
  }
  let entries;
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    state.complete = false;
    recordOmission(state, {
      path: toPosix(path.relative(root, current)) || '.',
      reason: 'directory-unreadable',
      size: null,
    });
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      if (current === root && entry.name.startsWith('.')) {
        // 根目录下的隐藏目录（.husky/.github 等）不参与实现范围。
        continue;
      }
      await walk(root, absolute, state);
      continue;
    }
    if (!entry.isFile()) continue;
    if (EXCLUDED_FILES.has(entry.name)) continue;
    const relative = toPosix(path.relative(root, absolute));
    if (relative.startsWith('specs/') || relative === 'COMETFLOW.md') continue;
    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch {
      state.complete = false;
      recordOmission(state, { path: relative, reason: 'file-unreadable', size: null });
      continue;
    }
    if (stat.size > MAX_SCOPE_FILE_BYTES) {
      // 跳过超大文件是必要的，但必须留痕：否则「没比对过」会被当成「没越界」。
      recordOmission(state, { path: relative, reason: 'file-too-large', size: stat.size });
      state.complete = false;
      continue;
    }
    let content: string;
    try {
      content = await readTextFile(absolute);
    } catch {
      recordOmission(state, { path: relative, reason: 'file-unreadable', size: stat.size });
      state.complete = false;
      continue;
    }
    state.files[relative] = { hash: hashSpecText(content), size: stat.size };
    state.count += 1;
    if (state.count >= MAX_SCOPE_FILES) {
      state.complete = false;
      recordOmission(state, { path: relative, reason: 'file-count-limit', size: null });
      return;
    }
  }
}

/**
 * 记录一条 omission。
 *
 * 明细超过上限后只累加计数并把被折叠的条目哈希进 `omissionHash`，
 * 这样即使不保留全部明细，快照之间仍能判断「跳过的东西是否变过」。
 */
function recordOmission(
  state: {
    omitted: ScopeOmission[];
    omittedCount: number;
    omissionHash: ReturnType<typeof createHash>;
  },
  omission: ScopeOmission,
): void {
  state.omittedCount += 1;
  state.omissionHash.update(omission.path + '\u0000' + omission.reason + '\u0000' + (omission.size ?? '') + '\n');
  if (state.omitted.length < MAX_SCOPE_OMISSIONS) state.omitted.push(omission);
}

function emptyWalkState() {
  return {
    files: {} as Record<string, ImplementationFileIdentity>,
    complete: true,
    count: 0,
    omitted: [] as ScopeOmission[],
    omittedCount: 0,
    omissionHash: createHash('sha256'),
  };
}

function omissionSummary(state: { omittedCount: number; omitted: ScopeOmission[]; omissionHash: ReturnType<typeof createHash> }) {
  return {
    omitted: state.omitted,
    omittedCount: state.omittedCount,
    omissionOverflow:
      state.omittedCount > state.omitted.length
        ? { count: state.omittedCount - state.omitted.length, hash: state.omissionHash.digest('hex') }
        : undefined,
  };
}

export async function captureImplementationBaseline(
  projectRoot: string,
  name: string,
  options: { now?: Date } = {},
): Promise<ImplementationBaseline> {
  const state = emptyWalkState();
  await walk(projectRoot, projectRoot, state);
  const baseline: ImplementationBaseline = {
    schema: IMPLEMENTATION_SCOPE_SCHEMA,
    change: name,
    captured_at: (options.now ?? new Date()).toISOString(),
    complete: state.complete,
    fileCount: state.count,
    files: state.files,
    ...omissionSummary(state),
  };
  const filePath = implementationBaselinePath(projectRoot, name);
  await atomicWriteText(filePath, JSON.stringify(baseline, null, 2));
  return baseline;
}

export async function readImplementationBaseline(
  projectRoot: string,
  name: string,
): Promise<ImplementationBaseline | null> {
  try {
    const source = await fs.readFile(implementationBaselinePath(projectRoot, name), 'utf8');
    return JSON.parse(source) as ImplementationBaseline;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function normalizeAllow(allow: string[]): string[] {
  return allow
    .map((entry) => toPosix(entry).replace(/^\.\//u, '').replace(/\/+$/u, ''))
    .filter((entry) => entry !== '' && !entry.startsWith('..'))
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .sort();
}

/**
 * 解析允许越出模块的共享路径。
 *
 * 两个来源，缺一不可：
 * - `COMETFLOW.md` 的 `## 模块归属`：随仓库分发，换机器仍然有效（权威来源）；
 * - `.cometflow/config.yaml` 的 `scope.allow`：本地临时放行，不随仓库走（覆盖用）。
 */
export async function resolveScopeAllow(projectRoot: string): Promise<string[]> {
  const config = await readProjectConfig(projectRoot);
  let shared: string[] = [];
  try {
    shared = (await loadProjectContext(projectRoot))?.shared_paths ?? [];
  } catch {
    shared = [];
  }
  return normalizeAllow([...(config.scope?.allow ?? []), ...shared]);
}

export function attributionFor(
  relativePath: string,
  module: string | null,
  allow: string[],
): ImplementationChange['attribution'] {
  const target = toPosix(relativePath);
  for (const entry of allow) {
    if (target === entry || target.startsWith(entry + '/')) return 'allow-list';
  }
  if (!module) return 'unattributed';
  if (target === module) return 'module';
  if (target.startsWith(module + '/')) return 'module-prefix';
  return 'unattributed';
}

/**
 * 收集本 change 的实现范围：baseline 快照 vs 当前工作区。
 *
 * 借鉴 comet Native 的 declaredArtifacts / unattributed 机制：
 * 「spec 控制模块化代码」不能只靠提示词，必须能指出「哪些文件改动不在声明模块内」，
 * 并把这个结论作为归档前的硬门禁。
 */
export async function collectImplementationScope(
  projectRoot: string,
  name: string,
  options: ImplementationScopeOptions,
): Promise<ImplementationScopeReport> {
  const baseline = await readImplementationBaseline(projectRoot, name);
  const allow = normalizeAllow(options.allow ?? []);
  const current = emptyWalkState();
  await walk(projectRoot, projectRoot, current);

  const omission = omissionSummary(current);
  const baselineOmissions = baseline?.omitted ?? [];
  const baselineOmittedCount = baseline?.omittedCount ?? baselineOmissions.length;

  // 没有基线就等于没有参照物：不能拿「空快照」去比，否则仓库里每个文件都会被算成越界新增。
  // 这类 change（在实现范围机制之前创建）只能报告「无法判定」，把判断权交回给人。
  if (baseline === null) {
    return {
      schema: IMPLEMENTATION_SCOPE_SCHEMA,
      change: name,
      module: options.module,
      allow,
      baseline_captured_at: null,
      complete: false,
      file_count: Object.keys(current.files).length,
      changes: [],
      attributed: [],
      unattributed: [],
      omitted: omission.omitted,
      omittedCount: omission.omittedCount,
      omissionOverflow: omission.omissionOverflow ?? null,
    };
  }

  const baselineFiles = baseline.files;
  const changes: ImplementationChange[] = [];
  const paths = new Set([...Object.keys(baselineFiles), ...Object.keys(current.files)]);

  for (const relativePath of [...paths].sort()) {
    const before = baselineFiles[relativePath] ?? null;
    const after = current.files[relativePath] ?? null;
    if (before && after && before.hash === after.hash && before.size === after.size) continue;
    const kind: ImplementationChange['kind'] = before ? (after ? 'modified' : 'removed') : 'added';
    const attribution = attributionFor(relativePath, options.module, allow);
    changes.push({
      path: relativePath,
      kind,
      before,
      after,
      attributed: attribution !== 'unattributed',
      attribution,
    });
  }

  const attributed = changes.filter((entry) => entry.attributed).map((entry) => entry.path);
  const unattributed = changes.filter((entry) => !entry.attributed).map((entry) => entry.path);
  return {
    schema: IMPLEMENTATION_SCOPE_SCHEMA,
    change: name,
    module: options.module,
    allow,
    baseline_captured_at: baseline?.captured_at ?? null,
    // baseline 不完整时不能宣称范围完整（否则会把「没比对过」当成「没越界」）。
    complete: baseline.complete && current.complete && unattributed.length === 0,
    file_count: Object.keys(current.files).length,
    changes,
    attributed,
    unattributed,
    // 快照本身的 omission 也要暴露：它是「判定可能不完整」的直接证据。
    omitted: [...baselineOmissions, ...omission.omitted],
    omittedCount: baselineOmittedCount + omission.omittedCount,
    omissionOverflow:
      baseline?.omissionOverflow ?? omission.omissionOverflow ?? null,
  };
}
