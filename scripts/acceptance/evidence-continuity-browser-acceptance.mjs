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
const root = await mkdtemp(join(tmpdir(), 'flowmind-evidence-continuity-browser-'));
const stateFile = join(root, 'state.json');
const runtimeErrors = [];
const oldSentence = 'OLD_VERSION_SENTENCE';
const newSentence = 'NEW_VERSION_SENTENCE';

const state = createDefaultState();
state.documents = [];
state.notes = [];
await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

let app;
let server;
let browser;
try {
  app = await createInitializedApp({
    stateFile,
    staticDir: join(projectRoot, 'app', 'dist'),
    env: {},
    ocrService: false,
    transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const repository = app.locals.contentRepository;
  const source = repository.upsertSourceConnection({ sourceType: 'feishu', externalId: 'evidence-continuity-browser', name: 'Evidence continuity browser fixture' });
  const space = repository.upsertSpace({ sourceConnectionId: source.id, externalId: 'evidence-continuity-space', name: 'Evidence continuity space' });
  const oldContent = `# Evidence continuity fixture\n\n${oldSentence}\n\nThe first revision remains readable after an update.`;
  const created = repository.upsertContentItem({
    sourceConnectionId: source.id, spaceId: space.id, externalId: 'evidence-continuity-document', contentType: 'document',
    title: 'Evidence continuity fixture', content: oldContent, revision: 'fixture-v1', tags: ['fixture']
  }).item;
  const oldVersionId = created.currentVersionId;
  repository.replaceIndexChunks(created.id, [{ text: oldContent, metadata: { anchor: `chars:0-${oldContent.length}` } }], { contentVersionId: oldVersionId });
  const oldChunk = repository.listIndexChunks(created.id)[0];
  await app.locals.store.update(stateValue => {
    stateValue.knowledgeBases = [{ id: space.id, spaceId: space.id, name: space.name, source: 'feishu', documentCount: 1 }];
    stateValue.settings.activeKnowledgeBaseId = space.id;
  });
  app.locals.graphIndex.rebuild();
  server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('console', message => {
    if (message.type() === 'error' && !/server responded with a status of 404 \(Not Found\)/u.test(message.text())) runtimeErrors.push(`console:${message.text()}`);
  });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  const docRow = page.locator('.doc-row').filter({ hasText: 'Evidence continuity fixture' });
  await docRow.locator('.doc-open').click();
  const reader = page.getByLabel('Evidence continuity fixture阅读器');
  await reader.waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await reader.innerText(), new RegExp(oldSentence));
  assert.equal(await reader.locator('.evidence-status-notice').getAttribute('data-evidence-status'), 'current');

  const noteResponse = await page.evaluate(async ({ documentId, versionId, revision, contentHash, anchor, excerpt }) => {
    const response = await fetch('/api/notes', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Stale evidence note', content: 'This note keeps the first revision.', sourceRefs: [{ documentId, contentVersionId: versionId, revision, contentHash, anchor, excerpt }] })
    });
    return response.json();
  }, { documentId: created.id, versionId: oldVersionId, revision: created.revision, contentHash: created.contentHash, anchor: oldChunk.metadata.anchor, excerpt: oldSentence });
  assert.equal(noteResponse.ok, true);
  assert.equal(noteResponse.note.sourceRefs[0].evidenceStatus, 'current');

  const updated = repository.upsertContentItem({
    sourceConnectionId: source.id, spaceId: space.id, externalId: 'evidence-continuity-document', contentType: 'document',
    title: 'Evidence continuity fixture', content: `# Evidence continuity fixture\n\n${newSentence}\n\nThe current revision replaced the first sentence.`, revision: 'fixture-v2', tags: ['fixture']
  }).item;
  assert.notEqual(updated.currentVersionId, oldVersionId);
  app.locals.graphIndex.rebuild();

  await page.getByRole('button', { name: '笔记', exact: true }).click();
  const staleNote = page.locator('.module-list').getByRole('button').filter({ hasText: 'Stale evidence note' });
  await staleNote.click();
  const staleSource = page.locator('.note-relations-panel').getByRole('button').filter({ hasText: 'Evidence continuity fixture' }).first();
  await staleSource.click();
  await reader.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(value => document.body.textContent.includes(value), oldSentence, { timeout: 15000 });
  assert.equal(await reader.locator('.evidence-status-notice').getAttribute('data-evidence-status'), 'stale');
  assert.match(await reader.locator('.evidence-status-notice').innerText(), /历史正文|旧版本/);
  assert.equal(await reader.locator('.content-reader-markdown').getByText(oldSentence, { exact: true }).count(), 1);
  assert.equal(await reader.locator('.content-reader-markdown').getByText(newSentence, { exact: true }).count(), 0);

  await reader.getByRole('button', { name: '打开当前版本', exact: true }).click();
  await page.waitForFunction(value => document.body.textContent.includes(value), newSentence, { timeout: 15000 });
  assert.equal(await reader.locator('.evidence-status-notice').getAttribute('data-evidence-status'), 'current');
  assert.equal(await reader.locator('.content-reader-markdown').getByText(newSentence, { exact: true }).count(), 1);

  const idOnly = await page.evaluate(async documentId => {
    const response = await fetch('/api/notes', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Unavailable evidence note', content: 'This source will be deleted.', sourceRefs: [{ documentId }] })
    });
    return response.json();
  }, created.id);
  assert.equal(idOnly.ok, true);
  assert.equal(idOnly.note.sourceRefs[0].evidenceStatus, 'unverified');
  repository.softDeleteContentItem(created.id);
  app.locals.graphIndex.rebuild();

  const missing = await page.evaluate(async () => {
    const response = await fetch('/api/notes', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Missing evidence note', content: 'This source is absent from the fixture.', sourceRefs: [{ documentId: 'missing-document' }] })
    });
    return response.json();
  });
  assert.equal(missing.ok, true);

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await page.locator('.module-list').getByRole('button').filter({ hasText: 'Unavailable evidence note' }).click();
  await page.locator('.note-relations-panel').getByRole('button').filter({ hasText: 'Evidence continuity fixture' }).first().click();
  const unavailableReader = page.getByLabel('Evidence continuity fixture阅读器');
  await unavailableReader.waitFor({ state: 'visible', timeout: 15000 });
  await unavailableReader.locator('.evidence-status-notice[data-evidence-status="unavailable"]').waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await unavailableReader.locator('.content-reader-markdown').getByText(oldSentence, { exact: true }).count(), 0);
  assert.equal(await unavailableReader.locator('.content-reader-markdown').getByText(newSentence, { exact: true }).count(), 1);

  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await page.locator('.module-list').getByRole('button').filter({ hasText: 'Missing evidence note' }).click();
  await page.locator('.note-relations-panel').getByRole('button').filter({ hasText: '来源文档' }).first().click();
  const missingReader = page.getByLabel('来源不可用阅读器');
  await missingReader.waitFor({ state: 'visible', timeout: 15000 });
  await missingReader.locator('.evidence-status-notice[data-evidence-status="unavailable"]').waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await missingReader.locator('.content-reader-empty').innerText(), /没有可阅读的正文/);

  const overflow = async () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  await page.setViewportSize({ width: 1180, height: 860 });
  await page.waitForTimeout(200);
  const compactOverflow = await overflow();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const mobileOverflow = await overflow();
  assert.equal(compactOverflow, 0, `1180px layout overflowed by ${compactOverflow}px`);
  assert.equal(mobileOverflow, 0, `390px layout overflowed by ${mobileOverflow}px`);
  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({ ok: true, oldVersionId, currentVersionId: updated.currentVersionId, states: ['current', 'stale-history', 'current-restored', 'unavailable'], overflow: { compact: compactOverflow, mobile: mobileOverflow }, runtimeErrors }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
