import path from 'node:path';
import { pathExists, readTextFile } from '../../platform/fs/read-file.js';

/**
 * goal 级调度顺序（ADR 0029）。
 *
 * 顺序写在 COMETFLOW.md 的 `## 调度顺序` 段落里——一处显式清单，**位置即顺序**：
 *
 * ```markdown
 * ## 调度顺序
 *
 * - G3
 * - G7
 * ```
 *
 * 没列出的按 goal **编号升序**兜底排在后面（`G10` 解析成 10，不是字典序——旧的实现按
 * plan 文件名排序，`G10.task-plan.yaml` 会插到 `G2` 前面）。
 *
 * 它和 `## 模块归属` 同类：给人看、也给机器读。用位置而不是数字表达顺序，是因为
 * 位置天然唯一——不存在"两个 goal 优先级相同怎么办"，也不存在"0 算最高还是最低"的歧义；
 * 新加的 goal 追加在文档末尾、不写进清单就自动末位。
 */

export const SCHEDULE_ORDER_HEADING = '## 调度顺序';

const SCHEDULE_SECTION = /^##\s+调度顺序\s*$/u;
const ANY_SECTION = /^##\s+\S/u;
const BULLET = /^\s*[-*]\s+(.*)$/u;
const GOAL_ID = /^(G\d+)\b/u;
const NUMERIC_GOAL = /^G(\d+)$/u;

export interface ScheduleOrder {
  /** 显式列出的 goal（按书写顺序，已去重）。 */
  listed: string[];
  /** 可读的提示：未知 id、重复列。**不致命**——坏行忽略，其余照常。 */
  warnings: string[];
}

/**
 * 解析 `## 调度顺序`。
 *
 * `declared` 是 COMETFLOW.md 里声明过的 goal id；传了就顺带校验清单里有没有写错的 id
 * （给 `goal sync` 的反馈用）。不传就不做这项校验——调度读取时一个"清单里有、但没有计划"
 * 的 goal 本来也是惰性的，没必要在那里反复提醒。
 */
export function parseScheduleOrder(markdown: string, declared: readonly string[] = []): ScheduleOrder {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.findIndex((line) => SCHEDULE_SECTION.test(line.trim()));
  const listed: string[] = [];
  const warnings: string[] = [];
  if (start < 0) return { listed, warnings };

  const known = new Set(declared);
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (ANY_SECTION.test(line)) break;
    const bullet = BULLET.exec(line);
    if (bullet === null) continue;
    const value = bullet[1]!.trim();
    const id = GOAL_ID.exec(value)?.[1];
    if (id === undefined) {
      warnings.push('调度顺序里这一行不是 goal id，已忽略：' + value);
      continue;
    }
    if (declared.length > 0 && !known.has(id)) {
      warnings.push('调度顺序里的 ' + id + ' 不在 COMETFLOW.md 的「任务目标」里，已忽略');
      continue;
    }
    if (listed.includes(id)) {
      warnings.push('调度顺序里 ' + id + ' 出现了多次，只认第一次');
      continue;
    }
    listed.push(id);
  }
  return { listed, warnings };
}

/** 兜底位次：`G10` → 10（按数字，不是字典序）；非 `G<数字>` 形态排在所有数字之后。 */
export function fallbackRank(goalId: string): number {
  const match = NUMERIC_GOAL.exec(goalId);
  return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1]);
}

/**
 * goal 的排序键（越小越先跑）。
 *
 * 列在清单里的按**位置**（0,1,2…）；没列出的排在所有列出者之后，内部按编号升序。
 */
export function scheduleRank(goalId: string, order: ScheduleOrder): number {
  const index = order.listed.indexOf(goalId);
  if (index >= 0) return index;
  return order.listed.length + fallbackRank(goalId);
}

/**
 * 比较两个 goal 的先后。
 *
 * 位次相同的情况只有"两个都不是 `G<数字>` 形态"（手写计划的 goal id）：那时按字符串定序，
 * 保证**全序**——任何两个 goal 的先后都确定，不依赖 readdir 顺序或文件系统。
 */
export function compareGoals(left: string, right: string, order: ScheduleOrder): number {
  const diff = scheduleRank(left, order) - scheduleRank(right, order);
  if (diff !== 0) return diff;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 一行人话描述当前生效的顺序（CLI 与面板共用）。 */
export function formatScheduleOrder(order: ScheduleOrder): string {
  if (order.listed.length === 0) {
    return '没有 ' + SCHEDULE_ORDER_HEADING + '，按 goal 编号升序（' + SCHEDULE_ORDER_HEADING + ' 里可以显式指定先后）';
  }
  return order.listed.join(' → ') + ' → 其余按编号升序';
}

/** 读项目的调度顺序（COMETFLOW.md 是唯一权威；不读 goal 投影，避免"改完没 sync"的陈旧）。 */
export async function readScheduleOrder(projectRoot: string): Promise<ScheduleOrder> {
  const missionPath = path.join(projectRoot, 'COMETFLOW.md');
  if (!(await pathExists(missionPath))) return { listed: [], warnings: [] };
  return parseScheduleOrder(await readTextFile(missionPath));
}
