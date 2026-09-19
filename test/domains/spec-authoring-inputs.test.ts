import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncGoals } from '../../domains/goal/goal-sync.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { buildChangePrompt } from '../../domains/workflow/change-execution.js';
import {
  NEIGHBOR_SPEC_LIMIT,
  gatherSpecAuthoringHints,
  renderSpecAuthoringInputs,
} from '../../domains/workflow/spec-authoring-inputs.js';

/**
 * `spec-authoring` 提示词的输入面。
 *
 * 起草任务的旧提示词只交底了 goal 的范围与成功标准，Agent 于是凭空造引用，
 * 或者干脆不写引用——两者都会让 spec validate 报 unresolved reference。
 * 这里钉住新增的两块：**可引用的事实**（枚举）与**本仓库的体例**（邻居全文）。
 */

let root: string;

const MODELS = [
  '# 数据模型',
  '',
  '## 实体：Order',
  '',
  '| 字段 | 类型 | 必填 | 唯一 | 说明 |',
  '|------|------|------|------|------|',
  '| order_id | string | 是 | 是 | 订单号 |',
  '| amount | integer | 是 | 否 | 金额 |',
  '| status | string | 是 | 否 | 见枚举 OrderStatus |',
  '',
  '## 枚举',
  '',
  '- OrderStatus：0=created, 1=paid',
  '',
].join('\n');

const ERRORS = [
  '# 错误码目录',
  '',
  '## 错误码',
  '',
  '| code | 语义 | 触发接口 |',
  '|------|------|----------|',
  '| E_ORDER_NOT_FOUND | 订单不存在 | order |',
  '| E_STOCK_SHORTAGE | 库存不足 | inventory |',
  '',
].join('\n');

const CONFIG = [
  '# 配置',
  '',
  '## 配置项',
  '',
  '| key | 默认值 | 说明 |',
  '|-----|--------|------|',
  '| order.max_amount | 10000 | 单笔金额上限 |',
  '',
].join('\n');

const INVENTORY_SPEC = [
  '---',
  'capability: inventory',
  'module: internal/inventory',
  'status: approved',
  '---',
  '',
  '# inventory capability',
  '',
  '## POST /api/inventory/reserve',
  '',
  '预占库存。',
  '',
  '- 模型：Order',
  '- 错误码：E_STOCK_SHORTAGE',
  '- 状态码：200',
  '',
  '## 验收',
  '',
  '- A001：库存充足时返回预留号',
  '',
].join('\n');

async function writeFile(relativePath: string, content: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content);
}

async function makeProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-authoring-inputs-'));
  await fs.mkdir(path.join(dir, '.cometflow'), { recursive: true });
  await fs.writeFile(path.join(dir, '.cometflow', 'config.yaml'), 'schema: cometflow.project.v1\n');
  await fs.writeFile(
    path.join(dir, 'COMETFLOW.md'),
    [
      '# 项目使命',
      '',
      '## 任务目标',
      '',
      '### G1：下单与库存',
      '- 目标：把下单流程做成可验收的契约',
      '- 范围：order, inventory',
      '- 成功标准：',
      '  - 下单接口有可判定的验收项',
      '- 非目标：',
      '  - 不做支付',
      '',
    ].join('\n'),
  );
  return dir;
}

/** 建一个 order capability 缺席、inventory 已存在的项目，并产出一条起草任务。 */
async function makeAuthoringChange(): Promise<void> {
  const plan = await generateTaskPlan(root, 'G1');
  const authoring = plan.tasks.find((task) => task.kind === 'spec-authoring');
  if (!authoring) throw new Error('expected a spec-authoring task');
  await writeTaskPlan(root, await freezeTaskPlan(root, plan));
  await createChangeFromTask({
    projectRoot: root,
    goalId: 'G1',
    taskId: authoring.id,
    changeName: 'author-order',
  });
}

