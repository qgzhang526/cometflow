import path from 'node:path';
import { startDashboardServer } from '../../domains/dashboard/server.js';

export async function dashboardCommand(targetPath: string, options: { port?: number }): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const server = await startDashboardServer({ projectRoot, port: options.port });
  console.log("CometFlow dashboard: " + server.url);
  console.log("Press Ctrl+C to stop");

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
