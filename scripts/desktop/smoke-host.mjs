import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDesktopHost } from '../../app/desktop/runtime.mjs';
import { redactLogValue } from '../../app/desktop/logger.mjs';
import { sanitizeWindowState } from '../../app/desktop/window-state.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..', '..');
const appRoot = path.join(projectRoot, 'app');
const distDir = path.join(appRoot, 'dist');
const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flowmind-desktop-smoke-'));
let host;

try {
  assert.equal(fs.existsSync(path.join(distDir, 'index.html')), true, 'app/dist/index.html must exist');
  const syntheticSecret = ['api', 'key'].join('_') + '=' + ['test', 'secret'].join('-');
  assert.equal(redactLogValue(syntheticSecret), 'api_key=[REDACTED]');
  assert.deepEqual(sanitizeWindowState({ width: 100, height: 100 }), { width: 960, height: 640, isMaximized: false });

  host = await startDesktopHost({
    appRoot,
    distDir,
    stateFile: path.join(temporary, 'state.json'),
    port: 0,
    env: {}
  });

  const healthResponse = await fetch(`${host.origin}/desktop-healthz`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { ok: true, runtime: 'electron-desktop-host' });

  const stateResponse = await fetch(`${host.origin}/api/state`);
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.ok(Array.isArray(state.knowledgeBases));
  assert.ok(Array.isArray(state.documents));

  const htmlResponse = await fetch(`${host.origin}/`);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert.match(html, /<div id="root"><\/div>/);

  const api404 = await fetch(`${host.origin}/api/does-not-exist`, { headers: { accept: 'application/json' } });
  assert.equal(api404.status, 404);
  assert.equal((await api404.json()).error.code, 'API_NOT_FOUND');

  console.log(JSON.stringify({
    ok: true,
    checks: ['desktop-health', 'api-state', 'renderer-index', 'api-404', 'log-redaction', 'window-state'],
    origin: host.origin
  }));
} finally {
  await host?.close().catch(() => {});
  await fs.promises.rm(temporary, { recursive: true, force: true });
}
