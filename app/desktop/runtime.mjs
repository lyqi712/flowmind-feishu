import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createApp } from '../server/app.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function assertReadableFile(filePath, description) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    throw new Error(`${description} not found or unreadable: ${filePath}`);
  }
}

function listen(app, { host, port }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

function closeServer(server, timeoutMs = 5000) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      if (!settled) {
        settled = true;
        reject(new Error(`desktop server did not close within ${timeoutMs}ms`));
      }
    }, timeoutMs);
    timer.unref?.();
    server.close((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections?.();
  });
}

export async function startDesktopHost({
  appRoot,
  distDir = path.join(appRoot, 'dist'),
  stateFile,
  host = '127.0.0.1',
  port = 0,
  logger,
  env = process.env,
  fetchImpl = globalThis.fetch,
  connector,
  connectorOptions,
  feishuOptions,
  modelOptions,
  contentOptions
} = {}) {
  if (!appRoot) throw new Error('appRoot is required');
  if (!stateFile) throw new Error('stateFile is required');
  if (!LOOPBACK_HOSTS.has(host)) throw new Error(`desktop host must use loopback, received: ${host}`);

  const indexFile = path.join(distDir, 'index.html');
  assertReadableFile(indexFile, 'production renderer');

  const webApp = createApp({ stateFile, env, fetchImpl, connector, connectorOptions, feishuOptions, modelOptions, contentOptions, staticDir: null });
  await webApp.locals.ready;

  webApp.get('/desktop-healthz', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, runtime: 'electron-desktop-host' });
  });

  webApp.use('/api', (req, res) => {
    res.status(404).json({ ok: false, error: { code: 'API_NOT_FOUND', message: 'API route not found' } });
  });

  webApp.use(express.static(distDir, {
    index: false,
    fallthrough: true,
    setHeaders(res, assetPath) {
      if (path.basename(assetPath) === 'index.html') res.setHeader('Cache-Control', 'no-store');
      else if (assetPath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));

  webApp.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    if (!req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(indexFile);
  });

  webApp.use((req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Resource not found' } });
  });

  webApp.use((error, req, res, next) => {
    logger?.error('desktop host request failed', { method: req.method, path: req.path, error });
    if (res.headersSent) return next(error);
    return res.status(500).json({ ok: false, error: { code: 'DESKTOP_HOST_ERROR', message: 'Desktop host error' } });
  });

  const server = await listen(webApp, { host, port });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const origin = `http://${host === '::1' ? '[::1]' : host}:${actualPort}`;
  logger?.info('desktop host listening', origin);

  return Object.freeze({
    app: webApp,
    server,
    host,
    port: actualPort,
    origin,
    async close() {
      logger?.info('desktop host stopping');
      await closeServer(server);
      webApp.locals.close?.();
    }
  });
}
