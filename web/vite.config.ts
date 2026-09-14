import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Web 客户端独立构建到 web/dist，由 `cometflow serve` 静态托管。
// 开发时用 `pnpm web:dev`，/api 代理到本机 serve，避免 CORS 与 token 跨域问题。
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.COMETFLOW_SERVE_URL ?? 'http://127.0.0.1:4321',
        changeOrigin: true,
      },
    },
  },
});
