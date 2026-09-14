import path from 'node:path';
import { parseSpecFile } from './spec-parse.js';
import { listSpecFiles } from './spec-index.js';
import { loadProjectContext, validateProjectContext } from '../project/context.js';
import { pathExists, readTextFile } from '../../platform/fs/read-file.js';
import { kindForSpecFile, ROOT_KIND_FILES, type SpecKind } from './kind.js';
import { readInitManifest } from '../project/scaffold.js';
import { parseCapability, parseModels } from './spec-model.js';
import { normalizeModulePath, parseSpecMeta } from './spec-meta.js';
import {
  extractApiPathRefs,
  extractApiReferences,
  extractConfigKeyRefs,
  extractConfigKeys,
  extractEntities,
  extractErrorCodeRefs,
  extractErrorCodes,
  extractFlowSteps,
  extractHeaderRefs,
  extractHeadings,
  extractModelRefs,
  extractProcesses,
  extractProtocolHeaders,
  extractProtocolStatusCodes,
  extractSectionErrorCodes,
  extractStatusRefs,
  normalizeApiHeading,
} from './spec-structure.js';
import type { SpecValidationFinding, SpecValidationResult } from './types.js';

interface CrossRefIndex {
  apiAnchors: Set<string>;
  modelsContent: string | null;
  modelsEntities: Set<string>;
  modelsFields: Map<string, Set<string>>;
  errorsContent: string | null;
  errorCodes: Set<string>;
  configContent: string | null;
  configKeys: Set<string>;
  protocolContent: string | null;
  protocolHeaders: Set<string>;
  protocolStatusCodes: Set<string>;
}

function error(pathValue: string, code: string, message: string): SpecValidationFinding {
  return { path: pathValue, severity: 'error', code, message };
}

function warning(pathValue: string, code: string, message: string): SpecValidationFinding {
  return { path: pathValue, severity: 'warning', code, message };
}

async function readRootKind(projectRoot: string, kind: SpecKind): Promise<string | null> {
  const relativePath = ROOT_KIND_FILES[kind];
  if (!relativePath) return null;
  const absolutePath = path.join(projectRoot, relativePath);
  if (!(await pathExists(absolutePath))) return null;
  return readTextFile(absolutePath);
}

// Error codes are owned by specs/errors.md, or by the `## 错误码` table of
// specs/protocol.md when a small project keeps a single contract file.
function collectErrorCodes(errorsContent: string | null, protocolContent: string | null): Set<string> {
  const codes = new Set<string>();
  if (errorsContent) for (const code of extractErrorCodes(errorsContent)) codes.add(code);
  if (protocolContent) for (const code of extractSectionErrorCodes(protocolContent)) codes.add(code);
  return codes;
}

async function validateManifest(projectRoot: string, findings: SpecValidationFinding[]): Promise<void> {
  const manifest = await readInitManifest(projectRoot);
  if (!manifest) return;

  for (const kind of Object.keys(ROOT_KIND_FILES) as SpecKind[]) {
    const relativePath = ROOT_KIND_FILES[kind];
    if (!relativePath) continue;
    const entry = manifest.kinds[kind];
    const exists = await pathExists(path.join(projectRoot, relativePath));
    if (entry?.status === 'present' && !exists) {
      findings.push(error(relativePath, 'missing-kind-file', 'kind ' + kind + ' is present in init-manifest but file is missing'));
    } else if (entry?.status === 'deferred' && !exists) {
      findings.push(warning(relativePath, 'deferred-kind-file', 'kind ' + kind + ' is deferred; run cometflow spec scaffold --interactive'));
    }
  }
}

function checkModelRefs(content: string, relativePath: string, findings: SpecValidationFinding[], index: CrossRefIndex): void {
  for (const entity of extractModelRefs(content)) {
    if (!index.modelsContent) {
      findings.push(warning(relativePath, 'missing-reference-target', '引用了模型 ' + entity + '，但 specs/models.md 不存在'));
    } else if (!index.modelsEntities.has(entity)) {
      findings.push(error(relativePath, 'unresolved-model-reference', '引用的模型未在 specs/models.md 定义: ' + entity));
    }
  }
}

