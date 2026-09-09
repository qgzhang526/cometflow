import { startServe } from '../../domains/server/serve.js';

export interface ServeCommandOptions {
  workspace?: string;
  port?: number;
  token?: string;
  webDir?: string;
  host?: string;
}

export async function serveCommand(options: ServeCommandOptions): Promise<void> {
  const server = await startServe({
    workspaceRoot: options.workspace,
    port: options.port,
    token: options.token,
    webDir: options.webDir,
    host: options.host,
  });
  console.log('CometFlow: ' + server.url);
  console.log('token: ' + server.token);
  console.log('Press Ctrl+C to stop');

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
