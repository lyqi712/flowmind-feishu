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

const root = await mkdtemp(join(tmpdir(), 'flowmind-parallel-conversations-'));
const stateFile = join(root, 'state.json');
const runtimeErrors = [];
let alphaId = '';
let betaId = '';

const sleep = milliseconds => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));

function streamText(text, delay = 0) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      if (delay) await sleep(delay);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }
  }), { headers: { 'content-type': 'text/event-stream' } });
}

function modelFetch(_url, options = {}) {
  const body = JSON.parse(options.body || '{}');
  const system = String(body.messages?.[0]?.content || '');
  const transcript = (body.messages || []).map(message => String(message.content || '')).join('\n');
  const beta = /Fixture Beta|Ask Fixture Beta|PARALLEL_BETA/.test(transcript);
  const alpha = /Fixture Alpha|PARALLEL_SLOW_ALPHA|Ask Fixture Alpha/.test(transcript);
  const delay = /PARALLEL_SLOW/.test(transcript) ? 2200 : 0;
  if (system.includes('You are FlowMind Agent') || system.startsWith('你是 FlowMind。')) {
    const answer = beta ? 'Parallel fixture answer for Beta.' : (alpha ? 'Parallel fixture answer for Alpha.' : 'Parallel fixture generic answer.');
    return Promise.resolve(streamText(JSON.stringify({
      kind: 'final',
      answer,
      sourceRefs: [{ documentId: beta ? betaId : alphaId, title: beta ? 'Fixture Beta' : 'Fixture Alpha', anchor: 'evidence' }]
    }), delay));
  }
  const answer = beta ? 'Parallel fixture answer for Beta.' : (alpha ? 'Parallel fixture answer for Alpha.' : 'Parallel fixture generic answer.');
  return Promise.resolve(streamText(answer, delay));
}

function currentSession(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('flowmind.workspace.session') || '{}'));
}

const state = createDefaultState();
state.documents = [];
state.notes = [];
state.conversations = [];
state.skillRuns = [];
await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

