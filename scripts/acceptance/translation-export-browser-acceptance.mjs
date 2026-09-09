import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInitializedApp } from '../../app/server/app.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const requireRuntime = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = requireRuntime('playwright');
const evidenceDir = join(projectRoot, 'evidence');
const screenshotDir = join(evidenceDir, 'browser');
const desktopScreenshot = join(screenshotDir, 'translation-export-desktop.png');
const mobileScreenshot = join(screenshotDir, 'translation-export-mobile-390x844.png');
const evidenceFile = join(evidenceDir, 'translation-export-browser-acceptance.json');
const root = await mkdtemp(join(tmpdir(), 'flowmind-translation-export-browser-'));
const downloadDir = join(root, 'downloads');
const fixtureName = 'translation-export-release.md';
const fixtureTitle = 'Translation Export Acceptance';
const unsafeMarker = '<script>window.__flowmindInjected=true</script>';
const markdownFixture = `# ${fixtureTitle}\n第一段：Release owner 是 FlowMind，发布门禁必须保留可点击引用。\n\n第二段：Mobile acceptance 需要在 390x844 下保持单栏且没有横向溢出。\n\n第三段：HTML export 必须把 ${unsafeMarker} 当作普通文本安全转义。`;
const glossary = 'Release owner=发布负责人\nFlowMind=FlowMind\nHTML export=HTML 导出';
const editedTranslation = 'EDITED_TRANSLATION_OWNER: FlowMind owns the release gate.';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function monitorPage(page, errors, monitoredPages) {
  if (monitoredPages.has(page)) return;
  monitoredPages.add(page);
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  page.on('pageerror', error => errors.push(`page:${error.message}`));
}

async function viewportMetrics(page) {
  return page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));
}

