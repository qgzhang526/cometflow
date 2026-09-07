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

function dashboardHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>CometFlow Dashboard</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; background: #f6f8fa; color: #1f2328; }
h1 { font-size: 24px; }
h2 { font-size: 18px; margin-top: 24px; }
.card { background: #fff; border: 1px solid #d1d9e0; border-radius: 8px; padding: 16px; margin: 12px 0; }
table { border-collapse: collapse; width: 100%; background: #fff; }
th, td { text-align: left; border-bottom: 1px solid #e6e6e6; padding: 8px; }
th { background: #f0f3f5; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; background: #eef2ff; color: #3344cc; }
</style>
</head>
<body>
<h1>CometFlow Dashboard</h1>
<div id="cometflow-dashboard" class="card">Loading...</div>
<script>
async function render() {
  const root = document.getElementById('cometflow-dashboard');
  const response = await fetch('/api/status');
  const status = await response.json();
  const goalList = status.goals.length ? status.goals.join(', ') : 'none';
  const planRows = status.plans.map(p => '<tr><td>' + p.goal + '</td><td>' + p.status + '</td><td>' + p.tasks + '</td></tr>').join('');
  const changeRows = status.changes.map(c => '<tr><td>' + c.name + '</td><td>' + c.phase + '</td><td>' + (c.archived ? 'archived' : 'active') + '</td></tr>').join('');
  const evolutionRows = status.evolutions.map(e => '<tr><td>' + e.name + '</td><td>' + e.status + '</td></tr>').join('');
  root.innerHTML = '<p><strong>Goals:</strong> ' + goalList + '</p>' +
    '<h2>Plans</h2><table><tr><th>Goal</th><th>Status</th><th>Tasks</th></tr>' + planRows + '</table>' +
    '<h2>Changes</h2><table><tr><th>Name</th><th>Phase</th><th>State</th></tr>' + changeRows + '</table>' +
    '<h2>Evolutions</h2><table><tr><th>Name</th><th>Status</th></tr>' + evolutionRows + '</table>';
}
render().catch(error => {
  document.getElementById('cometflow-dashboard').textContent = 'Failed to load status: ' + error;
});
</script>
</body>
</html>`;
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
    res.end(dashboardHtml());
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
