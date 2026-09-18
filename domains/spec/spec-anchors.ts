import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { listSpecEntries, listSpecFiles } from './spec-index.js';
import { parseSpecFile } from './spec-parse.js';
import type { TaskPlan } from '../task-plan/types.js';

/**
 * 锚点平铺视图（`spec anchors` 的投影）。
 *
 * 与「验收覆盖」（只看得到有 acceptance 的锚点）互补：这里列**全部**锚点，
 * 并回答三个界面答不出来的问题——这个锚点属于哪个 kind、它有没有被冻结任务绑定、它的验收项里有几条可执行。
 *
 * 「被绑定」的判定只有一份实现（`collectBoundAnchorBindings`），指标侧（anchor_coverage_rate）也用同一份，
 * 否则「覆盖率 0.75」和界面上标红的锚点数可能对不上。
 */

export interface SpecAnchorEntry {
  path: string;
  kind: string;
  anchor: string;
  /** 有效验收项数：锚点自己的，没有则回退到文件级（与 `spec anchors` 同口径）。 */
  acceptance: number;
  /** 其中带可执行 check 的数量。 */
  checked: number;
  /** 绑定到该锚点的 frozen / approved 任务，形如 `G1/T2`。 */
  bound_tasks: string[];
}

export interface SpecAnchorsProjection {
  entries: SpecAnchorEntry[];
  totals: {
    anchors: number;
    bound: number;
    unbound: number;
    acceptance: number;
    checked: number;
    /**
     * 不参与绑定的**结构标题**数量（其它 kind 的标题：flow 的步骤、models 的实体、rules 的规则……）。
     *
     * 存在的理由是界面要能**把"不需要绑定"说出来**：只列可绑定锚点时，用户看到"未绑定"无法
     * 判断这是"该绑没绑"还是"本来就不用绑"——把被排除的数量一并给出，两类语义才分得开。
     */
    structural: number;
  };
}

function planDir(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'plans');
}

async function listPlanFiles(projectRoot: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(planDir(projectRoot));
    return entries.filter((entry) => entry.endsWith('.task-plan.yaml')).sort();
  } catch {
    return [];
  }
}

/**
 * 锚点 → 绑定任务（键为 `spec_ref#anchor`）。
 *
 * 只认 frozen / approved：draft 阶段的任务还没定下来，把它算进覆盖率会让「覆盖率」变成
 * 「计划里写了多少」，而它想问的是「契约被兑现了多少」。
 */
export async function collectBoundAnchorBindings(projectRoot: string): Promise<Map<string, string[]>> {
  const bindings = new Map<string, string[]>();
  for (const file of await listPlanFiles(projectRoot)) {
    let plan: TaskPlan;
    try {
      plan = parse(await fs.readFile(path.join(planDir(projectRoot), file), 'utf8')) as TaskPlan;
    } catch {
      continue;
    }
    for (const task of plan.tasks) {
      if (task.status !== 'frozen' && task.status !== 'approved') continue;
      if (!task.spec_ref || !task.spec_anchor) continue;
      const key = task.spec_ref + '#' + task.spec_anchor;
      const binding = bindings.get(key) ?? [];
      binding.push(plan.goal + '/' + task.id);
      bindings.set(key, binding);
    }
  }
  return bindings;
}

export async function collectSpecAnchors(projectRoot: string): Promise<SpecAnchorsProjection> {
  const files = await listSpecFiles(projectRoot);
  const entries = await listSpecEntries(projectRoot);
  const kindByPath = new Map(entries.map((entry) => [entry.path, entry.kind]));
  const bindings = await collectBoundAnchorBindings(projectRoot);

  const rows: SpecAnchorEntry[] = [];
  /**
   * 只有 **capability spec** 的契约标题是"可绑定锚点"：任务用 `spec_anchor` 指向它，
   * 覆盖率也只看它（`domains/metrics/spec-health.ts` 同一口径）。
   *
   * 其它 kind 的标题是**文档结构**——flow 的三段式骨架、models 的实体清单、rules 的规则表、
   * constraints 的各条约束……它们不参与任务绑定，列进来只会让「未绑定锚点」变成噪音
   * （实测：某项目 22 行里 16 行是这类结构标题，唯一被误报的"缺口"其实没人需要绑定）。
   */
  const bindable = files.filter((file) => kindByPath.get(file) === 'capability');
  let structural = 0;
  for (const file of files) {
    if (kindByPath.get(file) === 'capability') continue;
    structural += (await parseSpecFile(projectRoot, file)).anchors.length;
  }
  for (const file of bindable) {
    const parsed = await parseSpecFile(projectRoot, file);
    for (const anchor of parsed.anchors) {
      // 与 CLI 同口径：锚点自己有验收项就用它，否则回退到文件级。
      const items = anchor.acceptance.length > 0 ? anchor.acceptance : parsed.acceptance;
      rows.push({
        path: file,
        kind: kindByPath.get(file) ?? 'unknown',
        anchor: anchor.heading,
        acceptance: items.length,
        checked: items.filter((item) => item.check !== null).length,
        bound_tasks: bindings.get(file + '#' + anchor.heading) ?? [],
      });
    }
  }

  const bound = rows.filter((row) => row.bound_tasks.length > 0).length;
  return {
    entries: rows,
    totals: {
      anchors: rows.length,
      bound,
      unbound: rows.length - bound,
      acceptance: rows.reduce((total, row) => total + row.acceptance, 0),
      checked: rows.reduce((total, row) => total + row.checked, 0),
      structural,
    },
  };
}
