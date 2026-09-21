import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPackageVersion } from '../../platform/paths/package-version.js';

describe('readPackageVersion', () => {
  it('returns the version declared in this package.json', () => {
    const raw = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');
    const declared = (JSON.parse(raw) as { version: string }).version;
    expect(readPackageVersion()).toBe(declared);
  });
});
