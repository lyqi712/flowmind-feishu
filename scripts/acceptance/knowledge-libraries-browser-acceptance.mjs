import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitializedApp } from '../../app/server/app.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const runtimeNodeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
const requireRuntime = createRequire(join(runtimeNodeModules, 'playwright', 'package.json'));
const { chromium } = requireRuntime('playwright');
const root = await mkdtemp(join(tmpdir(), 'flowmind-knowledge-libraries-browser-'));
const evidenceDir = join(projectRoot, 'evidence');
const desktopScreenshot = join(evidenceDir, 'v9-knowledge-libraries-1440.png');
const narrowScreenshot = join(evidenceDir, 'v9-knowledge-libraries-1180.png');
const evidenceFile = join(evidenceDir, 'v9-knowledge-libraries-browser.json');
await mkdir(evidenceDir, { recursive: true });

function fixtureFetch(url, options = {}) {
  const target = String(url);
  if (target.includes('/auth/v3/tenant_access_token/internal')) {
    const submitted = JSON.parse(options.body);
    assert.equal(submitted.app_id, 'cli_test_app');
    assert.equal(submitted.app_secret, 'test-app-secret');
    return Promise.resolve(Response.json({ code: 0, tenant_access_token: 'tenant-test-token' }));
  }
  if (target.includes('/wiki/v2/spaces?')) {
    assert.equal(options.headers?.Authorization, 'Bearer tenant-test-token');
    return Promise.resolve(Response.json({ code: 0, data: { items: [
      { space_id: 'space-auto', name: '自动发现空间', description: '真实共享库 fixture', visibility: 'tenant' },
      { space_id: 'space-second', name: '第二知识空间', description: '', visibility: null }
    ], has_more: false } }));
  }
  return Promise.resolve(Response.json({ code: 0, data: {} }));
}

let app; let server; let browser;
const errors = []; const requests = [];
try {
  const stateFile = join(root, 'state.json');
  app = await createInitializedApp({
    stateFile,
    staticDir: join(projectRoot, 'app', 'dist'),
    env: {},
    fetchImpl: fixtureFetch,
    ocrService: false,
    transcriptionService: false,
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') },
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') }
  });
  await app.locals.feishuService.update({ appId: 'cli_test_app', appSecret: 'test-app-secret' });
  const repo = app.locals.contentRepository;
  const source = repo.upsertSourceConnection({ sourceType: 'feishu', externalId: 'tenant-fixture', name: '飞书租户' });
  const space = repo.upsertSpace({ sourceConnectionId: source.id, externalId: 'space-auto', name: '自动发现空间', description: '真实共享库 fixture', metadata: { visibility: 'tenant' } });
  repo.upsertContentItem({ sourceConnectionId: source.id, spaceId: space.id, externalId: 'doc-shared', contentType: 'docx', title: '共享库文档 · 项目规范', content: '共享库中的真实文档，用于验证选择知识库后的精确过滤。', revision: '1' });
  server = await new Promise((resolveServer, reject) => { const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance)); instance.once('error', reject); });
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') errors.push('console:' + message.text()); });
  page.on('pageerror', error => errors.push('page:' + error.message));
  page.on('requestfailed', request => errors.push('failed:' + request.url()));
  page.on('response', response => { if (response.status() >= 400) requests.push(`${response.status()} ${response.url()}`); });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('button', { name: '知识库', exact: true }).first().click();
  await page.getByTitle('刷新共享库').first().click();
  await page.locator('.library-list').getByText('第二知识空间', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('.library-list').getByRole('button', { name: '关注：自动发现空间', exact: true }).click();
  await page.locator('.library-list').getByRole('button', { name: '取消关注：自动发现空间', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  const sharedSelect = page.locator('.kb-select').filter({ hasText: '自动发现空间' });
  await sharedSelect.click();
  await page.locator('.doc-row').filter({ hasText: '共享库文档 · 项目规范' }).waitFor({ state: 'visible', timeout: 10000 });
  const docTexts = await page.locator('.doc-row').allTextContents();
  assert.equal(docTexts.filter(text => text.includes('共享库文档 · 项目规范')).length, 1);
  assert.equal(docTexts.filter(text => text.includes('第二知识空间')).length, 0);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('button', { name: '知识库', exact: true }).first().click();
  await page.locator('.kb-row.active').filter({ hasText: '自动发现空间' }).waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('.library-list').getByRole('button', { name: '取消关注：自动发现空间', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('.doc-row').filter({ hasText: '共享库文档 · 项目规范' }).waitFor({ state: 'visible', timeout: 10000 });
  const restoredDocTexts = await page.locator('.doc-row').allTextContents();
  const desktopMetrics = await page.evaluate(() => ({ viewportWidth: innerWidth, documentClientWidth: document.documentElement.clientWidth, documentScrollWidth: document.documentElement.scrollWidth, bodyClientWidth: document.body.clientWidth, bodyScrollWidth: document.body.scrollWidth, editorWidth: document.querySelector('.workspace')?.getBoundingClientRect().width || 0 }));
  assert.ok(desktopMetrics.documentScrollWidth <= desktopMetrics.documentClientWidth);
  assert.ok(desktopMetrics.bodyScrollWidth <= desktopMetrics.viewportWidth);
  await page.screenshot({ path: desktopScreenshot, fullPage: false });
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.waitForTimeout(200);
  const narrowMetrics = await page.evaluate(() => ({ viewportWidth: innerWidth, documentClientWidth: document.documentElement.clientWidth, documentScrollWidth: document.documentElement.scrollWidth, bodyClientWidth: document.body.clientWidth, bodyScrollWidth: document.body.scrollWidth, editorWidth: document.querySelector('.workspace')?.getBoundingClientRect().width || 0 }));
  assert.ok(narrowMetrics.documentScrollWidth <= narrowMetrics.documentClientWidth);
  assert.ok(narrowMetrics.bodyScrollWidth <= narrowMetrics.viewportWidth);
  await page.screenshot({ path: narrowScreenshot, fullPage: false });
  await writeFile(evidenceFile, JSON.stringify({ ok: true, baseUrl, desktopMetrics, narrowMetrics, libraries: await page.locator('.kb-row').allTextContents(), documents: restoredDocTexts, failedResponses: requests, runtimeErrors: errors }, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ desktopMetrics, narrowMetrics, errors, requests }, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.();
  await rm(root, { recursive: true, force: true });
}



