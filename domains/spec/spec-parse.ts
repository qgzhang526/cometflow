import path from 'node:path';
import { readTextFile } from '../../platform/fs/read-file.js';
import { toPosix } from '../../platform/paths/relative.js';
import { hashSpecText, normalizeSpecText } from './spec-hash.js';
import { kindForSpecFile } from './kind.js';
import type { AcceptanceItem, ParsedSpec, SpecAnchor } from './types.js';

const ACCEPTANCE_HEADING = /^(##|###)\s+(acceptance|验收)\s*$/iu;
const HEADING = /^(#{2,3})\s+(.+?)\s*$/u;
const ACCEPTANCE_ITEM = /^\s*-\s+(A\d+)[：:]?\s*(.*)$/u;
const ACCEPTANCE_CHECK = /^\s{2,}[-*]?\s*check\s*[:：]\s*(.+)$/u;

function normalizeHeading(heading: string): string {
  return heading.trim();
}

interface HeadingLine {
  index: number;
  level: number;
  text: string;
}

interface SpecLayout {
  lines: string[];
  headings: HeadingLine[];
  /** 所有 Acceptance / 验收 标题所在行号（升序）。 */
  acceptanceStarts: number[];
}

function collectHeadings(lines: string[]): HeadingLine[] {
  const headings: HeadingLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (ACCEPTANCE_HEADING.test(trimmed)) continue;
    const match = HEADING.exec(trimmed);
    if (match) headings.push({ index, level: match[1].length, text: match[2] });
  }
  return headings;
}

function analyze(content: string): SpecLayout {
  const lines = normalizeSpecText(content).split('\n');
  return {
    lines,
    headings: collectHeadings(lines),
    acceptanceStarts: lines.reduce<number[]>((acc, line, index) => {
      if (ACCEPTANCE_HEADING.test(line.trim())) acc.push(index);
      return acc;
    }, []),
  };
}

/**
 * 段落边界：标题行开始，到下一个「同级或更高级」标题之前结束。
 * 这样 `## POST /x` 的子标题 `### 请求` 属于同一个 anchor，
 * 而紧随其后的 `## POST /y` 会正确切分。
 */
function sectionRange(layout: SpecLayout, position: number): { start: number; end: number } {
  const current = layout.headings[position];
  let end = layout.lines.length;
  for (let next = position + 1; next < layout.headings.length; next += 1) {
    if (layout.headings[next].level <= current.level) {
      end = layout.headings[next].index;
      break;
    }
  }
  return { start: current.index, end };
}

/**
 * 参与哈希的是「标题行之后」的正文，并且不含 Acceptance 段落：
 * - 不含标题 → 改标题只是重命名，正文哈希不变，可以和「改内容」区分开；
 * - 不含 Acceptance → 验收项单独比对，两个信号正交。
 */
function anchorBodyText(layout: SpecLayout, position: number): string {
  const range = sectionRange(layout, position);
  // 只截断「本 anchor 之后」的第一个 Acceptance 段，前面的验收段不影响本 anchor。
  const acceptanceCap =
    layout.acceptanceStarts.find((index) => index > range.start) ?? layout.lines.length;
  return layout.lines
    .slice(range.start + 1, Math.min(range.end, acceptanceCap))
    .join('\n');
}

export function parseSpecContent(content: string, source: string): ParsedSpec {
  const layout = analyze(content);
  const { lines, headings } = layout;
  /**
   * 可绑定 anchor 的层级：优先二级标题（契约锚点，如 `## POST /x`）。
   *
   * 三级标题通常是 `### 请求` / `### 响应` 这类段落，会跨接口重名，
   * 把它们当成 anchor 会导致 spec_anchor 冲突、任务绑错段落。
   * 只有当整份文件没有二级标题时，才退化为三级标题作为 anchor。
   *
   * **flow 是例外**：它的二级标题是 `## 前置条件` / `## 步骤` / `## 后置条件` 这三段式骨架
   * （`spec validate` 会强制要求这三段），属于**结构容器**——与 `## Acceptance` 同类，
   * 不是可绑定锚点。flow 真正的可绑定单位是步骤（`### 步骤N …`），所以这里直接用三级标题。
   * （在这之前，三段骨架会被当成锚点，于是「验收覆盖」里出现一堆 `前置条件` / `步骤` / `后置条件`。）
   */
  const isFlow = kindForSpecFile(source) === 'flow';
  const anchorLevel = isFlow ? 3 : headings.some((heading) => heading.level === 2) ? 2 : 3;
  const headingPosition = new Map<number, number>();
  headings.forEach((heading, position) => headingPosition.set(heading.index, position));

  const anchors: SpecAnchor[] = [];
  const fileAcceptance: AcceptanceItem[] = [];
  let inAcceptance = false;
  let currentAnchor: SpecAnchor | null = null;
  let currentItem: AcceptanceItem | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (ACCEPTANCE_HEADING.test(trimmed)) {
      inAcceptance = true;
      currentItem = null;
      continue;
    }

    const position = headingPosition.get(index);
    if (position !== undefined && headings[position].level === anchorLevel) {
      const heading = headings[position];
      inAcceptance = false;
      currentItem = null;
      currentAnchor = {
        id: source + '#' + normalizeHeading(heading.text),
        heading: normalizeHeading(heading.text),
        level: heading.level,
        line: index + 1,
        source,
        hash: hashSpecText(anchorBodyText(layout, position)),
        acceptance: [],
      };
      anchors.push(currentAnchor);
      continue;
    }
    if (position !== undefined) {
      // 任何非 Acceptance 的标题都结束上一段验收块。
      inAcceptance = false;
      currentItem = null;
      continue;
    }

    if (inAcceptance) {
      const itemMatch = ACCEPTANCE_ITEM.exec(line);
      if (itemMatch) {
        const item: AcceptanceItem = { id: itemMatch[1], text: itemMatch[2].trim(), check: null };
        fileAcceptance.push(item);
        if (currentAnchor) currentAnchor.acceptance.push(item);
        currentItem = item;
        continue;
      }
      // 缩进的 check 行属于上一个验收项，是该项的可执行判定命令。
      const checkMatch = ACCEPTANCE_CHECK.exec(line);
      if (checkMatch && currentItem) {
        currentItem.check = checkMatch[1].trim();
      }
    }
  }

  return { path: source, hash: hashSpecText(content), anchors, acceptance: fileAcceptance };
}

