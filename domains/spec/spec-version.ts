import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readTextFile } from '../../platform/fs/read-file.js';
import { toPosix } from '../../platform/paths/relative.js';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';
import { hashSpecText, normalizeSpecText } from './spec-hash.js';
import { listSpecFiles } from './spec-index.js';
import { computeSpecLock, writeSpecLock, type SpecLock } from './spec-lock.js';

export const SPEC_HISTORY_SCHEMA = 'cometflow.spec-history.v1';

/**
 * 版本仓默认放在**仓库内可提交**的目录，而不是被 gitignore 的 `.cometflow/`。
 *
 * 理由：如果版本仓不进版本控制，换台机器 `spec show specs/x/spec.md@2` 就会失败，
 * 「spec 即产物」在协作场景就只剩一半。`.cometflow-history/` 里只有 spec 正文与版本链，
 * 不含运行状态，适合随 git 分发。
 */
export const SPEC_HISTORY_DIR = '.cometflow-history';
const LEGACY_HISTORY_DIR = '.cometflow';

export interface SpecVersionRecord {
  /** 每个 spec 文件独立单调递增，从 1 开始。 */
  spec_version: number;
  /** 归一化内容的 sha256，同时是该版本在 blob 仓中的地址。 */
  hash: string;
  recorded_at: string;
  /** 产生该版本的 change 名称；人工 lock/restore 时为 null。 */
  change: string | null;
  /** 该版本的上一个内容哈希，形成可回溯的版本链。 */
  parent: string | null;
  note: string | null;
}

export interface SpecHistory {
  schema: typeof SPEC_HISTORY_SCHEMA;
  specs: Record<string, SpecVersionRecord[]>;
}

export interface RecordSpecVersionOptions {
  specPath: string;
  content: string;
  change?: string | null;
  note?: string | null;
  now?: Date;
}

export function specHistoryPath(projectRoot: string): string {
  return path.join(projectRoot, SPEC_HISTORY_DIR, 'spec-history.json');
}

export function specVersionStoreDir(projectRoot: string): string {
  return path.join(projectRoot, SPEC_HISTORY_DIR, 'spec-versions');
}

export function specVersionBlobPath(projectRoot: string, hash: string): string {
  return path.join(specVersionStoreDir(projectRoot), hash + '.md');
}

function legacySpecHistoryPath(projectRoot: string): string {
  return path.join(projectRoot, LEGACY_HISTORY_DIR, 'spec-history.json');
}

