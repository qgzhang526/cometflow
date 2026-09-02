import path from 'node:path';
import { syncProjectContext } from '../../domains/project/context.js';

export async function contextSyncCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const result = await syncProjectContext(projectRoot);
  for (const error of result.errors) console.log("WARN " + error);
  console.log("wrote " + result.written);
}
