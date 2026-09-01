import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGoals } from '../../domains/goal/goal-sync.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');

describe('parseGoals', () => {
  it('extracts structured goals from COMETFLOW.md', async () => {
    const fs = await import('node:fs/promises');
    const markdown = await fs.readFile(path.join(fixture, 'COMETFLOW.md'), 'utf8');
    const goals = parseGoals(markdown);
    expect(goals).toHaveLength(1);
    const goal = goals[0];
    expect(goal.id).toBe('G1');
    expect(goal.scope).toEqual(['auth']);
    expect(goal.success_criteria).toHaveLength(2);
    expect(goal.non_goals).toEqual(['不做第三方 OAuth']);
    expect(goal.source_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
