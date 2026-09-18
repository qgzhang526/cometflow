import { createRouter, createWebHashHistory } from 'vue-router';
import { PANELS, type PanelId } from './panels';

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

// 面板清单挪到 `panels.ts`（纯数据，可单测）；这里只是转出去，既有 import 不用改。
export { PANELS };
export type { PanelId };
