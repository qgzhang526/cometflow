import { parse } from 'yaml';

export interface SpecMeta {
  capability: string | null;
  /** 该 capability 对应的代码模块边界（项目相对路径，如 internal/auth）。 */
  module: string | null;
  /** 该 spec 的补充说明，会进入 Builder 提示词。 */
  notes: string | null;
}

function parseFrontmatter(source: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(source);
  if (!match) return {};
  try {
    return (parse(match[1]) ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * capability spec 的可选 front-matter：
 *
 * ```markdown
 * ---
 * capability: auth
 * module: internal/auth
 * notes: 认证相关实现都放在该模块内
 * ---
 * ```
 *
 * `module` 是「spec 控制模块化代码」的落点：拆解时写入任务的 test_scope 与 module，
 * 执行时进入 Builder 提示词，使 agent 不得把该 capability 的实现散落到别处。
 */
export function parseSpecMeta(content: string): SpecMeta {
  const frontmatter = parseFrontmatter(content);
  return {
    capability: text(frontmatter.capability),
    module: text(frontmatter.module),
    notes: text(frontmatter.notes),
  };
}

export function normalizeModulePath(module: string | null): string | null {
  if (!module) return null;
  const normalized = module.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  if (normalized === '' || normalized.startsWith('/') || normalized.startsWith('..')) return null;
  return normalized;
}
