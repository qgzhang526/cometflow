import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCasConflicts, recordCasConflict, resolveConcurrencyPolicy } from '../../domains/project/concurrency.js';
import { validateProjectConfig, writeProjectConfig, DEFAULT_CONFIG, projectConfigPath } from '../../domains/project/config.js';
import { runDoctor } from '../../domains/dashboard/doctor.js';
import { verifySpecIntegrity } from '../../domains/spec/spec-verify.js';

let tmp: string;

async function setConfig(concurrency: Record<string, unknown>): Promise<void> {
  await writeProjectConfig(tmp, { ...DEFAULT_CONFIG, concurrency } as never);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-concurrency-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('concurrency policy', () => {
  it('defaults to warn without an expiry and reports the remaining window when set', async () => {
    const missing = await resolveConcurrencyPolicy(tmp);
    expect(missing.mode).toBe('warn');
    expect(missing.warnUntil).toBeNull();
    expect(missing.expired).toBe(false);

    await setConfig({ specWrites: 'warn', warnUntil: new Date(Date.now() + 5 * 86400000).toISOString() });
    const warned = await resolveConcurrencyPolicy(tmp);
    expect(warned.mode).toBe('warn');
    expect(warned.expired).toBe(false);
    expect(warned.daysUntilExpiry).toBeGreaterThan(0);
  });

  it('marks the warn window as expired once the date passes', async () => {
    await setConfig({ specWrites: 'warn', warnUntil: new Date(Date.now() - 86400000).toISOString() });
    const policy = await resolveConcurrencyPolicy(tmp);
    expect(policy.expired).toBe(true);

    // 到期是「必须显式决策」：门禁与 doctor 都报错，CI 因此变红（ADR 0021）。
    const verification = await verifySpecIntegrity(tmp);
    expect(verification.findings.map((finding) => finding.code)).toContain('concurrency-warn-expired');
    const doctor = await runDoctor(tmp);
    expect(doctor.healthy).toBe(false);
    expect(doctor.findings.map((finding) => finding.code)).toContain('concurrency-warn-expired');
  });

  it('records conflicts and surfaces them in doctor while in warn mode', async () => {
    await recordCasConflict(tmp, { path: 'specs/core/spec.md', expected: 'a', actual: 'b', mode: 'warn' });
    const conflicts = await readCasConflicts(tmp);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].path).toBe('specs/core/spec.md');

    const doctor = await runDoctor(tmp);
    const finding = doctor.findings.find((entry) => entry.code === 'concurrent-modification-warned');
    expect(finding?.severity).toBe('warning');
  });

  it('validates the two-phase rollout rules', async () => {
    expect(validateProjectConfig({ ...DEFAULT_CONFIG, concurrency: { specWrites: 'fail' } })).toHaveLength(0);
    expect(
      validateProjectConfig({ ...DEFAULT_CONFIG, concurrency: { specWrites: 'warn' } }).some((error) =>
        error.includes('concurrency.warnUntil is required'),
      ),
    ).toBe(true);
    expect(
      validateProjectConfig({
        ...DEFAULT_CONFIG,
        concurrency: { specWrites: 'fail', warnUntil: '2026-01-01T00:00:00Z' },
      }).some((error) => error.includes('must be removed')),
    ).toBe(true);
    expect(
      validateProjectConfig({ ...DEFAULT_CONFIG, concurrency: { specWrites: 'warn', warnUntil: 'not-a-date' } }).some((error) =>
        error.includes('must be an ISO date'),
      ),
    ).toBe(true);

    // 写盘后能被读回（走真实的 config 文件而不是内存对象）
    await setConfig({ specWrites: 'fail' });
    expect(await fs.readFile(projectConfigPath(tmp), 'utf8')).toContain('specWrites: fail');
  });
});
