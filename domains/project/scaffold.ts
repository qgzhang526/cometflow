import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { pathExists } from '../../platform/fs/read-file.js';
import { ROOT_KIND_FILES, SPEC_KINDS, kindForSpecFile } from '../spec/kind.js';
import { listSpecFiles } from '../spec/spec-index.js';
import { setSpecStatus } from '../spec/spec-meta.js';
import type { SpecKind } from '../spec/kind.js';

export type { SpecKind } from '../spec/kind.js';


export type KindStatus = 'present' | 'deferred' | 'absent';

export interface KindEntry {
  status: KindStatus;
  reason: string;
}

export interface InitManifest {
  schema: 'cometflow.init-manifest.v1';
  kinds: Record<SpecKind, KindEntry>;
}

export const INIT_MANIFEST_SCHEMA = 'cometflow.init-manifest.v1';

export interface StackHints {
  frontend?: string;
  backend?: string;
  database?: string;
}

export interface ScaffoldAnswers {
  network?: boolean;
  runtimeConfig?: boolean;
  crossApiFlow?: boolean;
  backgroundProcess?: boolean;
  domainDsl?: boolean;
  auth?: 'none' | 'machine' | 'roles';
  manyErrors?: boolean;
}

export interface ScaffoldResult {
  kinds: Record<SpecKind, KindEntry>;
  created: string[];
  skipped: string[];
  manifestPath: string;
}

export function initManifestPath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'init-manifest.yaml');
}

function isNone(value: string): boolean {
  const v = value.trim();
  if (v === '无' || v.toLowerCase() === 'none') return true;
  if (v.startsWith('[无') || v.includes('待定') || v.includes('TODO')) return true;
  return false;
}

function firstLayer(value: string | undefined, presentReason: string, absentReason: string): KindEntry {
  if (value === undefined) {
    return { status: 'deferred', reason: 'unknown: fill COMETFLOW.md then run spec scaffold' };
  }
  if (value.includes('[') || value.includes(']')) {
    return { status: 'deferred', reason: 'placeholder: fill COMETFLOW.md then run spec scaffold' };
  }
  if (value === '' || isNone(value)) {
    return { status: 'absent', reason: absentReason };
  }
  return { status: 'present', reason: presentReason };
}

export function detectKindNeeds(stack: StackHints, answers: ScaffoldAnswers = {}): Record<SpecKind, KindEntry> {
  const databaseLayer = firstLayer(stack.database, 'database != none', 'database == none');
  const frontendLayer = firstLayer(stack.frontend, 'frontend != none', 'frontend == none');
  const backendLayer = firstLayer(stack.backend, 'backend present', 'no backend');
  const stackKnown = [databaseLayer, frontendLayer, backendLayer].some((entry) => entry.status !== 'deferred');

  const kinds: Record<SpecKind, KindEntry> = {
    project: { status: 'present', reason: 'always' },
    models: databaseLayer,
    pages: frontendLayer,
    // Non-functional constraints apply to every project, including frontend-only
    // and CLI-only ones, so they are not gated on having a backend.
    constraints: stackKnown
      ? { status: 'present', reason: 'non-functional constraints apply to all projects' }
      : { status: 'deferred', reason: 'unknown: fill COMETFLOW.md then run spec scaffold' },
    capability: { status: 'absent', reason: 'derived from goals, not init' },
    protocol: { status: 'deferred', reason: 'use --interactive' },
    errors: { status: 'deferred', reason: 'use --interactive' },
    config: { status: 'deferred', reason: 'use --interactive' },
    flow: { status: 'deferred', reason: 'use --interactive' },
    process: { status: 'deferred', reason: 'use --interactive' },
    rules: { status: 'deferred', reason: 'use --interactive' },
    permissions: { status: 'deferred', reason: 'use --interactive' },
  };

  if (answers.network !== undefined) {
    kinds.protocol = answers.network
      ? { status: 'present', reason: 'network: yes' }
      : { status: 'absent', reason: 'no network interface' };
  }
  if (answers.runtimeConfig !== undefined) {
    kinds.config = answers.runtimeConfig
      ? { status: 'present', reason: 'runtime config: yes' }
      : { status: 'absent', reason: 'no runtime config' };
  }
  if (answers.crossApiFlow !== undefined) {
    kinds.flow = answers.crossApiFlow
      ? { status: 'present', reason: 'cross-api scenario: yes' }
      : { status: 'absent', reason: 'no cross-api scenario' };
  }
  if (answers.backgroundProcess !== undefined) {
    kinds.process = answers.backgroundProcess
      ? { status: 'present', reason: 'background process: yes' }
      : { status: 'absent', reason: 'no background loop' };
  }
  if (answers.domainDsl !== undefined) {
    kinds.rules = answers.domainDsl
      ? { status: 'present', reason: 'domain dsl: yes' }
      : { status: 'absent', reason: 'no domain dsl' };
  }
  if (answers.auth !== undefined) {
    kinds.permissions = answers.auth === 'none'
      ? { status: 'absent', reason: 'auth: none' }
      : { status: 'present', reason: 'auth: ' + answers.auth };
  }
  if (answers.manyErrors !== undefined) {
    kinds.errors = answers.manyErrors
      ? { status: 'present', reason: 'dedicated error catalogue requested' }
      : { status: 'absent', reason: 'merged into the 错误码 table of specs/protocol.md' };
  }

  return kinds;
}

