import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { ChangeState } from './change-types.js';

export interface AcceptanceVerdict {
  id: string;
  result: 'passed' | 'failed' | 'blocked';
  reason: string;
}

export interface VerificationDocument {
  schema: 'cometflow.verification.v1';
  change: string;
  acceptance: AcceptanceVerdict[];
}

export function verificationFilePath(projectRoot: string, name: string): string {
  return path.join(projectRoot, 'changes', name, 'verification.yaml');
}

export async function readVerificationDocument(projectRoot: string, name: string): Promise<VerificationDocument | null> {
  try {
    const source = await fs.readFile(verificationFilePath(projectRoot, name), "utf8");
    return parse(source) as VerificationDocument;
  } catch {
    return null;
  }
}

export function validateVerificationDocument(state: ChangeState, document: VerificationDocument): string[] {
  const errors: string[] = [];
  if (document.change !== state.name) errors.push("verification change name does not match");
  const expected = [...state.acceptance_ids].sort();
  const actual = [...document.acceptance.map((item) => item.id)].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    errors.push('acceptance coverage mismatch: expected ' + expected.join(',') + ' got ' + actual.join(','));
  }
  for (const item of document.acceptance) {
    if (!['passed', 'failed', 'blocked'].includes(item.result)) {
      errors.push("invalid result for acceptance " + item.id + ": " + item.result);
    }
  }
  return errors;
}

export function allAcceptancePassed(document: VerificationDocument): boolean {
  return document.acceptance.every((item) => item.result === 'passed');
}
