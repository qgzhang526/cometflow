import { createRouter, createWebHashHistory } from 'vue-router';

// 沿用 hash 路由：serve 静态托管时不需要额外的 rewrite 规则，刷新也不会 404。
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
    {
      path: '/project/:id/:panel?',
      name: 'project',
      component: () => import('./views/ProjectView.vue'),
      props: true,
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

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
