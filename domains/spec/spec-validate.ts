import path from 'node:path';
import { parseSpecFile } from './spec-parse.js';
import { listSpecFiles } from './spec-index.js';
import { loadProjectContext, validateProjectContext } from '../project/context.js';
import { pathExists, readTextFile } from '../../platform/fs/read-file.js';
import { kindForSpecFile, ROOT_KIND_FILES, type SpecKind } from './kind.js';
import { readInitManifest } from '../project/scaffold.js';
import {
  extractEntities,
  extractFlowSteps,
  extractHeadings,
  extractProcesses,
  normalizeApiHeading,
} from './spec-structure.js';
import type { SpecValidationFinding, SpecValidationResult } from './types.js';

function error(pathValue: string, code: string, message: string): SpecValidationFinding {
  return { path: pathValue, severity: 'error', code, message };
}

function warning(pathValue: string, code: string, message: string): SpecValidationFinding {
  return { path: pathValue, severity: 'warning', code, message };
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

async function validateCapabilityFile(
  projectRoot: string,
  relativePath: string,
  findings: SpecValidationFinding[],
): Promise<void> {
  const parsed = await parseSpecFile(projectRoot, relativePath);
  if (parsed.anchors.length === 0) {
    findings.push(error(relativePath, 'no-anchors', 'spec 中没有可绑定的 anchor（需要至少一个二级或三级标题）'));
  }
  if (parsed.acceptance.length === 0) {
    findings.push(error(relativePath, 'no-acceptance', 'spec 中没有 Acceptance 验收项'));
  }
}

async function validateFlowFile(
  projectRoot: string,
  relativePath: string,
  apiAnchors: Set<string>,
  findings: SpecValidationFinding[],
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
      if (!apiAnchors.has(key)) {
        findings.push(warning(relativePath, 'unresolved-api-reference', 'flow 步骤 ' + step.step + ' 引用的 API 未在 capability spec 中找到: ' + key));
      }
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

  if (kind === 'models') {
    if (extractEntities(content).length === 0) {
      findings.push(error(relativePath, 'no-models', 'models spec 需要至少一个 ## 实体：<Name>'));
    }
    return;
  }

  if (kind === 'process') {
    if (extractProcesses(content).length === 0) {
      findings.push(error(relativePath, 'no-processes', 'process spec 需要至少一个 ## 进程：<Name>'));
    }
    return;
  }

  if (extractHeadings(content, 2).length === 0) {
    findings.push(error(relativePath, 'empty-kind-file', 'kind ' + kind + ' 的 spec 缺少二级标题结构'));
  }
}

export async function validateSpecs(projectRoot: string): Promise<SpecValidationResult> {
  const files = await listSpecFiles(projectRoot);
  const findings: SpecValidationFinding[] = [];

  const context = await loadProjectContext(projectRoot);
  if (!context) {
    findings.push({
      path: 'COMETFLOW.md',
      severity: 'error',
      code: 'missing-project-context',
      message: 'project context is missing; run cometflow context sync',
    });
  } else {
    for (const message of validateProjectContext(context)) {
      findings.push({
        path: 'COMETFLOW.md',
        severity: 'error',
        code: 'invalid-project-context',
        message,
      });
    }
  }

  await validateManifest(projectRoot, findings);

  // Cross-file reference base: every capability anchor is a resolvable API target.
  const apiAnchors = new Set<string>();
  for (const relativePath of files) {
    if (kindForSpecFile(relativePath) !== 'capability') continue;
    const parsed = await parseSpecFile(projectRoot, relativePath);
    for (const anchor of parsed.anchors) {
      apiAnchors.add(normalizeApiHeading(anchor.heading));
    }
  }

  for (const relativePath of files) {
    const kind = kindForSpecFile(relativePath);
    if (kind === 'capability') {
      await validateCapabilityFile(projectRoot, relativePath, findings);
    } else if (kind === 'flow') {
      await validateFlowFile(projectRoot, relativePath, apiAnchors, findings);
    } else {
      await validateStructuralFile(projectRoot, relativePath, kind, findings);
    }
  }

  return { valid: findings.every((item) => item.severity !== 'error'), findings };
}
