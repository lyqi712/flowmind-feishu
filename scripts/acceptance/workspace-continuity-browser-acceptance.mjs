import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitializedApp } from '../../app/server/app.mjs';
import { createDefaultState } from '../../app/server/state-store.mjs';

if (process.argv.includes('--negative')) {
  const brokenTabScenes = new Map([['shared-scene', { documentIds: ['fixture-alpha'] }]]);
  brokenTabScenes.set('shared-scene', { documentIds: ['fixture-beta'] });
  assert.deepEqual(
    brokenTabScenes.get('shared-scene').documentIds,
    ['fixture-alpha'],
    'negative fixture: a shared Tab state key leaked Fixture Beta into Fixture Alpha'
  );
}

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const runtimeNodeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
const requireRuntime = createRequire(join(runtimeNodeModules, 'playwright', 'package.json'));
const { chromium } = requireRuntime('playwright');
const root = await mkdtemp(join(tmpdir(), 'flowmind-workspace-continuity-'));
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
  const prompt = String(body.messages?.at(-1)?.content || '');
  const transcript = (body.messages || []).map(message => String(message.content || '')).join('\n');
  const beta = /Fixture Beta|Ask Fixture Beta/.test(transcript);
  if (system.includes('You are FlowMind Agent')) {
    return Promise.resolve(streamText(JSON.stringify({
      kind: 'final',
      answer: beta ? 'Fixture agent answer for Beta.' : 'Fixture agent answer for Alpha.',
      sourceRefs: [{ documentId: beta ? betaId : alphaId, title: beta ? 'Fixture Beta' : 'Fixture Alpha', anchor: beta ? 'evidence' : 'alpha-section' }]
    })));
  }
  if (system.startsWith('你是 FlowMind。') || system.startsWith('你是 FlowMind。用简体中文')) {
    const delay = /slow recoverable/.test(transcript) ? 2600 : 0;
    const answer = beta ? 'Fixture agent answer for Beta.' : 'Fixture agent answer for Alpha.';
    return Promise.resolve(streamText(answer, delay));
  }
  const delay = /slow recoverable/.test(transcript) ? 2600 : 0;
  const answer = beta
    ? 'Fixture answer for Beta.'
    : 'Fixture agent answer for Alpha.';
  return Promise.resolve(streamText(answer, delay));
}

function currentSession(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('flowmind.workspace.session') || '{}'));
}

function overflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
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
  const source = repository.upsertSourceConnection({ sourceType: 'feishu', externalId: 'workspace-continuity-fixture', name: 'Workspace continuity fixture' });
  const space = repository.upsertSpace({ sourceConnectionId: source.id, externalId: 'workspace-continuity-space', name: 'Fixture space' });
  const beta = repository.upsertContentItem({
    sourceConnectionId: source.id, spaceId: space.id, externalId: 'fixture-beta', contentType: 'docx',
    title: 'Fixture Beta', content: '# Fixture Beta\n\n## Evidence\n\nBETA_EVIDENCE_SENTENCE', revision: 'beta-v2', tags: ['fixture']
  }).item;
  const alpha = repository.upsertContentItem({
    sourceConnectionId: source.id, spaceId: space.id, externalId: 'fixture-alpha', contentType: 'docx',
    title: 'Fixture Alpha', content: '# Fixture Alpha\n\n## Alpha section\n\nALPHA_SELECTED_SENTENCE', revision: 'alpha-v3', tags: ['fixture'],
    metadata: { links: [
      { documentId: beta.id, label: 'Fixture source link', sourceAnchor: 'alpha-section', targetAnchor: 'evidence' },
      { target: 'Missing fixture target', sourceAnchor: 'alpha-missing' }
    ] }
  }).item;
  alphaId = alpha.id;
  betaId = beta.id;
  await app.locals.store.update(current => {
    current.knowledgeBases = [{ id: space.id, spaceId: space.id, name: 'Fixture space', source: 'feishu', documentCount: 2 }];
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
    body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'workspace-fixture', apiKey: 'fixture-key', retries: 0 })
  });
  assert.equal(settings.status, 200);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(`console:${message.text()}`); });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });

  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('.library-doc-card').filter({ hasText: 'Fixture Alpha' }).click();
  const alphaReader = page.getByLabel('Fixture Alpha阅读器');
  await alphaReader.waitFor({ state: 'visible', timeout: 15000 });
  await page.evaluate(() => {
    const text = [...document.querySelectorAll('.content-reader-scroll p')].find(node => node.textContent?.includes('ALPHA_SELECTED_SENTENCE'));
    if (!text?.firstChild) throw new Error('fixture selection text is unavailable');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    text.closest('.content-reader-scroll')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await alphaReader.locator('.content-reader-toolbar button.content-reader-ask').click();
  await alphaReader.getByLabel('针对这篇的问答').waitFor({ state: 'visible', timeout: 15000 });
  await alphaReader.locator('.content-reader-conversation-composer input').fill('Explain ALPHA_SELECTED_SENTENCE');
  await alphaReader.locator('.content-reader-conversation-composer button[type="submit"]').click();
  await page.waitForFunction(() => document.body.textContent.includes('Fixture agent answer for Alpha.'), null, { timeout: 15000 }).catch(async error => {
    console.error('Reader acceptance diagnostics:', await alphaReader.innerText());
    throw error;
  });
  const afterAlpha = await currentSession(page);
  const tabA = afterAlpha.tabs.find(tab => tab.kind === 'document' && String(tab.resourceId) === alphaId);
  assert.ok(tabA?.readerConversationId, 'Alpha reader tab must retain its server conversation id');
  assert.doesNotMatch(JSON.stringify(afterAlpha), /Fixture answer for Alpha|Fixture agent answer for Beta/, 'message bodies must stay on the server');

  await page.getByLabel('新建工作标签页').click();
  await page.locator('.composer').getByRole('button', { name: '管理资料范围', exact: true }).click();
  const scopePicker = page.getByRole('dialog', { name: '筛选资料范围' });
  await scopePicker.getByRole('button', { name: '不限篇目', exact: true }).click();
  await scopePicker.getByRole('checkbox', { name: /Fixture Beta/ }).check();
  await scopePicker.getByRole('button', { name: '应用范围', exact: true }).click();
  const composer = page.locator('.composer textarea');
  await composer.waitFor({ state: 'visible', timeout: 15000 });
  await composer.fill('Ask Fixture Beta');
  await page.locator('.composer .send').click();
  await page.waitForFunction(() => document.body.textContent.includes('Fixture agent answer for Beta.'), null, { timeout: 15000 });
  const afterBeta = await currentSession(page);
  const tabB = afterBeta.tabs.find(tab => tab.id !== tabA.id && tab.kind === 'chat' && tab.chat?.documentIds?.includes(betaId));
  assert.ok(tabB?.chat?.conversationId, 'Beta scene must retain its server conversation id');
  assert.deepEqual(tabB.chat.documentIds, [betaId]);
  assert.equal(tabB.chat.agentMode, 'auto');
  assert.doesNotMatch(JSON.stringify(afterBeta), /Fixture answer for Alpha|Fixture agent answer for Beta/, 'message bodies must stay on the server');

  await composer.click();
  await composer.fill('/');
  await page.getByRole('option', { name: /^总结/ }).click();
  await composer.fill('slow recoverable');
  await page.locator('.composer .send').click();
  await page.waitForFunction(() => {
    const session = JSON.parse(localStorage.getItem('flowmind.workspace.session') || '{}');
    return session.tabs.some(tab => tab.chat?.skillRun?.skillId === 'summary' && ['running', 'recoverable'].includes(tab.chat?.skillRun?.status));
  }, null, { timeout: 10000 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByText('上次 Skill 未完成').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => {
    const session = JSON.parse(localStorage.getItem('flowmind.workspace.session') || '{}');
    return session.tabs.some(tab => tab.chat?.skillRun?.status === 'recoverable');
  }, null, { timeout: 10000 });
  const restored = await currentSession(page);
  const restoredA = restored.tabs.find(tab => tab.id === tabA.id);
  const restoredB = restored.tabs.find(tab => tab.id === tabB.id);
  assert.ok(restoredA?.readerConversationId, 'Alpha reader conversation must survive reload');
  assert.deepEqual(restoredB.chat.documentIds, [betaId]);
  assert.equal(restoredB.chat.agentMode, 'auto');
  assert.equal(restoredB.chat.skillRun.status, 'recoverable');

  await page.locator(`#workspace-tab-${encodeURIComponent(tabA.id)}`).click();
  await alphaReader.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => document.body.textContent.includes('Fixture agent answer for Alpha.'), null, { timeout: 15000 });
  assert.equal(await page.locator('.chat-workspace .messages').count(), 0);
  await page.locator(`#workspace-tab-${encodeURIComponent(tabB.id)}`).click();
  await page.waitForFunction(() => document.body.textContent.includes('Fixture agent answer for Beta.'), null, { timeout: 15000 });
  await page.screenshot({ path: join(root, 'workspace-continuity-1440.png'), fullPage: false });

  await page.getByRole('navigation', { name: '主功能' }).getByRole('button', { name: '笔记', exact: true }).click();
  await page.getByLabel('新建笔记').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByLabel('新建笔记').click();
  await page.locator('.editor-title').fill('Fixture backlink note');
  await page.locator('.editor-body').fill('[[Fixture Beta#Evidence]]');
  // Notes save automatically; wait for the persisted graph rather than a removed Save button.
  await page.waitForFunction(async id => {
    const graph = await (await fetch('/api/graph', { cache: 'no-store' })).json();
    return graph.graph.edges.some(edge => edge.type === 'link' && edge.rawTarget === 'Fixture Beta' && edge.targetAnchor === 'Evidence');
  }, betaId, { timeout: 15000 });
  await page.locator('.note-editor-toolbar').getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: /^关系/ }).click();
  const noteRelations = page.locator('.note-relations-panel');
  await noteRelations.waitFor({ state: 'visible', timeout: 15000 });
  await noteRelations.getByText('Fixture Beta', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });

  const graphSnapshot = await page.evaluate(async () => (await (await fetch('/api/graph?suggestions=true', { cache: 'no-store' })).json()).graph);
  const alphaNode = graphSnapshot.nodes.find(node => node.sourceId === alphaId);
  const betaNode = graphSnapshot.nodes.find(node => node.sourceId === betaId);
  assert.ok(alphaNode && betaNode, 'fixture graph must include both Feishu documents');
  assert.ok(graphSnapshot.edges.some(edge => edge.from === alphaNode.id && edge.to === betaNode.id && edge.createdSource === 'feishu-metadata-link' && edge.targetAnchor === 'evidence' && edge.sourceVersionId), 'Feishu metadata link must retain source version and anchor');
  assert.ok(graphSnapshot.edges.some(edge => edge.type === 'link' && edge.rawTarget === 'Fixture Beta'), 'saved note must become an explicit graph backlink');
  assert.ok(graphSnapshot.unresolved.some(item => item.rawTarget === 'Missing fixture target'), 'unresolved explicit target must stay outside the resolved main graph');

  await page.locator(`#workspace-tab-${encodeURIComponent(tabB.id)}`).click();
  await page.getByRole('button', { name: '更多对话设置', exact: true }).click();
  await page.getByRole('menuitem', { name: '知识观察', exact: true }).click();
  const graph = page.getByLabel('知识观察');
  await graph.waitFor({ state: 'visible', timeout: 15000 });
  await graph.locator('[data-graph-renderer="sigma"]').waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await graph.locator('.knowledge-graph-heading').innerText(), /1 条待处理链接/);
  const overview = graph.getByLabel('关系概览');
  const alphaBetaRelation = overview.locator('button').filter({ hasText: 'Fixture Alpha' }).filter({ hasText: 'Fixture Beta' }).first();
  await alphaBetaRelation.click();
  const inspector = graph.getByLabel('关系侧栏');
  await inspector.getByRole('heading', { name: 'Fixture Alpha', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await inspector.locator('.knowledge-graph-relation-group').filter({ hasText: 'Fixture Beta' }).getByRole('button', { name: /^Fixture Beta Fixture source/ }).click();
  await inspector.getByRole('heading', { name: 'Fixture Beta', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await inspector.getByRole('button', { name: '打开文档', exact: true }).click();
  const betaReader = page.getByLabel('Fixture Beta阅读器');
  await betaReader.waitFor({ state: 'visible', timeout: 15000 });
  await betaReader.locator('.content-reader-location-status').waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await betaReader.locator('.content-reader-location-status').innerText(), /引用锚点定位/);

  await page.setViewportSize({ width: 1180, height: 860 });
  await page.waitForTimeout(250);
  const compactOverflow = await overflow(page);
  assert.equal(compactOverflow, 0, `1180px layout overflowed by ${compactOverflow}px`);
  await page.screenshot({ path: join(root, 'workspace-continuity-1180.png'), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobileOverflow = await overflow(page);
  assert.equal(mobileOverflow, 0, `390px layout overflowed by ${mobileOverflow}px`);
  await page.screenshot({ path: join(root, 'workspace-continuity-390.png'), fullPage: false });
  assert.deepEqual(runtimeErrors, []);

  console.log(JSON.stringify({
    ok: true,
    viewports: { desktop: 1440, compact: 1180, mobile: 390 },
    tabs: { alpha: tabA.id, beta: tabB.id },
    graph: { nodes: graphSnapshot.nodes.length, edges: graphSnapshot.edges.length, unresolved: graphSnapshot.unresolved.length },
    overflow: { compact: compactOverflow, mobile: mobileOverflow },
    runtimeErrors
  }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
