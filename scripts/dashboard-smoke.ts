import path from 'node:path';
import { startDashboardServer } from '../domains/dashboard/server.js';

const projectRoot = path.resolve(process.argv[2] ?? ".");
const server = await startDashboardServer({ projectRoot, port: 0 });
try {
  const statusResponse = await fetch(server.url + "/api/status");
  if (!statusResponse.ok) throw new Error("status endpoint returned " + statusResponse.status);
  const status = await statusResponse.json() as { goals?: unknown; plans?: unknown; changes?: unknown; evolutions?: unknown };
  for (const key of ["goals", "plans", "changes", "evolutions"]) {
    if (!(key in status)) throw new Error("status missing field " + key);
  }

  const htmlResponse = await fetch(server.url);
  const html = await htmlResponse.text();
  if (!html.includes("cometflow-dashboard")) throw new Error("dashboard HTML missing app element");
  if (!html.includes("CometFlow Dashboard")) throw new Error("dashboard HTML missing title");

  console.log("dashboard-smoke: PASS " + server.url);
} finally {
  await server.close();
}
