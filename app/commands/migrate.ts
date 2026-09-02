import path from 'node:path';
import { migrateProject } from '../../domains/project/migrate.js';

export async function projectMigrateCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const report = await migrateProject(projectRoot);
  for (const item of report.migrated) console.log("migrated " + item);
  for (const item of report.skipped) console.log("skipped " + item);
}
