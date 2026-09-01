import path from 'node:path';
import { validateSpecs } from '../../domains/spec/spec-validate.js';
import { parseSpecFile } from '../../domains/spec/spec-parse.js';
import { listSpecFiles } from '../../domains/spec/spec-index.js';

export async function specValidateCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const result = await validateSpecs(projectRoot);
  for (const finding of result.findings) {
    console.log([finding.severity.toUpperCase(), finding.code, finding.path, finding.message].join(' '));
  }
  console.log(result.valid ? 'spec validate: OK' : 'spec validate: FAILED');
}

export async function specAnchorsCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const files = await listSpecFiles(projectRoot);
  for (const file of files) {
    const parsed = await parseSpecFile(projectRoot, file);
    for (const anchor of parsed.anchors) {
      console.log(file + '#' + anchor.heading + ' acceptance=' + (anchor.acceptance.length > 0 ? anchor.acceptance.length : parsed.acceptance.length));
    }
  }
}
