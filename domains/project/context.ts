import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { readTextFile } from '../../platform/fs/read-file.js';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';

export interface ProjectContext {
  schema: 'cometflow.project-context.v1';
  tech_stack: Record<string, string>;
  runtime: Record<string, string>;
  /**
   * 不属于任何 capability 模块、但允许改动的共享路径（来自 COMETFLOW.md 的 `## 模块归属`）。
   *
   * 放在 project 层是有意的：`.cometflow/` 被 gitignore，配置里的 scope.allow 换台机器就丢，
   * 而「哪些文件是全仓库共享」属于项目事实，必须随仓库分发。config.scope.allow 仅作本地覆盖。
   */
  shared_paths: string[];
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

/** 归一化共享路径：统一 posix、去掉 `./` 与前导斜杠、去掉尾部 `/`。 */
export function normalizeSharedPath(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/\\/gu, '/')
    .replace(/^\.\//u, '')
    .replace(/^\/+/u, '')
    .replace(/\/+$/u, '');
  if (normalized === '' || normalized.startsWith('..')) return null;
  return normalized;
}

/**
 * `## 模块归属` 支持两种写法，表格是推荐形式：
 *
 * ```markdown
 * ## 模块归属
 *
 * | 共享路径 | 说明 |
 * |---------|------|
 * | bin/ | CLI 入口，跨 capability 共享 |
 * | package.json | 依赖清单与脚本 |
 * ```
 */
function parseSharedPaths(section: string): string[] {
  const paths = new Set<string>();
  for (const line of section.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const tableMatch = /^\|\s*([^|]+?)\s*\|/u.exec(trimmed);
    if (tableMatch) {
      const cell = tableMatch[1];
      // 跳过表头与分隔行。
      if (/^-+$|^:?-+:?$/u.test(cell)) continue;
      if (cell === '共享路径' || cell === '路径' || cell === 'path') continue;
      const normalized = normalizeSharedPath(cell);
      if (normalized) paths.add(normalized);
      continue;
    }

    const bulletMatch = /^[-*]\s+(.+)$/u.exec(trimmed);
    if (bulletMatch) {
      const normalized = normalizeSharedPath(bulletMatch[1]);
      if (normalized) paths.add(normalized);
    }
  }
  return [...paths].sort();
}

export function parseProjectContext(markdown: string): ProjectContext {
  const techStack = parseTable(extractSection(markdown, "技术栈"), TECH_KEYS);
  const runtime = parseTable(extractSection(markdown, "运行环境"), RUNTIME_KEYS);
  const sharedPaths = parseSharedPaths(extractSection(markdown, "模块归属"));
  return {
    schema: "cometflow.project-context.v1",
    tech_stack: techStack,
    runtime,
    shared_paths: sharedPaths,
  };
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
  await atomicWriteText(filePath, stringify(context));
  return { context, written: filePath, errors };
}

export async function loadProjectContext(projectRoot: string): Promise<ProjectContext | null> {
  try {
    const source = await fs.readFile(projectContextPath(projectRoot), "utf8");
    const parsed = parse(source) as Partial<ProjectContext>;
    return {
      schema: 'cometflow.project-context.v1',
      tech_stack: parsed.tech_stack ?? {},
      runtime: parsed.runtime ?? {},
      // 老 project-context.yaml 没有这个字段，读回时必须补默认值。
      shared_paths: Array.isArray(parsed.shared_paths) ? parsed.shared_paths : [],
    };
  } catch {
    try {
      const markdown = await readTextFile(path.join(projectRoot, 'COMETFLOW.md'));
      return parseProjectContext(markdown);
    } catch {
      return null;
    }
  }
}