function checkErrorCodeRefs(content: string, relativePath: string, findings: SpecValidationFinding[], index: CrossRefIndex): void {
  for (const code of extractErrorCodeRefs(content)) {
    if (index.errorCodes.has(code)) continue;
    if (!index.errorsContent && !index.protocolContent) {
      findings.push(warning(relativePath, 'missing-reference-target', '引用了错误码 ' + code + '，但 specs/errors.md 与 specs/protocol.md 都不存在'));
      continue;
    }
    findings.push(error(relativePath, 'unresolved-error-reference', '引用的错误码未在 specs/errors.md 或 specs/protocol.md 的「错误码」表定义: ' + code));
  }
}

function checkConfigKeyRefs(content: string, relativePath: string, findings: SpecValidationFinding[], index: CrossRefIndex): void {
  for (const key of extractConfigKeyRefs(content)) {
    if (!index.configContent) {
      findings.push(warning(relativePath, 'missing-reference-target', '引用了配置键 ' + key + '，但 specs/config.md 不存在'));
    } else if (!index.configKeys.has(key)) {
      findings.push(error(relativePath, 'unresolved-config-reference', '引用的配置键未在 specs/config.md 定义: ' + key));
    }
  }
}

function checkHeaderRefs(content: string, relativePath: string, findings: SpecValidationFinding[], index: CrossRefIndex): void {
  for (const header of extractHeaderRefs(content)) {
    if (!index.protocolContent) {
      findings.push(warning(relativePath, 'missing-reference-target', '引用了协议头 ' + header + '，但 specs/protocol.md 不存在'));
    } else if (!index.protocolHeaders.has(header)) {
      findings.push(error(relativePath, 'unresolved-protocol-reference', '引用的协议头未在 specs/protocol.md 定义: ' + header));
    }
  }
}

function checkStatusRefs(content: string, relativePath: string, findings: SpecValidationFinding[], index: CrossRefIndex): void {
  for (const status of extractStatusRefs(content)) {
    if (!index.protocolContent) {
      findings.push(warning(relativePath, 'missing-reference-target', '引用了状态码 ' + status + '，但 specs/protocol.md 不存在'));
    } else if (!index.protocolStatusCodes.has(status)) {
      findings.push(error(relativePath, 'unresolved-protocol-reference', '引用的状态码未在 specs/protocol.md 定义: ' + status));
    }
  }
}

function checkFieldRefs(content: string, relativePath: string, findings: SpecValidationFinding[], index: CrossRefIndex): void {
  const capability = parseCapability(content, relativePath);
  for (const endpoint of capability.endpoints) {
    const fields = [...endpoint.requestFields, ...endpoint.responseFields];
    if (fields.length === 0) continue;
    if (endpoint.modelRefs.length === 0) {
      findings.push(warning(relativePath, 'missing-model-binding', '接口 ' + endpoint.method + ' ' + endpoint.path + ' 声明了字段但未绑定 模型：X'));
      continue;
    }
    for (const entity of endpoint.modelRefs) {
      const entityFields = index.modelsFields.get(entity);
      if (!entityFields) continue;
      for (const field of fields) {
        if (!entityFields.has(field.name)) {
          findings.push(error(relativePath, 'unresolved-field-reference', '接口字段未在 models 实体 ' + entity + ' 中定义: ' + field.name));
        }
      }
    }
  }
}

