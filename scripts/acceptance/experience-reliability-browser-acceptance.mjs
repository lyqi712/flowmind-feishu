import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'flowmind-experience-'));
const stateFile = join(root, 'state.json');
const staticDir = join(root, 'dist');
const primaryId = 'reader-primary';
const secondaryId = 'reader-secondary';
const marker = '唯一验证句：阅读器快捷任务只能使用当前资料。';
const runtimeErrors = [];

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
  if (system.includes('You are FlowMind Agent') && system.includes('Execution mode: write')) {
    return Promise.resolve(streamText(JSON.stringify({
      kind: 'tool', name: 'note.create',
      arguments: { title: '阅读器提案', content: `# 阅读器提案\n\n${marker}`, tags: ['验收'] }
    })));
  }
  if (system.includes('You are FlowMind Agent')) {
    return Promise.resolve(streamText(JSON.stringify({
      kind: 'final', answer: `已核验：${marker}`, evidenceIds: [], analysis: { support: [], conflicts: [], gaps: [] }
    })));
  }
  return Promise.resolve(streamText(`依据当前资料：${marker}`));
}

const state = createDefaultState();
state.documents = [
  { id: primaryId, title: '主要资料', knowledgeBaseId: 'feishu-space', source: 'mock', updatedAt: new Date().toISOString(), content: `# 主要资料\n\n${marker}\n\n当前资料的其余内容。` },
  { id: secondaryId, title: '不应自动带入的资料', knowledgeBaseId: 'feishu-space', source: 'mock', updatedAt: new Date().toISOString(), content: '# 次要资料\n\n这份资料不应在“问这篇”时自动扩大范围。' }
];

