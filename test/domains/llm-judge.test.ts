import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLocalEval } from '../../domains/eval/eval-service.js';

async function writeManifest(tmp: string, judge: string): Promise<void> {
  await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
  await fs.writeFile(path.join(tmp, '.cometflow', 'eval.yaml'), [
    'schema: cometflow.eval.v1',
    'tasks:',
    '  - name: pass',
    '    command: ' + JSON.stringify(process.execPath),
    '    args: ["-e", "process.exit(0)"]',
    'judge:',
    '  provider: ' + judge,
  ].join('\n'));
}

describe('llm judge', () => {
  it('mock judge derives verdict from report', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-judge-'));
    await writeManifest(tmp, 'mock');
    const report = await runLocalEval(tmp);
    expect(report.judge?.provider).toBe('mock');
    expect(report.judge?.verdict).toBe('pass');
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('langsmith judge blocks when not configured', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-judge-'));
    await writeManifest(tmp, 'langsmith');
    const report = await runLocalEval(tmp);
    expect(report.judge?.verdict).toBe('blocked');
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
