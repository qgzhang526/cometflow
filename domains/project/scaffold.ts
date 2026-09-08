import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';

export type SpecKind =
  | 'project'
  | 'models'
  | 'protocol'
  | 'errors'
  | 'config'
  | 'capability'
  | 'flow'
  | 'process'
  | 'rules'
  | 'constraints'
  | 'permissions'
  | 'pages';

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
  const kinds: Record<SpecKind, KindEntry> = {
    project: { status: 'present', reason: 'always' },
    models: firstLayer(stack.database, 'database != none', 'database == none'),
    pages: firstLayer(stack.frontend, 'frontend != none', 'frontend == none'),
    constraints: firstLayer(stack.backend, 'backend present', 'no backend'),
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
      ? { status: 'present', reason: 'many error codes' }
      : { status: 'absent', reason: 'merged into protocol' };
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

| code | 语义 | 触发接口 |
|------|------|----------|
| EXAMPLE | 示例错误码 | POST /example |
`;

const TEMPLATE_CONFIG = `# 运行时配置

运行时配置契约：键 → 类型 → 默认值 → 必填 → 敏感。

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

const KIND_FILE: Partial<Record<SpecKind, string>> = {
  models: 'specs/models.md',
  protocol: 'specs/protocol.md',
  errors: 'specs/errors.md',
  config: 'specs/config.md',
  constraints: 'specs/constraints.md',
  permissions: 'specs/permissions.md',
  rules: 'specs/rules.md',
  process: 'specs/processes.md',
  pages: 'specs/pages.md',
};

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

    const relativePath = KIND_FILE[kind];
    if (!relativePath) continue;
    const absolutePath = path.join(projectRoot, relativePath);
    try {
      await fs.access(absolutePath);
      skipped.push(relativePath);
    } catch {
      const template = templateFor(kind, answers);
      if (template === null) continue;
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, template);
      created.push(relativePath);
    }
  }

  return { created, skipped };
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
  const kinds = detectKindNeeds(stack, answers);
  const { created, skipped } = await scaffoldKinds(projectRoot, kinds, answers);
  const manifestPath = await writeInitManifest(projectRoot, kinds);
  return { kinds, created, skipped, manifestPath };
}
