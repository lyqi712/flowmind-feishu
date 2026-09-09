import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
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
const execFileAsync = promisify(execFile);

const root = await mkdtemp(join(tmpdir(), 'flowmind-search-sync-experience-'));
const staticDir = join(root, 'dist');
await execFileAsync(process.execPath, [join(projectRoot, 'app', 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', staticDir], {
  cwd: join(projectRoot, 'app'),
  windowsHide: true
});
const runtimeErrors = [];
const app = await createInitializedApp({
  stateFile: join(root, 'state.json'),
  staticDir,
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

function overflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(`console:${message.text()}`); });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });

  // 1. Sync via demo mode lands on the library that has documents.
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByLabel('同步内容').first().click();
  await page.locator('.feishu-wizard').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: '演示模式' }).click();
  await page.getByText('同步完成，本地知识索引已更新', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.fw-result-pane .fw-primary').click();
  const activeLibrary = page.locator('.kb-row.active b');
  await activeLibrary.waitFor({ state: 'visible', timeout: 15000 });
  assert.equal((await activeLibrary.innerText()).trim(), '飞书知识库（Mock）');
  const docRows = page.locator('.doc-row:visible');
  await docRows.first().waitFor({ state: 'visible', timeout: 15000 });
  assert.ok((await docRows.count()) >= 5, 'sync must reveal documents immediately');

  // 2. Global search yields the workspace, then reopens with the same results and opened marker.
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').locator('input[aria-label="全局命令"]').fill('飞书');
  await page.locator('#workspace-command-search').click();
  await page.locator('#workspace-search-results [role="option"]').first().waitFor({ state: 'visible', timeout: 15000 });
  let firstOption = page.locator('#workspace-search-results [role="option"]').first();
  const firstTitle = (await firstOption.locator('b').innerText()).trim();
  await firstOption.click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.unified-workspace-search-panel').count(), 0, 'opening a result must reveal the workspace');
  const returnToSearch = page.getByRole('button', { name: '返回搜索结果', exact: true });
  await returnToSearch.waitFor({ state: 'visible', timeout: 15000 });
  await returnToSearch.click();
  await page.locator('.unified-workspace-search-panel').waitFor({ state: 'visible', timeout: 15000 });
  firstOption = page.locator('#workspace-search-results [role="option"]').first();
  assert.equal(await firstOption.getAttribute('data-search-opened'), 'true');
  assert.equal((await page.locator('[aria-selected="true"]').first().innerText()).trim(), firstTitle);

  let secondOption = page.locator('#workspace-search-results [role="option"]').nth(1);
  const secondTitle = (await secondOption.locator('b').innerText()).trim();
  await secondOption.click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.unified-workspace-search-panel').count(), 0, 'second result must also yield the workspace');
  assert.equal((await page.locator('[aria-selected="true"]').first().innerText()).trim(), secondTitle, 'second result must switch the active tab');
  await returnToSearch.click();
  await page.locator('.unified-workspace-search-panel').waitFor({ state: 'visible', timeout: 15000 });
  secondOption = page.locator('#workspace-search-results [role="option"]').nth(1);
  assert.equal(await secondOption.getAttribute('data-search-opened'), 'true');
  await page.locator('.unified-workspace-search-panel [aria-label="关闭全局搜索"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.unified-workspace-search-panel').count(), 0, 'explicit close hides the search list');

  const overflowByViewport = {};
  for (const [label, width, height] of [['desktop', 1440, 960], ['compact', 1180, 860], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(180);
    overflowByViewport[label] = await overflow(page);
    assert.equal(overflowByViewport[label], 0, `${label} view must not overflow`);
  }
  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({ ok: true, activeLibrary: await activeLibrary.innerText(), documents: await docRows.count(), firstTitle, secondTitle, overflow: overflowByViewport, runtimeErrors }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolveServer => server.close(() => resolveServer()));
  await app.locals.close?.();
  await rm(root, { recursive: true, force: true });
}
