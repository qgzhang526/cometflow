import path from 'node:path';
import { runCommand } from '../../platform/process/spawn-command.js';

export interface GitSafetySnapshot {
  schema: 'cometflow.git-safety.v1';
  head: string | null;
  dirtyFiles: string[];
  bundlePath: string | null;
  created_at: string;
}

export function bundlePath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'safety.bundle');
}

async function gitHead(projectRoot: string): Promise<string | null> {
  const result = await runCommand('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, timeoutMs: 10_000 });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

async function gitDirtyFiles(projectRoot: string): Promise<string[]> {
  const result = await runCommand('git', ['status', '--porcelain'], { cwd: projectRoot, timeoutMs: 10_000 });
  if (result.exitCode !== 0) return [];
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

export async function captureGitSafetySnapshot(projectRoot: string, options: { bundle?: boolean } = {}): Promise<GitSafetySnapshot> {
  const head = await gitHead(projectRoot);
  const dirtyFiles = await gitDirtyFiles(projectRoot);
  let bundle: string | null = null;
  if (options.bundle) {
    const target = bundlePath(projectRoot);
    const result = await runCommand('git', ['bundle', 'create', target, '--all'], { cwd: projectRoot, timeoutMs: 120_000 });
    bundle = result.exitCode === 0 ? target : null;
  }
  return {
    schema: 'cometflow.git-safety.v1',
    head,
    dirtyFiles,
    bundlePath: bundle,
    created_at: new Date().toISOString(),
  };
}

export function buildRollbackGuidance(snapshot: GitSafetySnapshot): string[] {
  const lines = ["CometFlow rollback guidance"];
  lines.push("head: " + (snapshot.head ?? "(not a git repository)"));
  if (snapshot.dirtyFiles.length > 0) {
    lines.push('dirty files before run:');
    for (const file of snapshot.dirtyFiles) lines.push("  - " + file);
  }
  if (snapshot.bundlePath) {
    lines.push("safety bundle: " + snapshot.bundlePath);
    lines.push('restore with: git bundle verify <bundle> and inspect refs');
  } else {
    lines.push('restore with: git reset --hard <head>');
  }
  return lines;
}
