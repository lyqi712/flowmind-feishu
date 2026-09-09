import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
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
const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'flowmind-knowledge-graph-'));
const staticDir = join(root, 'dist');
const evidenceDir = join(projectRoot, 'evidence', 'agent-graph');
const stateFile = join(root, 'state.json');
const sourceState = createDefaultState();
const runtimeErrors = [];
const screenshots = {
  desktop: join(evidenceDir, 'knowledge-graph-1440.png'),
  compact: join(evidenceDir, 'knowledge-graph-1180.png'),
  mobile: join(evidenceDir, 'knowledge-graph-390.png')
};

sourceState.conversations = [];
sourceState.documents = [
  { id: 'graph-target', title: 'Graph Target', content: '# Evidence\n\nThe source document provides a verifiable anchor.', tags: ['graph'], updatedAt: new Date().toISOString() },
  { id: 'graph-unrelated', title: 'Unrelated document', content: 'This shares no explicit relation.', tags: ['other'], updatedAt: new Date().toISOString() }
];
sourceState.notes = [
  {
    id: 'graph-source-note', title: 'Graph Source Note', content: '[[Graph Target#Evidence|target evidence]]\n\n[[02-Areas/Area Name]]',
    sourceRefs: [{ documentId: 'graph-target', title: 'Graph Target', anchor: 'heading:evidence:1', provenance: { kind: 'explicit' } }],
    tags: ['graph'], archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }
];
sourceState.writingDrafts = [];
sourceState.skillRuns = [];
sourceState.settings = { ...(sourceState.settings || {}), model: { provider: 'local', model: 'local-retrieval' } };
await writeFile(stateFile, JSON.stringify(sourceState, null, 2) + '\n', 'utf8');
await mkdir(evidenceDir, { recursive: true });
await execFileAsync(process.execPath, [join(projectRoot, 'app', 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', staticDir], {
  cwd: join(projectRoot, 'app'),
  windowsHide: true
});

let app;
let server;
let browser;
try {
  app = await createInitializedApp({
    stateFile,
    staticDir,
    env: {},
    ocrService: false,
    transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const initialGraph = await (await fetch(`${base}/api/graph`)).json();
  assert.equal(initialGraph.graph.edges.some(edge => edge.type === 'semantic'), false);
  assert.equal(initialGraph.graph.nodes.some(node => /Area Name/.test(node.title)), false);
  const sourceNode = initialGraph.graph.nodes.find(node => node.sourceId === 'graph-source-note');
  const targetNode = initialGraph.graph.nodes.find(node => node.title === 'Graph Target');
  assert.ok(sourceNode && targetNode);
  const proposal = await fetch(`${base}/api/graph/suggestions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceNodeId: sourceNode.id, targetNodeId: targetNode.id, reason: 'Evidence-backed suggestion', evidence: [{ documentId: 'graph-target', anchor: 'heading:evidence:1' }] })
  });
  assert.equal(proposal.status, 201);
  const approvePayload = await proposal.json();
  const approveSuggestionId = approvePayload.suggestion?.id;
  assert.ok(approveSuggestionId);

  const ignoreProposal = await fetch(`${base}/api/graph/suggestions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceNodeId: targetNode.id, targetNodeId: sourceNode.id, reason: 'Should be ignored suggestion', evidence: [] })
  });
  assert.equal(ignoreProposal.status, 201);
  const ignorePayload = await ignoreProposal.json();
  const ignoreSuggestionId = ignorePayload.suggestion?.id;
  assert.ok(ignoreSuggestionId);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(`console:${message.text()}`); });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  page.on('requestfailed', request => runtimeErrors.push(`failed:${request.url()}`));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.unified-workspace-primary-nav').locator('button').nth(1).click();
  const graphTrigger = page.locator('button[title="打开知识观察"]');
  await graphTrigger.waitFor({ state: 'visible', timeout: 15000 });
  await graphTrigger.click();
  const graph = page.locator('[aria-label="知识观察"]');
  await graph.waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('[data-graph-renderer="sigma"] canvas').first().waitFor({ state: 'visible', timeout: 15000 });

  const overview = page.locator('[aria-label="关系概览"]');
  await overview.waitFor({ state: 'visible', timeout: 10000 });
  const suggestionSection = overview.locator('[aria-label="待确认关系"]');
  await suggestionSection.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await suggestionSection.getByRole('button', { name: '确认写入图谱' }).count(), 2);
  const approveRow = suggestionSection.locator('p', { hasText: 'Evidence-backed suggestion' }).locator('xpath=..');
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/graph/suggestions/') && response.url().includes('/decision') && response.ok(), { timeout: 15000 }),
    approveRow.getByRole('button', { name: '确认写入图谱' }).click()
  ]);
  await page.waitForFunction(() => /已确认建议|关系已写入图谱/.test(document.body.textContent), null, { timeout: 15000 });
  const graphAfterApprove = await page.evaluate(async () => (await (await fetch('/api/graph?suggestions=true')).json()).graph);
  assert.ok(graphAfterApprove.edges.some(edge => edge.createdSource === 'suggestion-approved' || edge.label === 'Evidence-backed suggestion'));

  const ignoreRow = suggestionSection.locator('p', { hasText: 'Should be ignored suggestion' }).locator('xpath=..');
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/graph/suggestions/') && response.url().includes('/decision') && response.ok(), { timeout: 15000 }),
    ignoreRow.getByRole('button', { name: '忽略' }).click()
  ]);
  await page.waitForFunction(() => document.body.textContent.includes('已忽略'), null, { timeout: 15000 });
  const graphAfterIgnore = await page.evaluate(async () => (await (await fetch('/api/graph?suggestions=true')).json()).graph);
  assert.ok(!graphAfterIgnore.suggestions.some(item => item.id === ignoreSuggestionId));

  const graphGeometry = await page.evaluate(() => {
    const rect = selector => { const node = document.querySelector(selector); const value = node?.getBoundingClientRect(); return value ? { left: value.left, right: value.right, width: value.width } : null; };
    const graph = document.querySelector('[aria-label="知识观察"]');
    const layout = graph?.closest('.unified-workspace-layout');
    return {
      graph: rect('[aria-label="知识观察"]'),
      header: rect('.knowledge-graph-header'),
      heading: rect('.knowledge-graph-heading'),
      stage: rect('.unified-workspace-stage'),
      scrollLeft: layout?.scrollLeft || 0,
      scrollWidth: layout?.scrollWidth || 0,
      clientWidth: layout?.clientWidth || 0
    };
  });
  assert.ok(graphGeometry.heading.left >= graphGeometry.header.left, `graph heading is clipped: ${JSON.stringify(graphGeometry)}`);
  assert.ok(graphGeometry.graph.left >= graphGeometry.stage.left, `graph frame escapes its workspace: ${JSON.stringify(graphGeometry)}`);
  assert.ok(await page.locator('.knowledge-graph-edge').count() > 0, 'compatibility graph edge contract should remain available');
  assert.equal(await graph.getByRole('button', { name: /AI 建议/ }).count(), 0, 'AI suggestions stay out of the main graph surface');
  assert.ok(await graph.getByRole('button', { name: /证据工作台/ }).count() > 0);
  await page.screenshot({ path: screenshots.desktop, fullPage: false });

  const sigmaLayer = page.locator('[data-graph-renderer="sigma"]');
  const waitForGraphHits = async () => {
    await page.waitForFunction(() => {
      try {
        const hits = JSON.parse(document.querySelector('[data-graph-renderer="sigma"]')?.dataset.graphHits || '{}');
        return Object.keys(hits).length > 0;
      } catch {
        return false;
      }
    }, { timeout: 15000 });
    return page.evaluate(() => JSON.parse(document.querySelector('[data-graph-renderer="sigma"]')?.dataset.graphHits || '{}'));
  };
  const clickGraphNode = async (nodeId, clicks = 1) => {
    const hits = await waitForGraphHits();
    const hit = hits[nodeId];
    assert.ok(hit, `missing graph hit for ${nodeId}: ${JSON.stringify(hits)}`);
    const box = await sigmaLayer.boundingBox();
    assert.ok(box, 'sigma layer is not measurable');
    const x = box.x + hit.x;
    const y = box.y + hit.y;
    if (clicks === 2) {
      await page.mouse.click(x, y, { delay: 40 });
      await page.mouse.click(x, y, { delay: 40 });
      return;
    }
    await page.mouse.click(x, y);
  };
  const noteTitle = page.locator('.module-workspace .workspace-title strong');
  const documentTitle = page.locator('.content-reader-title-group h1');

  await clickGraphNode(sourceNode.id, 1);
  const inspector = page.locator('[aria-label="关系侧栏"]');
  await inspector.waitFor({ state: 'visible', timeout: 10000 });
  assert.match(await inspector.innerText(), /Graph Source Note/);
  assert.equal(await page.locator('[data-graph-renderer="sigma"]').getAttribute('data-selected-node-id'), sourceNode.id);
  assert.equal(await page.locator('[aria-label="Graph Source Note阅读器"]').count(), 0);
  assert.equal(await noteTitle.count(), 0);
  await page.waitForTimeout(250);

  await clickGraphNode(sourceNode.id, 2);
  if (await page.locator('[aria-label="知识观察"]').count()) {
    await inspector.getByRole('button', { name: '打开笔记' }).click();
  }
  await noteTitle.waitFor({ state: 'visible', timeout: 15000 });
  assert.equal((await noteTitle.innerText()).trim(), 'Graph Source Note');
  assert.equal(await page.locator('[aria-label="知识观察"]').count(), 0);

  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await graphTrigger.waitFor({ state: 'visible', timeout: 15000 });
  await graphTrigger.click();
  await graph.waitFor({ state: 'visible', timeout: 15000 });
  await sigmaLayer.waitFor({ state: 'visible', timeout: 15000 });
  await clickGraphNode(targetNode.id, 1);
  await inspector.waitFor({ state: 'visible', timeout: 10000 });
  assert.match(await inspector.innerText(), /Graph Target/);
  assert.equal(await page.locator('[aria-label="Graph Target阅读器"]').count(), 0);

  await clickGraphNode(targetNode.id, 2);
  if (await page.locator('[aria-label="知识观察"]').count()) {
    await inspector.getByRole('button', { name: '打开文档' }).click();
  }
  await page.locator('[aria-label="Graph Target阅读器"]').waitFor({ state: 'visible', timeout: 15000 });
  assert.equal((await documentTitle.innerText()).trim(), 'Graph Target');
  assert.equal(await page.locator('[aria-label="知识观察"]').count(), 0);
  await page.getByRole('button', { name: '关闭阅读器' }).click();

  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await graphTrigger.waitFor({ state: 'visible', timeout: 15000 });
  await graphTrigger.click();
  await graph.waitFor({ state: 'visible', timeout: 15000 });
  const overviewPanel = page.locator('[aria-label="关系概览"]');
  await overviewPanel.waitFor({ state: 'visible', timeout: 10000 });
  await overviewPanel.locator('.knowledge-graph-overview-list button').first().click();
  await inspector.waitFor({ state: 'visible', timeout: 10000 });
  assert.match(await inspector.innerText(), /Graph Target|Graph Source Note/);
  await page.setViewportSize({ width: 1180, height: 860 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: screenshots.compact, fullPage: false });
  const compactMetrics = await page.evaluate(() => ({ width: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(compactMetrics.scroll <= compactMetrics.client);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.locator('[aria-label="知识观察"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.screenshot({ path: screenshots.mobile, fullPage: false });
  const mobileMetrics = await page.evaluate(() => ({ width: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(mobileMetrics.scroll <= mobileMetrics.client);
  assert.deepEqual(runtimeErrors, []);

  const result = {
    ok: true,
    graph: initialGraph.graph.stats,
    graphGeometry,
    desktop: compactMetrics,
    mobile: mobileMetrics,
    clickContract: {
      singleClickSelects: true,
      doubleClickOpensNote: true,
      doubleClickOpensDocument: true,
      suggestionConfirmWritesEdge: true,
      suggestionIgnoreRejects: true
    },
    runtimeErrors,
    screenshots: Object.values(screenshots).map(file => file.replace(projectRoot + '\\', '').replaceAll('\\', '/'))
  };
  await writeFile(join(evidenceDir, 'knowledge-graph-browser-acceptance.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
