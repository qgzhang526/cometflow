import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLocalEval } from '../../domains/eval/eval-service.js';

describe('pass@k / pass^k k-window semantics', () => {
  it('uses only the first k runs when k < sampling', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-k-window-'));
    await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });

    await fs.writeFile(path.join(tmp, 'flaky.mjs'), [
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
      "import path from 'node:path';",
      "const f = path.join(process.cwd(), '.runs');",
      "const n = existsSync(f) ? Number(readFileSync(f, 'utf8')) : 0;",
      "writeFileSync(f, String(n + 1));",
      "process.exit(n === 0 ? 1 : 0);",
      '',
    ].join('\n'));

    await fs.writeFile(path.join(tmp, '.cometflow', 'eval.yaml'), [
      'schema: cometflow.eval.v1',
      'sampling: 3',
      'pass_at_k: 1',
      'pass_all_k: 2',
      'tasks:',
      '  - name: flaky',
      '    command: ' + JSON.stringify(process.execPath),
      '    args: ["flaky.mjs"]',
    ].join('\n'));

    const report = await runLocalEval(tmp);
    const summary = report.results[0];
    expect(summary.runs).toBe(3);
    expect(summary.passedRuns).toBe(2);
    expect(summary.passAtK).toBe(false);
    expect(summary.passAllK).toBe(false);
    expect(report.passAtKRate).toBe(0);
    expect(report.passAllKRate).toBe(0);
    expect(report.passed).toBe(false);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
