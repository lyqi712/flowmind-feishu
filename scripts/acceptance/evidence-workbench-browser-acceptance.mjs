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
const root = await mkdtemp(join(tmpdir(), 'flowmind-evidence-browser-'));
const stateFile = join(root, 'state.json');
const evidenceDir = join(projectRoot, 'evidence', 'agent-graph');
const runtimeErrors = [];
let releaseDocumentId = 'release-doc';
const screenshots = {
  desktop: join(evidenceDir, 'evidence-workbench-1440.png'),
  confirmation: join(evidenceDir, 'evidence-workbench-confirmation-1440.png'),
  mobile: join(evidenceDir, 'evidence-workbench-390.png')
};

const state = createDefaultState();
state.documents = [{
  id: 'release-doc', title: 'Release plan', source: 'mock', knowledgeBaseId: 'feishu-space', updatedAt: new Date().toISOString(),
  revision: 'release-r1', content: 'Alice owns the release review. Launch is blocked until the final security review is signed off.'
}];
await writeFile(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
await mkdir(evidenceDir, { recursive: true });

function modelFetch(url, options = {}) {
  const body = JSON.parse(options.body || '{}');
  const system = String(body.messages?.[0]?.content || '');
  const prompt = String(body.messages?.at(-1)?.content || '');
  let answer = 'The model is reachable.';
  if (system.includes('Execution mode: research')) {
    if (prompt.includes('UNTRUSTED_EVIDENCE_DATA_BEGIN')) {
      answer = JSON.stringify({
        kind: 'final', answer: 'Alice owns the release review. The security sign-off remains the release gate.',
        analysis: {
          support: [{ claim: 'The release plan names Alice as the review owner.', evidenceIds: [] }],
          conflicts: [],
          gaps: [{ claim: 'The final security sign-off is not yet recorded.', evidenceIds: [] }],
          nextSteps: ['Verify the security sign-off before approval.']
        }
      });
    } else answer = JSON.stringify({ kind: 'tool', name: 'knowledge.search', arguments: { query: 'release security review', limit: 3 } });
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
  assert.ok(releaseDocument, 'fixture document should be available through the content repository');
  releaseDocumentId = releaseDocument.id;
  server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const settings = await fetch(`${base}/api/settings/model`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'fixture-evidence', apiKey: 'fixture-key', retries: 0 })
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
  await page.locator('.side-head-actions button[title="打开证据工作台"]').click();
  await page.locator('[aria-label="证据工作台"]').waitFor({ state: 'visible', timeout: 15000 });

  const source = page.locator('.evidence-source-row').filter({ hasText: 'Release plan' });
  await source.click();
  await page.locator('#evidence-question').fill('Who owns the release review, what supports it, and what remains unresolved?');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes('Alice owns the release review.'), null, { timeout: 15000 });
  await page.locator('.evidence-ledger-row').filter({ hasText: 'Release plan' }).first().waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await page.locator('.evidence-analysis-section').innerText(), /支持[\s\S]*names Alice as the review owner/);
  assert.match(await page.locator('.evidence-analysis-section').innerText(), /缺口[\s\S]*security sign-off/);
  await page.screenshot({ path: screenshots.desktop, fullPage: false });

  await page.getByRole('button', { name: '生成提案', exact: true }).click();
  await page.getByRole('button', { name: '提交受控提案', exact: true }).click();
  await page.getByRole('button', { name: '确认写入', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  const notesBefore = await page.evaluate(async () => (await (await fetch('/api/notes')).json()).notes.length);
  assert.equal(notesBefore, 0);
  await page.screenshot({ path: screenshots.confirmation, fullPage: false });
  await page.getByRole('button', { name: '确认写入', exact: true }).click();
  await page.waitForTimeout(500);
  const confirmationText = await page.locator('.evidence-confirmation').innerText();
  if (!confirmationText.includes('提案已完成')) console.log(JSON.stringify(await page.evaluate(async () => await (await fetch('/api/agent/runs')).json()), null, 2));
  assert.match(confirmationText, /提案已完成/);
  const notesAfter = await page.evaluate(async () => (await (await fetch('/api/notes')).json()).notes.length);
  assert.equal(notesAfter, 1);
  const graph = await page.evaluate(async () => await (await fetch('/api/graph')).json());
  assert.ok(graph.graph.edges.some(edge => edge.type === 'source'), 'confirmed note should add only a validated source edge');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const mobileOverflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  assert.ok(mobileOverflow <= 0, `mobile layout overflowed by ${mobileOverflow}px`);
  await page.screenshot({ path: screenshots.mobile, fullPage: false });
  assert.deepEqual(runtimeErrors, []);

  const result = {
    ok: true,
    runId: app.locals.agentRuntime.getRuns()[0]?.id || null,
    releaseDocumentId,
    runtimeErrors,
    screenshots: Object.values(screenshots).map(file => file.replace(projectRoot + '\\', '').replaceAll('\\', '/'))
  };
  await writeFile(join(evidenceDir, 'evidence-workbench-browser-acceptance.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
