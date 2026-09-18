/**
 * 工作台的面板清单（导航与"面板标签"的唯一来源）。
 *
 * 单独一个模块而不是写在 `router.ts` 里：路由要建 `createWebHashHistory()`（依赖 `location`），
 * 而面板标签是**纯数据**——问题清单的「去处理」要按 panel id 取中文名，
 * 那份映射必须能在 node 环境里单测（不拖进 vue-router）。
 */
export const PANELS = [
  { id: 'overview', label: '总览', icon: '📊' },
  { id: 'goals', label: '目标', icon: '🎯' },
  { id: 'specs', label: '规格', icon: '📐' },
  { id: 'plans', label: '计划', icon: '🗺️' },
  { id: 'changes', label: '变更', icon: '🔀' },
  { id: 'evolve', label: '进化', icon: '🧬' },
  { id: 'eval', label: '评估', icon: '🧪' },
  { id: 'scheduler', label: '调度', icon: '🛰️' },
  { id: 'assets', label: '资产', icon: '📦' },
  { id: 'settings', label: '设置', icon: '⚙️' },
] as const;

export type PanelId = (typeof PANELS)[number]['id'];
