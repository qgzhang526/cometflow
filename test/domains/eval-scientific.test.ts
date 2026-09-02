import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLocalEval } from '../../domains/eval/eval-service.js';
import { proposeEvolution, verifyEvolution } from '../../domains/evolution/evolution-service.js';

async function writeEvalManifest(tmp: string, sampling: number): Promise<void> {
  await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
  await fs.writeFile(path.join(tmp, '.cometflow', 'eval.yaml'), [
    'schema: cometflow.eval.v1',
    'sampling: ' + sampling,
    'pass_at_k: ' + sampling,
    'pass_all_k: ' + sampling,
    'tasks:',
    '  - name: passing',
    '    command: ' + JSON.stringify(process.execPath),
    '    args: ["-e", "console.log(\'ok\'); process.exit(0)"]',
    '    assertions:',
    '      - target: stdout',
    '        operator: contains',
    '        value: ok',
    '  - name: failing',
    '    command: ' + JSON.stringify(process.execPath),
    '    args: ["-e", "process.exit(1)"]',
    'rubric:',
    '  - id: correctness',
    '    description: core correctness',
    '    task: passing',
  ].join('\n'));
}

describe('scientific eval metrics', () => {
  it('computes pass@k and pass^k rates from repeated sampling', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-sci-eval-'));
    await writeEvalManifest(tmp, 3);

    const report = await runLocalEval(tmp);
    expect(report.sampling).toBe(3);
    expect(report.passAtKRate).toBe(0.5);
    expect(report.passAllKRate).toBe(0.5);
    expect(report.rubric[0].passRate).toBe(1);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe('evolve verify --eval', () => {
  it('attaches eval summary and rejects when eval fails', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-evolve-eval-'));
    await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
    await writeEvalManifest(tmp, 1);
    await proposeEvolution({
      projectRoot: tmp,
      name: 'with-eval',
      summary: 'test eval gate',
      gates: [{ name: 'trivial', command: process.execPath, args: ['-e', 'process.exit(0)'] }],
    });

    const verified = await verifyEvolution(tmp, 'with-eval', { includeEval: true });
    expect(verified.status).toBe('rejected');
    expect(verified.eval?.passed).toBe(false);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
