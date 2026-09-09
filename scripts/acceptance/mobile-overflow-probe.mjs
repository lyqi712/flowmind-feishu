import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitializedApp } from '../../app/server/app.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const runtimeNodeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
const requireRuntime = createRequire(join(runtimeNodeModules, 'playwright', 'package.json'));
const { chromium } = requireRuntime('playwright');

const root = await mkdtemp(join(tmpdir(), 'flowmind-mobile-probe-'));
const runtimeErrors = [];
const app = await createInitializedApp({
  stateFile: join(root, 'state.json'),
  staticDir: join(projectRoot, 'app', 'dist'),
  env: {},
  ocrService: false,
  transcriptionService: false,
  modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
  feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') },
  workspaceSyncOptions: { secretFile: join(root, 'sync.enc'), masterKeyFile: join(root, 'sync.key'), relayFile: join(root, 'relay.json') }
});
const server = await new Promise((resolveServer, reject) => {
  const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
  instance.once('error', reject);
});
const base = `http://127.0.0.1:${server.address().port}`;
const overflow = page => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(`console:${message.text()}`); });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });

  // Desktop setup: open knowledge, run demo sync, open reader + writing draft + notes + graph tabs.
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByLabel('同步内容').first().click();
  await page.locator('.feishu-wizard').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: '演示模式' }).click();
  await page.getByText('同步完成，本地知识索引已更新', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.fw-result-pane .fw-primary').click();
  await page.locator('.doc-row').first().waitFor({ state: 'visible', timeout: 15000 });

  await page.locator('.doc-row .doc-open').first().click();
  await page.locator('.content-reader').first().waitFor({ state: 'visible', timeout: 15000 });
  const writeBtn = page.getByRole('button', { name: '创建写作草稿' });
  if (await writeBtn.count()) { await writeBtn.click(); await page.waitForTimeout(2000); }
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByLabel('打开知识观察').click();
  await page.locator('.knowledge-graph').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1500);

  const measure = async () => ({ overflow: await overflow(page), w: await page.evaluate(() => window.innerWidth) });
  const views = {};
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  views.graph = await measure();

  const homeTab = page.getByRole('tab', { name: '首页', exact: true });
  if (await homeTab.count()) { await homeTab.click(); await page.waitForTimeout(400); views.home = await measure(); }

  const contributors = await page.evaluate(() => {
    const vw = window.innerWidth;
    return [...document.querySelectorAll('body *')].map(el => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, cls: String(el.className || '').slice(0, 60), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
    }).filter(x => x.right > vw + 2 || x.left < -2).sort((a, b) => b.right - a.right).slice(0, 10);
  });

  console.log(JSON.stringify({ ok: true, views, contributors, runtimeErrors }, null, 2));
  for (const [view, value] of Object.entries(views)) assert.equal(value.overflow, 0, `${view} must not overflow at 390px`);
  assert.deepEqual(runtimeErrors, []);
} finally {
  await browser?.close();
  await new Promise(resolveServer => server.close(() => resolveServer()));
  await app.locals.close?.();
  await rm(root, { recursive: true, force: true });
}
