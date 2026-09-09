import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { handleApiRequest } from './api.js';
import type { ApiContext } from './http.js';
import { JobManager } from './jobs.js';
import { defaultWorkspaceRoot } from './workspace.js';

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
  close: () => Promise<void>;
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

function sendUnauthorized(res: import('node:http').ServerResponse): void {
  res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: { code: 'unauthorized', message: 'missing or invalid token' } }));
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
  for (const candidate of candidates) {
    try {
      const data = await fs.readFile(candidate);
      const ext = path.extname(candidate).toLowerCase();
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
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
  const webDir = options.webDir ?? path.join(process.cwd(), 'web');
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 4321;
  const jobs = new JobManager();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
      const bearer = req.headers.authorization;
      const supplied = bearer?.startsWith('Bearer ') ? bearer.slice(7) : url.searchParams.get('token');
      if (supplied !== token) {
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

      const ctx: ApiContext = { req, res, workspaceRoot, jobs, webDir };
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
