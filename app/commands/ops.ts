import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function updateCommand(): Promise<void> {
  console.log("cometflow update: self-update is not implemented in this MVP; reinstall the npm package to upgrade.");
}

export async function uninstallCommand(targetPath: string, options: { force?: boolean }): Promise<void> {
  if (!options.force) {
    console.log("cometflow uninstall requires --force because it removes project state.");
    process.exitCode = 1;
    return;
  }
  const projectRoot = path.resolve(targetPath);
  const stateDir = path.join(projectRoot, ".cometflow");
  await fs.rm(stateDir, { recursive: true, force: true });
  console.log("removed " + stateDir);
}