const TEMPLATE_MODELS = `# 数据模型

唯一数据字典：实体、字段、枚举（对照表）、状态机。字段/枚举/状态只在此定义，其余 spec 文件只引用、不重述。

## 实体：<Name>

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| id | string (UUID) | 是 | 是 | 主键 |

## 枚举

格式：0=值A, 1=值B；对照表只在此维护。

## 状态机：<Entity>

| 当前状态 | 事件 | 目标状态 |
|----------|------|----------|
| A | event | B |
`;

const TEMPLATE_PROTOCOL = `# 通信协议

传输契约：传输方式、压缩、请求头、响应包络、状态码总表。

## 传输方式

- 仅 HTTPS

## 压缩

- gzip

## 请求头

| 头 | 类型 | 必填 | 说明 |
|----|------|------|------|
| User-Agent | string | 是 | 客户端标识 |

## 响应包络

{ "type": 0, "message": "" }

## 状态码总表

| 状态码 | 含义 | 说明 |
|--------|------|------|
| 200 | OK | 成功 |
`;

const TEMPLATE_ERRORS = `# 错误码目录

全局错误码：code → 语义 → 触发接口。小项目可并入 protocol.md。

## 错误码

| code | 语义 | 触发接口 |
|------|------|----------|
| EXAMPLE | 示例错误码 | POST /example |
`;

const TEMPLATE_CONFIG = `# 运行时配置

运行时配置契约：键 → 类型 → 默认值 → 必填 → 敏感。

## 配置项

| 键 | 类型 | 默认值 | 必填 | 敏感 | 说明 |
|----|------|--------|------|------|------|
| PORT | integer | 8080 | 否 | 否 | 监听端口 |
`;

const TEMPLATE_CONSTRAINTS = `# 非功能约束

技术栈之外的非功能需求：安全、性能、数据、高可用、部署、离线依赖。

## 安全约束

（bcrypt/JWT/脱敏/SQL 注入防护等）

## 性能约束

| 指标 | 目标值 |
|------|--------|
| 示例指标 | 目标 |

## 数据约束

（保留周期、存储策略等）

## 高可用约束

（水平扩展、重试、恢复等）

## 部署约束

（OS、运行时、容器、端口分离等）

## 离线依赖管理

（vendor / lockfile 约定，按需填写）
`;

const TEMPLATE_RULES = `# 领域规则

领域不变量与外部 DSL 语义；不描述常驻进程（进程归 processes.md），不重述字段（字段归 models.md）。

## 规则：<Name>

- 语义：
- 操作逻辑：add/del/reset（按需）
`;

