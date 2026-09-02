import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { readTextFile } from '../../platform/fs/read-file.js';

export interface ProjectContext {
  schema: 'cometflow.project-context.v1';
  tech_stack: Record<string, string>;
  runtime: Record<string, string>;
}

const TECH_KEYS: Record<string, string> = {
  前端: 'frontend',
  后端: 'backend',
  数据库: 'database',
  缓存: 'cache',
  测试框架: 'test_framework',
  构建工具: 'build_tool',
};

const RUNTIME_KEYS: Record<string, string> = {
  操作系统: 'os',
  部署方式: 'deployment',
  语言版本: 'language_version',
};

export function projectContextPath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'project-context.yaml');
}

function parseTable(section: string, keyMap: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of section.split(/\r?\n/u)) {
    const match = /^\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/u.exec(line);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    const mapped = keyMap[key];
    if (mapped) result[mapped] = value;
  }
  return result;
}

function extractSection(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === "## " + title);
  if (start < 0) return "";
  const out: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(lines[index])) break;
    out.push(lines[index]);
  }
  return out.join("\n");
}

export function parseProjectContext(markdown: string): ProjectContext {
  const techStack = parseTable(extractSection(markdown, "技术栈"), TECH_KEYS);
  const runtime = parseTable(extractSection(markdown, "运行环境"), RUNTIME_KEYS);
  return { schema: "cometflow.project-context.v1", tech_stack: techStack, runtime };
}

export function validateProjectContext(context: ProjectContext): string[] {
  const errors: string[] = [];
  const requiredTech = ["frontend", "backend", "database", "cache", "test_framework", "build_tool"];
  const requiredRuntime = ["os", "deployment", "language_version"];
  for (const key of requiredTech) {
    const value = context.tech_stack[key];
    if (!value || value.includes("待定") || value.includes("TODO")) {
      errors.push('tech_stack.' + key + ' is missing or incomplete');
    }
  }
  for (const key of requiredRuntime) {
    const value = context.runtime[key];
    if (!value || value.includes("待定") || value.includes("TODO")) {
      errors.push('runtime.' + key + ' is missing or incomplete');
    }
  }
  return errors;
}

export async function syncProjectContext(projectRoot: string): Promise<{ context: ProjectContext; written: string; errors: string[] }> {
  const markdown = await readTextFile(path.join(projectRoot, 'COMETFLOW.md'));
  const context = parseProjectContext(markdown);
  const errors = validateProjectContext(context);
  const filePath = projectContextPath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringify(context));
  return { context, written: filePath, errors };
}

export async function loadProjectContext(projectRoot: string): Promise<ProjectContext | null> {
  try {
    const source = await fs.readFile(projectContextPath(projectRoot), "utf8");
    return parse(source) as ProjectContext;
  } catch {
    try {
      const markdown = await readTextFile(path.join(projectRoot, 'COMETFLOW.md'));
      return parseProjectContext(markdown);
    } catch {
      return null;
    }
  }
}