async function validateCapabilityFile(
  projectRoot: string,
  relativePath: string,
  findings: SpecValidationFinding[],
  index: CrossRefIndex,
): Promise<void> {
  const parsed = await parseSpecFile(projectRoot, relativePath);
  if (parsed.anchors.length === 0) {
    findings.push(error(relativePath, 'no-anchors', 'spec 中没有可绑定的 anchor（需要至少一个二级或三级标题）'));
  }
  const headingCounts = new Map<string, number>();
  for (const anchor of parsed.anchors) {
    headingCounts.set(anchor.heading, (headingCounts.get(anchor.heading) ?? 0) + 1);
  }
  for (const [heading, count] of headingCounts) {
    if (count > 1) {
      findings.push(
        error(
          relativePath,
          'duplicate-anchor',
          'anchor 标题重复 ' + count + ' 次: ' + heading + '（anchor 必须唯一，否则任务绑定会指向错误段落）',
        ),
      );
    }
  }
  if (parsed.acceptance.length === 0) {
    findings.push(error(relativePath, 'no-acceptance', 'spec 中没有 Acceptance 验收项'));
  }
  const content = await readTextFile(path.join(projectRoot, relativePath));
  if (!normalizeModulePath(parseSpecMeta(content).module)) {
    findings.push(
      warning(
        relativePath,
        'missing-module-declaration',
        '未声明代码模块边界；建议在 front-matter 加 module: <项目相对路径>，拆解时任务会继承该边界',
      ),
    );
  }
  // 可执行验收是「重建质量可判定」的前提：没有 check 的验收项只能靠人判断。
  const unchecked = parsed.acceptance.filter((item) => !item.check).length;
  if (parsed.acceptance.length > 0 && unchecked > 0) {
    findings.push(
      warning(
        relativePath,
        'acceptance-without-check',
        unchecked +
          '/' +
          parsed.acceptance.length +
          ' 个验收项没有 `- check: <command>`；这些项在 change verify 时只能由独立 Verifier 或人工判定',
      ),
    );
  }
  checkModelRefs(content, relativePath, findings, index);
  checkErrorCodeRefs(content, relativePath, findings, index);
  checkHeaderRefs(content, relativePath, findings, index);
  checkStatusRefs(content, relativePath, findings, index);
  checkFieldRefs(content, relativePath, findings, index);
}

async function validateFlowFile(
  projectRoot: string,
  relativePath: string,
  findings: SpecValidationFinding[],
  index: CrossRefIndex,
): Promise<void> {
  const content = await readTextFile(path.join(projectRoot, relativePath));
  const steps = extractFlowSteps(content);
  if (steps.length === 0) {
    findings.push(error(relativePath, 'no-flow-steps', 'flow spec 没有可解析的步骤（### 步骤N）'));
  }
  if (!/前置条件/u.test(content) || !/后置条件/u.test(content)) {
    findings.push(error(relativePath, 'missing-flow-sections', 'flow spec 需要 前置条件 / 步骤 / 后置条件 三段式'));
  }
  for (const step of steps) {
    for (const ref of step.apiRefs) {
      const key = normalizeApiHeading(ref.method + ' ' + ref.path);
      if (!index.apiAnchors.has(key)) {
        findings.push(warning(relativePath, 'unresolved-api-reference', 'flow 步骤 ' + step.step + ' 引用的 API 未在 capability spec 中找到: ' + key));
      }
    }
  }
  checkModelRefs(content, relativePath, findings, index);
  checkConfigKeyRefs(content, relativePath, findings, index);
}

async function validateModelsFile(projectRoot: string, relativePath: string, findings: SpecValidationFinding[]): Promise<void> {
  const content = await readTextFile(path.join(projectRoot, relativePath));
  if (extractEntities(content).length === 0) {
    findings.push(error(relativePath, 'no-models', 'models spec 需要至少一个 ## 实体：<Name>'));
  }
}

async function validateProcessFile(
  projectRoot: string,
  relativePath: string,
  findings: SpecValidationFinding[],
  index: CrossRefIndex,
): Promise<void> {
  const content = await readTextFile(path.join(projectRoot, relativePath));
  if (extractProcesses(content).length === 0) {
    findings.push(error(relativePath, 'no-processes', 'process spec 需要至少一个 ## 进程：<Name>'));
  }
  checkConfigKeyRefs(content, relativePath, findings, index);
  checkModelRefs(content, relativePath, findings, index);
  for (const ref of extractApiReferences(content)) {
    const key = normalizeApiHeading(ref.method + ' ' + ref.path);
    if (!index.apiAnchors.has(key)) {
      findings.push(warning(relativePath, 'unresolved-api-reference', 'process 引用的 API 未在 capability spec 中找到: ' + key));
    }
  }
}

async function validateRulesFile(
  projectRoot: string,
  relativePath: string,
  findings: SpecValidationFinding[],
  index: CrossRefIndex,
): Promise<void> {
  const content = await readTextFile(path.join(projectRoot, relativePath));
  if (extractHeadings(content, 2).length === 0) {
    findings.push(error(relativePath, 'empty-kind-file', 'rules spec 缺少二级标题结构'));
  }
  checkModelRefs(content, relativePath, findings, index);
}

