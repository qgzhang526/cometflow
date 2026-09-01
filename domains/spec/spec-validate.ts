import { parseSpecFile } from './spec-parse.js';
import { listSpecFiles } from './spec-index.js';
import type { SpecValidationFinding, SpecValidationResult } from './types.js';

export async function validateSpecs(projectRoot: string): Promise<SpecValidationResult> {
  const files = await listSpecFiles(projectRoot);
  const findings: SpecValidationFinding[] = [];

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
