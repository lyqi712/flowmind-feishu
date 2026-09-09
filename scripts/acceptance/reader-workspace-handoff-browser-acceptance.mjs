import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
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

const root = await mkdtemp(join(tmpdir(), 'flowmind-reader-handoff-'));
const stateFile = join(root, 'state.json');
const runtimeErrors = [];
let alphaId = '';

function streamText(text, delay = 0) {
  const sleep = milliseconds => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));
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
  const transcript = (body.messages || []).map(message => String(message.content || '')).join('\n');
  if (/继续追问|follow-up handoff/i.test(transcript)) {
    return Promise.resolve(streamText('Fixture handoff follow-up answer.'));
  }
  if (transcript.includes('You are FlowMind Agent') || transcript.startsWith('你是 FlowMind。')) {
    return Promise.resolve(streamText('Fixture agent answer for Alpha.'));
  }
  return Promise.resolve(streamText('Fixture answer for Alpha.'));
}

function currentSession(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('flowmind.workspace.session') || '{}'));
}

const state = createDefaultState();
state.documents = [];
state.notes = [];
state.conversations = [];
const app = await createInitializedApp({
  stateFile,
  env: { NODE_ENV: 'test' },
  fetchImpl: modelFetch,
  ocrService: false,
  transcriptionService: false,
  modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
  feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
});
const repository = app.locals.contentRepository;
const source = repository.upsertSourceConnection({ provider: 'feishu', name: 'Fixture source', status: 'connected' }).connection;
const space = repository.upsertSpace({ sourceConnectionId: source.id, externalId: 'reader-handoff-space', name: 'Fixture space' });
const alpha = repository.upsertContentItem({
  sourceConnectionId: source.id,
  spaceId: space.id,
  externalId: 'fixture-alpha',
  contentType: 'docx',
  title: 'Fixture Alpha',
  content: '# Fixture Alpha\n\n## Alpha section\n\nALPHA_SELECTED_SENTENCE',
  revision: 'alpha-v1',
  tags: ['fixture']
}).item;
alphaId = alpha.id;
await app.locals.store.update(current => {
  current.knowledgeBases = [{ id: space.id, spaceId: space.id, name: 'Fixture space', source: 'feishu', documentCount: 1 }];
  current.settings.activeKnowledgeBaseId = space.id;
});
const server = await new Promise((resolveServer, reject) => {
  const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
  instance.once('error', reject);
});
const base = `http://127.0.0.1:${server.address().port}`;
const settings = await fetch(`${base}/api/settings/model`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'reader-handoff-fixture', apiKey: 'fixture-key', retries: 0 })
});
assert.equal(settings.status, 200);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.on('console', message => {
  const text = message.text();
  if (message.type() === 'error' && !/Failed to load resource.*404/.test(text)) runtimeErrors.push(`console:${text}`);
});
page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));

try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });

  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.locator('.doc-row').filter({ hasText: 'Fixture Alpha' }).locator('.doc-open').click();
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
  await page.waitForFunction(() => document.body.textContent.includes('Fixture answer for Alpha.'), null, { timeout: 15000 });

  const readerConversationId = (await currentSession(page)).tabs.find(tab => tab.kind === 'document' && String(tab.resourceId) === alphaId)?.readerConversationId;
  assert.ok(readerConversationId, 'reader tab must retain server conversation id before handoff');

  await alphaReader.getByRole('button', { name: '在工作区继续', exact: true }).click();
  const composer = page.locator('.composer textarea');
  await composer.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('.chat-workspace .messages .message.user'), null, { timeout: 15000 });

  const afterHandoff = await currentSession(page);
  const workspaceTab = afterHandoff.tabs.find(tab => tab.kind === 'chat' && tab.chat?.documentIds?.includes(alphaId));
  assert.ok(workspaceTab, 'handoff must open a workspace chat tab scoped to the reader document');
  assert.equal(workspaceTab.chat.conversationId, readerConversationId, 'handoff must inherit reader conversation id');

  await composer.fill('继续追问 follow-up handoff');
  await page.locator('.composer .send').click();
  await page.waitForFunction(() => document.body.textContent.includes('Fixture handoff follow-up answer.'), null, { timeout: 15000 });

  const afterFollowUp = await currentSession(page);
  const followUpTab = afterFollowUp.tabs.find(tab => tab.id === workspaceTab.id);
  assert.equal(followUpTab.chat.conversationId, readerConversationId, 'follow-up must stay on the same server conversation');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(id => {
    const session = JSON.parse(localStorage.getItem('flowmind.workspace.session') || '{}');
    const tab = session.tabs.find(item => item.id === id);
    return tab?.chat?.conversationId;
  }, workspaceTab.id, { timeout: 15000 });
  await page.waitForFunction(() => document.body.textContent.includes('Fixture handoff follow-up answer.'), null, { timeout: 15000 });

  const restored = await currentSession(page);
  const restoredTab = restored.tabs.find(tab => tab.id === workspaceTab.id);
  assert.equal(restoredTab.chat.conversationId, readerConversationId, 'reload must restore inherited conversation id');
  assert.deepEqual(restoredTab.chat.documentIds, [alphaId]);
  assert.deepEqual(runtimeErrors, []);

  console.log(JSON.stringify({
    ok: true,
    readerConversationId,
    workspaceTabId: workspaceTab.id,
    runtimeErrors
  }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await app.locals.close();
  await rm(root, { recursive: true, force: true });
}
