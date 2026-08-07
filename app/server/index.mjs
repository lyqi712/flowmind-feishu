import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadLocalEnv } from './load-env.mjs';
import { createApp } from './app.mjs';

loadLocalEnv({ cwd: fileURLToPath(new URL('..', import.meta.url)) });

export { createApp, createInitializedApp, DEFAULT_STATE_FILE } from './app.mjs';

export async function startServer({ port = Number(process.env.PORT) || 8789, host = process.env.HOST || '127.0.0.1', ...appOptions } = {}) {
  const app = createApp(appOptions);
  await app.locals.ready;
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(port, host, () => resolve(instance));
    instance.once('error', reject);
  });
  return { app, server, port: server.address().port, host };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, host, port } = await startServer();
  console.log(`ima-feishu API listening on http://${host}:${port}`);

  const shutdown = (signal) => {
    console.log(`received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
