/**
 * 外部变更（SSE `state.changed` 的 path）→ 面板刷新区域。
 *
 * 后端每次写状态都会广播一条 `state.changed`，path 就是"哪个接口对应的东西变了"。
 * 前端把它收敛成**面板级**区域：只刷新受影响的那一块，而不是整页重挂。
 *
 * 抽成独立模块的理由是它**纯函数、可测**：映射错一条，表现为"某个面板就是不动"，
 * 而这种缺陷靠肉眼看很难发现——它和"没有变更"长得一模一样。
 */
export type RefreshArea =
  | 'overview'
  | 'goals'
  | 'specs'
  | 'plans'
  | 'changes'
  | 'evolve'
  | 'eval'
  | 'config'
  | 'workspace'
  | 'scheduler'
  | 'assets';

export function areaForPath(path: string | undefined): RefreshArea {
  if (path === undefined) return 'overview';
  if (path.startsWith('/api/config')) return 'config';
  if (path.startsWith('/api/goals') || path.startsWith('/api/mission') || path.startsWith('/api/context')) return 'goals';
  if (path.startsWith('/api/specs')) return 'specs';
  if (path.startsWith('/api/plans')) return 'plans';
  // current-change 指针在 Changes 面板展示（也能从资产页的 Hook 预览里改），所以归到 changes。
  if (path.startsWith('/api/changes') || path.startsWith('/api/current-change')) return 'changes';
  if (path.startsWith('/api/evolutions')) return 'evolve';
  if (path.startsWith('/api/eval')) return 'eval';
  // 调度：页面上的控制 / 重建 / 重排 / 启动内嵌调度器都会广播它。
  // 注意 CLI 起的 daemon 直接写项目文件、不发 SSE（见 SchedulerPanel 里的活跃租约轮询）。
  if (path.startsWith('/api/scheduler')) return 'scheduler';
  // 资产：bundle 分发、skill 导入、hook 安装都会改仓库里的文件，面板要重读。
  if (path.startsWith('/api/bundles') || path.startsWith('/api/skills') || path.startsWith('/api/hook')) {
    return 'assets';
  }
  if (path.startsWith('/api/projects') || path.startsWith('/api/workspace')) return 'workspace';
  // 其余（findings / metrics / gates / doctor / jobs …）都影响总览：默认回落到它。
  return 'overview';
}
