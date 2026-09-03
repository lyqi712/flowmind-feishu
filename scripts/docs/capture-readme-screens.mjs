import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitializedApp } from '../../app/server/app.mjs';
import { createDefaultState } from '../../app/server/state-store.mjs';
import { createFakeModelService } from '../../app/tests/helpers/fake-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const runtimeNodeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
const requireRuntime = createRequire(join(runtimeNodeModules, 'playwright', 'package.json'));
const { chromium } = requireRuntime('playwright');
const shots = join(projectRoot, 'docs', 'screenshots');
await mkdir(shots, { recursive: true });

const root = await mkdtemp(join(tmpdir(), 'flowmind-shots-'));
const stateFile = join(root, 'state.json');
const state = createDefaultState();
await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

const app = await createInitializedApp({
  stateFile,
  staticDir: join(projectRoot, 'app', 'dist'),
  env: {},
  modelService: createFakeModelService({ answer: '发布前先过安全审批，负责人是 Alice [1]。库里两份材料日期不一致时，以有 owner 的那篇为准。' }),
  ocrService: false,
  transcriptionService: false,
  modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
  feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
});
const server = await new Promise(resolveServer => {
  const current = app.listen(0, '127.0.0.1', () => resolveServer(current));
});
const base = `http://127.0.0.1:${server.address().port}`;
await fetch(`${base}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'mock' }) });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(shots, 'home.png'), type: 'png' });

  const ask = page.locator('textarea').first();
  if (await ask.count()) {
    await ask.fill('发布前要完成什么安全审批？');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1800);
    await page.screenshot({ path: join(shots, 'chat.png'), type: 'png' });
  }

  const notes = page.getByRole('button', { name: /笔记/ }).first();
  if (await notes.count()) {
    await notes.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, 'notes.png'), type: 'png' });
  }

  const settings = page.getByRole('button', { name: /设置/ }).first();
  if (await settings.count()) {
    await settings.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, 'settings.png'), type: 'png' });
  }
  console.log(JSON.stringify({ ok: true, dir: shots }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(() => resolveClose()));
  await app.locals.close();
}
