import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';

export interface MigrateReport {
  migrated: string[];
  skipped: string[];
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

export async function migrateProject(projectRoot: string): Promise<MigrateReport> {
  const migrated: string[] = [];
  const skipped: string[] = [];

  const legacyMission = path.join(projectRoot, "NIGHTSHIFT.md");
  const mission = path.join(projectRoot, "COMETFLOW.md");
  if ((await exists(legacyMission)) && !(await exists(mission))) {
    await fs.copyFile(legacyMission, mission);
    migrated.push("NIGHTSHIFT.md -> COMETFLOW.md");
  } else if (await exists(mission)) {
    skipped.push("COMETFLOW.md already exists");
  }

  const legacyConfig = path.join(projectRoot, ".nightshift", "config");
  const config = path.join(projectRoot, ".cometflow", "config.yaml");
  if ((await exists(legacyConfig)) && !(await exists(config))) {
    const source = await fs.readFile(legacyConfig, "utf8");
    const agentMatch = /^\s*AGENT\s*=\s*(.+)$/mu.exec(source);
    await fs.mkdir(path.dirname(config), { recursive: true });
    await fs.writeFile(config, stringify({
      schema: 'cometflow.project.v1',
      default_workflow: 'native',
      agent: agentMatch ? agentMatch[1].trim() : "opencode",
    }));
    migrated.push(".nightshift/config -> .cometflow/config.yaml");
  } else if (await exists(config)) {
    skipped.push(".cometflow/config.yaml already exists");
  }

  return { migrated, skipped };
}
