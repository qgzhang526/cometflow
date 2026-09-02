import path from 'node:path';
import { validateSpecs } from '../../domains/spec/spec-validate.js';
import { parseSpecFile } from '../../domains/spec/spec-parse.js';
import { listSpecFiles } from '../../domains/spec/spec-index.js';
import { computeSpecLock, diffSpecs, writeSpecLock } from '../../domains/spec/spec-lock.js';
import { collectSpecDrift } from '../../domains/spec/spec-drift.js';

export async function specValidateCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const result = await validateSpecs(projectRoot);
  for (const finding of result.findings) {
    console.log([finding.severity.toUpperCase(), finding.code, finding.path, finding.message].join(' '));
  }
  console.log(result.valid ? 'spec validate: OK' : 'spec validate: FAILED');
}

export async function specLockCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const lock = await computeSpecLock(projectRoot);
  const filePath = await writeSpecLock(projectRoot, lock);
  console.log('wrote ' + filePath);
}

export async function specDiffCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const diff = await diffSpecs(projectRoot);
  console.log('added: ' + diff.added.length);
  console.log('modified: ' + diff.modified.length);
  console.log('removed: ' + diff.removed.length);
  console.log('unchanged: ' + diff.unchanged.length);
  for (const entry of [...diff.added, ...diff.modified, ...diff.removed]) {
    console.log(entry.path + ' ' + (diff.added.includes(entry) ? 'added' : diff.modified.includes(entry) ? 'modified' : 'removed'));
  }
}

export async function specDriftCommand(targetPath: string, options: { json?: boolean }): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const report = await collectSpecDrift(projectRoot);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('scannedTasks: ' + report.scannedTasks);
  console.log('drift: ' + report.drift.length);
  for (const entry of report.drift) {
    console.log([entry.goal, entry.task, entry.spec_ref, entry.frozen_hash.slice(0, 8) + ' -> ' + entry.current_hash.slice(0, 8)].join(' '));
  }
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
