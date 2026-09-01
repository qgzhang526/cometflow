import path from 'node:path';
import { syncGoals } from '../../domains/goal/goal-sync.js';

export async function goalSyncCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const result = await syncGoals(projectRoot);
  if (result.written.length === 0) {
    console.log('No goals found in COMETFLOW.md');
    return;
  }
  for (const filePath of result.written) {
    console.log('wrote ' + filePath);
  }
}