const TEMPLATE_PROCESSES = `# 后台进程

常驻/后台进程：触发条件、输入、处理逻辑、输出、异常处理。与 flow 的区别：process 是常驻循环，flow 是一次性场景。

## 进程：<Name>

- 触发条件：
- 输入：
- 处理逻辑：
- 输出：
- 异常处理：
- 引用 API：
`;

const TEMPLATE_PAGES = `# 前端页面

前端页面/交互/路由规格。

## 页面：<Name>

- 路由：
- 交互：
- 状态：
`;

// Unicode letters/digits so Chinese capability names (工标章节名) are usable as
// directory names; path separators, leading dots and traversal stay rejected.
const CAPABILITY_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

// Capability specs are never authored by init: they come from the project's goals
// (`plan generate` emits a spec-authoring task) or from a fixed external standard
// that the human transcribes verbatim. This stub only seeds the canonical shape.
export function capabilitySpecPath(capability: string): string | null {
  if (!CAPABILITY_NAME_PATTERN.test(capability)) return null;
  return 'specs/' + capability + '/spec.md';
}

function capabilityTemplate(capability: string): string {
  return `---
capability: ${capability}
# 该 capability 的实现模块边界（项目相对路径）；拆解时任务会继承它
module: internal/${capability}
# 骨架是机器产的占位内容，不能直接当契约用：确认后 cometflow spec approve specs/${capability}/spec.md
status: draft
---

# ${capability}

接口契约：一个接口一个 \`## METHOD /path\` anchor；字段引用 specs/models.md，错误码引用 specs/errors.md（或 specs/protocol.md 的「错误码」表），不在此重述。

## GET /example

- 认证：<机器认证 / 角色 / 无>
- 请求：<字段名，引用 specs/models.md>
- 响应：<字段名>
- 错误码：<CODE>

## Acceptance

- A1：<可验证的验收标准>
`;
}

function permissionsTemplate(auth: ScaffoldAnswers['auth']): string {
  if (auth === 'roles') {
    return `# 认证与鉴权

有人类用户与角色，使用角色 × API 权限矩阵。

## 角色定义

| 角色 | 说明 |
|------|------|
| admin | 系统管理员，拥有全部权限 |
| viewer | 只读用户 |

## 接口级权限

| API | admin | viewer | 说明 |
|-----|-------|--------|------|
| GET /example | ✓ | ✓ | |
`;
  }
  return `# 认证与鉴权

无人类用户，机机通信认证。

## 认证方式

（API Key / Cookie Session / mTLS 等，按需填写）

- 无需 RBAC：无人类角色，不实现角色中间件。
`;
}

function templateFor(kind: SpecKind, answers: ScaffoldAnswers): string | null {
  switch (kind) {
    case 'models': return TEMPLATE_MODELS;
    case 'protocol': return TEMPLATE_PROTOCOL;
    case 'errors': return TEMPLATE_ERRORS;
    case 'config': return TEMPLATE_CONFIG;
    case 'constraints': return TEMPLATE_CONSTRAINTS;
    case 'permissions': return permissionsTemplate(answers.auth);
    case 'rules': return TEMPLATE_RULES;
    case 'process': return TEMPLATE_PROCESSES;
    case 'pages': return TEMPLATE_PAGES;
    default: return null;
  }
}

