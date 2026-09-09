import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitializedApp } from '../../app/server/app.mjs';
import { createDefaultState } from '../../app/server/state-store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const runtimeNodeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
const requireRuntime = createRequire(join(runtimeNodeModules, 'playwright', 'package.json'));
const { chromium } = requireRuntime('playwright');
const root = await mkdtemp(join(tmpdir(), 'flowmind-stage-b-evidence-'));
const stateFile = join(root, 'state.json');
const runtimeErrors = [];

async function request(base, path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  });
  return { response, body: await response.json() };
}

function sourceRef(item, detail, excerpt) {
  const chunk = detail.chunks?.[0];
  return {
    documentId: item.id,
    title: item.title,
    contentVersionId: item.currentVersionId,
    revision: item.revision,
    contentHash: item.contentHash,
    anchor: chunk?.metadata?.anchor || null,
    excerpt
  };
}

const overflow = page => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);

let app;
let server;
let browser;
try {
  const state = createDefaultState();
  state.documents = [];
  state.notes = [];
  state.translations = [];
  state.settings = { ...(state.settings || {}), model: { provider: 'local', model: 'local-retrieval' } };
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  app = await createInitializedApp({
    stateFile,
    staticDir: join(projectRoot, 'app', 'dist'),
    env: {},
    ocrService: false,
    transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const first = (await request(base, '/api/content/import', 'POST', {
    items: [{ externalId: 'stage-b-continuity', fileName: 'continuity.md', title: 'Stage B continuity source', revision: 'stage-b-r1', content: '# Stage B continuity source\n\nVersion one owner is Alice.\n\nThe first revision remains readable.' }]
  })).body.items[0].item;
  const firstDetail = (await request(base, `/api/content/items/${encodeURIComponent(first.id)}`)).body;
  const firstRef = sourceRef(first, firstDetail, 'Version one owner is Alice.');
  const staleNote = await request(base, '/api/notes', 'POST', { title: 'Stage B stale note', content: 'Keep the first revision.', sourceRefs: [firstRef] });
  assert.equal(staleNote.response.status, 201);
  assert.equal(staleNote.body.note.sourceRefs[0].evidenceStatus, 'current');
  const translation = await request(base, '/api/translations', 'POST', {
    documentId: first.id, title: 'Stage B continuity translation', sourceLanguage: '自动检测', targetLanguage: 'English', provider: 'local', glossary: '',
    segments: [{ index: 0, sourceText: 'Version one owner is Alice.', translatedText: 'Version one owner is Alice.', anchor: firstRef.anchor }]
  });
  assert.equal(translation.response.status, 201);

  const current = (await request(base, '/api/content/import', 'POST', {
    items: [{ externalId: 'stage-b-unverified', fileName: 'unverified.md', title: 'Stage B unverified source', revision: 'unverified-r1', content: '# Stage B unverified source\n\nCurrent owner is Alice.' }]
  })).body.items[0].item;
  const currentRef = sourceRef(current, (await request(base, `/api/content/items/${encodeURIComponent(current.id)}`)).body, 'Text absent from this source');
  const unverifiedNote = await request(base, '/api/notes', 'POST', {
    title: 'Stage B unverified note', content: 'The server did not observe this location.', sourceRefs: [{ ...currentRef, anchor: 'forged-stage-b-anchor' }]
  });
  assert.equal(unverifiedNote.response.status, 201);
  assert.equal(unverifiedNote.body.note.sourceRefs[0].evidenceStatus, 'unverified');

  const deleted = (await request(base, '/api/content/import', 'POST', {
    items: [{ externalId: 'stage-b-deleted', fileName: 'deleted.md', title: 'Stage B deleted source', revision: 'deleted-r1', content: '# Stage B deleted source\n\nHistorical owner is Alice.' }]
  })).body.items[0].item;
  const deletedDetail = (await request(base, `/api/content/items/${encodeURIComponent(deleted.id)}`)).body;
  const deletedRef = sourceRef(deleted, deletedDetail, 'Historical owner is Alice.');
  const unavailableNote = await request(base, '/api/notes', 'POST', { title: 'Stage B unavailable note', content: 'History must remain readable.', sourceRefs: [deletedRef] });
  assert.equal(unavailableNote.response.status, 201);
  assert.equal(unavailableNote.body.note.sourceRefs[0].evidenceStatus, 'current');
  app.locals.contentRepository.softDeleteContentItem(deleted.id);

  const updated = (await request(base, '/api/content/import', 'POST', {
    items: [{ externalId: 'stage-b-continuity', fileName: 'continuity.md', title: 'Stage B continuity source', revision: 'stage-b-r2', content: '# Stage B continuity source\n\nVersion two owner is Bob.\n\nThe current revision replaced the first sentence.' }]
  })).body.items[0].item;
  assert.notEqual(updated.currentVersionId, first.currentVersionId);
  app.locals.graphIndex.rebuild();
  const notes = (await request(base, '/api/notes?archived=true')).body.notes;
  assert.equal(notes.find(note => note.title === 'Stage B stale note').sourceRefs[0].evidenceStatus, 'stale');
  assert.equal(notes.find(note => note.title === 'Stage B unverified note').sourceRefs[0].evidenceStatus, 'unverified');
  assert.equal(notes.find(note => note.title === 'Stage B unavailable note').sourceRefs[0].evidenceStatus, 'unavailable');
  const graph = (await request(base, '/api/graph')).body.graph;
  assert.equal(graph.nodes.find(node => node.sourceId === first.id).contentVersionId, updated.currentVersionId);
  assert.equal(graph.edges.find(edge => edge.type === 'source' && edge.rawTarget === first.id)?.provenance?.sourceRef?.evidenceStatus, 'stale');

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(`console:${message.text()}`); });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  page.on('requestfailed', requestValue => runtimeErrors.push(`failed:${requestValue.url()}`));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });

  async function openSourceFromNote(noteTitle, readerTitle) {
    await page.getByRole('button', { name: '笔记', exact: true }).click();
    const row = page.locator('.module-list button').filter({ hasText: noteTitle }).first();
    await row.waitFor({ state: 'visible', timeout: 15000 });
    await row.click();
    await page.locator('.note-relations-panel > section').first().getByRole('button').first().click();
    const reader = page.getByLabel(`${readerTitle}阅读器`);
    await reader.waitFor({ state: 'visible', timeout: 15000 });
    return reader;
  }

  const staleReader = await openSourceFromNote('Stage B stale note', 'Stage B continuity source');
  await staleReader.locator('.evidence-status-notice[data-evidence-status="stale"]').waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await staleReader.locator('.content-reader-scroll').innerText(), /Version one owner is Alice/);
  assert.doesNotMatch(await staleReader.locator('.content-reader-scroll').innerText(), /Version two owner is Bob/);
  assert.equal(await staleReader.getByLabel('选择回源版本').count(), 1);
  await staleReader.getByRole('button', { name: '打开当前版本', exact: true }).click();
  await page.getByLabel('Stage B continuity source阅读器').locator('.content-reader-scroll').getByText('Version two owner is Bob.', { exact: false }).waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await page.getByLabel('Stage B continuity source阅读器').locator('.evidence-status-notice').getAttribute('data-evidence-status'), 'current');
  await page.getByRole('button', { name: '关闭阅读器', exact: true }).first().click();

  const unverifiedReader = await openSourceFromNote('Stage B unverified note', 'Stage B unverified source');
  const unverifiedNotice = unverifiedReader.locator('.evidence-status-notice');
  await unverifiedNotice.waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await unverifiedNotice.getAttribute('data-evidence-status'), 'unverified');
  assert.match(await unverifiedReader.innerText(), /服务端没有在正文或索引中观察到/);
  await page.getByRole('button', { name: '关闭阅读器', exact: true }).first().click();

  const unavailableReader = await openSourceFromNote('Stage B unavailable note', 'Stage B deleted source');
  await unavailableReader.locator('.evidence-status-notice[data-evidence-status="unavailable"]').waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await unavailableReader.locator('.content-reader-scroll').innerText(), /Historical owner is Alice/);
  assert.doesNotMatch(await unavailableReader.locator('.content-reader-scroll').innerText(), /没有可阅读的正文/);
  await page.getByRole('button', { name: '关闭阅读器', exact: true }).first().click();

  await page.getByRole('button', { name: '打开全局命令框', exact: true }).click();
  await page.getByRole('option', { name: /文档解读/ }).click();
  await page.locator('.analysis-list button').filter({ hasText: 'Stage B continuity source' }).first().click();
  await page.getByRole('button', { name: '对照翻译', exact: true }).click();
  const translationPanel = page.locator('.translation-workbench');
  await translationPanel.waitFor({ state: 'visible', timeout: 15000 });
  await translationPanel.locator('.evidence-status-badge[data-evidence-status="stale"]').first().waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await translationPanel.innerText(), /原文已经更新/);

  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('button[title="打开知识观察"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('button[title="打开知识观察"]').click();
  await page.getByLabel('知识观察').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('[data-graph-renderer="sigma"] canvas').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.setViewportSize({ width: 1180, height: 860 });
  await page.waitForTimeout(200);
  const compactOverflow = await overflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const mobileOverflow = await overflow(page);
  assert.equal(compactOverflow, 0, `1180px layout overflowed by ${compactOverflow}px`);
  assert.equal(mobileOverflow, 0, `390px layout overflowed by ${mobileOverflow}px`);
  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({
    ok: true,
    statuses: ['current', 'stale', 'unavailable', 'unverified'],
    history: { oldVersionId: first.currentVersionId, currentVersionId: updated.currentVersionId, deletedHistoryReadable: true },
    graph: { nodes: graph.nodes.length, edges: graph.edges.length, staleSourceEdge: true },
    translation: { sourceStatus: 'stale' },
    viewports: { desktop: 1440, compact: 1180, mobile: 390 },
    overflow: { compact: compactOverflow, mobile: mobileOverflow },
    runtimeErrors
  }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
