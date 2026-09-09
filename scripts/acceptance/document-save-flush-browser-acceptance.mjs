import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitializedApp } from '../../app/server/app.mjs';
import { createDefaultState } from '../../app/server/state-store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const runtimeNodeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  || join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
const requireRuntime = createRequire(join(runtimeNodeModules, 'playwright', 'package.json'));
const { chromium } = requireRuntime('playwright');
const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'flowmind-document-save-flush-'));
const staticDir = join(root, 'dist');
const stateFile = join(root, 'state.json');
const runtimeErrors = [];
const now = new Date().toISOString();

const state = createDefaultState();
state.notes = [
  { id: 'note-alpha', title: '切篇 Alpha', content: 'alpha-origin', tags: [], archived: false, createdAt: now, updatedAt: now },
  { id: 'note-beta', title: '切篇 Beta', content: 'beta-origin', tags: [], archived: false, createdAt: now, updatedAt: now },
  {
    id: 'note-problem',
    title: '问题记录：切篇',
    artifactKind: 'problem',
    content: '## 问题\n快速切篇会丢字吗\n\n## 这次怎么解决的\n切换前先 flush\n\n## 下次容易忘的点\n不要只清 timer',
    tags: ['问题记录'],
    archived: false,
    createdAt: now,
    updatedAt: now
  }
];
state.writingDrafts = [
  { id: 'draft-alpha', title: '写作 Alpha', content: 'draft-alpha-origin', template: 'freeform', audience: '', tone: '专业', sourceRefs: [], versions: [], createdAt: now, updatedAt: now },
  { id: 'draft-beta', title: '写作 Beta', content: 'draft-beta-origin', template: 'freeform', audience: '', tone: '专业', sourceRefs: [], versions: [], createdAt: now, updatedAt: `${now.slice(0, -1)}1Z` }
];
await writeFile(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
await execFileAsync(process.execPath, [join(projectRoot, 'app', 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', staticDir], {
  cwd: join(projectRoot, 'app'),
  windowsHide: true
});

const session = {
  version: 4,
  tabs: [
    { id: 'module-notes', kind: 'module', type: 'module', route: 'notes', title: '笔记', noteId: 'note-alpha' }
  ],
  activeTabId: 'module-notes',
  recentWork: [],
  readingPositions: {},
  aiContextItems: [],
  tasks: [],
  draftMarkers: {}
};

const sleep = milliseconds => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));

async function readJson(base, path) {
  const response = await fetch(`${base}${path}`);
  return response.json();
}

async function waitUntil(label, probe, timeout = 10000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await probe();
    if (last) return last;
    await sleep(120);
  }
  throw new Error(`${label} timed out: ${last == null ? 'empty' : JSON.stringify(last)}`);
}

