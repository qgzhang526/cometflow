import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { proposeEvolution, submitEvolution, verifyEvolution } from '../../domains/evolution/evolution-service.js';

describe('evolution workflow', () => {
  it('proposes, verifies, and submits an evolution', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cometflow-evolve-"));
    const proposal = await proposeEvolution({
      projectRoot: tmp,
      name: 'better-prompt',
      summary: 'Improve task decomposition prompt',
      riskPlan: 'Isolated branch + tests',
    });
    expect(proposal.status).toBe('draft');

    const verified = await verifyEvolution(tmp, "better-prompt");
    expect(verified.status).toBe('verified');

    const submitted = await submitEvolution(tmp, "better-prompt");
    expect(submitted.status).toBe('ready-for-review');

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
