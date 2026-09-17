import { describe, expect, it } from 'vitest';
import {
  compareGoals,
  fallbackRank,
  formatScheduleOrder,
  parseScheduleOrder,
  scheduleRank,
} from '../../domains/goal/schedule-order.js';

/**
 * goal 级调度顺序（ADR 0029）。
 *
 * 顺序写在 COMETFLOW.md 的 `## 调度顺序` 里，**位置即顺序**：列出的按清单走，
 * 没列出的按编号升序兜底。用位置而不是数字，是因为位置天然唯一——不存在
 * "两个 goal 优先级相同怎么办"，也不存在"0 算最高还是最低"的歧义。
 */

const MISSION = [
  '# 项目使命',
  '',
  '## 任务目标',
  '',
  '### G1：core',
  '- 目标：core',
  '',
  '### G2：auth',
  '- 目标：auth',
  '',
  '## 调度顺序',
  '',
  '- G2',
  '- G1',
  '',
  '## 其他段落',
  '',
  '- G9',
  '',
].join('\n');

describe('parseScheduleOrder', () => {
  it('按书写顺序取清单，且不会越过下一节', () => {
    const order = parseScheduleOrder(MISSION, ['G1', 'G2']);
    // `## 其他段落` 之后的 G9 不属于调度顺序。
    expect(order.listed).toEqual(['G2', 'G1']);
    expect(order.warnings).toEqual([]);
  });

  it('没有这一段：就是空清单（全部走编号兜底），不报错', () => {
    const order = parseScheduleOrder('## 任务目标\n\n### G1：core\n- 目标：core\n');
    expect(order.listed).toEqual([]);
    expect(order.warnings).toEqual([]);
    expect(formatScheduleOrder(order)).toContain('按 goal 编号升序');
  });

  it('容错：未知 goal / 重复 / 不是 goal 的行都只给 warning，其余照常', () => {
    const markdown = [
      '## 调度顺序',
      '- G3',
      '- G9',
      '- 先做认证',
      '- G3：再写一次',
    ].join('\n');
    const order = parseScheduleOrder(markdown, ['G1', 'G3']);
    expect(order.listed).toEqual(['G3']);
    expect(order.warnings.some((line) => line.includes('G9'))).toBe(true);
    expect(order.warnings.some((line) => line.includes('不是 goal id'))).toBe(true);
    expect(order.warnings.some((line) => line.includes('多次'))).toBe(true);
  });

  it('`- G3：说明` 与 `* G3` 都认', () => {
    const order = parseScheduleOrder('## 调度顺序\n\n- G3：先做这个\n* G1\n');
    expect(order.listed).toEqual(['G3', 'G1']);
  });
});

describe('排序判据', () => {
  it('清单里的按位置，没列出的按编号升序排在后面', () => {
    const order = parseScheduleOrder('## 调度顺序\n\n- G7\n');
    expect(scheduleRank('G7', order)).toBe(0);
    // 没列出的排在列出者之后（0 + listed.length），内部按编号。
    expect(scheduleRank('G2', order)).toBeLessThan(scheduleRank('G10', order));
    expect(compareGoals('G7', 'G2', order)).toBeLessThan(0);
  });

  it('兜底按编号而不是字典序：G2 在 G10 之前（旧实现按 plan 文件名排序会反）', () => {
    const empty = parseScheduleOrder('# 项目使命\n');
    expect(fallbackRank('G2')).toBe(2);
    expect(fallbackRank('G10')).toBe(10);
    expect(compareGoals('G2', 'G10', empty)).toBeLessThan(0);
    expect(['G10', 'G2', 'G1'].sort((left, right) => compareGoals(left, right, empty))).toEqual([
      'G1',
      'G2',
      'G10',
    ]);
  });

  it('全序：非 G<数字> 的 id 也有确定先后（同样输入两次结果一致）', () => {
    const empty = parseScheduleOrder('# 项目使命\n');
    const ids = ['spike', 'G3', 'alpha', 'G10'];
    const once = [...ids].sort((left, right) => compareGoals(left, right, empty));
    const twice = [...ids].sort((left, right) => compareGoals(left, right, empty));
    expect(once).toEqual(twice);
    // 非数字 id 排在数字之后，彼此按字符串。
    expect(once.slice(-2)).toEqual(['alpha', 'spike']);
  });
});