let app;
let server;
let browser;
const mobile = process.env.FLOWMIND_MOBILE_PARALLEL === '1';
try {
  app = await createInitializedApp({
    stateFile,
    staticDir: join(projectRoot, 'app', 'dist'),
    env: {},
    fetchImpl: modelFetch,
    ocrService: false,
    transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const repository = app.locals.contentRepository;
  const source = repository.upsertSourceConnection({ sourceType: 'feishu', externalId: 'parallel-fixture', name: 'Parallel fixture' });
  const space = repository.upsertSpace({ sourceConnectionId: source.id, externalId: 'parallel-space', name: 'Parallel space' });
  const beta = repository.upsertContentItem({
    sourceConnectionId: source.id, spaceId: space.id, externalId: 'fixture-beta', contentType: 'docx',
    title: 'Fixture Beta', content: '# Fixture Beta\n\n## Evidence\n\nBETA_PARALLEL_SENTENCE', revision: 'beta-v1', tags: ['fixture']
  }).item;
  const alpha = repository.upsertContentItem({
    sourceConnectionId: source.id, spaceId: space.id, externalId: 'fixture-alpha', contentType: 'docx',
    title: 'Fixture Alpha', content: '# Fixture Alpha\n\n## Alpha section\n\nALPHA_PARALLEL_SENTENCE', revision: 'alpha-v1', tags: ['fixture']
  }).item;
  alphaId = alpha.id;
  betaId = beta.id;
  await app.locals.store.update(current => {
    current.knowledgeBases = [{ id: space.id, spaceId: space.id, name: 'Parallel space', source: 'feishu', documentCount: 2 }];
    current.settings.activeKnowledgeBaseId = space.id;
  });
  app.locals.graphIndex.rebuild();
  server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const settings = await fetch(`${base}/api/settings/model`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'parallel-fixture', apiKey: 'fixture-key', retries: 0 })
  });
  assert.equal(settings.status, 200);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Failed to load resource: the server responded with a status of 404/.test(text)) return;
    runtimeErrors.push(`console:${text}`);
  });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });

  const composer = page.locator('.composer textarea');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByLabel('加入问答范围：Fixture Alpha').click();
  await composer.waitFor({ state: 'visible', timeout: 15000 });
  await composer.fill('PARALLEL_SLOW_ALPHA Ask Fixture Alpha');
  await page.locator('.composer .send').click();

  await page.getByLabel('新建工作标签页').click();
  await page.getByLabel('加入问答范围：Fixture Beta').click();
  await composer.waitFor({ state: 'visible', timeout: 15000 });
  await composer.fill('PARALLEL_BETA Ask Fixture Beta');
  await page.locator('.composer .send').click();
  await page.waitForFunction(() => document.body.textContent.includes('Parallel fixture answer for Beta.'), null, { timeout: 20000 });

  const midSession = await currentSession(page);
  const chatTabs = midSession.tabs.filter(tab => tab.kind === 'chat');
  assert.equal(chatTabs.length, 2, 'two chat tabs must exist during parallel runs');
  const tabAlpha = chatTabs.find(tab => tab.chat?.documentIds?.includes(alphaId));
  const tabBeta = chatTabs.find(tab => tab.chat?.documentIds?.includes(betaId));
  assert.ok(tabAlpha?.id && tabBeta?.id, 'alpha and beta chat tabs must be scoped separately');
  assert.notEqual(tabAlpha.chat.conversationId, tabBeta.chat.conversationId, 'parallel tabs must not share conversation ids');

  await page.locator(`#workspace-tab-${encodeURIComponent(tabAlpha.id)}`).click();
  await page.waitForFunction(() => document.body.textContent.includes('Parallel fixture answer for Alpha.'), null, { timeout: 20000 });
  assert.match(await composer.inputValue(), /^$|PARALLEL_SLOW/, 'switching back should not leak beta composer draft');

  await composer.fill('draft-alpha-keep');
  await page.locator(`#workspace-tab-${encodeURIComponent(tabBeta.id)}`).click();
  await page.waitForFunction(() => document.body.textContent.includes('Parallel fixture answer for Beta.'), null, { timeout: 15000 });
  assert.notEqual(await composer.inputValue(), 'draft-alpha-keep', 'composer draft must not leak across tabs');
  await composer.fill('draft-beta-keep');
  await page.locator(`#workspace-tab-${encodeURIComponent(tabAlpha.id)}`).click();
  await page.waitForFunction(() => document.body.textContent.includes('Parallel fixture answer for Alpha.'), null, { timeout: 15000 });
  assert.equal(await composer.inputValue(), 'draft-alpha-keep', 'composer draft must restore when returning to tab');

  await page.locator(`#workspace-tab-${encodeURIComponent(tabBeta.id)}`).click();
  await composer.fill('/');
  await page.getByRole('option', { name: /^总结/ }).click();
  await composer.fill('PARALLEL_SLOW summary task');
  await page.locator('.composer .send').click();
  await page.locator(`#workspace-tab-${encodeURIComponent(tabAlpha.id)}`).click();
  await page.waitForFunction(() => document.body.textContent.includes('Parallel fixture answer for Alpha.'), null, { timeout: 15000 });
  const sendVisibleOnAlpha = await page.locator('.composer .send').isVisible();
  assert.equal(sendVisibleOnAlpha, true, 'alpha tab composer should not inherit beta skill streaming lock');
  await page.locator(`#workspace-tab-${encodeURIComponent(tabBeta.id)}`).click();
  await page.waitForFunction(() => {
    const session = JSON.parse(localStorage.getItem('flowmind.workspace.session') || '{}');
    return session.tabs.some(tab => tab.chat?.skillRun?.skillId === 'summary');
  }, null, { timeout: 20000 });

  const finalSession = await currentSession(page);
  const finalAlpha = finalSession.tabs.find(tab => tab.id === tabAlpha.id);
  const finalBeta = finalSession.tabs.find(tab => tab.id === tabBeta.id);
  assert.ok(finalAlpha?.chat?.conversationId, 'alpha conversation must persist');
  assert.ok(finalBeta?.chat?.conversationId, 'beta conversation must persist');
  assert.notEqual(finalAlpha.chat.conversationId, finalBeta.chat.conversationId);
  assert.deepEqual(finalBeta.chat.documentIds, [betaId]);
  assert.ok(['running', 'completed', 'recoverable'].includes(finalBeta.chat.skillRun?.status || ''), 'beta skill run must be tracked on its tab');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  const reloaded = await currentSession(page);
  const reloadedAlpha = reloaded.tabs.find(tab => tab.id === tabAlpha.id);
  const reloadedBeta = reloaded.tabs.find(tab => tab.id === tabBeta.id);
  assert.ok(reloadedAlpha?.chat?.conversationId, 'alpha conversation survives reload');
  assert.ok(reloadedBeta?.chat?.conversationId, 'beta conversation survives reload');
  assert.notEqual(reloadedAlpha.chat.conversationId, reloadedBeta.chat.conversationId);
  await page.locator(`#workspace-tab-${encodeURIComponent(tabAlpha.id)}`).click();
  await page.waitForFunction(() => document.body.textContent.includes('Parallel fixture answer for Alpha.'), null, { timeout: 20000 });
  await page.locator(`#workspace-tab-${encodeURIComponent(tabBeta.id)}`).click();
  await page.waitForFunction(() => document.body.textContent.includes('Parallel fixture answer for Beta.'), null, { timeout: 20000 });

  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({
    ok: true,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 },
    tabs: { alpha: tabAlpha.id, beta: tabBeta.id },
    conversations: { alpha: finalAlpha.chat.conversationId, beta: finalBeta.chat.conversationId },
    skillStatus: finalBeta.chat.skillRun?.status || null,
    runtimeErrors
  }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
