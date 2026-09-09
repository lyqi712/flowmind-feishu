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

const root = await mkdtemp(join(tmpdir(), 'flowmind-mixed-tabs-stress-'));
const stateFile = join(root, 'state.json');
const runtimeErrors = [];
let docId = '';

function streamText(text) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
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
  const gamma = /CHAT_C/.test(transcript);
  const beta = /CHAT_B/.test(transcript);
  const alpha = /CHAT_A/.test(transcript);
  if (system.includes('You are FlowMind Agent') || system.startsWith('你是 FlowMind。')) {
    const answer = gamma ? 'Mixed tab answer C.' : (beta ? 'Mixed tab answer B.' : (alpha ? 'Mixed tab answer A.' : 'Mixed tab generic answer.'));
    return Promise.resolve(streamText(JSON.stringify({ kind: 'final', answer, sourceRefs: [{ documentId: docId, title: 'Mixed Fixture Doc' }] })));
  }
  const answer = /Mixed Fixture|MIXED_FIXTURE/.test(transcript) ? 'Mixed tab reader answer.' : 'Mixed tab reader answer.';
  return Promise.resolve(streamText(answer));
}

const state = createDefaultState();
state.documents = [];
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
  const source = repository.upsertSourceConnection({ sourceType: 'feishu', externalId: 'mixed-tabs-fixture', name: 'Mixed tabs fixture' });
  const space = repository.upsertSpace({ sourceConnectionId: source.id, externalId: 'mixed-tabs-space', name: 'Mixed space' });
  const doc = repository.upsertContentItem({
    sourceConnectionId: source.id, spaceId: space.id, externalId: 'mixed-doc', contentType: 'docx',
    title: 'Mixed Fixture Doc', content: '# Mixed Fixture\n\nMIXED_FIXTURE_SENTENCE', revision: 'mixed-v1', tags: ['fixture']
  }).item;
  docId = doc.id;
  await app.locals.store.update(current => {
    current.knowledgeBases = [{ id: space.id, spaceId: space.id, name: 'Mixed space', source: 'feishu', documentCount: 1 }];
    current.settings.activeKnowledgeBaseId = space.id;
  });
  server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/api/settings/model`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'mixed-fixture', apiKey: 'fixture-key', retries: 0 })
  });

  for (const viewport of [{ label: 'desktop', width: 1180, height: 860 }, { label: 'mobile', width: 390, height: 844 }]) {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    page.on('console', message => {
      if (message.type() !== 'error') return;
      if (/404 \(Not Found\)/.test(message.text())) return;
      runtimeErrors.push(`console:${message.text()}`);
    });
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });

    await page.getByRole('button', { name: '新对话', exact: true }).click();
    await page.locator('.doc-row').filter({ hasText: 'Mixed Fixture Doc' }).locator('.doc-open').click();
    const reader = page.getByLabel('Mixed Fixture Doc阅读器');
    await reader.waitFor({ state: 'visible', timeout: 15000 });
    await reader.locator('.content-reader-toolbar button.content-reader-ask').click();
    await page.waitForFunction(() => document.body.textContent.includes('Mixed tab reader answer.'), null, { timeout: 15000 });

    await page.getByLabel('新建工作标签页').click();
    await page.getByLabel('加入问答范围：Mixed Fixture Doc').click();
    const composer = page.locator('.composer textarea');
    await composer.fill('CHAT_A mixed tab question');
    await page.locator('.composer .send').click();
    await page.waitForFunction(() => document.body.textContent.includes('Mixed tab answer A.'), null, { timeout: 15000 });

    await page.getByLabel('新建工作标签页').click();
    await composer.fill('CHAT_B mixed tab question');
    await page.locator('.composer .send').click();
    await page.waitForFunction(() => document.body.textContent.includes('Mixed tab answer B.'), null, { timeout: 15000 });

    await page.getByLabel('新建工作标签页').click();
    await composer.fill('CHAT_C mixed tab question');
    await page.locator('.composer .send').click();
    await page.waitForFunction(() => document.body.textContent.includes('Mixed tab answer C.'), null, { timeout: 15000 });

    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('flowmind.workspace.session') || '{}'));
    const chatTabs = session.tabs.filter(tab => tab.kind === 'chat');
    assert.equal(chatTabs.length, 3, `${viewport.label}: expected three chat tabs`);
    const conversationIds = chatTabs.map(tab => tab.chat?.conversationId).filter(Boolean);
    assert.equal(conversationIds.length, 3, `${viewport.label}: each chat tab must have conversation id`);
    assert.equal(new Set(conversationIds).size, 3, `${viewport.label}: chat tabs must have separate conversations`);

    const docTab = session.tabs.find(tab => tab.kind === 'document');
    assert.ok(docTab?.readerConversationId, `${viewport.label}: reader tab must keep conversation id`);

    await page.locator(`#workspace-tab-${encodeURIComponent(docTab.id)}`).click();
    await reader.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForFunction(() => document.body.textContent.includes('Mixed tab reader answer.'), null, { timeout: 15000 });

    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    assert.equal(overflow, 0, `${viewport.label} overflow ${overflow}px`);

    await browser.close();
    browser = null;
  }

  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({ ok: true, viewports: ['1180x860', '390x844'], runtimeErrors }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
