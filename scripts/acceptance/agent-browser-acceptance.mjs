import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
const root = await mkdtemp(join(tmpdir(), 'flowmind-agent-browser-'));
const stateFile = join(root, 'state.json');
const evidenceDir = join(projectRoot, 'evidence', 'agent-graph');
const runtimeErrors = [];
const modelCalls = [];
let releaseDocumentId = 'release-doc';
const screenshots = {
  research: join(evidenceDir, 'agent-research-1440.png'),
  scope: join(evidenceDir, 'agent-selected-scope-1440.png'),
  write: join(evidenceDir, 'agent-confirm-write-1440.png'),
  mobile: join(evidenceDir, 'agent-selected-scope-390.png')
};
const state = createDefaultState();
state.documents = [{ id: 'release-doc', title: 'Release plan', content: 'Alice owns the release review. The selected source is available. The evidence anchor is section one.', source: 'mock', knowledgeBaseId: 'feishu-space', updatedAt: new Date().toISOString() }];
await writeFile(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
await mkdir(evidenceDir, { recursive: true });

function modelFetch(url, options = {}) {
  const body = JSON.parse(options.body || '{}');
  const prompt = String(body.messages?.at(-1)?.content || '');
  const transcript = (body.messages || []).map(message => String(message.content || '')).join('\n');
  const currentTask = transcript.match(/CURRENT_AGENT_TASK_BEGIN\n([\s\S]*?)\nCURRENT_AGENT_TASK_END/)?.[1] || prompt;
  const system = String(body.messages?.[0]?.content || '');
  modelCalls.push({ prompt, currentTask, system });
  let answer = 'Quick Agent answer: the model is reachable.';
  if (currentTask.includes('Give one concise follow-up from this conversation')) answer = 'Quick follow-up: the release owner remains Alice.';
  if (system.includes('Execution mode: research')) {
    if (currentTask.includes('Is the selected source available?')) answer = JSON.stringify({ kind: 'final', answer: 'Release plan is selected and ready to read.', sourceRefs: [{ documentId: releaseDocumentId, title: 'Release plan' }] });
    else if (/web/i.test(currentTask) && transcript.includes('MCP_CAPABILITY_UNAVAILABLE')) answer = JSON.stringify({ kind: 'final', answer: '当前没有已配置的 Web 连接器，所以本次没有声称获得外部结果。', sourceRefs: [{ documentId: releaseDocumentId, title: 'Release plan', anchor: 'section-1' }] });
    else if (/web/i.test(currentTask)) answer = JSON.stringify({ kind: 'tool', name: 'mcp.call', arguments: { name: 'web.search', arguments: { query: 'release news' } } });
    else if (prompt.includes('Tool observation') || prompt.includes('UNTRUSTED_TOOL_OBSERVATION')) answer = JSON.stringify({ kind: 'final', answer: 'Alice owns the release review.', sourceRefs: [{ documentId: releaseDocumentId, title: 'Release plan', anchor: 'section-1' }] });
    else answer = JSON.stringify({ kind: 'tool', name: 'knowledge.search', arguments: { query: 'release', limit: 3 } });
  }
  if (system.includes('Execution mode: write')) answer = JSON.stringify({ kind: 'tool', name: 'note.create', arguments: { title: 'Confirmed Agent note', content: '# Confirmed Agent note\n\n[[Release plan]]', tags: ['agent'] } });
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }
  });
  return Promise.resolve(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
}

