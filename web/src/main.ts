import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { initTokenFromUrl } from './api/client';
import './styles/main.css';

// serve 启动时打印的是带 ?token= 的地址：先落进 localStorage 再从地址栏清掉，
// 后续请求一律走 Authorization 头。
initTokenFromUrl();

createApp(App).use(createPinia()).use(router).mount('#app');
