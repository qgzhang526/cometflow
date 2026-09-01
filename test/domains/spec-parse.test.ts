import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSpecFile } from '../../domains/spec/spec-parse.js';
import { validateSpecs } from '../../domains/spec/spec-validate.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');

describe('spec kernel', () => {
  it('parses anchors and acceptance items', async () => {
    const parsed = await parseSpecFile(fixture, 'specs/auth/spec.md');
    expect(parsed.anchors.length).toBe(2);
    expect(parsed.acceptance.length).toBe(2);
  });

  it('validates the fixture project', async () => {
    const result = await validateSpecs(fixture);
    expect(result.valid).toBe(true);
  });
});
