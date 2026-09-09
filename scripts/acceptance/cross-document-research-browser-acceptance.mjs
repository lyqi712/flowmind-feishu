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

const alphaMarker = 'RETRIEVAL_POLICY_UNIQUE';
const betaMarker = 'CONNECTOR_SECURITY_UNIQUE';
const lunchMarker = 'LUNCH_MENU_UNIQUE';
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
  const transcript = (body.messages || []).map(message => String(message.content || '')).join('\n');
  if (transcript.includes(alphaMarker) || transcript.includes(betaMarker) || /对比|约束|手册/.test(transcript)) {
    return Promise.resolve(streamText(`跨文档结论：检索必须先核验来源版本（${alphaMarker}），连接器密钥只能留在服务端（${betaMarker}）。`));
  }
  return Promise.resolve(streamText('这是一条不引用具体手册的普通回答。'));
}

function overflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
}

async function openGlobalSearch(page, query) {
  for (let attempt = 0; attempt < 2; attempt += 1) await page.keyboard.press('Escape').catch(() => {});
  await page.locator('#workspace-tab-home').click();
  await page.locator('.unified-workspace-home, .unified-workspace-stage-header').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.evaluate(() => document.querySelector('button.unified-workspace-stage-search')?.click());
  const searchInput = page.getByRole('dialog').locator('input[aria-label="全局搜索"]');
  await searchInput.waitFor({ state: 'visible', timeout: 15000 });
  await searchInput.fill(query);
  await page.getByRole('dialog').getByRole('button', { name: '搜索', exact: true }).click();
  await page.locator('#workspace-search-results').waitFor({ state: 'visible', timeout: 15000 });
}

