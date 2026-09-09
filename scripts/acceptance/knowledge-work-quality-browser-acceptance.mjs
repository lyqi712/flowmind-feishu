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
const execFileAsync = promisify(execFile);
const { chromium } = requireRuntime('playwright');
const root = await mkdtemp(join(tmpdir(), 'flowmind-knowledge-quality-'));
const stateFile = join(root, 'state.json');
const staticDir = join(root, 'dist');
await execFileAsync(process.execPath, [join(projectRoot, 'app', 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', staticDir], {
  cwd: join(projectRoot, 'app'),
  windowsHide: true
});
const runtimeErrors = [];
const externalFontRequests = [];
let documentId = '';

const state = createDefaultState();
const lateMarker = '尾部唯一结论：发布前必须完成安全审批，负责人是 Alice。';
state.documents = [{
  id: 'quality-source', title: '发布风险资料', source: 'mock', knowledgeBaseId: 'feishu-space', updatedAt: new Date().toISOString(),
  content: `# 发布风险资料\n\n${'背景与例行进展。'.repeat(1700)}\n\n${lateMarker}\n\n${'收尾说明。'.repeat(220)}`
}];
await writeFile(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');

function modelFetch(url, options = {}) {
  const body = JSON.parse(options.body || '{}');
  const system = String(body.messages?.[0]?.content || '');
  let answer = '根据已选资料，发布前需要完成安全审批，负责人是 Alice。';
  if (system.includes('Execution mode: research')) {
    answer = JSON.stringify({
      kind: 'final',
      answer: '发布前必须完成安全审批，负责人是 Alice。当前已选资料没有记录审批完成，因此该项仍待核验。',
      analysis: {
        support: [{ claim: '资料明确要求安全审批，并指定 Alice 负责。', evidenceIds: [] }],
        conflicts: [],
        gaps: [{ claim: '资料没有记录安全审批已完成。', evidenceIds: [] }],
        nextSteps: ['核验审批记录后再推进发布。']
      }
    });
  } else if (system.includes('企业知识库工作流引擎')) {
    answer = '发布说明：上线前由 Alice 完成安全审批核验，确认后再推进发布。';
  }
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

async function assertNamedControls(page, surface) {
  const unnamedControls = await page.locator('input:not([id]):not([name]), textarea:not([id]):not([name]), select:not([id]):not([name])').evaluateAll(elements => elements.map(element => ({ tag: element.tagName, type: element.getAttribute('type'), placeholder: element.getAttribute('placeholder'), ariaLabel: element.getAttribute('aria-label') })));
  assert.deepEqual(unnamedControls, [], `${surface}: form controls need an id or name: ${JSON.stringify(unnamedControls)}`);
}

async function assertNamedButtons(page, surface) {
  const unnamedButtons = await page.locator('button:visible').evaluateAll(elements => elements
    .filter(element => !String(element.textContent || '').trim() && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.getAttribute('title'))
    .map(element => ({ className: element.className, outerHTML: element.outerHTML.slice(0, 220) })));
  assert.deepEqual(unnamedButtons, [], `${surface}: visible icon buttons need an accessible name: ${JSON.stringify(unnamedButtons)}`);
}

let app;
let server;
let browser;
try {
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
  const item = app.locals.contentRepository.listContentItems({ limit: 20 }).find(entry => entry.title === '发布风险资料');
  assert.ok(item, 'fixture document should migrate into the content repository');
  documentId = item.id;
  assert.ok(app.locals.contentRepository.listIndexChunks(documentId).length > 3, 'long fixture must have local index chunks');

  server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const settings = await fetch(`${base}/api/settings/model`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'quality-fixture', apiKey: 'fixture-key', retries: 0 })
  });
  assert.equal(settings.status, 200);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(`console:${message.text()}`); });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  page.on('requestfailed', request => runtimeErrors.push(`failed:${request.url()}`));
  page.on('request', request => {
    if (/^https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//i.test(request.url())) externalFontRequests.push(request.url());
  });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  const commandTrigger = page.locator('[aria-label="打开全局命令框"]:visible').first();
  await commandTrigger.focus();
  await page.keyboard.press('Control+K');
  const commandInput = page.getByRole('textbox', { name: '全局命令', exact: true });
  await commandInput.waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await commandInput.evaluate(element => document.activeElement === element), true, 'command palette should move focus into its input');
  await page.keyboard.press('ArrowDown');
  assert.ok(await commandInput.getAttribute('aria-activedescendant'), 'command palette should expose an active command after ArrowDown');
  await page.keyboard.press('Escape');
  await commandTrigger.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '打开全局命令框', null, { timeout: 15000 });
  assert.equal(await commandTrigger.evaluate(element => document.activeElement === element), true, 'Escape should return focus to the command trigger');
  await assertNamedControls(page, 'home');
  await assertNamedButtons(page, 'home');
  await page.locator('.unified-workspace-primary-nav').locator('button').nth(1).click();
  const composer = page.locator('.composer');
  await composer.locator('textarea').waitFor({ state: 'visible', timeout: 15000 });
  await assertNamedControls(page, 'chat workspace');
  await assertNamedButtons(page, 'chat workspace');
  const sourceRow = page.locator('.doc-row:visible').filter({ hasText: '发布风险资料' });
  await sourceRow.waitFor({ state: 'visible', timeout: 15000 });
  await sourceRow.locator('.doc-scope-toggle').click();

  await composer.locator('textarea').fill('发布前需要完成什么安全审批？');
  await composer.locator('.send').click();
  await page.waitForFunction(value => document.body.textContent.includes(value), lateMarker, { timeout: 15000 });
  const scopeSummary = page.locator('.scope-evidence-summary').last();
  await scopeSummary.waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await scopeSummary.innerText(), /证据预算/);
  const conversations = await page.evaluate(async () => (await (await fetch('/api/conversations')).json()).conversations);
  const normalCitation = conversations[0]?.messages?.at(-1)?.citations?.[0];
  assert.equal(normalCitation?.documentId, documentId);
  assert.ok(normalCitation?.chunkId && normalCitation?.anchor, 'normal chat should persist an anchored chunk citation');

  await page.getByRole('button', { name: '研究', exact: true }).click();
  await composer.locator('textarea').fill('请研究发布前审批要求、已知支持和仍需核验的部分。');
  await composer.locator('.send').click();
  await page.locator('[aria-label="Agent 执行记录"]').last().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => document.body.textContent.includes('当前已选资料没有记录审批完成'), null, { timeout: 15000 });
  assert.match(await page.locator('[aria-label="Agent 执行记录"]').last().innerText(), /待核验缺口/);
  const runs = await page.evaluate(async () => (await (await fetch('/api/agent/runs')).json()).runs);
  assert.ok(runs[0]?.evidence?.some(entry => entry.documentId && entry.anchor), 'research should store anchored server-issued evidence');

  const draft = await page.evaluate(async ({ id, marker }) => {
    const response = await fetch('/api/writing/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '发布说明草稿',
        content: `原始草稿：${marker}`,
        template: 'brief',
        audience: '项目团队',
        tone: '专业简洁',
        sourceRefs: [{ documentId: id, title: '发布风险资料', anchor: 'chars:0-1', excerpt: marker }]
      })
    });
    return response.json();
  }, { id: documentId, marker: lateMarker });
  assert.ok(draft.draft?.id);

  await composer.locator('textarea').fill('/');
  const writingAction = page.getByRole('option', { name: /智能写作.*基于当前材料继续创作/ });
  await writingAction.waitFor({ state: 'visible', timeout: 15000 });
  await writingAction.click();
  const editor = page.locator('textarea.editor-body');
  await editor.waitFor({ state: 'visible', timeout: 15000 });
  await assertNamedControls(page, 'writing workspace');
  await assertNamedButtons(page, 'writing workspace');
  assert.match(await page.locator('.writing-sources').innerText(), /发布风险资料/);
  await page.getByRole('button', { name: '打开草稿 AI 写作', exact: true }).click();
  await page.getByRole('button', { name: '润色', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes('发布说明：上线前由 Alice'), null, { timeout: 15000 });
  await page.getByRole('button', { name: '替换全文', exact: true }).click();
  assert.match(await editor.inputValue(), /上线前由 Alice/);
  await page.getByRole('button', { name: '保存版本', exact: true }).click();
  await page.waitForTimeout(250);
  const saved = await page.evaluate(async draftId => (await (await fetch('/api/writing/drafts')).json()).drafts.find(entry => entry.id === draftId), draft.draft.id);
  assert.match(saved.content, /上线前由 Alice/);
  assert.ok(saved.sourceRefs.length >= 1);
  assert.ok(saved.sourceRefs.every(ref => ref.documentId === documentId));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  assert.ok(overflow <= 0, `mobile layout overflowed by ${overflow}px`);
  assert.deepEqual(externalFontRequests, [], `unexpected external font requests: ${externalFontRequests.join(', ')}`);
  assert.deepEqual(runtimeErrors, []);

  console.log(JSON.stringify({
    ok: true,
    documentId,
    citation: { chunkId: normalCitation.chunkId, anchor: normalCitation.anchor },
    agentEvidence: runs[0].evidence.length,
    writingDraftId: saved.id,
    runtimeErrors
  }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
