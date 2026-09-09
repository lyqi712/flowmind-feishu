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
const sourceState = createDefaultState();
const root = await mkdtemp(join(tmpdir(), 'flowmind-natural-graph-copilot-'));
const stateFile = join(root, 'state.json');
sourceState.conversations = [];
sourceState.documents = [
  ...(sourceState.documents || []),
  { id: 'acceptance-memory-design', title: 'FlowMind 记忆设计', content: 'Copilot 记忆系统支持长期项目的知识工作流，并保留可追溯上下文。', tags: ['Copilot', '记忆'], metadata: { outboundLinks: [{ target: 'Copilot 记忆工作流' }] } },
  { id: 'acceptance-memory-workflow', title: 'Copilot 记忆工作流', content: '长期项目通过 Copilot 记忆系统组织知识工作流和后续任务。', tags: ['Copilot', '记忆'] }
];
sourceState.notes = [{ id: 'acceptance-memory-note', title: '记忆关系观察', content: '[[FlowMind 记忆设计]] 通过来源关联 [[Copilot 记忆工作流]]。', sourceRefs: [{ documentId: 'acceptance-memory-workflow' }], tags: ['记忆'] }];
sourceState.writingDrafts = [];
sourceState.skillRuns = [];
sourceState.settings = { ...(sourceState.settings || {}), model: { provider: 'local', model: 'local-retrieval', fallbackToLocal: true } };
await writeFile(stateFile, JSON.stringify(sourceState, null, 2) + '\n', 'utf8');
const evidenceDir = join(projectRoot, 'evidence');
await mkdir(join(evidenceDir, 'browser'), { recursive: true });
const evidenceFile = join(evidenceDir, 'browser', 'ai-natural-graph-copilot-acceptance.json');
const screenshots = {
  chat: join(evidenceDir, 'browser', 'ai-natural-chat-1440.png'),
  graph: join(evidenceDir, 'browser', 'ai-natural-graph-overview-1440.png'),
  graphDetail: join(evidenceDir, 'browser', 'ai-natural-graph-detail-1440.png'),
  copilot: join(evidenceDir, 'browser', 'ai-natural-copilot-1180.png'),
  copilotMobile: join(evidenceDir, 'browser', 'ai-natural-copilot-390.png')
};
const calls = [];
function modelFetch(url, options = {}) {
  const target = String(url);
  if (target.includes('/v1/chat/completions')) {
    const body = JSON.parse(options.body || '{}');
    calls.push({ url: target, model: body.model, messages: body.messages?.map(item => ({ role: item.role, content: String(item.content || '').slice(0, 200) })) });
    const prompt = body.messages?.at(-1)?.content || '';
    const answer = String(prompt).includes('你好') ? '你好！我是 FlowMind 的已配置模型，可以继续帮你检索、总结、解释和落地操作。' : '模型已结合当前上下文生成这份回答：先给出结论，再保留可核验来源和下一步操作。';
    const encoder = new TextEncoder();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`)); controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); } });
    return Promise.resolve(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
  }
  return Promise.resolve(Response.json({ data: [] }));
}
let app; let server; let browser;
const runtimeErrors = [];
try {
  app = await createInitializedApp({ stateFile, staticDir: join(projectRoot, 'app', 'dist'), fetchImpl: modelFetch, ocrService: false, transcriptionService: false, modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') }, feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') } });
  server = await new Promise((resolveServer, reject) => { const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance)); instance.once('error', reject); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const settingResponse = await fetch(`${baseUrl}/api/settings/model`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'fixture-natural', apiKey: 'fixture-key' }) });
  assert.equal(settingResponse.status, 200);
  const greetingResponse = await fetch(`${baseUrl}/api/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '你好' }) });
  const greetingEvents = (await greetingResponse.text()).trim().split('\n').map(JSON.parse);
  const greetingRetrieval = greetingEvents.find(event => event.type === 'retrieval');
  const greetingDone = greetingEvents.find(event => event.type === 'done');
  assert.equal(greetingRetrieval.mode, 'conversation');
  assert.equal(greetingRetrieval.matchCount, 0);
  assert.deepEqual(greetingDone.citations, []);
  assert.equal(greetingDone.relations, null);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.addInitScript(() => {
    class FixtureSpeechRecognition {
      start() { this.onstart?.(); setTimeout(() => { this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: '请总结当前材料', confidence: 0.99 }, isFinal: true }] }); this.onend?.(); }, 20); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    window.SpeechRecognition = FixtureSpeechRecognition;
  });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(`console:${message.text()}`); });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  page.on('requestfailed', request => runtimeErrors.push(`failed:${request.url()}`));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.unified-workspace-primary-nav').locator('button').nth(1).click();
  await page.waitForTimeout(500);
  await page.locator('.composer textarea').waitFor({ state: 'visible', timeout: 15000 });

  const composer = page.locator('.composer');
  await composer.locator('textarea').fill('你好');
  await composer.getByRole('button', { name: '语音输入', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.composer textarea')?.value.includes('请总结当前材料'), null, { timeout: 5000 }).catch(async () => { await page.waitForTimeout(200); });
  const transcript = await composer.locator('textarea').inputValue();
  assert.match(transcript, /请总结当前材料/);
  await composer.locator('textarea').fill('你好');
  await page.locator('.composer .send').evaluate(element => element.click());
  await page.locator('.message.assistant').last().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.message.assistant:last-of-type')?.textContent?.includes('FlowMind'), null, { timeout: 30000 });
  const assistantText = await page.locator('.message.assistant').last().innerText();
  assert.match(assistantText, /FlowMind/);
  assert.doesNotMatch(assistantText, /根据本地知识库中/);
  assert.equal(await page.locator('.message.assistant').last().locator('text=正在连接模型').count(), 0);
  await page.screenshot({ path: screenshots.chat, fullPage: false });

  await composer.locator('textarea').fill('\u603b\u7ed3\u98de\u4e66\u77e5\u8bc6\u5e93\u7684\u5173\u952e\u7ed3\u8bba\uff0c\u5e76\u4fdd\u7559\u6765\u6e90');
  await composer.locator('.send').click();
  const panel = page.locator('.deep-answer-panel').last();
  await panel.waitFor({ state: 'visible', timeout: 30000 });
  await panel.getByRole('button', { name: '\u751f\u6210\u8bc1\u636e\u56fe\u8868', exact: true }).click();
  await page.locator('.deep-answer-chart').waitFor({ state: 'visible', timeout: 15000 });
  const chart = await page.evaluate(async () => (await (await fetch('/api/notes?archived=true')).json()).notes.find(item => item.artifactKind === 'chart'));
  assert.ok(chart?.chartSpec?.labels?.length >= 2, 'chart artifact should persist evidence labels');
  assert.ok(chart.sourceRefs?.length > 0, 'chart artifact should preserve sourceRefs');
  await page.screenshot({ path: screenshots.graph, fullPage: false });

  await page.locator('.unified-workspace-primary-nav').getByRole('button', { name: '知识库', exact: true }).click();
  const graphTrigger = page.locator('button[title="打开知识观察"]');
  await graphTrigger.waitFor({ state: 'visible', timeout: 15000 });
  await graphTrigger.click();
  const graph = page.locator('[aria-label="知识观察"]');
  await graph.waitFor({ state: 'visible', timeout: 15000 });
  const graphStats = await graph.locator('.knowledge-graph-heading p').innerText();
  const semanticCount = Number(graphStats.match(/(\d+) 条主题关联/)?.[1] || 0);
  assert.ok(semanticCount <= 32, `semantic relationship count should remain readable, received ${semanticCount}`);
  const relationOverview = page.locator('[aria-label="关系概览"]');
  await relationOverview.waitFor({ state: 'visible', timeout: 15000 });
  assert.ok(await page.locator('.knowledge-graph-edge').count() > 0, 'graph should render at least one relation edge');
  assert.ok(await relationOverview.locator('button').count() > 0, 'relation overview should expose at least one explainable relation');
  assert.match(await relationOverview.innerText(), /共同主题|链接|来源|标签/);
  await page.screenshot({ path: screenshots.graph, fullPage: false });
  await relationOverview.locator('button').first().click();
  await page.locator('[aria-label="关系侧栏"]').waitFor({ state: 'visible', timeout: 10000 });
  assert.ok(await page.locator('.knowledge-graph-relation-summary').count() > 0, 'selected node should show relationship reasons');
  await page.screenshot({ path: screenshots.graphDetail, fullPage: false });

  await page.getByRole('button', { name: 'Copilot', exact: true }).click();
  await page.locator('.copilot-form').waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await page.getByText('系统提示词', { exact: true }).count(), 0);
  assert.ok(await page.getByText('用户自定义指令', { exact: true }).count() > 0);
  const memorySwitch = page.locator('.memory-switch');
  assert.ok(await memorySwitch.count() > 0);
  assert.equal(await memorySwitch.locator('input[type="checkbox"]').evaluate(element => getComputedStyle(element).width === '18px'), true);
  assert.equal(await memorySwitch.evaluate(element => getComputedStyle(element).writingMode), 'horizontal-tb');
  await page.screenshot({ path: screenshots.copilot, fullPage: false });
  const desktopMetrics = await page.evaluate(() => ({ viewportWidth: innerWidth, documentClientWidth: document.documentElement.clientWidth, documentScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth }));
  assert.ok(desktopMetrics.documentScrollWidth <= desktopMetrics.documentClientWidth);
  assert.ok(desktopMetrics.bodyScrollWidth <= desktopMetrics.viewportWidth);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await memorySwitch.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await memorySwitch.evaluate(element => getComputedStyle(element).writingMode), 'horizontal-tb');
  assert.equal(await memorySwitch.locator('input[type="checkbox"]').evaluate(element => getComputedStyle(element).width === '18px'), true);
  const mobileMetrics = await page.evaluate(() => ({ viewportWidth: innerWidth, documentClientWidth: document.documentElement.clientWidth, documentScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth }));
  assert.ok(mobileMetrics.documentScrollWidth <= mobileMetrics.documentClientWidth);
  assert.ok(mobileMetrics.bodyScrollWidth <= mobileMetrics.viewportWidth);
  await page.screenshot({ path: screenshots.copilotMobile, fullPage: false });
  assert.ok(calls.some(call => call.messages?.some(item => item.content.includes('你好'))), 'configured model should receive the greeting');
  const greetingCall = calls.find(call => call.messages?.at(-1)?.content === '你好');
  assert.ok(greetingCall, 'the greeting should reach the configured model as the final user message');
  assert.doesNotMatch(greetingCall.messages.at(-1).content, /检索上下文|资料片段|引用来源/);
  assert.deepEqual(runtimeErrors, []);
  const result = { ok: true, verifiedAt: new Date().toISOString(), modelCalls: calls, transcript, assistantText, graph: { stats: graphStats, semanticCount }, metrics: { desktop: desktopMetrics, mobile: mobileMetrics }, runtimeErrors, screenshots: Object.values(screenshots).map(path => path.replace(projectRoot + '\\', '').replaceAll('\\', '/')) };
  await writeFile(evidenceFile, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