const root = await mkdtemp(join(tmpdir(), 'flowmind-cross-doc-research-'));
const stateFile = join(root, 'state.json');
const state = createDefaultState();
state.documents = [];
state.notes = [];
state.conversations = [];
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
  const source = repository.upsertSourceConnection({ sourceType: 'feishu', externalId: 'cross-doc-research', name: 'Cross-document research fixture' });
  const space = repository.upsertSpace({ sourceConnectionId: source.id, externalId: 'cross-doc-space', name: '研究资料库' });
  const beta = repository.upsertContentItem({
    sourceConnectionId: source.id, spaceId: space.id, externalId: 'connector-security-manual', contentType: 'docx',
    title: '连接器安全手册', revision: 'beta-v1', tags: ['安全', '连接器'],
    content: `# 连接器安全手册\n\n连接器密钥不得写入前端或日志。\n\n${betaMarker}\n\n失败时必须展示真实上游错误，不得伪造成功。`
  }).item;
  const alpha = repository.upsertContentItem({
    sourceConnectionId: source.id, spaceId: space.id, externalId: 'retrieval-policy-manual', contentType: 'docx',
    title: '检索策略手册', revision: 'alpha-v1', tags: ['检索', '证据'],
    content: `# 检索策略手册\n\n回答前先核验来源版本和锚点。\n\n${alphaMarker}\n\n历史版本可以回看，但不能悄悄覆盖当前正文。`,
    metadata: { links: [{ documentId: beta.id, label: '连接器安全手册', sourceAnchor: 'retrieval', targetAnchor: 'security' }] }
  }).item;
  repository.upsertContentItem({
    sourceConnectionId: source.id, spaceId: space.id, externalId: 'lunch-menu', contentType: 'docx',
    title: '午餐菜单', revision: 'lunch-v1', tags: ['无关'],
    content: `# 午餐菜单\n\n今日供应番茄炒蛋。\n\n${lunchMarker}`
  });
  await app.locals.store.update(current => {
    current.knowledgeBases = [{ id: space.id, spaceId: space.id, name: space.name, source: 'feishu', documentCount: 3 }];
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
    body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'cross-doc-fixture', apiKey: 'fixture-key', retries: 0 })
  });
  assert.equal(settings.status, 200);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('console', message => {
    if (message.type() === 'error' && !/server responded with a status of 404 \(Not Found\)/u.test(message.text())) {
      runtimeErrors.push(`console:${message.text()}`);
    }
  });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });

  // 1. Open the first source from the knowledge sidebar.
  await page.getByRole('navigation', { name: '主功能' }).getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('.doc-row').filter({ hasText: '检索策略手册' }).locator('.doc-open').click();
  const alphaReader = page.getByLabel('检索策略手册阅读器');
  await alphaReader.waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await alphaReader.innerText(), new RegExp(alphaMarker));

  // 2. Select the unique policy sentence and persist a source note.
  await page.evaluate(marker => {
    const text = [...document.querySelectorAll('.content-reader p, .content-reader-markdown p, .content-reader-scroll p')]
      .find(node => node.textContent?.includes(marker));
    if (!text) throw new Error('alpha selection text is unavailable');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    text.closest('.content-reader-scroll, .content-reader')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, alphaMarker);
  await alphaReader.getByLabel('更多操作').click();
  await alphaReader.getByRole('menuitem', { name: '记下选区' }).click();
  const editor = page.locator('.markdown-editor-body');
  await editor.waitFor({ state: 'visible', timeout: 15000 });
  const noteText = await editor.inputValue();
  await editor.fill(`${noteText}\n\n核验结论：${alphaMarker} 必须在回答前成立。\n\n[[连接器安全手册]]\n`);
  await page.waitForTimeout(2200);

  // 3. Search the second source, open it, then return to the same result list.
  await openGlobalSearch(page, betaMarker);
  const betaOption = page.locator('#workspace-search-results [role="option"]').filter({ hasText: '连接器安全手册' }).first();
  await betaOption.waitFor({ state: 'visible', timeout: 15000 });
  await betaOption.click();
  const betaReader = page.getByLabel('连接器安全手册阅读器');
  await betaReader.waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await page.locator('.unified-workspace-search-panel').count(), 0, 'opening a search result must yield the reader');
  assert.match(await betaReader.innerText(), new RegExp(betaMarker));
  await page.getByRole('button', { name: '返回搜索结果', exact: true }).click();
  await page.locator('.unified-workspace-search-panel').waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await page.locator('#workspace-search-results [role="option"]').filter({ hasText: '连接器安全手册' }).first().getAttribute('data-search-opened'), 'true');
  await page.locator('.unified-workspace-search-panel [aria-label="关闭全局搜索"]').click();

  // 4. Put both manuals into the same question scope and ask a comparison question.
  await page.getByRole('navigation', { name: '主功能' }).getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('.doc-row').filter({ hasText: '检索策略手册' }).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByLabel('加入问答范围：检索策略手册').click();
  await page.getByLabel('加入问答范围：连接器安全手册').click();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  const composer = page.locator('.composer textarea');
  await composer.waitFor({ state: 'visible', timeout: 10000 });
  await composer.fill('对比两份手册的关键约束，并保留来源。');
  await page.locator('.composer .send').click();
  await page.waitForFunction(value => document.body.textContent.includes(value), alphaMarker, { timeout: 20000 });
  await page.waitForFunction(value => document.body.textContent.includes(value), betaMarker, { timeout: 20000 });
  const contextStrip = await page.locator('.context-strip').innerText().catch(() => '');
  assert.match(`${contextStrip}\n${await page.locator('body').innerText()}`, /已选 2 篇|2 篇资料|检索策略手册/, 'both manuals must stay in the visible working context');

  // 5. Create a writing draft from the cross-document answer and keep provenance.
  await page.locator('.answer-version-actions button').filter({ hasText: '接着写' }).last().click();
  await page.waitForTimeout(2000);
  const writingText = await page.locator('body').innerText();
  assert.match(writingText, /写作草稿|写作台/, 'writing draft tab must open');
  assert.match(writingText, /连接器安全手册|检索策略手册|跨文档结论/, 'writing draft must keep source provenance');

  // 6. Graph hop: both manuals and the source note remain visible and openable.
  await page.getByRole('navigation', { name: '主功能' }).getByRole('button', { name: '知识库', exact: true }).click();
  const graphTrigger = page.locator('button[title="打开知识观察"]');
  await graphTrigger.waitFor({ state: 'visible', timeout: 15000 });
  await graphTrigger.click();
  const graph = page.locator('.knowledge-graph').first();
  await graph.waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1200);
  const graphText = await graph.innerText();
  assert.match(graphText, /检索策略手册/);
  assert.match(graphText, /连接器安全手册/);
  assert.match(graphText, /阅读笔记|检索策略/, 'graph must include the newly created note');

  // 7. Empty search stays honest and does not crash the workspace.
  await openGlobalSearch(page, 'zzzz-no-such-doc-xyz');
  await page.getByText('没有找到匹配内容').waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await page.locator('#workspace-search-results [role="option"]').count(), 0);
  await page.locator('.unified-workspace-search-panel [aria-label="关闭全局搜索"]').click();

  // 8. Reload recovers the research workset.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1800);
  const restoredTabs = await page.locator('[role="tab"]').allInnerTexts();
  assert.ok(restoredTabs.some(text => text.includes('检索策略手册')), `missing alpha tab after reload: ${JSON.stringify(restoredTabs)}`);
  assert.ok(restoredTabs.some(text => text.includes('连接器安全手册')), `missing beta tab after reload: ${JSON.stringify(restoredTabs)}`);
  assert.ok(restoredTabs.some(text => /阅读笔记|写作草稿/.test(text)), `missing research artifact tab after reload: ${JSON.stringify(restoredTabs)}`);

  // 9. Unrelated lunch menu must not leak into the recovered research tabs as the active reader.
  assert.equal(restoredTabs.some(text => text.includes('午餐菜单')), false, 'unrelated document must not be auto-opened');

  const overflowByViewport = {};
  for (const [label, width, height] of [['desktop', 1440, 960], ['compact', 1180, 860], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(220);
    overflowByViewport[label] = await overflow(page);
    assert.equal(overflowByViewport[label], 0, `${label} view must not overflow`);
  }
  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({
    ok: true,
    documents: { alpha: alpha.id, beta: beta.id },
    restoredTabs,
    overflow: overflowByViewport,
    runtimeErrors
  }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