async function validatePermissionsFile(
  projectRoot: string,
  relativePath: string,
  findings: SpecValidationFinding[],
  index: CrossRefIndex,
): Promise<void> {
  const content = await readTextFile(path.join(projectRoot, relativePath));
  if (extractHeadings(content, 2).length === 0) {
    findings.push(error(relativePath, 'empty-kind-file', 'permissions spec 缺少二级标题结构'));
  }
  for (const apiPath of extractApiPathRefs(content)) {
    const key = normalizeApiHeading(apiPath);
    if (!index.apiAnchors.has(key)) {
      findings.push(warning(relativePath, 'unresolved-api-reference', 'permissions 矩阵引用的 API 未在 capability spec 中找到: ' + key));
    }
  }
}

async function validateStructuralFile(
  projectRoot: string,
  relativePath: string,
  kind: SpecKind,
  findings: SpecValidationFinding[],
): Promise<void> {
  const content = await readTextFile(path.join(projectRoot, relativePath));
  if (extractHeadings(content, 2).length === 0) {
    findings.push(error(relativePath, 'empty-kind-file', 'kind ' + kind + ' 的 spec 缺少二级标题结构'));
  }
}

export async function validateSpecs(projectRoot: string): Promise<SpecValidationResult> {
  const files = await listSpecFiles(projectRoot);
  const findings: SpecValidationFinding[] = [];

  const context = await loadProjectContext(projectRoot);
  if (!context) {
    findings.push(error('COMETFLOW.md', 'missing-project-context', 'project context is missing; run cometflow context sync'));
  } else {
    for (const message of validateProjectContext(context)) {
      findings.push(error('COMETFLOW.md', 'invalid-project-context', message));
    }
  }

  await validateManifest(projectRoot, findings);

  const modelsContent = await readRootKind(projectRoot, 'models');
  const errorsContent = await readRootKind(projectRoot, 'errors');
  const configContent = await readRootKind(projectRoot, 'config');
  const protocolContent = await readRootKind(projectRoot, 'protocol');

  const index: CrossRefIndex = {
    apiAnchors: new Set(),
    modelsContent,
    modelsEntities: new Set(modelsContent ? extractEntities(modelsContent).map((entry) => entry.name) : []),
    modelsFields: new Map(modelsContent ? parseModels(modelsContent).entities.map((entity) => [entity.name, new Set(entity.fields.map((field) => field.name))] as [string, Set<string>]) : []),
    errorsContent,
    errorCodes: collectErrorCodes(errorsContent, protocolContent),
    configContent,
    configKeys: new Set(configContent ? extractConfigKeys(configContent) : []),
    protocolContent,
    protocolHeaders: new Set(protocolContent ? extractProtocolHeaders(protocolContent) : []),
    protocolStatusCodes: new Set(protocolContent ? extractProtocolStatusCodes(protocolContent) : []),
  };

  for (const relativePath of files) {
    if (kindForSpecFile(relativePath) !== 'capability') continue;
    const parsed = await parseSpecFile(projectRoot, relativePath);
    for (const anchor of parsed.anchors) {
      index.apiAnchors.add(normalizeApiHeading(anchor.heading));
    }
  }

  for (const relativePath of files) {
    const kind = kindForSpecFile(relativePath);
    switch (kind) {
      case 'capability':
        await validateCapabilityFile(projectRoot, relativePath, findings, index);
        break;
      case 'flow':
        await validateFlowFile(projectRoot, relativePath, findings, index);
        break;
      case 'models':
        await validateModelsFile(projectRoot, relativePath, findings);
        break;
      case 'process':
        await validateProcessFile(projectRoot, relativePath, findings, index);
        break;
      case 'rules':
        await validateRulesFile(projectRoot, relativePath, findings, index);
        break;
      case 'permissions':
        await validatePermissionsFile(projectRoot, relativePath, findings, index);
        break;
      default:
        await validateStructuralFile(projectRoot, relativePath, kind, findings);
        break;
    }
  }

  return { valid: findings.every((item) => item.severity !== 'error'), findings };
}