let app;
let server;
let browser;
try {
  app = await createInitializedApp({
    stateFile,
    staticDir,
    env: {},
    ocrService: false,
    transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') },
    workspaceSyncOptions: { secretFile: join(root, 'sync.enc'), masterKeyFile: join(root, 'sync.key'), relayFile: join(root, 'relay.json') }
  });
  server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.addInitScript(value => localStorage.setItem('flowmind.workspace.session', JSON.stringify(value)), session);
  const page = await context.newPage();
  const notePatches = [];
  page.on('request', request => {
    if (request.method() === 'PATCH' && /\/api\/notes\//.test(request.url())) {
      try { notePatches.push({ url: request.url(), body: JSON.parse(request.postData() || '{}') }); } catch {}
    }
  });
  page.on('response', response => {
    if (response.status() >= 400) runtimeErrors.push(`http:${response.status()}:${response.url()}`);
  });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('button', { name: /切篇 Alpha/ }).waitFor({ state: 'visible', timeout: 20000 });
  assert.ok(await page.getByRole('button', { name: '问题记录' }).count() >= 1);

  const noteEditor = page.locator('textarea.editor-body');
  await noteEditor.waitFor({ state: 'visible', timeout: 15000 });
  await noteEditor.fill('alpha-fast-switch');
  await page.getByRole('button', { name: /切篇 Beta/ }).click();
  await page.locator('.editor-title').waitFor({ state: 'visible', timeout: 10000 });
  await waitUntil('fast note switch persisted Alpha', async () => {
    const data = await readJson(base, '/api/notes');
    const note = (data.notes || []).find(item => item.id === 'note-alpha');
    return note?.content?.includes('alpha-fast-switch') ? note : null;
  });
  assert.ok(notePatches.some(item => item.url.includes('/api/notes/note-alpha') && item.body.baseVersion != null), 'note PATCH must send baseVersion');
  assert.equal((await page.locator('.editor-title').inputValue()).trim(), '切篇 Beta');

  let failOnce = true;
  await page.route('**/api/notes/note-beta', async route => {
    if (route.request().method() === 'PATCH' && failOnce) {
      failOnce = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: { message: '写入失败' } })
      });
      return;
    }
    await route.continue();
  });
  const betaEditor = page.locator('textarea.editor-body');
  await betaEditor.fill('beta-should-retry');
  await page.getByRole('button', { name: /切篇 Alpha/ }).click();
  await page.getByText('写入失败').first().waitFor({ state: 'visible', timeout: 10000 });
  assert.equal((await page.locator('.editor-title').inputValue()).trim(), '切篇 Beta');
  await page.getByRole('button', { name: '重试保存' }).click();
  await waitUntil('failed note save retried', async () => {
    const data = await readJson(base, '/api/notes');
    const note = (data.notes || []).find(item => item.id === 'note-beta');
    return note?.content?.includes('beta-should-retry') ? note : null;
  });
  await page.getByRole('button', { name: /切篇 Alpha/ }).click();
  await page.locator('.editor-title').waitFor({ state: 'visible', timeout: 10000 });
  assert.equal((await page.locator('.editor-title').inputValue()).trim(), '切篇 Alpha');

  await page.route('**/api/notes/**', async route => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: { message: 'HTTP 503' } })
      });
      return;
    }
    await route.continue();
  });
  await page.locator('textarea.editor-body').fill('stay-on-notes-503');
  await page.getByRole('navigation', { name: '主功能' }).getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByText('HTTP 503').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('textarea.editor-body').waitFor({ state: 'visible', timeout: 5000 });
  assert.equal((await page.locator('textarea.editor-body').inputValue()).includes('stay-on-notes-503'), true);
  await page.unroute('**/api/notes/**');
  await page.getByRole('navigation', { name: '主功能' }).getByRole('button', { name: '知识库', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('textarea.editor-body'), null, { timeout: 15000 });
  await waitUntil('503 recovery saved Alpha before leaving notes', async () => {
    const data = await readJson(base, '/api/notes');
    const note = (data.notes || []).find(item => item.id === 'note-alpha');
    return note?.content?.includes('stay-on-notes-503') ? note : null;
  });
  await page.getByRole('navigation', { name: '主功能' }).getByRole('button', { name: '笔记', exact: true }).click();
  await page.locator('textarea.editor-body').waitFor({ state: 'visible', timeout: 15000 });

  await page.locator('textarea.editor-body').fill('alpha-unmount-tab');
  await page.getByRole('tab', { name: /首页/ }).click();
  await waitUntil('note unmount flush persisted Alpha', async () => {
    const data = await readJson(base, '/api/notes');
    const note = (data.notes || []).find(item => item.id === 'note-alpha');
    return note?.content?.includes('alpha-unmount-tab') ? note : null;
  });

  await page.keyboard.press('Control+k');
  const commandInput = page.getByRole('dialog').locator('input[aria-label="全局命令"]');
  await commandInput.waitFor({ state: 'visible', timeout: 10000 });
  await commandInput.fill('写作草稿');
  await page.locator('#workspace-command-writing').click();
  await page.getByRole('tab', { name: /写作/ }).or(page.getByRole('heading', { name: '智能写作' })).or(page.getByRole('button', { name: /飞书知识库 · 写作草稿/ })).first().waitFor({ state: 'visible', timeout: 20000 });
  if (await page.locator('textarea[name="writing-draft-content"]').count() === 0) {
    const writingTab = page.getByRole('tab', { name: /写作/ });
    if (await writingTab.count()) await writingTab.first().click();
    else await page.getByRole('button', { name: /飞书知识库 · 写作草稿/ }).first().click();
  }
  await page.locator('textarea[name="writing-draft-content"]').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('textarea[name="writing-draft-content"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('.module-list').getByRole('button', { name: /写作 Alpha/ }).click();
  const writingEditor = page.locator('textarea[name="writing-draft-content"]');
  await writingEditor.waitFor({ state: 'visible', timeout: 10000 });
  await writingEditor.fill('writing-fast-switch');
  await page.locator('.module-list').getByRole('button', { name: /写作 Beta/ }).click();
  await waitUntil('fast writing switch persisted Alpha', async () => {
    const data = await readJson(base, '/api/writing/drafts');
    const draft = (data.drafts || []).find(item => item.id === 'draft-alpha');
    return draft?.content?.includes('writing-fast-switch') ? draft : null;
  });

  await page.locator('.module-list').getByRole('button', { name: /写作 Alpha/ }).click();
  await writingEditor.waitFor({ state: 'visible', timeout: 10000 });
  await writingEditor.fill('writing-reload-keep');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await waitUntil('reload flush persisted writing', async () => {
    const data = await readJson(base, '/api/writing/drafts');
    const draft = (data.drafts || []).find(item => item.id === 'draft-alpha');
    return draft?.content?.includes('writing-reload-keep') ? draft : null;
  });

  await page.getByRole('navigation', { name: '主功能' }).getByRole('button', { name: '笔记', exact: true }).click();
  await page.getByRole('button', { name: /切篇 Beta/ }).click();
  await page.locator('textarea.editor-body').fill('beta-before-attachment');
  await page.locator('input.note-file-input:not([accept])').setInputFiles({ name: '保存验证.txt', mimeType: 'text/plain', buffer: Buffer.from('attachment-persist-fixture') });
  await waitUntil('attachment markdown saves against the new server version', async () => {
    const data = await readJson(base, '/api/notes');
    const note = (data.notes || []).find(item => item.id === 'note-beta');
    return note?.content?.includes('beta-before-attachment') && note.content.includes('/attachments/') && note.attachments?.length === 1;
  });
  await page.locator('textarea.editor-body').fill('beta-dirty-before-archive');
  await page.locator('.note-editor-toolbar').getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '归档笔记', exact: true }).click();
  await waitUntil('dirty archive flushes latest content first', async () => {
    const data = await readJson(base, '/api/notes?archived=true');
    const note = (data.notes || []).find(item => item.id === 'note-beta');
    return note?.archived && note.content === 'beta-dirty-before-archive';
  });

  const leftover = runtimeErrors.filter(item => !/ResizeObserver|favicon|http:500:.*\/api\/notes\/note-beta|http:503:.*\/api\/notes\//.test(item));
  assert.equal(leftover.length, 0, leftover.join('\n'));
  console.log(JSON.stringify({
    ok: true,
    cases: ['fast-note-switch', 'failed-save-blocks-and-retries', 'patch-503-blocks-knowledge-nav', 'note-tab-unmount', 'fast-writing-switch', 'writing-reload', 'attachment-version-save', 'dirty-archive'],
    runtimeErrors: leftover.length
  }));
} finally {
  await browser?.close().catch(() => {});
  await new Promise(resolveClose => server?.close(() => resolveClose()));
  await rm(root, { recursive: true, force: true });
}
