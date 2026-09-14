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
  if (server.ui.state === 'unbuilt') {
    console.warn(
      'UI 警告: ' +
        server.ui.dir +
        ' 指向的是前端源码入口（Vite 的 index.html），不是构建产物，打开只会得到空白页。',
    );
    console.warn('          先运行 pnpm web:build，或用 --web-dir <项目>/web/dist 指向构建产物。');
  } else if (server.ui.state === 'missing') {
    console.warn('UI 警告: ' + server.ui.dir + ' 下没有 index.html；先运行 pnpm web:build 构建前端。');
  } else {
    console.log('UI: ' + server.ui.dir);
  }
  console.log('Press Ctrl+C to stop');

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
