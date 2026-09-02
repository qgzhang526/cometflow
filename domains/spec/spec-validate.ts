import { parseSpecFile } from './spec-parse.js';
import { listSpecFiles } from './spec-index.js';
import { loadProjectContext, validateProjectContext } from '../project/context.js';
import type { SpecValidationFinding, SpecValidationResult } from './types.js';

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
    for (const error of validateProjectContext(context)) {
      findings.push({
        path: 'COMETFLOW.md',
        severity: 'error',
        code: 'invalid-project-context',
        message: error,
      });
    }
  }

  for (const relativePath of files) {
    const parsed = await parseSpecFile(projectRoot, relativePath);
    if (parsed.anchors.length === 0) {
      findings.push({
        path: relativePath,
        severity: 'error',
        code: 'no-anchors',
        message: "spec 中没有可绑定的 anchor（需要至少一个二级或三级标题）",
      });
    }
    if (parsed.acceptance.length === 0) {
      findings.push({
        path: relativePath,
        severity: 'error',
        code: 'no-acceptance',
        message: "spec 中没有 Acceptance 验收项",
      });
    }
  }

  return { valid: findings.every((item) => item.severity !== 'error'), findings };
}