export interface SpecAnchorSection {
  heading: string;
  level: number;
  line: number;
  /** 含标题行与其全部子标题、Acceptance 段落的原始文本。 */
  text: string;
  acceptance: AcceptanceItem[];
}

/**
 * 取出单个 anchor 的完整原文，供 Builder / Verifier 直接消费。
 *
 * 这是「代码丢了也能重建」的关键输入：agent 拿到的是冻结版本里那一段确定的契约，
 * 而不是当前工作区里可能已经漂移的内容。
 */
export function extractAnchorSection(content: string, heading: string): SpecAnchorSection | null {
  const layout = analyze(content);
  const position = layout.headings.findIndex(
    (entry) => normalizeHeading(entry.text) === normalizeHeading(heading),
  );
  if (position < 0) return null;

  const range = sectionRange(layout, position);
  const parsed = parseSpecContent(content, 'memory://spec');
  const anchor = parsed.anchors.find(
    (entry) => normalizeHeading(entry.heading) === normalizeHeading(heading),
  );
  const acceptance = anchor && anchor.acceptance.length > 0 ? anchor.acceptance : parsed.acceptance;
  return {
    heading: normalizeHeading(layout.headings[position].text),
    level: layout.headings[position].level,
    line: layout.headings[position].index + 1,
    text: layout.lines.slice(range.start, range.end).join('\n').trimEnd(),
    acceptance,
  };
}

export async function parseSpecFile(projectRoot: string, relativePath: string): Promise<ParsedSpec> {
  const source = toPosix(relativePath);
  const content = await readTextFile(path.join(projectRoot, relativePath));
  return parseSpecContent(content, source);
}