function legacySpecVersionBlobPath(projectRoot: string, hash: string): string {
  return path.join(projectRoot, LEGACY_HISTORY_DIR, 'spec-versions', hash + '.md');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** 读历史时兼容旧位置：老项目不需要手工迁移，第一次写入即完成搬迁。 */
async function resolveHistoryPath(projectRoot: string): Promise<string> {
  const current = specHistoryPath(projectRoot);
  if (await fileExists(current)) return current;
  const legacy = legacySpecHistoryPath(projectRoot);
  if (await fileExists(legacy)) return legacy;
  return current;
}

/**
 * 一个 blob 可能出现的位置：当前目录在前，旧目录在后。
 *
 * 导出它是为了让调用方（迁移、清理、测试）不必自己拼路径——
 * 之前有两个测试硬编码了旧路径，在干净检出上直接失败，正是这么来的。
 */
export function specVersionBlobCandidates(projectRoot: string, hash: string): string[] {
  return [specVersionBlobPath(projectRoot, hash), legacySpecVersionBlobPath(projectRoot, hash)];
}

async function resolveBlobPath(projectRoot: string, hash: string): Promise<string | null> {
  for (const candidate of specVersionBlobCandidates(projectRoot, hash)) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

function emptyHistory(): SpecHistory {
  return { schema: SPEC_HISTORY_SCHEMA, specs: {} };
}

export async function readSpecHistory(projectRoot: string): Promise<SpecHistory> {
  try {
    const source = await fs.readFile(await resolveHistoryPath(projectRoot), 'utf8');
    const parsed = JSON.parse(source) as Partial<SpecHistory>;
    return {
      schema: SPEC_HISTORY_SCHEMA,
      specs: parsed.specs ?? {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyHistory();
    throw error;
  }
}

async function writeSpecHistory(projectRoot: string, history: SpecHistory): Promise<string> {
  const filePath = specHistoryPath(projectRoot);
  await atomicWriteText(filePath, JSON.stringify(history, null, 2));
  return filePath;
}

export function specVersionsFor(history: SpecHistory, specPath: string): SpecVersionRecord[] {
  return history.specs[toPosix(specPath)] ?? [];
}

export async function latestSpecVersion(
  projectRoot: string,
  specPath: string,
): Promise<SpecVersionRecord | null> {
  const history = await readSpecHistory(projectRoot);
  const versions = specVersionsFor(history, specPath);
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

/**
 * 读出某个 spec 的「最新已登记版本」内容。
 *
 * 这是 spec diff / impact 的比对基线：只要任何一次 canonical spec 变更都走
 * refreshSpecBaseline 记账，最新登记版本就等于 spec-lock 的内容，
 * 于是 spec diff 与 impact 两个视图不会互相矛盾。
 */
export async function latestSpecVersionContent(
  projectRoot: string,
  specPath: string,
): Promise<{ record: SpecVersionRecord; content: string } | null> {
  const record = await latestSpecVersion(projectRoot, specPath);
  if (!record) return null;
  const content = await readSpecBlob(projectRoot, record.hash);
  if (content === null) return null;
  return { record, content };
}

/**
 * 写入内容寻址 blob。同一 hash 只存一份，重复写是幂等的。
 */
export async function storeSpecBlob(projectRoot: string, content: string): Promise<string> {
  const normalized = normalizeSpecText(content);
  const hash = hashSpecText(normalized);
  if (await resolveBlobPath(projectRoot, hash)) return hash;
  const blobPath = specVersionBlobPath(projectRoot, hash);
  // 内容寻址：半写的 blob 会让「按冻结版本重建」永久失效，必须原子落盘。
  await atomicWriteText(blobPath, normalized);
  return hash;
}

export async function readSpecBlob(projectRoot: string, hash: string): Promise<string | null> {
  const blobPath = await resolveBlobPath(projectRoot, hash);
  if (blobPath === null) return null;
  try {
    return await readTextFile(blobPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function hasSpecBlob(projectRoot: string, hash: string): Promise<boolean> {
  return (await resolveBlobPath(projectRoot, hash)) !== null;
}

/**
 * 记录一个 spec 版本。
 *
 * - 内容与当前最新版本相同 → 不产生新版本，直接返回已有记录（幂等）。
 * - 内容变化 → spec_version + 1，parent 指向上一版本 hash。
 */
export async function recordSpecVersion(
  projectRoot: string,
  options: RecordSpecVersionOptions,
): Promise<SpecVersionRecord> {
  const specPath = toPosix(options.specPath);
  const hash = await storeSpecBlob(projectRoot, options.content);
  const history = await readSpecHistory(projectRoot);
  const versions = history.specs[specPath] ?? [];
  const latest = versions.length > 0 ? versions[versions.length - 1] : null;

  if (latest && latest.hash === hash) return latest;

  const record: SpecVersionRecord = {
    spec_version: (latest?.spec_version ?? 0) + 1,
    hash,
    recorded_at: (options.now ?? new Date()).toISOString(),
    change: options.change ?? null,
    parent: latest?.hash ?? null,
    note: options.note ?? null,
  };
  history.specs[specPath] = [...versions, record];
  await writeSpecHistory(projectRoot, history);
  return record;
}

export interface RefreshSpecBaselineOptions {
  change?: string | null;
  note?: string | null;
  now?: Date;
}

export interface RefreshSpecBaselineResult {
  lock: SpecLock;
  recorded: { path: string; spec_version: number; hash: string }[];
}

/**
 * 刷新 spec 基线：先把 specs/ 全部内容写入版本仓，再刷新 spec-lock.json。
 *
 * 这是「归档即记账」的落点：任何改变 canonical spec 的动作都应该走这里，
 * 否则 spec-lock 会过期、冻结任务的 spec_hash 会在版本仓里查不到。
 */
export async function refreshSpecBaseline(
  projectRoot: string,
  options: RefreshSpecBaselineOptions = {},
): Promise<RefreshSpecBaselineResult> {
  const files = await listSpecFiles(projectRoot);
  const recorded: { path: string; spec_version: number; hash: string }[] = [];
  for (const relativePath of files) {
    const content = await readTextFile(path.join(projectRoot, relativePath));
    const record = await recordSpecVersion(projectRoot, {
      specPath: relativePath,
      content,
      change: options.change ?? null,
      note: options.note ?? null,
      now: options.now,
    });
    recorded.push({ path: relativePath, spec_version: record.spec_version, hash: record.hash });
  }
  const lock = await computeSpecLock(projectRoot);
  await writeSpecLock(projectRoot, lock);
  return { lock, recorded };
}

export interface ResolvedSpecVersion {
  path: string;
  record: SpecVersionRecord;
}

export class SpecVersionNotFoundError extends Error {
  constructor(ref: string) {
    super('Unknown spec version reference: ' + ref);
    this.name = 'SpecVersionNotFoundError';
  }
}

function normalizeRef(ref: string): string {
  return toPosix(ref.trim());
}

/**
 * 解析版本引用，支持三种写法：
 *   - `specs/auth/spec.md@3` —— 指定路径的第 3 版
 *   - `<hash>`               —— 内容寻址（在版本链里反查路径）
 *   - `@3`                   —— 仅当版本号在版本链中唯一时可用
 */
export async function resolveSpecVersionRef(
  projectRoot: string,
  ref: string,
): Promise<ResolvedSpecVersion> {
  const history = await readSpecHistory(projectRoot);
  const value = normalizeRef(ref);

  if (/^[a-f0-9]{64}$/u.test(value)) {
    for (const [specPath, versions] of Object.entries(history.specs)) {
      const record = versions.find((entry) => entry.hash === value);
      if (record) return { path: specPath, record };
    }
    throw new SpecVersionNotFoundError(ref);
  }

  const at = value.split('@');
  const explicitPath = at.length === 2 && at[0] !== '' ? at[0] : null;
  const versionText = at.length === 2 ? at[1] : null;
  if (versionText === null) throw new SpecVersionNotFoundError(ref);

  const version = Number.parseInt(versionText, 10);
  if (!Number.isInteger(version) || version <= 0) throw new SpecVersionNotFoundError(ref);

  const candidates = explicitPath
    ? [[toPosix(explicitPath), history.specs[toPosix(explicitPath)] ?? []] as const]
    : Object.entries(history.specs);

  const matches: ResolvedSpecVersion[] = [];
  for (const [specPath, versions] of candidates) {
    const record = versions.find((entry) => entry.spec_version === version);
    if (record) matches.push({ path: specPath, record });
  }
  if (matches.length !== 1) throw new SpecVersionNotFoundError(ref);
  return matches[0];
}