export async function scaffoldKinds(
  projectRoot: string,
  kinds: Record<SpecKind, KindEntry>,
  answers: ScaffoldAnswers = {},
): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const [kind, entry] of Object.entries(kinds) as [SpecKind, KindEntry][]) {
    if (entry.status !== 'present') continue;

    if (kind === 'flow') {
      const dir = path.join(projectRoot, 'specs', 'flows');
      try {
        await fs.access(dir);
        skipped.push('specs/flows/');
      } catch {
        await fs.mkdir(dir, { recursive: true });
        created.push('specs/flows/');
      }
      continue;
    }

    const relativePath = ROOT_KIND_FILES[kind];
    if (!relativePath) continue;
    const absolutePath = path.join(projectRoot, relativePath);
    try {
      await fs.access(absolutePath);
      skipped.push(relativePath);
    } catch {
      const template = templateFor(kind, answers);
      if (template === null) continue;
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      // 骨架是机器产的占位内容（`<Name>` / `EXAMPLE` 这类），在有人确认之前不是契约，
      // 所以与 capability 骨架走同一口径：落盘即 `status: draft`，由 `spec approve` 定稿。
      // 漏掉这一行会让「人还没填」的占位文件以已定稿身份进入引用校验与问题清单（G1 的补漏）。
      await fs.writeFile(absolutePath, setSpecStatus(template, 'draft'));
      created.push(relativePath);
    }
  }

  return { created, skipped };
}

export interface CapabilityScaffoldResult {
  created: string[];
  skipped: string[];
  invalid: string[];
}

// Seeds `specs/<capability>/spec.md` for capabilities that are already decided by
// goals or by an external standard. Idempotent: existing files are never touched.
export async function scaffoldCapabilities(
  projectRoot: string,
  capabilities: string[],
): Promise<CapabilityScaffoldResult> {
  const created: string[] = [];
  const skipped: string[] = [];
  const invalid: string[] = [];

  for (const capability of capabilities) {
    const relativePath = capabilitySpecPath(capability);
    if (!relativePath) {
      invalid.push(capability);
      continue;
    }
    const absolutePath = path.join(projectRoot, relativePath);
    try {
      await fs.access(absolutePath);
      skipped.push(relativePath);
    } catch {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, capabilityTemplate(capability));
      created.push(relativePath);
    }
  }

  return { created, skipped, invalid };
}

/**
 * 磁盘事实：specs/ 下每个 kind 到底有没有文件。
 *
 * 与 `detectKindNeeds`（从技术栈与问答**倒推**）相对：这里只回答「文件在不在」。
 * 两条产出路径需要它——「先有规格包、后有项目」的接入，以及日常新建 capability 之后
 * 校正 init-manifest：`detectKindNeeds` 把 capability 写死成 `absent`，所以只要不按磁盘
 * 事实校正一次，12-kind 页就会一直把已经存在的 capability 报成「由目标派生」。
 */
export async function detectKindEvidence(projectRoot: string): Promise<Record<SpecKind, boolean>> {
  const present = new Set((await listSpecFiles(projectRoot)).map((file) => kindForSpecFile(file)));
  const evidence = {} as Record<SpecKind, boolean>;
  for (const kind of SPEC_KINDS) evidence[kind] = present.has(kind);
  // COMETFLOW.md 不在 specs/ 下，扫不到它，单独判一次。
  if (await pathExists(path.join(projectRoot, 'COMETFLOW.md'))) evidence.project = true;
  return evidence;
}

/** capability 不是「本项目需不需要」的问题，而是「磁盘上有几份」的事实，所以 reason 单独写。 */
const KIND_EVIDENCE_REASON: Partial<Record<SpecKind, string>> = {
  capability: '磁盘上已存在 capability spec（不由 init 生成）',
};

/**
 * 合并「推断结果」与「磁盘事实」。四支的优先级是有意的：
 *
 * 1. 文件存在、旧判定已经是 present → 保留旧判定（连 reason 一起，那是 scaffold / 接入 /
 *    人写下的来源说明，不该被重算冲掉）；
 * 2. 文件存在、推断也说 present → 用推断结果；
 * 3. 文件存在、推断说 absent/deferred → 以磁盘为准判 present。capability 永远走这一支：
 *    它由目标或外部标准决定，`detectKindNeeds` 推不出来；
 * 4. 文件不存在 → 用推断结果。`absent` 是「本项目不需要」的显式决定，`deferred` 是「需要时
 *    再补」，两者都不该被「这次没扫到文件」推翻；真缺文件由 `spec validate` 报出来。
 */