let app;
let server;
let browser;
try {
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await execFileAsync(process.execPath, [join(projectRoot, 'app', 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', staticDir], { cwd: join(projectRoot, 'app'), windowsHide: true });
  app = await createInitializedApp({
    stateFile,
    staticDir,
    env: {},
    fetchImpl: modelFetch,
    ocrService: false,
    transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const primary = app.locals.contentRepository.listContentItems({ limit: 20 }).find(item => item.externalId === primaryId || item.id === primaryId || item.title === '主要资料');
  const secondary = app.locals.contentRepository.listContentItems({ limit: 20 }).find(item => item.externalId === secondaryId || item.id === secondaryId || item.title === '不应自动带入的资料');
  assert.ok(primary && secondary, 'fixture documents should migrate into the isolated content repository');

  server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const settings = await fetch(`${base}/api/settings/model`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'experience-fixture', apiKey: 'fixture-key', retries: 0 })
  });
  assert.equal(settings.status, 200);

  browser = await chromium.launch({ headless: true });
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktopContext.addInitScript(({ second }) => {
    localStorage.setItem('flowmind.workspace.session', JSON.stringify({
      version: 3, tabs: [], activeTabId: null, recentWork: [], readingPositions: {}, tasks: [], draftMarkers: {},
      aiContextItems: [{ id: 'context-secondary', kind: 'document', type: 'document', documentId: second, sourceId: second, title: '不应自动带入的资料' }]
    }));
  }, { second: secondary.id });
  const desktop = await desktopContext.newPage();
  desktop.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });
  desktop.on('pageerror', error => runtimeErrors.push(error.message));
  await desktop.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await desktop.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  const searchTrigger = desktop.locator('[aria-label="打开全局命令框"]:visible').first();
  await searchTrigger.focus();
  await desktop.keyboard.press('Control+K');
  const commandInput = desktop.getByRole('textbox', { name: '全局命令', exact: true });
  await commandInput.fill('主要资料');
  await commandInput.press('Enter');
  const searchPanel = desktop.getByRole('dialog', { name: '搜索全部内容', exact: true });
  await searchPanel.waitFor({ state: 'visible', timeout: 15000 });
  const searchResult = searchPanel.getByRole('option', { name: /主要资料/ });
  await searchResult.waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await searchPanel.innerText(), /找到 1 项/);
  await desktop.keyboard.press('Escape');
  await searchPanel.waitFor({ state: 'hidden', timeout: 15000 });
  await desktop.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '打开全局命令框');
  await desktop.keyboard.press('Control+K');
  await desktop.getByRole('textbox', { name: '全局命令', exact: true }).fill('主要资料');
  await desktop.getByRole('textbox', { name: '全局命令', exact: true }).press('Enter');
  await searchPanel.waitFor({ state: 'visible', timeout: 15000 });
  await searchResult.waitFor({ state: 'visible', timeout: 15000 });
  await searchResult.click();
  await desktop.locator('[aria-label="主要资料阅读器"]').waitFor({ state: 'visible', timeout: 15000 });
  await desktop.getByRole('button', { name: '问这篇', exact: true }).click();
  await desktop.waitForFunction(value => document.body.textContent.includes(value), marker, { timeout: 15000 });
  const conversations = await desktop.evaluate(async () => (await (await fetch('/api/conversations')).json()).conversations);
  const scope = conversations.at(-1)?.lastScope?.documentIds || conversations.at(-1)?.messages?.find(message => message.role === 'user')?.documentIds || [];
  assert.deepEqual(scope.map(String), [String(primary.id)], 'reader quick ask must not inherit unrelated persistent AI context');

  await desktop.getByRole('button', { name: '写入', exact: true }).click();
  const composer = desktop.locator('.composer textarea[name="chat-question"]');
  await composer.fill('为当前资料创建一份待确认笔记');
  await desktop.locator('.composer .send').click();
  const confirmation = desktop.locator('[aria-label="Agent 执行记录"] .agent-confirmation').last();
  await confirmation.waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await confirmation.innerText(), /查看将写入的内容与依据/);
  assert.match(await confirmation.innerText(), /阅读器提案/);
  assert.equal((await fetch(`${base}/api/notes`)).status, 200);
  assert.equal((await (await fetch(`${base}/api/notes`)).json()).notes.length, 0, 'a pending proposal must remain zero-write');

  await desktop.locator('[aria-label="打开全局命令框"]:visible').first().click();
  const analysisCommand = desktop.getByRole('textbox', { name: '全局命令', exact: true });
  await analysisCommand.fill('文档解读');
  await desktop.getByRole('option', { name: /文档解读/ }).click();
  const analysisWorkspace = desktop.locator('.analysis-workspace');
  await analysisWorkspace.waitFor({ state: 'visible', timeout: 15000 });
  await desktop.locator('.analysis-list').getByText('主要资料', { exact: true }).click();
  const analysisQuestion = desktop.locator('.document-question textarea');
  await analysisQuestion.fill('请解释唯一验证句');
  await desktop.locator('.document-question button').click();
  await desktop.waitForFunction(value => document.body.textContent.includes(value), `依据当前资料：${marker}`, { timeout: 15000 });
  assert.equal(await desktop.locator('.document-answer-status').count(), 0, 'stream should finish without a stale status line');
  const documentCitation = desktop.locator('.document-answer > div button').first();
  await documentCitation.waitFor({ state: 'visible', timeout: 15000 });
  await documentCitation.click();
  const highlightedEvidence = desktop.locator('mark[data-document-anchor^="chars:"]');
  await highlightedEvidence.waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await highlightedEvidence.innerText(), /唯一验证句/);
  assert.match(await desktop.locator('.document-anchor-notice').innerText(), /已定位至字符/);

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await mobileContext.newPage();
  mobile.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });
  mobile.on('pageerror', error => runtimeErrors.push(error.message));
  await mobile.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await mobile.getByRole('button', { name: '知识库', exact: true }).click();
  const scopeButton = mobile.locator('.context-scope-manager');
  await scopeButton.waitFor({ state: 'visible', timeout: 15000 });
  await scopeButton.click();
  const sheet = mobile.locator('.source-scope-sheet');
  await sheet.waitFor({ state: 'visible', timeout: 15000 });
  await mobile.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '筛选资料范围');
  await mobile.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden', timeout: 15000 });
  await mobile.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '管理资料范围');
  await scopeButton.click();
  await sheet.waitFor({ state: 'visible', timeout: 15000 });
  await sheet.getByLabel('筛选资料范围').fill('主要');
  await sheet.locator('.source-scope-list label').filter({ hasText: '主要资料' }).click();
  await sheet.getByRole('button', { name: '完成', exact: true }).click();
  await scopeButton.click();
  await sheet.getByRole('button', { name: '证据分析', exact: true }).click();
  await mobile.locator('[aria-label="证据工作台"]').waitFor({ state: 'visible', timeout: 15000 });
  await mobile.getByLabel('筛选证据来源').fill('主要');
  assert.equal(await mobile.locator('.evidence-source-row').count(), 1);
  const noOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert.equal(noOverflow, true, '390px workflow must not introduce horizontal overflow');

  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({ ok: true, readerScope: scope, mobileWidth: 390, confirmationReview: true }));
  await mobileContext.close();
  await desktopContext.close();
} finally {
  await browser?.close();
  await new Promise(resolve => server?.close(() => resolve()));
  await app?.locals?.close?.();
  await rm(root, { recursive: true, force: true });
}
