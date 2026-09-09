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
const evidenceDir = join(projectRoot, 'evidence');
const screenshotDir = join(evidenceDir, 'browser');
const evidenceFile = join(evidenceDir, 'deep-knowledge-browser-acceptance.json');
const desktopScreenshot = join(screenshotDir, 'deep-knowledge-desktop.png');
const mobileScreenshot = join(screenshotDir, 'deep-knowledge-mobile-390x844.png');
const root = await mkdtemp(join(tmpdir(), 'flowmind-deep-knowledge-browser-'));
const fixtureDocumentTokens = ['fixture-feishu-release', 'fixture-feishu-risk', 'fixture-feishu-operations'];
const question = '请综合这三份飞书文档，特别核对发布风险等级的分歧，并梳理共同主题、关键实体、知识之间的联系、共识、时间线，并给出可以直接执行的下一步工作计划。';

function monitorPage(page, errors, monitored) {
  if (monitored.has(page)) return;
  monitored.add(page);
  page.on('console', message => { if (message.type() === 'error') errors.push('console:' + message.text()); });
  page.on('pageerror', error => errors.push('page:' + error.message));
}

async function metrics(page) {
  return page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));
}

function assertNoOverflow(value, width) {
  assert.equal(value.viewportWidth, width);
  assert.ok(value.documentScrollWidth <= value.documentClientWidth, 'document overflow: ' + JSON.stringify(value));
  assert.ok(value.bodyScrollWidth <= value.viewportWidth, 'body overflow: ' + JSON.stringify(value));
}

async function gridColumns(locator) {
  return locator.evaluate(element => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length);
}