beforeEach(async () => {
  root = await makeProject();
  await writeFile('specs/models.md', MODELS);
  await writeFile('specs/errors.md', ERRORS);
  await writeFile('specs/config.md', CONFIG);
  await writeFile('specs/inventory/spec.md', INVENTORY_SPEC);
  await syncGoals(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('spec-authoring 的输入面', () => {
  it('列出可引用的模型实体、错误码与配置键', async () => {
    const hints = await gatherSpecAuthoringHints(root, { capability: 'order', scope: ['order', 'inventory'] });
    expect(hints.models.map((entity) => entity.name)).toContain('Order');
    expect(hints.error_codes).toContain('E_ORDER_NOT_FOUND');
    expect(hints.error_codes).toContain('E_STOCK_SHORTAGE');
    expect(hints.config_keys).toContain('order.max_amount');
    expect(hints.capability_names).toEqual(['inventory']);
  });

  it('提示词里给出可引用事实、实体字段与体例参照', async () => {
    await makeAuthoringChange();
    const prompt = await buildChangePrompt(root, 'author-order');

    expect(prompt).toContain('## Existing facts you may reference');
    expect(prompt).toContain('Order');
    expect(prompt).toContain('E_ORDER_NOT_FOUND');
    expect(prompt).toContain('order.max_amount');
    // 接口字段必须来自 models，否则报 unresolved-field-reference：字段清单要一起给出。
    expect(prompt).toContain('order_id');
    // 体例参照：邻居 spec 的 front-matter 键与验收写法要能看到。
    expect(prompt).toContain('## House style to follow');
    expect(prompt).toContain('specs/inventory/spec.md');
    expect(prompt).toContain('A001：库存充足时返回预留号');
  });

  it('缺什么就明说缺，而不是让 Agent 凭空引用', async () => {
    await fs.rm(path.join(root, 'specs', 'errors.md'));
    await fs.rm(path.join(root, 'specs', 'config.md'));
    const hints = await gatherSpecAuthoringHints(root, { capability: 'order', scope: ['order'] });
    const rendered = renderSpecAuthoringInputs(hints).join('\n');
    expect(hints.error_codes).toEqual([]);
    expect(hints.config_keys).toEqual([]);
    expect(rendered).toContain('还没有定义任何错误码');
    expect(rendered).toContain('specs/config.md 里还没有配置键');
    // 悄悄造一个错误码是最危险的失败模式，提示词必须明确禁止。
    expect(rendered).toContain('不要凭空引用');
    // 缺 kind 文件时 validate 只会降级为 warning——这件事必须说清楚，否则护栏口径会被误读。
    expect(rendered).toContain('只会降级为 warning');
  });

  it('正在起草的产物不被当成现状，也不冒充体例', async () => {
    // 目标文件已存在（上一轮起草留下的半成品）时，正文不得回流进提示词。
    await writeFile('specs/order/spec.md', '# order capability\n\n## 旧的半成品\n\n- 模型：Ghost\n');
    const hints = await gatherSpecAuthoringHints(root, { capability: 'order', scope: ['order', 'inventory'] });
    expect(hints.capability_names).not.toContain('order');
    expect(hints.neighbor?.capability).toBe('inventory');
    const rendered = renderSpecAuthoringInputs(hints).join('\n');
    expect(rendered).not.toContain('Ghost');
  });

  it('邻居自身超过上界时截断并标注', async () => {
    await writeFile('specs/inventory/spec.md', INVENTORY_SPEC + '\n' + 'x'.repeat(NEIGHBOR_SPEC_LIMIT + 500));
    const hints = await gatherSpecAuthoringHints(root, { capability: 'order', scope: ['inventory'] });
    expect(hints.neighbor?.truncated).toBe(true);
    expect(hints.neighbor?.content.length).toBe(NEIGHBOR_SPEC_LIMIT);
    const rendered = renderSpecAuthoringInputs(hints).join('\n');
    expect(rendered).toContain('已截断');
  });

  it('没有任何邻居时给出「这是第一份」而不是空节', async () => {
    await fs.rm(path.join(root, 'specs', 'inventory'), { recursive: true, force: true });
    const hints = await gatherSpecAuthoringHints(root, { capability: 'order', scope: ['order'] });
    expect(hints.neighbor).toBeNull();
    expect(renderSpecAuthoringInputs(hints).join('\n')).toContain('还没有任何 capability spec 可参照');
  });
});
