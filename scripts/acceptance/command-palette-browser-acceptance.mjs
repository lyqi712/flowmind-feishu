import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitializedApp } from '../../app/server/app.mjs';
import { createDefaultState } from '../../app/server/state-store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const runtimeNodeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
const requireRuntime = createRequire(join(runtimeNodeModules, 'playwright', 'package.json'));
const { chromium } = requireRuntime('playwright');

const root = await mkdtemp(join(tmpdir(), 'flowmind-command-palette-'));
const stateFile = join(root, 'state.json');
const runtimeErrors = [];

const state = createDefaultState();
const app = await createInitializedApp({
  stateFile,
  env: { NODE_ENV: 'test' },
  fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
  ocrService: false,
  transcriptionService: false,
  modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
  feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
});
const server = await new Promise((resolveServer, reject) => {
  const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
  instance.once('error', reject);
});
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console:${message.text()}`);
});
page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));

try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });

  await page.keyboard.press('Control+K');
  const palette = page.locator('.unified-workspace-command-palette');
  await palette.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await page.locator('.unified-workspace-command-palette').count(), 1, 'Ctrl+K must open exactly one command palette');
  await palette.getByLabel('全局命令').waitFor({ state: 'visible', timeout: 5000 });

  await page.keyboard.press('Escape');
  await palette.waitFor({ state: 'hidden', timeout: 5000 });

  await page.keyboard.press('Control+K');
  await palette.waitFor({ state: 'visible', timeout: 5000 });
  await page.keyboard.press('Control+K');
  await palette.waitFor({ state: 'hidden', timeout: 5000 });

  await page.getByRole('button', { name: '新对话', exact: true }).click();
  const composer = page.locator('.composer textarea');
  await composer.waitFor({ state: 'visible', timeout: 10000 });
  await composer.focus();
  await page.keyboard.press('Control+K');
  await palette.waitFor({ state: 'hidden', timeout: 5000 });
  assert.equal(await page.locator('.unified-workspace-command-palette').count(), 0, 'Ctrl+K must not open palette while composer is focused');

  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({ ok: true, runtimeErrors }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await app.locals.close();
  await rm(root, { recursive: true, force: true });
}
