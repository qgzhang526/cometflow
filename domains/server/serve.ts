import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { handleApiRequest } from './api.js';
import type { ApiContext } from './http.js';
import { JobManager } from './jobs.js';
import { createTicketStore } from './tickets.js';
import { defaultWorkspaceRoot, getProject } from './workspace.js';

export interface ServeOptions {
  workspaceRoot?: string;
  port?: number;
  token?: string;
  webDir?: string;
  host?: string;
}

export interface ServeHandle {
  url: string;
  token: string;
  port: number;
  /** 静态目录的解析结果，用于启动时提示「托管的是构建产物还是源码入口」。 */
  ui: UiStatus;
  close: () => Promise<void>;
}

export interface UiStatus {
  dir: string;
  state: 'built' | 'unbuilt' | 'missing';
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

/**
 * 缓存策略。
 *
 * Vite 产物的文件名带内容哈希，可以长期缓存；`index.html` 必须每次回源校验，
 * 否则浏览器会拿着旧入口去请求已经被删掉的 chunk，页面同样是白页。
 */
function cacheControlFor(filePath: string, base: string, servedAsFallback: boolean): string {
  const relative = path.relative(base, filePath).split(path.sep).join('/');
  if (servedAsFallback || relative === 'index.html') return 'no-cache';
  if (relative.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}

function sendUnauthorized(res: import('node:http').ServerResponse): void {
  res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: { code: 'unauthorized', message: 'missing or invalid token' } }));
}

/**
 * 解析静态目录。
 *
 * Web 客户端由 Vite 构建到 `web/dist`，但人们习惯把 `--web-dir web` 或
 * `COMETFLOW_WEB_DIR=web` 指到项目根。这里在「目标目录没有 index.html」时自动下沉到
 * `dist/`，让两种写法都能命中已构建的 SPA，而不是把 Vite 的源码入口当成品发出去。
 */
function resolveWebDir(explicit?: string): string {
  const configured = explicit ?? process.env.COMETFLOW_WEB_DIR;
  const base =
    configured !== undefined && configured.trim() !== ''
      ? path.resolve(configured)
      : path.join(process.cwd(), 'web');
  const hasIndex = (dir: string): boolean => existsSync(path.join(dir, 'index.html'));
  // 优先命中已构建产物：Vite 的源码入口也叫 web/index.html（内容是 `src="/src/main.ts"`），
  // 直接发出去只会得到一个空白页，所以 dist/ 优先于 base 本身。
  const candidates = [path.join(base, 'dist'), base];
  return candidates.find(hasIndex) ?? base;
}

/**
 * 判断静态目录里放的是构建产物还是 Vite 源码入口。
 *
 * 源码入口引用 `/src/main.ts`，而 serve 不编译它：浏览器只会拿到一个加载失败的模块，
 * 表现就是白页。这种情况必须在启动时就说清楚，而不是让用户对着空白页猜。
 */
function inspectUi(webDir: string): UiStatus {
  const indexPath = path.join(webDir, 'index.html');
  try {
    const html = readFileSync(indexPath, 'utf8');
    return { dir: webDir, state: html.includes('/src/main.ts') ? 'unbuilt' : 'built' };
  } catch {
    return { dir: webDir, state: 'missing' };
  }
}

async function serveStatic(
  res: import('node:http').ServerResponse,
  webDir: string,
  pathname: string,
): Promise<void> {
  const base = path.resolve(webDir);
  const rel = pathname.replace(/^\/+/, '') || 'index.html';
  const filePath = path.resolve(base, rel);
  if (filePath !== base && !filePath.startsWith(base + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }
  const candidates = [filePath, path.join(base, 'index.html')];
  for (const [index, candidate] of candidates.entries()) {
    try {
      const data = await fs.readFile(candidate);
      const ext = path.extname(candidate).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': cacheControlFor(candidate, base, index > 0),
      });
      res.end(data);
      return;
    } catch {
      // try next candidate
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

export async function startServe(options: ServeOptions = {}): Promise<ServeHandle> {
  const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot();
  const token = options.token ?? randomUUID().replace(/-/g, '').slice(0, 24);
  const webDir = resolveWebDir(options.webDir);
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 4321;
  // 任务落盘到项目自己的 .cometflow/runtime/jobs/，所以 JobManager 需要一个 projectId → root 的解析器。
  const jobs = new JobManager({
    resolveProjectRoot: async (projectId) => (await getProject(workspaceRoot, projectId))?.path ?? null,
  });
  const tickets = createTicketStore();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
      const bearer = req.headers.authorization;
      const supplied = bearer?.startsWith('Bearer ') ? bearer.slice(7) : url.searchParams.get('token');
      // SSE 允许用一次性 ticket 换取连接（token 不再出现在查询串里）；常规请求仍只认 token。
      const ticket = url.searchParams.get('ticket');
      const ticketOk = url.pathname === '/api/events' && ticket !== null && tickets.consume(ticket);
      if (supplied !== token && !ticketOk) {
        sendUnauthorized(res);
        return;
      }

      if (url.pathname === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        const unsubscribe = jobs.subscribe((event) => {
          res.write('data: ' + JSON.stringify(event) + '\n\n');
        });
        req.on('close', () => unsubscribe());
        return;
      }

      const ctx: ApiContext = { req, res, workspaceRoot, jobs, webDir, tickets };
      await handleApiRequest(ctx);
      return;
    }

    await serveStatic(res, webDir, url.pathname);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;

  return {
    port,
    token,
    url: 'http://' + host + ':' + port,
    ui: inspectUi(webDir),
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      /**
       * 优雅停机要把**在途的任务落盘**等完。
       *
       * 任务的终态是先在内存里改、再异步落盘（`jobs.complete` → `track(persist)`），
       * 所以「接口已经报 succeeded」不等于「磁盘上已经是 succeeded」。少了这一步，
       * 刚跑完一个任务就重启 serve，重启后可能读不到那条记录（CI 上就撞到过：
       * `keeps jobs and their results across a serve restart` 偶发 404）。
       */
      await jobs.flush();
    },
  };
}