await mkdir(screenshotDir, { recursive: true });
const state = createDefaultState();
state.settings = { ...(state.settings || {}), model: { provider: 'local', model: 'local-retrieval', fallbackToLocal: true } };
state.conversations = [];
state.notes = [];
state.writingDrafts = [];
state.skillRuns = [];
state.documents = [
  {
    id: fixtureDocumentTokens[0], nodeToken: fixtureDocumentTokens[0], title: '发布审批与负责人', source: 'fixture', knowledgeBaseId: 'feishu-space', updatedAt: '2026-08-07T00:00:00.000Z',
    content: '飞书文档记录发布治理。共同主题是发布前必须完成安全审批。发布风险等级为 2。关键实体 Alice 负责审批核验，时间线要求 2026-08-08 前完成。下一步是确认审批记录并更新发布清单。'
  },
  {
    id: fixtureDocumentTokens[1], nodeToken: fixtureDocumentTokens[1], title: '发布风险与回滚计划', source: 'fixture', knowledgeBaseId: 'feishu-space', updatedAt: '2026-08-07T00:00:00.000Z',
    content: '飞书文档记录发布风险。共同主题是安全审批和可回滚发布。发布风险等级为 4。关键实体 Bob 负责回滚演练；与发布审批文档的共识是审批完成前不能上线，分歧是风险等级仍待确认。'
  },
  {
    id: fixtureDocumentTokens[2], nodeToken: fixtureDocumentTokens[2], title: '上线操作与验证清单', source: 'fixture', knowledgeBaseId: 'feishu-space', updatedAt: '2026-08-07T00:00:00.000Z',
    content: '飞书文档记录上线操作。共同主题是安全审批、负责人和可执行验证。关键实体 Carol 负责移动端验收；时间线是 2026-08-09 审批后执行发布、回滚验证和复盘。'
  }
];
const fixtureDocuments = state.documents;
const stateFile = join(root, 'state.json');
await writeFile(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');

let app;
let server;
let browser;
const runtimeErrors = [];
const monitoredPages = new WeakSet();
try {
  console.log('STEP app-init');
  app = await createInitializedApp({
    stateFile,
    staticDir: join(projectRoot, 'app', 'dist'),
    ocrService: false,
    transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  console.log('STEP app-ready');
  server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  console.log('STEP server-listening');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  context.on('page', page => monitorPage(page, runtimeErrors, monitoredPages));
  const page = await context.newPage();
  monitorPage(page, runtimeErrors, monitoredPages);
  console.log('STEP browser-ready');
  const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.equal(response?.ok(), true, 'FlowMind UI should load');
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.unified-workspace-primary-nav').locator('button').nth(1).click();
  await page.locator('.composer textarea').waitFor({ state: 'visible', timeout: 15000 });

  console.log('STEP ui-loaded');
  const importedDocuments = await page.evaluate(async () => (await (await fetch('/api/documents')).json()).documents);
  for (const token of fixtureDocumentTokens) assert.ok(importedDocuments.some(document => JSON.stringify(document).includes(token)), 'missing isolated fixture document ' + token);

  console.log('STEP documents-verified');
  console.log('STEP before-fill');
  await page.locator('.composer textarea').fill(question);
  console.log('STEP after-fill');
  await page.locator('.composer .send').click({ timeout: 10000 });
  console.log('STEP question-sent');
  const panels = page.locator('.deep-answer-panel');
  await panels.first().waitFor({ state: 'visible', timeout: 30000 });
  console.log('STEP first-panel');
  const firstPanel = panels.first();
  await firstPanel.locator('.deep-answer-extras > summary, .deep-answer-header').first().click();
  const processToggle = firstPanel.locator('.deep-answer-process-summary');
  if (await processToggle.count()) await processToggle.click();
  for (const heading of ['问题理解', '引用覆盖率', '回答计划', '知识线索', '相关文档', '知识地图', '共识', '冲突观点', '时间线', '继续追问']) {
    await firstPanel.getByText(heading, { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 });
  }
  const relatedCount = await firstPanel.locator('.deep-answer-document-card').count();
  assert.ok(relatedCount >= 3, 'deep answer should expose at least three related documents');
  assert.equal(await firstPanel.locator('.deep-answer-document-reason').count(), relatedCount);
  const coverage = Number(await firstPanel.getByRole('progressbar', { name: '引用覆盖率' }).getAttribute('aria-valuenow'));
  assert.ok(Number.isFinite(coverage) && coverage >= 0 && coverage <= 100);
  const mapNodeCount = await firstPanel.locator('.deep-answer-map-lanes em, .deep-answer-map-lanes button').count();
  assert.ok(mapNodeCount >= 3, 'knowledge map should render topic/entity/document nodes');
  const bidirectionalCount = await firstPanel.locator('.deep-answer-bidirectional > div').count();
  await firstPanel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: desktopScreenshot, fullPage: false });
  const desktopMetrics = await metrics(page);
  assertNoOverflow(desktopMetrics, 1440);

  console.log('STEP first-assertions');
  const followUp = firstPanel.locator('.deep-answer-follow-ups button').first();
  const followUpText = (await followUp.innerText()).trim();
  assert.ok(followUpText.length > 3);
  await followUp.click();
  await page.locator('.deep-answer-panel').nth(1).waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await page.locator('.deep-answer-panel').count(), 2, 'follow-up should produce a second deep answer');
  console.log('STEP followup-panel');
  const conversation = await page.evaluate(async () => {
    const data = await (await fetch('/api/conversations')).json();
    return data.conversations[0];
  });
  assert.ok(conversation?.messages?.length >= 4, 'follow-up should remain in the same multi-turn conversation');
  assert.ok(conversation.messages.at(-1).relations?.knowledgeMap?.nodes?.length > 0);

  console.log('STEP conversation-verified');
  async function latestPanel() { return page.locator('.deep-answer-panel').last(); }
  const createdTitles = {};
  for (const [kind, buttonName, expectedWorkspace] of [
    ['note', '将回答转为笔记', '笔记'],
    ['task', '将回答转为任务', '笔记'],
    ['writing', '将回答转为写作草稿', 'writing']
  ]) {
    const panel = await latestPanel();
    await panel.getByRole('button', { name: buttonName, exact: true }).click();
    if (expectedWorkspace === 'writing') await page.locator('.writing-layout').waitFor({ state: 'visible', timeout: 15000 });
    else await page.getByRole('button', { name: expectedWorkspace, exact: true }).waitFor({ state: 'visible', timeout: 15000 });
    const created = await page.evaluate(async currentKind => {
      if (currentKind === 'writing') {
        const data = await (await fetch('/api/writing/drafts')).json();
        return data.drafts.find(item => item.template === 'knowledge-answer');
      }
      const data = await (await fetch('/api/notes?archived=true')).json();
      return data.notes.find(item => item.artifactKind === currentKind);
    }, kind);
    assert.ok(created?.id, kind + ' artifact should be persisted');
    assert.ok(created.sourceRefs?.length > 0, kind + ' artifact should preserve sourceRefs');
    createdTitles[kind] = created.title;
    await page.getByRole('button', { name: '知识库', exact: true }).click();
    await page.locator('.deep-answer-panel').last().waitFor({ state: 'visible', timeout: 10000 });
  }

  await page.getByRole('button', { name: '新会话', exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.deep-answer-panel').count(), 0);
  await page.getByRole('button', { name: '历史', exact: true }).click();
  await page.locator('.history-panel > button').first().click();
  await page.locator('.deep-answer-panel').last().waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await page.locator('.deep-answer-panel').count(), 2, 'history restore should recover both deep answers');

  console.log('STEP history-restored');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.deep-answer-panel').last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const mobilePanel = page.locator('.deep-answer-panel').last();
  assert.equal(await gridColumns(mobilePanel.locator('.deep-answer-overview')), 1, 'mobile overview should be one column');
  assert.equal(await gridColumns(mobilePanel.locator('.deep-answer-map-lanes')), 1, 'mobile knowledge map should be one column');
  const mobileMetrics = await metrics(page);
  assertNoOverflow(mobileMetrics, 390);
  await page.screenshot({ path: mobileScreenshot, fullPage: false });

  console.log('STEP mobile-verified');
  assert.deepEqual(runtimeErrors, []);
  const result = {
    ok: true,
    verifiedAt: new Date().toISOString(),
    fixtureDocuments: fixtureDocuments.map(document => ({ id: document.id, title: document.title, url: document.url || document.sourceUrl || null })),
    question,
    relatedDocuments: relatedCount,
    citationCoverage: coverage,
    knowledgeMapNodes: mapNodeCount,
    bidirectionalLinks: bidirectionalCount,
    followUp: { text: followUpText, conversationId: conversation.id, persistedMessages: conversation.messages.length },
    artifacts: createdTitles,
    sourceRefsVerified: ['note', 'task', 'writing'],
    historyRestore: true,
    desktopMetrics,
    mobileMetrics,
    runtimeErrors,
    screenshots: ['evidence/browser/deep-knowledge-desktop.png', 'evidence/browser/deep-knowledge-mobile-390x844.png']
  };
  await writeFile(evidenceFile, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