function assertNoHorizontalOverflow(metrics, expectedWidth) {
  assert.equal(metrics.viewportWidth, expectedWidth);
  assert.ok(metrics.documentScrollWidth <= metrics.documentClientWidth, `document overflow: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.bodyScrollWidth <= metrics.viewportWidth, `body overflow: ${JSON.stringify(metrics)}`);
}

async function gridColumnCount(locator) {
  return locator.evaluate(element => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length);
}

async function captureDownload(page, downloadDir, name, click, { extension, contains = [], excludes = [] } = {}) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    click()
  ]);
  const failure = await download.failure();
  assert.equal(failure, null, `${name} download failed: ${failure}`);
  const suggestedFileName = download.suggestedFilename();
  assert.equal(extname(suggestedFileName).toLowerCase(), extension, `${name} extension`);
  const target = join(downloadDir, `${name}${extension}`);
  await download.saveAs(target);
  const bytes = await readFile(target);
  const text = bytes.toString('utf8');
  assert.ok(bytes.length > 40, `${name} should not be empty`);
  for (const expected of contains) assert.ok(text.includes(expected), `${name} should contain ${JSON.stringify(expected)}`);
  for (const forbidden of excludes) assert.ok(!text.includes(forbidden), `${name} should exclude ${JSON.stringify(forbidden)}`);
  return {
    name,
    path: target,
    suggestedFileName,
    extension,
    byteLength: bytes.length,
    sha256: sha256(bytes),
    text
  };
}

async function reopenHtml(context, artifact, expectedText) {
  const page = await context.newPage();
  try {
    await page.goto(pathToFileURL(artifact.path).href, { waitUntil: 'load' });
    const safety = await page.evaluate(() => ({
      scriptCount: document.scripts.length,
      injected: globalThis.__flowmindInjected === true,
      text: document.body.innerText,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth
    }));
    assert.equal(safety.scriptCount, 0, `${artifact.name} must not create script elements`);
    assert.equal(safety.injected, false, `${artifact.name} must not execute exported content`);
    assert.ok(safety.text.includes(expectedText), `${artifact.name} should reopen with expected text`);
    assert.ok(safety.documentScrollWidth <= safety.documentClientWidth, `${artifact.name} reopened with horizontal overflow`);
    return { name: artifact.name, scriptCount: safety.scriptCount, injected: safety.injected, reopened: true };
  } finally {
    await page.close();
  }
}

await mkdir(screenshotDir, { recursive: true });
await mkdir(downloadDir, { recursive: true });

let app;
let server;
let browser;
const runtimeErrors = [];
const monitoredPages = new WeakSet();
try {
  app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    staticDir: join(projectRoot, 'app', 'dist'),
    ocrService: false,
    transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  context.on('page', page => monitorPage(page, runtimeErrors, monitoredPages));
  const page = await context.newPage();
  monitorPage(page, runtimeErrors, monitoredPages);

  const response = await page.goto(baseUrl, { waitUntil: 'networkidle' });
  assert.equal(response?.ok(), true, `FlowMind UI failed to load from ${baseUrl}`);
  await page.getByRole('button', { name: '打开全局命令框', exact: true }).click();
  await page.getByRole('option', { name: /文档解读/ }).click();

  const uploadInput = page.locator('input[type=file][accept*=".md"]');
  await uploadInput.setInputFiles({
    name: fixtureName,
    mimeType: 'text/markdown',
    buffer: Buffer.from(markdownFixture, 'utf8')
  });
  await page.getByText(fixtureTitle, { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
  const imported = await page.evaluate(async title => {
    const data = await (await fetch('/api/content/items?limit=300')).json();
    return data.items.find(item => item.title === title);
  }, fixtureTitle);
  assert.ok(imported?.id, 'three-paragraph Markdown fixture should be imported');

  await page.getByRole('button', { name: '对照翻译', exact: true }).click();
  await page.getByLabel('源语言').selectOption({ label: '简体中文' });
  await page.getByLabel('目标语言').selectOption({ label: 'English' });
  await page.getByLabel('翻译引擎').selectOption('local');
  await page.getByLabel('术语表').fill(glossary);
  await page.getByRole('button', { name: '生成对照翻译', exact: true }).click();

  const rows = page.locator('.translation-table article');
  await rows.first().waitFor({ state: 'visible', timeout: 20000 });
  assert.equal(await rows.count(), 3, 'Markdown fixture should generate exactly three translation rows');
  assert.equal(await gridColumnCount(rows.first()), 2, 'desktop translation workbench should use two columns');
  await page.getByText('当前为离线可编辑草稿', { exact: true }).waitFor({ state: 'visible' });

  const targetEditors = page.locator('.translation-target textarea');
  await targetEditors.nth(0).fill(editedTranslation);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.waitForFunction(async expected => {
    const data = await (await fetch('/api/translations')).json();
    return data.translations?.[0]?.segments?.[0]?.translatedText === expected;
  }, editedTranslation);

  const persistedBeforeRefresh = await page.evaluate(async documentId => {
    const data = await (await fetch(`/api/translations?documentId=${encodeURIComponent(documentId)}`)).json();
    return data.translations?.[0];
  }, imported.id);
  assert.equal(persistedBeforeRefresh.targetLanguage, 'English');
  assert.equal(persistedBeforeRefresh.sourceLanguage, '简体中文');
  assert.equal(persistedBeforeRefresh.provider, 'local');
  assert.equal(persistedBeforeRefresh.glossary, glossary);
  assert.equal(persistedBeforeRefresh.segments.length, 3);
  assert.equal(persistedBeforeRefresh.segments[0].translatedText, editedTranslation);
  assert.ok(persistedBeforeRefresh.segments.every(segment => segment.anchor), 'every translation row should retain an anchor');

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '打开全局命令框', exact: true }).click();
  await page.getByRole('option', { name: /文档解读/ }).click();
  const importedListRow = page.locator('.analysis-list button').filter({ hasText: fixtureTitle }).first();
  await importedListRow.waitFor({ state: 'visible', timeout: 20000 });
  await importedListRow.click();
  await page.locator('.analysis-workspace > .workspace-head').getByText(fixtureTitle, { exact: true }).waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForFunction(async ({ documentId, translationId, expectedText }) => {
    const response = await fetch(`/api/translations?documentId=${encodeURIComponent(documentId)}`);
    if (!response.ok) return false;
    const data = await response.json();
    const restored = data.translations?.find(item => item.id === translationId);
    return restored?.segments?.[0]?.translatedText === expectedText;
  }, { documentId: imported.id, translationId: persistedBeforeRefresh.id, expectedText: editedTranslation }, { timeout: 20000 });
  await page.getByRole('button', { name: '对照翻译', exact: true }).click();
  const restoredRows = page.locator('.translation-table article');
  await restoredRows.first().waitFor({ state: 'visible', timeout: 20000 });
  assert.equal(await restoredRows.count(), 3);
  assert.equal(await page.getByLabel('历史版本').inputValue(), persistedBeforeRefresh.id);
  assert.equal(await page.getByLabel('源语言').inputValue(), '简体中文');
  assert.equal(await page.getByLabel('目标语言').inputValue(), 'English');
  assert.equal(await page.getByLabel('翻译引擎').inputValue(), 'local');
  assert.equal(await page.getByLabel('术语表').inputValue(), glossary);
  assert.equal(await page.locator('.translation-target textarea').first().inputValue(), editedTranslation);

  const anchor = persistedBeforeRefresh.segments[0].anchor;
  const anchorRow = restoredRows.first();
  const anchorButton = anchorRow.locator('.translation-source');
  const anchorLabel = anchorButton.locator('small');
  await anchorLabel.waitFor({ state: 'visible', timeout: 10000 });
  assert.ok((await anchorLabel.innerText()).includes(anchor), 'restored translation row should expose its persisted anchor');
  await anchorButton.click();
  assert.equal(await anchorButton.evaluate(element => document.activeElement === element), true, 'anchor source button click should complete and retain keyboard focus');

  const desktopMetrics = await viewportMetrics(page);
  assertNoHorizontalOverflow(desktopMetrics, 1440);
  assert.equal(await gridColumnCount(anchorRow), 2, 'desktop translation row should remain two-column after persistence reload');
  await page.screenshot({ path: desktopScreenshot, fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobileMetrics = await viewportMetrics(page);
  assertNoHorizontalOverflow(mobileMetrics, 390);
  assert.equal(await gridColumnCount(anchorRow), 1, '390px translation row should collapse to one column');
  assert.equal(await page.getByRole('button', { name: '保存修改', exact: true }).isVisible(), true);
  await page.screenshot({ path: mobileScreenshot, fullPage: false });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForTimeout(150);

  const documentHeaderActions = page.locator('.analysis-workspace > .workspace-head .head-actions');
  const translationActions = page.locator('.translation-actions');
  const artifacts = {};
  artifacts.documentMarkdown = await captureDownload(page, downloadDir, 'document-markdown', () => documentHeaderActions.getByRole('button', { name: 'MD', exact: true }).click(), {
    extension: '.md', contains: [fixtureTitle, 'Release owner', unsafeMarker]
  });
  artifacts.documentHtml = await captureDownload(page, downloadDir, 'document-html', () => documentHeaderActions.getByRole('button', { name: 'HTML', exact: true }).click(), {
    extension: '.html', contains: [fixtureTitle, 'Release owner', '&lt;script&gt;window.__flowmindInjected=true&lt;/script&gt;'], excludes: [unsafeMarker]
  });
  artifacts.translationMarkdown = await captureDownload(page, downloadDir, 'translation-markdown', () => translationActions.getByRole('button', { name: 'Markdown', exact: true }).click(), {
    extension: '.md', contains: [fixtureTitle, '**原文**', '**译文**', editedTranslation, anchor]
  });
  artifacts.translationHtml = await captureDownload(page, downloadDir, 'translation-html', () => translationActions.getByRole('button', { name: 'HTML', exact: true }).click(), {
    extension: '.html', contains: [fixtureTitle, '原文', '译文', editedTranslation, '&lt;script&gt;window.__flowmindInjected=true&lt;/script&gt;'], excludes: [unsafeMarker]
  });

  await page.locator('.translation-close').click();
  const question = page.locator('.document-question textarea');
  await question.fill('Release owner 是谁？请引用原文说明 HTML export 的安全要求。');
  await page.locator('.document-question button').click();
  const answerActions = page.locator('.answer-export-actions');
  await answerActions.waitFor({ state: 'visible', timeout: 20000 });
  const answerText = await page.locator('.document-answer > p').innerText();
  assert.ok(answerText.trim().length > 20, 'document answer should contain generated local retrieval text');
  assert.ok(await page.locator('.document-answer button').count() > 0, 'document answer should contain at least one citation');
  artifacts.answerMarkdown = await captureDownload(page, downloadDir, 'answer-markdown', () => answerActions.getByRole('button', { name: '导出回答 MD', exact: true }).click(), {
    extension: '.md', contains: [fixtureTitle, answerText.trim().slice(0, 24), '来源引用']
  });
  artifacts.answerHtml = await captureDownload(page, downloadDir, 'answer-html', () => answerActions.getByRole('button', { name: '导出回答 HTML', exact: true }).click(), {
    extension: '.html', contains: [fixtureTitle, answerText.trim().slice(0, 24), '来源引用'], excludes: [unsafeMarker]
  });

  const note = await page.evaluate(async ({ unsafeMarker }) => {
    const response = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Translation Export Acceptance Note',
        content: `# Daily workflow note\n\nSaved translation is ready.\n\n${unsafeMarker}`,
        tags: ['translation', 'acceptance']
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
    return data.note;
  }, { unsafeMarker });
  assert.ok(note?.id);

  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await page.getByText(note.title, { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 });
  const noteHeaderActions = page.locator('.module-workspace > .workspace-head .head-actions').first();
  artifacts.noteMarkdown = await captureDownload(page, downloadDir, 'note-markdown', () => noteHeaderActions.getByRole('button', { name: 'MD', exact: true }).click(), {
    extension: '.md', contains: [note.title, 'Daily workflow note', unsafeMarker]
  });
  artifacts.noteHtml = await captureDownload(page, downloadDir, 'note-html', () => noteHeaderActions.getByRole('button', { name: 'HTML', exact: true }).click(), {
    extension: '.html', contains: [note.title, 'Daily workflow note', '&lt;script&gt;window.__flowmindInjected=true&lt;/script&gt;'], excludes: [unsafeMarker]
  });

  const htmlSafety = [];
  htmlSafety.push(await reopenHtml(context, artifacts.documentHtml, fixtureTitle));
  htmlSafety.push(await reopenHtml(context, artifacts.translationHtml, editedTranslation));
  htmlSafety.push(await reopenHtml(context, artifacts.answerHtml, fixtureTitle));
  htmlSafety.push(await reopenHtml(context, artifacts.noteHtml, note.title));

  assert.deepEqual(runtimeErrors, []);
  const result = {
    ok: true,
    verifiedAt: new Date().toISOString(),
    fixture: { fileName: fixtureName, title: fixtureTitle, paragraphs: 3 },
    translation: {
      id: persistedBeforeRefresh.id,
      mode: 'local-editable-draft',
      segments: persistedBeforeRefresh.segments.length,
      anchor,
      anchorClickVerified: true,
      anchorClickSignal: 'persisted API + exact anchor label + source button focus',
      editedTextPersisted: true,
      sourceLanguage: persistedBeforeRefresh.sourceLanguage,
      targetLanguage: persistedBeforeRefresh.targetLanguage,
      provider: persistedBeforeRefresh.provider,
      glossary: persistedBeforeRefresh.glossary
    },
    exports: Object.fromEntries(Object.entries(artifacts).map(([key, artifact]) => [key, {
      fileName: artifact.suggestedFileName,
      extension: artifact.extension,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256
    }])),
    htmlSafety,
    viewportDesktop: '1440x960',
    viewportMobile: '390x844',
    desktopMetrics,
    mobileMetrics,
    runtimeErrors,
    screenshots: [
      'evidence/browser/translation-export-desktop.png',
      'evidence/browser/translation-export-mobile-390x844.png'
    ]
  };
  await writeFile(evidenceFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}