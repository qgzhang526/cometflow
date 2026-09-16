import { parse } from 'yaml';

/**
 * spec 的定稿状态（G1）。
 *
 * 缺省是 `approved`：老项目、以及人手写的 spec 都没有这个字段，
 * 把它们一律当成「草案」会让所有存量项目立刻冻不住计划。
 * 只有显式写了 `status: draft` 才算草案——这正是 Agent 起草 / 脚手架骨架 / 表格导入
 * 这三条机器产出路径要打的标记。
 */
export type SpecStatus = 'draft' | 'approved';

export interface SpecMeta {
  capability: string | null;
  /** 该 capability 对应的代码模块边界（项目相对路径，如 internal/auth）。 */
  module: string | null;
  /** 该 spec 的补充说明，会进入 Builder 提示词。 */
  notes: string | null;
  /** 定稿状态：`draft` 表示还没被人确认过（缺省视为 approved）。 */
  status: SpecStatus;
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
    status: text(frontmatter.status) === 'draft' ? 'draft' : 'approved',
  };
}

/**
 * 改 `status` 字段，其余部分**逐字保留**。
 *
 * 不走 YAML parse + stringify：那会把注释、键顺序、引号风格全部重写，
 * 而 spec 的每一次改动都会进版本仓并被 diff 给人看——为了改一个键而搅动全文，
 * 等于把「谁批准了哪一版」这件事埋进噪音里。
 */
export function setSpecStatus(content: string, status: SpecStatus): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  if (!match) return `---\nstatus: ${status}\n---\n\n${content}`;

  const head = match[1];
  const rest = content.slice(match[0].length);
  const lines = head.split(/\r?\n/u);
  const index = lines.findIndex((line) => /^status\s*:/u.test(line));
  if (index >= 0) lines[index] = 'status: ' + status;
  else lines.push('status: ' + status);
  return `---\n${lines.join('\n')}\n---${rest}`;
}

export function normalizeModulePath(module: string | null): string | null {
  if (!module) return null;
  const normalized = module.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  if (normalized === '' || normalized.startsWith('/') || normalized.startsWith('..')) return null;
  return normalized;
}
