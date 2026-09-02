import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { loadSkillPackage } from '../skill/skill-load.js';
import type { BundleManifest, CompiledBundle } from './types.js';

export function bundleManifestPath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'bundle.yaml');
}

export function compiledBundlePath(projectRoot: string, name: string): string {
  return path.join(projectRoot, '.cometflow', 'bundle-' + name + '.json');
}

export async function readBundleManifest(projectRoot: string): Promise<BundleManifest> {
  const source = await fs.readFile(bundleManifestPath(projectRoot), "utf8");
  return parse(source) as BundleManifest;
}

export async function createBundle(projectRoot: string, name: string): Promise<BundleManifest> {
  const manifest: BundleManifest = {
    schema: 'cometflow.bundle.v1',
    name,
    version: '0.1.0',
    skills: [],
  };
  await fs.mkdir(path.dirname(bundleManifestPath(projectRoot)), { recursive: true });
  await fs.writeFile(bundleManifestPath(projectRoot), stringify(manifest));
  return manifest;
}

export async function compileBundle(projectRoot: string): Promise<CompiledBundle> {
  const manifest = await readBundleManifest(projectRoot);
  const files: string[] = [];
  for (const skillRef of manifest.skills) {
    const skillRoot = path.resolve(projectRoot, skillRef.path);
    const pkg = await loadSkillPackage(skillRoot);
    for (const file of pkg.files) files.push(skillRef.name + "/" + file);
  }
  return { schema: "cometflow.compiled-bundle.v1", name: manifest.name, version: manifest.version, skills: manifest.skills, files };
}

export async function distributeBundle(projectRoot: string, platform: string): Promise<string[]> {
  const manifest = await readBundleManifest(projectRoot);
  const base = platform === "claude-code" ? ".claude" : ".opencode";
  const skillsRoot = path.join(projectRoot, base, "skills");
  const written: string[] = [];
  for (const skillRef of manifest.skills) {
    const sourceRoot = path.resolve(projectRoot, skillRef.path);
    const destination = path.join(skillsRoot, skillRef.name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rm(destination, { recursive: true, force: true });
    await fs.cp(sourceRoot, destination, { recursive: true });
    written.push(destination);
  }
  return written;
}