let app;
let server;
let browser;
try {
  app = await createInitializedApp({
    stateFile,
    staticDir: join(projectRoot, 'app', 'dist'),
    env: {}, fetchImpl: modelFetch, ocrService: false, transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const releaseDocument = app.locals.contentRepository.listContentItems({ limit: 20 }).find(item => item.title === 'Release plan');
  assert.ok(releaseDocument, 'fixture release document should be available through the content repository');
  releaseDocumentId = releaseDocument.id;
  server = await new Promise((resolveServer, reject) => { const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance)); instance.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const settings = await fetch(`${base}/api/settings/model`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'fixture-agent', apiKey: 'fixture-key', retries: 0 })
  });
  assert.equal(settings.status, 200);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(`console:${message.text()}`); });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  page.on('requestfailed', request => runtimeErrors.push(`failed:${request.url()}`));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.unified-workspace-primary-nav').locator('button').nth(1).click();
  const composer = page.locator('.composer');
  await composer.locator('textarea').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('.doc-row').filter({ hasText: 'Release plan' }).waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await page.locator('.chat-welcome').count(), 0, 'empty conversations should not insert canned assistant prompts');

  await page.getByRole('button', { name: '研究', exact: true }).click();
  await composer.locator('textarea').fill('Research the release owner');
  await composer.locator('.send').click();
  await page.locator('[aria-label="Agent 执行记录"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => document.body.textContent.includes('Alice owns the release review.'), null, { timeout: 15000 });
  assert.match(await page.locator('.message.assistant').last().innerText(), /Alice owns the release review/);
  await page.screenshot({ path: screenshots.research, fullPage: false });

  await composer.locator('textarea').click();
  await composer.locator('textarea').pressSequentially('@Release');
  const mention = page.getByRole('option', { name: /Release plan/ });
  await mention.waitFor({ state: 'visible', timeout: 15000 });
  await mention.click();
  await page.locator('.composer-context-chip').getByText('Release plan', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await composer.locator('textarea').fill('Is the selected source available?');
  await composer.locator('.send').click();
  await page.waitForFunction(() => document.body.textContent.includes('Release plan is selected and ready to read.'), null, { timeout: 15000 });
  const scopedAgent = page.locator('[aria-label="Agent 执行记录"]').last();
  assert.match(await scopedAgent.innerText(), /已带入 1 篇资料/);
  assert.match(await scopedAgent.innerText(), /承接.*条本次对话/);
  assert.match(await scopedAgent.innerText(), /本地全文索引 100 字/);
  assert.match(await scopedAgent.innerText(), /Release plan/);
  assert.match(await page.locator('.message.assistant').last().innerText(), /引用来源[\s\S]*Release plan/);
  assert.ok(modelCalls.some(call => call.system.includes('Server-verified selected document scope: Release plan')));
  assert.ok(modelCalls.some(call => call.prompt.includes('UNTRUSTED_CONVERSATION_HANDOFF_BEGIN')), 'a later Agent run should receive only the server-derived handoff envelope');
  await page.screenshot({ path: screenshots.scope, fullPage: false });

  await page.getByRole('button', { name: '问答', exact: true }).click();
  await composer.locator('textarea').fill('Use the selected source in normal chat');
  await composer.locator('.send').click();
  await page.waitForFunction(() => document.body.textContent.includes('Quick Agent answer: the model is reachable.'), null, { timeout: 15000 });
  const scopedChat = page.locator('.message.assistant').last();
  assert.match(await scopedChat.innerText(), /引用来源[\s\S]*Release plan/);
  assert.ok(modelCalls.some(call => call.prompt.includes('Use the selected source in normal chat') && call.prompt.includes('Release plan')));

  await page.getByRole('button', { name: '写入', exact: true }).click();
  await composer.locator('textarea').fill('Create a note');
  await composer.locator('.send').click();
  const pending = page.getByRole('button', { name: '确认写入', exact: true });
  await pending.waitFor({ state: 'visible', timeout: 15000 });
  const notesBefore = await page.evaluate(async () => (await (await fetch('/api/notes')).json()).notes.length);
  assert.equal(notesBefore, 0);
  await pending.click();
  await page.waitForFunction(() => document.body.textContent.includes('提案已确认'), null, { timeout: 15000 });
  assert.match(await page.locator('[aria-label="Agent 执行记录"]').last().innerText(), /Confirmed Agent note/);
  const notesAfter = await page.evaluate(async () => (await (await fetch('/api/notes')).json()).notes.length);
  assert.equal(notesAfter, 1);
  await page.screenshot({ path: screenshots.write, fullPage: false });

  await page.getByRole('button', { name: '快答', exact: true }).click();
  await composer.locator('textarea').fill('Give one concise follow-up from this conversation');
  await composer.locator('.send').click();
  await page.waitForFunction(() => document.body.textContent.includes('Quick follow-up: the release owner remains Alice.'), null, { timeout: 15000 });
  const quickAgent = page.locator('[aria-label="Agent 执行记录"]').last();
  assert.match(await quickAgent.innerText(), /quick Agent/);
  assert.match(await quickAgent.innerText(), /承接.*条本次对话/);
  assert.ok(modelCalls.some(call => call.currentTask.includes('Give one concise follow-up from this conversation') && call.prompt.includes('UNTRUSTED_CONVERSATION_HANDOFF_BEGIN')));

  await page.getByRole('button', { name: '研究', exact: true }).click();
  await composer.locator('textarea').fill('Search the web for release news');
  await composer.locator('.send').click();
  await page.waitForFunction(() => document.body.textContent.includes('没有已配置的 Web 连接器'), null, { timeout: 15000 });
  assert.match(await page.locator('.message.assistant').last().innerText(), /没有声称获得外部结果/);
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  await page.getByRole('button', { name: '历史', exact: true }).click();
  const historyEntry = page.locator('.history-panel > button').first();
  await historyEntry.waitFor({ state: 'visible', timeout: 15000 });
  await historyEntry.click();
  await page.locator('.doc-row.selected').filter({ hasText: 'Release plan' }).waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await page.getByRole('button', { name: '研究', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('.context-strip').innerText(), /已选 1 篇文档/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const mobileOverflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  assert.ok(mobileOverflow <= 0, `mobile layout overflowed by ${mobileOverflow}px`);
  await page.screenshot({ path: screenshots.mobile, fullPage: false });
  const modeHeights = await page.locator('.agent-mode-control button').evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().height)));
  assert.ok(modeHeights.every(height => height >= 38), `mobile Agent mode controls were too small: ${modeHeights.join(', ')}`);
  assert.match(await page.locator('.agent-mode-summary').innerText(), /承接当前会话|还没有历史消息/);

  const scopeManager = page.getByRole('button', { name: '管理资料范围', exact: true });
  await scopeManager.click();
  const scopeSheet = page.getByRole('dialog', { name: '选择本次使用的资料' });
  await scopeSheet.waitFor({ state: 'visible', timeout: 15000 });
  await scopeSheet.getByRole('button', { name: '恢复全库', exact: true }).click();
  await scopeSheet.getByRole('textbox', { name: '筛选资料范围', exact: true }).fill('Release');
  const scopeCheckbox = scopeSheet.getByRole('checkbox', { name: /Release plan/ });
  await scopeCheckbox.check();
  await scopeSheet.getByRole('button', { name: '证据分析', exact: true }).click();
  const evidenceWorkbench = page.getByRole('main', { name: '证据工作台' });
  await evidenceWorkbench.waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await evidenceWorkbench.getByRole('checkbox', { name: /Release plan/ }).isChecked(), true);
  const evidenceOverflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  assert.ok(evidenceOverflow <= 0, `mobile evidence layout overflowed by ${evidenceOverflow}px`);
  assert.deepEqual(runtimeErrors, []);

  const result = {
    ok: true,
    agentRuns: app.locals.agentRuntime.getRuns().map(run => ({ id: run.id, mode: run.mode, status: run.status })),
    runtimeErrors,
    screenshots: Object.values(screenshots).map(file => file.replace(projectRoot + '\\', '').replaceAll('\\', '/'))
  };
  await writeFile(join(evidenceDir, 'agent-browser-acceptance.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
