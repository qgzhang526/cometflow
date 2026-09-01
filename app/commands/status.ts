import path from 'node:path';
import { collectProjectStatus } from '../../domains/dashboard/collector.js';

export async function statusCommand(targetPath: string): Promise<void> {
  const status = await collectProjectStatus(path.resolve(targetPath));
  console.log(JSON.stringify(status, null, 2));
}
