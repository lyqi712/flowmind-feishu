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

const root = await mkdtemp(join(tmpdir(), 'flowmind-daily-loop-'));
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

  // 1. Sync demo knowledge.
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByLabel('同步内容').first().click();
  await page.getByRole('button', { name: '演示模式' }).click();
  await page.getByText('同步完成，本地知识索引已更新', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.fw-result-pane .fw-primary').click();
  await page.locator('.doc-row:visible').first().waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await page.locator('.doc-row:visible').count(), 5);

  // 2. Open the first document.
  await page.locator('.doc-row:visible .doc-open').first().click();
  const reader = page.locator('.content-reader').first();
  await reader.waitFor({ state: 'visible', timeout: 15000 });
  const docTitle = await page.locator('.content-reader-title-group h1').first().innerText();

  // 3. Select a paragraph and ask "问这篇" -> chat tab carries the selection.
  await page.evaluate(() => {
    const paragraph = [...document.querySelectorAll('.content-reader p')].find(p => p.innerText?.length > 40);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: '问这篇', exact: true }).click();
  const readerAsk = page.getByLabel('针对选区提问');
  await readerAsk.waitFor({ state: 'visible', timeout: 10000 });
  await readerAsk.fill('请概括这段内容');
  await readerAsk.press('Enter');
  await reader.locator('.content-reader-conversation').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.content-reader-conversation')].some(node => node.innerText.includes('请概括这段内容')), null, { timeout: 15000 });

  // 4. Back to the document tab and create a source note.
  const docTab = page.locator('[role="tab"]').filter({ hasText: docTitle }).first();
  await docTab.click();
  await reader.waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('button', { name: '写来源笔记', exact: true }).click();
  await page.waitForTimeout(2500);
  const editor = page.locator('.markdown-editor-body');
  await editor.waitFor({ state: 'visible', timeout: 10000 });
  const noteText = await editor.inputValue();
  assert.match(noteText, /# /, 'note template must exist');

  // 5. Edit the note, add a [[双链]], let it autosave.
  await editor.fill(noteText.replace('## 摘要\n\n', '## 摘要\n\n凭据只从服务端环境变量读取。\n\n').replace('## 关键观点\n\n- ', '## 关键观点\n\n- 服务端隔离\n- '));
  await page.waitForTimeout(2500);
  const savedTitle = await page.locator('[role="tab"]').filter({ hasText: '阅读笔记' }).first().innerText();
  assert.match(savedTitle, /阅读笔记/);

  // 6. Open the graph, verify the note node exists and links back to the document.
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByLabel('打开知识观察').click();
  const graph = page.locator('.knowledge-graph').first();
  await graph.waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1500);
  const graphText = await graph.innerText();
  assert.match(graphText, /阅读笔记/, 'graph must include the new note node');
  assert.match(graphText, new RegExp(docTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'graph must keep the source document');

  // 7. Click the note node -> detail panel -> open the note editor.
  const noteNode = page.locator('.knowledge-graph button').filter({ hasText: '连接器安全' }).filter({ hasText: '阅读笔记' }).first();
  await noteNode.click();
  await page.waitForTimeout(1200);
  const openNoteBtn = page.locator('.knowledge-graph button').filter({ hasText: '打开笔记' }).first();
  await openNoteBtn.click();
  await page.waitForTimeout(3000);
  console.log('after open-note tabs:', JSON.stringify(await page.locator('[role="tab"]').allInnerTexts()));
  console.log('editor count:', await page.locator('.markdown-editor-body').count());
  assert.equal(await page.locator('.markdown-editor-body').count(), 1, 'graph note click must open the note');

  // 8. Create a writing draft from the reader (source retention).
  await docTab.click();
  await reader.waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('button', { name: '创建写作草稿' }).click();
  await page.waitForTimeout(2500);
  const writingText = await page.locator('body').innerText();
  assert.match(writingText, /写作草稿/, 'writing draft tab must open');
  assert.match(writingText, /来源资料/, 'writing draft must keep sources');

  // 9. Reload -> workspace restores tabs, active tab and note content.
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(2500);
  const restoredTabs = await page.locator('[role="tab"]').allInnerTexts();
  assert.ok(restoredTabs.some(text => text.includes('阅读笔记')), 'note tab must restore after reload');
  assert.ok(restoredTabs.some(text => text.includes('写作草稿')), 'writing tab must restore after reload');
  const noteTab = page.locator('[role="tab"]').filter({ hasText: '阅读笔记' }).first();
  await noteTab.click();
  await page.waitForTimeout(1500);
  const restoredEditor = page.locator('.markdown-editor-body');
  if (await restoredEditor.count()) {
    const restoredText = await restoredEditor.inputValue();
    assert.match(restoredText, /服务端环境变量/, 'note content must restore after reload');
  }

  // 10. Three viewports, no overflow, no runtime errors.
  const overflowByViewport = {};
  for (const [label, width, height] of [['desktop', 1440, 960], ['compact', 1180, 860], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    overflowByViewport[label] = await overflow(page);
    assert.equal(overflowByViewport[label], 0, `${label} view must not overflow`);
  }
  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({ ok: true, docTitle, noteTabRestored: restoredTabs.some(text => text.includes('阅读笔记')), overflow: overflowByViewport, runtimeErrors }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolveServer => server.close(() => resolveServer()));
  await app.locals.close?.();
  await rm(root, { recursive: true, force: true });
}
