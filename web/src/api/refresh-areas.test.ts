import { describe, expect, it } from 'vitest';
import { areaForPath } from './refresh-areas';

/**
 * SSE path → 刷新区域。
 *
 * 这里钉的是"每个会写状态的接口都有人管"：漏一条的表现是"某个面板就是不自动刷新"，
 * 而它和"本来没有变更"长得一模一样，肉眼几乎发现不了。
 */
describe('areaForPath', () => {
  it('后端确实会广播的 path 都落到一个具名区域', () => {
    const paths: Array<[string, string]> = [
      ['/api/goals', 'goals'],
      ['/api/mission.md', 'goals'],
      ['/api/context', 'goals'],
      ['/api/specs', 'specs'],
      ['/api/plans', 'plans'],
      ['/api/plans/G1', 'plans'],
      ['/api/changes', 'changes'],
      ['/api/changes/G1-T1', 'changes'],
      ['/api/current-change', 'changes'],
      ['/api/evolutions', 'evolve'],
      ['/api/config', 'config'],
      // 调度面板：页面上的控制 / 重建 / 重排 / 启动内嵌调度器都广播这个前缀。
      ['/api/scheduler/queue', 'scheduler'],
      ['/api/scheduler/daemon/control', 'scheduler'],
      // 资产面板：bundle 分发 / skill 导入 / hook 安装。
      ['/api/bundles', 'assets'],
      ['/api/skills', 'assets'],
      ['/api/hook/preview', 'assets'],
    ];
    for (const [path, area] of paths) expect([path, areaForPath(path)]).toEqual([path, area]);
  });

  it('其余（findings / metrics / gates / doctor / jobs）回落到总览', () => {
    for (const path of ['/api/findings', '/api/metrics', '/api/gates', '/api/project/doctor', '/api/jobs']) {
      expect([path, areaForPath(path)]).toEqual([path, 'overview']);
    }
    expect(areaForPath(undefined)).toBe('overview');
  });
});
