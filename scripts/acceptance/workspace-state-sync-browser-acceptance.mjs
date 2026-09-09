import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitializedApp } from '../../app/server/app.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const runtimeNodeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
const requireRuntime = createRequire(join(runtimeNodeModules, 'playwright', 'package.json'));
const { chromium } = requireRuntime('playwright');

const root = await mkdtemp(join(tmpdir(), 'flowmind-workspace-state-sync-browser-'));
const session = {
  version: 4,
  tabs: [{ id: 'tab-sync-doc', kind: 'document', type: 'document', route: 'knowledge', resourceId: 'sync-doc', title: '跨设备现场资料', contentVersionId: 2, revision: 'r2', contentHash: 'hash-2' }],
  activeTabId: 'tab-sync-doc',
  recentWork: [{ id: 'recent-sync-doc', kind: 'document', type: 'document', documentId: 'sync-doc', title: '跨设备现场资料', useCount: 2 }],
  readingPositions: { 'sync-doc': { scrollTop: 120, progress: 0.42, anchor: 'chars:10-20', updatedAt: '2026-08-09T14:00:00.000Z' } },
  aiContextItems: [{ id: 'context-sync-doc', kind: 'document', documentId: 'sync-doc', title: '跨设备现场资料', anchor: 'chars:10-20' }],
  tasks: [{ id: 'sync-task', type: 'skill', status: 'paused', recoverable: true, title: '继续核对现场', documentIds: ['sync-doc'] }],
  draftMarkers: { 'sync-doc': { dirty: true, updatedAt: '2026-08-09T14:00:00.000Z' } }
};
const changedSession = {
  ...session,
  readingPositions: { 'sync-doc': { scrollTop: 820, progress: 0.86, anchor: 'chars:80-90', updatedAt: '2026-08-09T14:05:00.000Z' } }
};
const emptySession = { version: 4, tabs: [], activeTabId: null, recentWork: [], readingPositions: {}, aiContextItems: [], tasks: [], draftMarkers: {} };
const runtimeErrors = [];
const apps = [];
const servers = [];
const appsRoot = join(root, 'apps');

async function start(name) {
  const stateRoot = join(appsRoot, name);
  const app = await createInitializedApp({
    stateFile: join(stateRoot, 'state.json'),
    staticDir: join(projectRoot, 'app', 'dist'),
    env: {},
    ocrService: false,
    transcriptionService: false,
    modelOptions: { secretFile: join(stateRoot, 'model.enc'), masterKeyFile: join(stateRoot, 'model.key') },
    feishuOptions: { secretFile: join(stateRoot, 'feishu.enc'), masterKeyFile: join(stateRoot, 'feishu.key') },
    workspaceSyncOptions: { secretFile: join(stateRoot, 'sync.enc'), masterKeyFile: join(stateRoot, 'sync.key'), relayFile: join(stateRoot, 'relay.json') }
  });
  const server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  apps.push(app); servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function api(base, path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, body: await response.json().catch(() => ({})) };
}

async function overflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
}

