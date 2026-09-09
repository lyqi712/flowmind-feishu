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
const root = await mkdtemp(join(tmpdir(), 'flowmind-deep-suggestion-'));
const staticDir = join(root, 'dist');
const evidenceDir = join(projectRoot, 'evidence', 'agent-graph');
const stateFile = join(root, 'state.json');
const runtimeErrors = [];
const now = new Date().toISOString();
const conversationId = 'conv_deep_suggestion_fixture';
const screenshots = {
  desktop: join(evidenceDir, 'deep-answer-suggestion-1440.png')
};

const sourceState = createDefaultState();
sourceState.conversations = [];
sourceState.documents = [
  { id: 'graph-target', title: 'Graph Target', content: '# Evidence\n\nThe source document provides a verifiable anchor.', tags: ['graph'], updatedAt: now },
  { id: 'graph-unrelated', title: 'Unrelated document', content: 'This shares no explicit relation.', tags: ['other'], updatedAt: now }
];
sourceState.notes = [
  {
    id: 'graph-source-note', title: 'Graph Source Note', content: '[[Graph Target#Evidence|target evidence]]',
    sourceRefs: [{ documentId: 'graph-target', title: 'Graph Target', anchor: 'heading:evidence:1', provenance: { kind: 'explicit' } }],
    tags: ['graph'], archived: false, createdAt: now, updatedAt: now
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
let approveSuggestionId;
let ignoreSuggestionId;

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
  const sourceNode = initialGraph.graph.nodes.find(node => node.sourceId === 'graph-source-note');
  const targetNode = initialGraph.graph.nodes.find(node => node.title === 'Graph Target');
  assert.ok(sourceNode && targetNode);

  const approveProposal = await fetch(`${base}/api/graph/suggestions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceNodeId: sourceNode.id, targetNodeId: targetNode.id, reason: 'Deep answer suggestion', evidence: [{ documentId: 'graph-target', anchor: 'heading:evidence:1' }] })
  });
  assert.equal(approveProposal.status, 201);
  approveSuggestionId = (await approveProposal.json()).suggestion.id;

  const ignoreProposal = await fetch(`${base}/api/graph/suggestions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceNodeId: targetNode.id, targetNodeId: sourceNode.id, reason: 'Deep answer ignore', evidence: [] })
  });
  assert.equal(ignoreProposal.status, 201);
  ignoreSuggestionId = (await ignoreProposal.json()).suggestion.id;

  const graphSuggestions = [
    {
      id: approveSuggestionId,
      sourceTitle: 'Graph Source Note',
      targetTitle: 'Graph Target',
      reason: 'Deep answer suggestion',
      status: 'pending',
      sourceNodeId: sourceNode.id,
      targetNodeId: targetNode.id
    },
    {
      id: ignoreSuggestionId,
      sourceTitle: 'Graph Target',
      targetTitle: 'Graph Source Note',
      reason: 'Deep answer ignore',
      status: 'pending',
      sourceNodeId: targetNode.id,
      targetNodeId: sourceNode.id
    }
  ];

  await app.locals.store.update(state => {
    state.conversations = [{
      id: conversationId,
      title: '这两篇有什么关系？',
      question: '这两篇有什么关系？',
      messages: [
        { id: 'msg-user-1', role: 'user', content: '这两篇有什么关系？', mode: 'auto', documentIds: [], createdAt: now },
        {
          id: 'msg-assistant-1',
          role: 'assistant',
          content: 'Graph Source Note 通过证据段落指向 Graph Target，可以写成图谱里的一条显式关系。',
          citations: [{ documentId: 'graph-target', title: 'Graph Target', anchor: 'heading:evidence:1' }],
          relations: {
            graphSuggestions,
            relatedDocuments: [
              { documentId: 'graph-source-note', title: 'Graph Source Note', score: 8 },
              { documentId: 'graph-target', title: 'Graph Target', score: 8 }
            ]
          },
          mode: 'auto',
          documentIds: [],
          createdAt: now
        }
      ],
      createdAt: now,
      updatedAt: now,
      archived: false
    }];
  });

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(`console:${message.text()}`); });
  page.on('pageerror', error => runtimeErrors.push(`page:${error.message}`));
  page.on('requestfailed', request => runtimeErrors.push(`failed:${request.url()}`));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.unified-workspace-primary-nav').locator('button').nth(1).click();
  await page.getByRole('button', { name: '历史', exact: true }).click();
  await page.locator('.history-panel').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('.history-panel > button').filter({ hasText: '这两篇有什么关系？' }).click();

  const deepPanel = page.locator('[aria-label="深度回答分析"]');
  await deepPanel.waitFor({ state: 'visible', timeout: 15000 });
  await deepPanel.locator('.deep-answer-extras > summary, .deep-answer-header').first().click();
  const suggestionSection = deepPanel.locator('[aria-label="待确认关系"]');
  await suggestionSection.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await suggestionSection.getByRole('button', { name: '确认写入图谱' }).count(), 2);

  const approveRow = suggestionSection.locator('.deep-answer-graph-suggestion').filter({ hasText: 'Deep answer suggestion' });
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/graph/suggestions/') && response.url().includes('/decision') && response.ok(), { timeout: 15000 }),
    approveRow.getByRole('button', { name: '确认写入图谱' }).click()
  ]);
  await page.waitForFunction(() => /已确认建议|关系已写入图谱/.test(document.body.textContent), null, { timeout: 15000 });
  const graphAfterApprove = await page.evaluate(async () => (await (await fetch('/api/graph?suggestions=true')).json()).graph);
  assert.ok(graphAfterApprove.edges.some(edge => edge.createdSource === 'suggestion-approved' || edge.label === 'Deep answer suggestion'));

  const ignoreRow = suggestionSection.locator('.deep-answer-graph-suggestion').filter({ hasText: 'Deep answer ignore' });
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/graph/suggestions/') && response.url().includes('/decision') && response.ok(), { timeout: 15000 }),
    ignoreRow.getByRole('button', { name: '忽略' }).click()
  ]);
  await page.waitForFunction(() => document.body.textContent.includes('已忽略'), null, { timeout: 15000 });
  const graphAfterIgnore = await page.evaluate(async () => (await (await fetch('/api/graph?suggestions=true')).json()).graph);
  assert.ok(!graphAfterIgnore.suggestions.some(item => item.id === ignoreSuggestionId));
  assert.match(await suggestionSection.innerText(), /已写入图谱|已忽略/);

  await page.screenshot({ path: screenshots.desktop, fullPage: false });
  assert.deepEqual(runtimeErrors, []);

  const result = {
    ok: true,
    conversationId,
    approveSuggestionId,
    ignoreSuggestionId,
    runtimeErrors,
    screenshots: [screenshots.desktop.replace(projectRoot + '\\', '').replaceAll('\\', '/')]
  };
  await writeFile(join(evidenceDir, 'graph-suggestion-deep-answer-browser-acceptance.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await app?.locals?.close?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
