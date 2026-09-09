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
const root = await mkdtemp(join(tmpdir(), 'flowmind-home-ranking-'));
const stateFile = join(root, 'state.json');
const runtimeErrors = [];
const session = {
  version: 4,
  tabs: [],
  activeTabId: null,
  recentWork: [
    { id: 'recent-old', kind: 'document', type: 'document', documentId: 'home-old', title: '旧资料', useCount: 6, lastUsedAt: '2026-08-09T11:30:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z' },
    { id: 'recent-followed', kind: 'document', type: 'document', documentId: 'home-followed', title: '关注资料', updatedAt: '2026-08-02T12:00:00.000Z' }
  ],
  readingPositions: {},
  aiContextItems: [],
  tasks: [
    { id: 'home-task', type: 'skill', skillId: 'summary', title: '继续整理发布计划', detail: '还差证据核对', status: 'running', progress: 0.45, documentIds: ['home-old'], updatedAt: '2026-08-09T11:00:00.000Z' },
    { id: 'home-done', type: 'skill', title: '已完成任务', status: 'completed', progress: 1, updatedAt: '2026-08-09T11:05:00.000Z' }
  ],
  draftMarkers: {}
};

function overflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
}

const state = createDefaultState();
state.documents = [];
state.notes = [];
state.knowledgeBases = [];
state.knowledgeLibraryState = { followedIds: [], discovered: [], refreshedAt: null };
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
  const source = repository.upsertSourceConnection({ sourceType: 'feishu', externalId: 'home-ranking-fixture', name: 'Home ranking fixture' });
  const followedSpace = repository.upsertSpace({ sourceConnectionId: source.id, externalId: 'home-followed-space', name: '已关注空间' });
  const otherSpace = repository.upsertSpace({ sourceConnectionId: source.id, externalId: 'home-other-space', name: '普通空间' });
  const followedDocument = repository.upsertContentItem({ sourceConnectionId: source.id, spaceId: followedSpace.id, externalId: 'home-followed', contentType: 'docx', title: '关注资料', content: '# 关注资料\n\nFOLLOWED_FIXTURE', revision: 'followed-v1' }).item;
  const oldDocument = repository.upsertContentItem({ sourceConnectionId: source.id, spaceId: otherSpace.id, externalId: 'home-old', contentType: 'docx', title: '旧资料', content: '# 旧资料\n\nOLD_FIXTURE', revision: 'old-v1' }).item;
  repository.upsertContentItem({ sourceConnectionId: source.id, spaceId: otherSpace.id, externalId: 'home-recent', contentType: 'docx', title: '最新资料', content: '# 最新资料\n\nRECENT_FIXTURE', revision: 'recent-v1' });
  session.recentWork[0].documentId = oldDocument.id;
  session.recentWork[1].documentId = followedDocument.id;
  session.tasks[0].documentIds = [oldDocument.id];
  await app.locals.store.update(current => {
    current.knowledgeLibraryState = { followedIds: [followedSpace.id], discovered: [], refreshedAt: null };
    current.settings.activeKnowledgeBaseId = otherSpace.id;
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
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(`console:${message.text()}`); });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  const ranking = page.locator('[data-home-ranking="true"]');
  await ranking.waitFor({ state: 'visible', timeout: 15000 });
  const rows = ranking.locator('.unified-workspace-recent-row');
  assert.ok(await rows.count() >= 3, 'home should show task and document candidates');
  assert.match(await rows.nth(0).innerText(), /继续整理发布计划/);
  assert.equal(await rows.nth(0).getAttribute('data-priority-reason'), '继续任务');
  assert.match(await rows.nth(1).innerText(), /旧资料/);
  assert.equal(await rows.nth(1).getAttribute('data-priority-reason'), '有未完成任务');
  assert.doesNotMatch(await ranking.innerText(), /已完成任务/);
  assert.ok((await rows.nth(0).getAttribute('aria-label'))?.includes('继续任务'));
  assert.equal(await overflow(page), 0, '1440px home layout must not overflow');

  await rows.nth(0).click();
  await page.getByRole('tab', { name: 'Skill 工作台', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByLabel('返回工作台首页').click();
  await page.locator('[data-home-ranking="true"]').waitFor({ state: 'visible', timeout: 15000 });

  await page.setViewportSize({ width: 1180, height: 860 });
  await page.waitForTimeout(200);
  assert.equal(await overflow(page), 0, '1180px home layout must not overflow');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  assert.equal(await overflow(page), 0, '390px home layout must not overflow');
  assert.deepEqual(runtimeErrors, []);

  console.log(JSON.stringify({
    ok: true,
    first: await rows.nth(0).innerText(),
    second: await rows.nth(1).innerText(),
    ranks: await ranking.locator('[data-home-rank]').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-home-rank')))),
    overflow: { desktop: 0, compact: 0, mobile: 0 },
    runtimeErrors
  }, null, 2));
} finally {
  await browser?.close().catch(() => undefined);
  await new Promise(resolveServer => server?.close(() => resolveServer()));
  await Promise.resolve(app?.locals?.contentRepository?.close?.()).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
