import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitializedApp } from '../../app/server/app.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const requireRuntime = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = requireRuntime('playwright');
const evidenceDir = join(projectRoot, 'evidence');
const screenshotDir = join(evidenceDir, 'browser');
const fixture = join(evidenceDir, 'fixtures', 'audio-transcript-release.wav');
await mkdir(screenshotDir, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'flowmind-audio-browser-'));
const transcript = {
  status: 'completed', provider: 'browser-fixture', language: 'zh', durationMs: 6000,
  segments: [
    { start: 0, end: 2, speaker: 'Alice', confidence: 0.96, text: 'ORBIT AUDIO 发布门禁已经确认。' },
    { start: 2, end: 4, speaker: 'Bob', confidence: 0.94, text: 'Rollback owner 是 FlowMind，需要今天完成验证。' },
    { start: 4, end: 6, speaker: 'Carol', confidence: 0.92, text: '行动项是保存会议纪要并检查移动端。' }
  ]
};
let app;
let server;
let browser;
const consoleErrors = [];
try {
  app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    staticDir: join(projectRoot, 'app', 'dist'),
    ocrService: false,
    transcriptionService: { transcribe: async () => transcript, close: async () => {} },
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
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(`console:${message.text()}`); });
  page.on('pageerror', error => consoleErrors.push(`page:${error.message}`));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '打开全局命令框', exact: true }).click();
  await page.locator('.unified-workspace-command-results button').filter({ hasText: '文档解读' }).click();
  const input = page.locator('input[type=file][accept*=".wav"]');
  await input.waitFor({ state: 'attached', timeout: 15000 });
  await input.setInputFiles(fixture);
  await page.getByText('audio-transcript-release', { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('audio').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('audio')?.readyState > 0, null, { timeout: 15000 });
  assert.equal(await page.locator('.audio-segment-list > button').count(), 3);
  assert.match(await page.locator('.audio-segment-list > button').nth(1).innerText(), /Bob/);
  assert.match(await page.locator('.audio-segment-list > button').nth(1).innerText(), /94%/);
  await page.locator('.audio-segment-list > button').nth(1).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime >= 1.8);
  const segmentSeek = await page.locator('audio').evaluate(audio => audio.currentTime);
  await page.locator('.chunk-list button').nth(1).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime >= 1.8);
  const chunkSeek = await page.locator('audio').evaluate(audio => audio.currentTime);
  const question = page.locator('.document-question textarea');
  await question.fill('Rollback owner 是谁？');
  await page.locator('.document-question button').click();
  const citation = page.locator('.document-answer button').first();
  await citation.waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await citation.innerText(), /00:02–00:04|Rollback owner|FlowMind/);
  await citation.click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime >= 1.8);
  const citationSeek = await page.locator('audio').evaluate(audio => audio.currentTime);
  await page.getByRole('button', { name: '生成本地纪要' }).click();
  const minuteEditors = page.locator('.audio-minutes-field textarea');
  assert.equal(await minuteEditors.count(), 2);
  assert.match(await minuteEditors.nth(0).inputValue(), /ORBIT AUDIO/);
  assert.match(await minuteEditors.nth(1).inputValue(), /行动项|Rollback owner/);
  await page.getByRole('button', { name: '保存为笔记' }).click();
  await page.waitForFunction(async () => (await (await fetch('/api/notes')).json()).total === 1);
  const notes = await page.evaluate(async () => (await (await fetch('/api/notes')).json()).notes);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].sourceRefs[0].anchor, 'time:0-2');
  assert.deepEqual(notes[0].tags, ['会议纪要', '音频']);
  const desktopMetrics = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }));
  assert.equal(desktopMetrics.documentWidth, 1440);
  assert.equal(desktopMetrics.bodyWidth, 1440);
  await page.screenshot({ path: join(screenshotDir, 'audio-transcript-desktop.png'), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobileMetrics = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }));
  assert.equal(mobileMetrics.documentWidth, 390);
  assert.equal(mobileMetrics.bodyWidth, 390);
  assert.equal(await page.locator('.audio-minutes-save').isVisible(), true);
  await page.screenshot({ path: join(screenshotDir, 'audio-transcript-mobile-390x844.png'), fullPage: false });
  assert.deepEqual(consoleErrors, []);
  const result = {
    ok: true,
    verifiedAt: new Date().toISOString(),
    viewportDesktop: '1440x960',
    viewportMobile: '390x844',
    formats: ['mp3', 'm4a', 'wav', 'aac'],
    segments: 3,
    segmentSeek,
    chunkSeek,
    citationSeek,
    citationAnchor: 'time:2-4',
    activeSpeaker: 'Bob',
    confidenceLabel: '94%',
    minutesGenerated: true,
    noteSaved: { id: notes[0].id, sourceAnchor: notes[0].sourceRefs[0].anchor, tags: notes[0].tags },
    desktopMetrics,
    mobileMetrics,
    consoleErrors,
    screenshots: ['evidence/browser/audio-transcript-desktop.png', 'evidence/browser/audio-transcript-mobile-390x844.png']
  };
  await writeFile(join(evidenceDir, 'audio-transcript-browser-acceptance.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}