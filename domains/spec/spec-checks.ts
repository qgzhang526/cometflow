import { listSpecFiles } from './spec-index.js';
import { kindForSpecFile } from './kind.js';
import { parseSpecFile } from './spec-parse.js';
import type { AcceptanceItem } from './types.js';

export interface AcceptanceCheckAnchor {
  path: string;
  /** spec kind：界面据此区分「契约锚点（需绑定）」与「结构标题（不参与绑定）」。 */
  kind: string;
  anchor: string;
  acceptance: AcceptanceItem[];
}

export interface AcceptanceCheckCoverage {
  anchors: AcceptanceCheckAnchor[];
  /** 验收项总数、声明了可执行 check 的数量、只能靠 Verifier 或人工判定的数量。 */
  total: number;
  checked: number;
  unchecked: number;
}

/**
 * 列出每个 anchor 的验收项与其可执行检查。
 *
 * 没有 check 的验收项意味着「重建质量只能靠人判断」。这条投影把这件事显式暴露出来，
 * 让 spec 能逐步补到「可自动判定」的程度（ADR 0013），CLI 的 `spec checks` 与
 * Specs 面板的「验收覆盖」视图共用它，避免两处各写一遍解析逻辑。
 */
export async function collectAcceptanceChecks(projectRoot: string): Promise<AcceptanceCheckCoverage> {
  const files = await listSpecFiles(projectRoot);
  const anchors: AcceptanceCheckAnchor[] = [];
  let total = 0;
  let checked = 0;
  let unchecked = 0;

  for (const file of files) {
    const parsed = await parseSpecFile(projectRoot, file);
    for (const anchor of parsed.anchors) {
      const items = anchor.acceptance.length > 0 ? anchor.acceptance : parsed.acceptance;
      if (items.length === 0) continue;
      total += items.length;
      unchecked += items.filter((item) => !item.check).length;
      checked += items.filter((item) => item.check).length;
      anchors.push({ path: file, kind: kindForSpecFile(file), anchor: anchor.heading, acceptance: items });
    }
  }

  return { anchors, total, checked, unchecked };
}