async function mergeKindEntries(
  projectRoot: string,
  detected: Record<SpecKind, KindEntry>,
  previous: InitManifest | null,
): Promise<Record<SpecKind, KindEntry>> {
  const evidence = await detectKindEvidence(projectRoot);
  const merged: Record<SpecKind, KindEntry> = { ...detected };

  for (const kind of SPEC_KINDS) {
    if (evidence[kind] !== true) continue;
    const before = previous?.kinds[kind];
    if (before?.status === 'present') merged[kind] = before;
    else if (detected[kind]?.status !== 'present') {
      merged[kind] = { status: 'present', reason: KIND_EVIDENCE_REASON[kind] ?? '磁盘上已存在' };
    }
  }

  return merged;
}

export interface ManifestReconcileResult {
  /** 被磁盘证据改写的 kind（status 从 absent/deferred 变成 present）。 */
  changed: SpecKind[];
  /** 校正后的 kinds；没有 init-manifest 时返回 null——不凭磁盘凭空造一份。 */
  kinds: Record<SpecKind, KindEntry> | null;
}

/**
 * 两份 manifest 之间的状态差异。
 *
 * 「这次改了什么」必须靠前后快照对比得出：`scaffoldProject` 自己就会把磁盘事实合并进去，
 * 事后再单独跑一次校正往往是空操作，只看它的返回值会漏报。
 */
export function changedKindStatuses(
  before: Record<string, KindEntry> | null,
  after: Record<string, KindEntry>,
): SpecKind[] {
  return SPEC_KINDS.filter((kind) => before?.[kind]?.status !== after[kind]?.status);
}

/**
 * 按磁盘事实校正 init-manifest，只做「文件存在 → present」这一个方向。
 *
 * - 文件存在但 manifest 说 absent/deferred：那一定是推断错了（capability 尤其如此）；
 * - 文件不存在：**原样保留**旧判。`absent` 是「本项目不需要」的显式决定，`deferred` 是
 *   「需要时再补」的约定，两者都不该被「这次没扫到文件」推翻；
 * - 已经 present 的条目不重写，reason 保留——那是 `spec scaffold`、接入或人写下的来源说明。
 *
 * 判据与 `scaffoldProject` 用的是同一份 `mergeKindEntries`；这条独立入口给不走
 * `scaffoldProject` 的写盘路径（Web 新建 spec 文件、将来的项目接入）收尾用。
 */
export async function reconcileInitManifest(projectRoot: string): Promise<ManifestReconcileResult> {
  const previous = await readInitManifest(projectRoot);
  if (previous === null) return { changed: [], kinds: null };

  const kinds = await mergeKindEntries(projectRoot, previous.kinds, previous);
  const changed = changedKindStatuses(previous.kinds, kinds);
  if (changed.length > 0) await writeInitManifest(projectRoot, kinds);
  return { changed, kinds };
}

export async function readInitManifest(projectRoot: string): Promise<InitManifest | null> {
  try {
    const source = await fs.readFile(initManifestPath(projectRoot), 'utf8');
    return parse(source) as InitManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeInitManifest(projectRoot: string, kinds: Record<SpecKind, KindEntry>): Promise<string> {
  const manifest: InitManifest = { schema: INIT_MANIFEST_SCHEMA, kinds };
  const filePath = initManifestPath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringify(manifest));
  return filePath;
}

export async function scaffoldProject(
  projectRoot: string,
  stack: StackHints,
  answers: ScaffoldAnswers = {},
): Promise<ScaffoldResult> {
  const detected = detectKindNeeds(stack, answers);
  const { created, skipped } = await scaffoldKinds(projectRoot, detected, answers);
  // init-manifest 不是技术栈的单方面投影：技术栈推不出 capability，也不该把已经落盘的 spec
  // 降级成 deferred——那会让 12-kind 页报出与磁盘相反的结论（见 docs/plan/project-adopt-plan.md §2.2）。
  const kinds = await mergeKindEntries(projectRoot, detected, await readInitManifest(projectRoot));
  const manifestPath = await writeInitManifest(projectRoot, kinds);
  return { kinds, created, skipped, manifestPath };
}
