import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { SkillDefinition, SkillPackage } from './types.js';

function parseFrontmatter(source: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(source);
  if (!match) return {};
  return (parse(match[1]) ?? {}) as Record<string, unknown>;
}

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, fullPath));
    else if (entry.isFile()) files.push(path.relative(root, fullPath).split(path.sep).join("/"));
  }
  return files.sort();
}

export async function loadSkillPackage(sourceRoot: string): Promise<SkillPackage> {
  const skillFile = path.join(sourceRoot, "SKILL.md");
  const source = await fs.readFile(skillFile, "utf8");
  const frontmatter = parseFrontmatter(source);
  const definition: SkillDefinition = {
    name: String(frontmatter.name ?? path.basename(sourceRoot)),
    description: String(frontmatter.description ?? ""),
    version: String(frontmatter.version ?? "0.1.0"),
    author: frontmatter.author ? String(frontmatter.author) : undefined,
  };
  if (!definition.name.trim()) throw new Error("Skill name is required in SKILL.md frontmatter");
  const files = await walkFiles(sourceRoot);
  return { root: sourceRoot, definition, files };
}
