import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLocalEval } from '../../domains/eval/eval-service.js';

describe('local eval', () => {
  it('runs manifest tasks and writes a report', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-eval-'));
    await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
    await fs.writeFile(path.join(tmp, '.cometflow', 'eval.yaml'), [
      'schema: cometflow.eval.v1',
      'tasks:',
      '  - name: passing',
      '    command: ' + JSON.stringify(process.execPath),
      '    args: ["-e", "process.exit(0)"]',
      '  - name: failing',
      '    command: ' + JSON.stringify(process.execPath),
      '    args: ["-e", "process.exit(1)"]',
    ].join('\n'));

    const report = await runLocalEval(tmp);
    expect(report.passed).toBe(false);
    expect(report.results.length).toBe(2);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