let browser;
try {
  const appBase = await start('device-a');
  const deviceB = await start('device-b');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.addInitScript(value => localStorage.setItem('flowmind.workspace.session', JSON.stringify(value)), session);
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(`console:${message.text()}`); });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  await page.goto(appBase, { waitUntil: 'networkidle', timeout: 30000 });
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.locator('[data-settings-section="privacy"]').click();
  const panel = page.locator('[data-workspace-sync-panel="true"]');
  await panel.waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: '创建同步空间', exact: true }).click();
  await page.locator('.workspace-sync-pairing code').waitFor({ state: 'visible', timeout: 15000 });
  const pairingToken = await page.locator('.workspace-sync-pairing code').innerText();
  const endpoint = await page.locator('.workspace-sync-fields input').nth(0).inputValue();
  const workspaceId = await page.locator('.workspace-sync-fields input').nth(1).inputValue();
  assert.ok(pairingToken && endpoint && workspaceId);
  await api(deviceB, '/api/workspace-sync/settings', 'PUT', { endpoint, workspaceId, accessToken: pairingToken, enabled: true });

  await page.getByRole('button', { name: '检查远端变化', exact: true }).click();
  await page.getByText('远端尚无工作现场', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: '同步并恢复', exact: true }).click();
  await page.getByText('工作现场已同步并恢复', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });

  const pulled = await api(deviceB, '/api/workspace-sync/preview', 'POST', { session: emptySession });
  assert.equal(pulled.body.plan.canApply, true);
  await api(deviceB, '/api/workspace-sync/apply', 'POST', { session: emptySession, expectedRevision: pulled.body.remoteRevision });
  const changedPreview = await api(deviceB, '/api/workspace-sync/preview', 'POST', { session: changedSession });
  const changedResolutions = Object.fromEntries((changedPreview.body.plan.conflicts || []).map(item => [item.id, 'local']));
  const changedApply = await api(deviceB, '/api/workspace-sync/apply', 'POST', { session: changedSession, expectedRevision: changedPreview.body.remoteRevision, resolutions: changedResolutions });
  assert.equal(changedApply.response.status, 200);

  await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('flowmind.workspace.session') || '{}');
    current.readingPositions = { ...(current.readingPositions || {}), 'sync-doc': { scrollTop: 140, progress: 0.3, anchor: 'chars:14-24', updatedAt: '2026-08-09T14:06:00.000Z' } };
    localStorage.setItem('flowmind.workspace.session', JSON.stringify(current));
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.locator('[data-settings-section="privacy"]').click();
  await panel.waitFor({ state: 'visible', timeout: 15000 });
  const previewResponsePromise = page.waitForResponse(response => response.url().endsWith('/api/workspace-sync/preview'));
  await page.getByRole('button', { name: '检查远端变化', exact: true }).click();
  const previewResponse = await previewResponsePromise;
  const previewBody = await previewResponse.json();
  console.log('browser preview after local edit:', { status: previewResponse.status(), localReading: await page.evaluate(() => JSON.parse(localStorage.getItem('flowmind.workspace.session') || '{}').readingPositions?.['sync-doc']), conflicts: previewBody.plan?.conflicts?.map(item => ({ id: item.id, collection: item.collection, local: item.local, remote: item.remote })) });
  await page.getByText('发现需要确认的变化', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  const conflictArticles = page.locator('.workspace-sync-conflicts article');
  assert.ok(await conflictArticles.count() > 0);
  for (let index = 0; index < await conflictArticles.count(); index += 1) await conflictArticles.nth(index).locator('button').first().click();
  console.log('selected resolutions:', await conflictArticles.locator('button.is-selected').count());
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('同步并恢复') && !button.disabled));
  const applyResponsePromise = page.waitForResponse(response => response.url().endsWith('/api/workspace-sync/apply'));
  await page.getByRole('button', { name: '同步并恢复', exact: true }).click();
  const applyResponse = await applyResponsePromise;
  console.log('browser apply status:', applyResponse.status(), 'body:', await applyResponse.json().then(body => ({ code: body.error?.code, status: body.status, revision: body.revision, conflicts: body.error?.details?.conflicts?.map(item => item.id) })));
  await page.waitForTimeout(1000);
  console.log('A sync panel after conflict apply:', await panel.innerText());
  await page.getByText('工作现场已同步并恢复', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('flowmind.workspace.session') || '{}'));
  assert.equal(restored.readingPositions['sync-doc'].scrollTop, 140);
  assert.equal((await api(appBase, '/api/state')).response.status, 200);

  const overflowByViewport = {};
  for (const [label, width, height] of [['desktop', 1440, 960], ['compact', 1180, 860], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(180);
    overflowByViewport[label] = await overflow(page);
    assert.equal(overflowByViewport[label], 0, `${label} settings view must not overflow`);
  }
  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({ ok: true, workspaceId, remoteRevision: 4, conflictsResolved: await conflictArticles.count(), overflow: overflowByViewport, runtimeErrors }, null, 2));
} finally {
  await browser?.close();
  for (const server of servers.reverse()) await new Promise(resolveServer => server.close(() => resolveServer()));
  for (const app of apps) await app.locals.close?.();
  await rm(root, { recursive: true, force: true });
}
