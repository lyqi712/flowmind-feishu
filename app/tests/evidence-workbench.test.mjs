import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const componentPath = resolve(appRoot, 'src/components/EvidenceWorkbench.jsx');
const cssPath = resolve(appRoot, 'src/components/EvidenceWorkbench.css');
const source = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
let vite;
let module;

before(async () => {
  vite = await createServer({ root: appRoot, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  module = await vite.ssrLoadModule('/src/components/EvidenceWorkbench.jsx');
});
after(async () => { await vite?.close(); });

test('EvidenceWorkbench renders the question, verified source scope, contract and empty evidence state', () => {
  const html = renderToStaticMarkup(React.createElement(module.EvidenceWorkbench, {
    documents: [{ id: 'doc-1', title: 'Release plan', contentType: 'markdown' }],
    initialDocumentIds: ['doc-1'],
    initialQuestion: 'What remains unresolved?',
    onOpenDocument() {},
    onClose() {}
  }));
  assert.match(html, /aria-label="证据工作台"/);
  assert.match(html, /研究问题/);
  assert.match(html, /Release plan/);
  assert.match(html, /开始分析/);
  assert.match(html, /name="evidence-question"/);
  assert.match(html, /aria-label="关闭证据工作台"/);
  assert.match(html, /执行契约/);
  assert.match(html, /证据账本/);
  assert.match(html, /尚未形成证据/);
  assert.match(html, /aria-label="筛选证据来源"/);
  assert.match(html, /加入筛选结果/);
  assert.match(html, /清空选择/);
});

test('EvidenceWorkbench keeps server-only proposal boundaries, cancellable research, retry recovery and narrow-layout contracts', () => {
  for (const fragment of [
    '/api/agent/capabilities',
    '/api/agent/run',
    '/api/agent/runs/${encodeURIComponent(run.id)}/decision-note',
    '/api/agent/confirmations/${encodeURIComponent(confirmation.id)}',
    'AbortController',
    'signal: controller.signal',
    'function stopResearch()',
    '停止分析',
    '重试分析',
    'researchRequestRef',
    'sourceFilter',
    'selectVisibleDocuments',
    'clearSelectedDocuments',
    'aria-label="筛选证据来源"',
    'evidence-confirmation-review',
    '审阅拟写内容'
  ]) assert.ok(source.includes(fragment), `missing workbench source controls: ${fragment}`);
  for (const selector of [
    '.evidence-query-band', '.evidence-ledger-row', '.evidence-analysis-grid', '.evidence-confirmation',
    '.evidence-error-retry', '.evidence-workbench button:focus-visible', '.evidence-confirmation-review', '@media (max-width: 560px)', 'overflow-x: hidden', 'grid-template-columns: 1fr'
  ]) assert.ok(css.includes(selector), `missing workbench style: ${selector}`);
});
