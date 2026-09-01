import { createServer } from 'node:http';
import { collectProjectStatus } from './collector.js';

export interface DashboardServerOptions {
  projectRoot: string;
  port?: number;
}

export interface DashboardServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startDashboardServer(options: DashboardServerOptions): Promise<DashboardServerHandle> {
  const requestedPort = options.port ?? 4321;
  const server = createServer(async (req, res) => {
    if (req.url === "/api/status") {
      const status = await collectProjectStatus(options.projectRoot);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(status, null, 2));
      return;
    }

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html><head><meta charset=\"utf-8\"><title>CometFlow</title></head><body><h1>CometFlow</h1><p><a href=\"/api/status\">/api/status</a></p></body></html>");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  return {
    port,
    url: "http://127.0.0.1:" + port,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
