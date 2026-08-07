import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const componentPath = resolve(appRoot, 'src/components/CollectionCenter.jsx');
const cssPath = resolve(appRoot, 'src/components/CollectionCenter.css');
const componentSource = readFileSync(componentPath, 'utf8');
const cssSource = readFileSync(cssPath, 'utf8');
let vite;
let collectionModule;

before(async () => {
  vite = await createServer({ root: appRoot, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  collectionModule = await vite.ssrLoadModule('/src/components/CollectionCenter.jsx');
});

after(async () => { await vite?.close(); });

function includesAll(source, expected, label) {
  for (const fragment of expected) assert.ok(source.includes(fragment), `${label}: missing ${fragment}`);
}

test('CollectionCenter 导出并让三个真实收集入口同时可达', () => {
  assert.equal(typeof collectionModule.CollectionCenter, 'function');
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(collectionModule.CollectionCenter, {
    open: true, onClose: noop, onOpenFeishu: noop, onImportFiles: noop, onImportText: noop, onOpenLibrary: noop
  }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /打开飞书导入/);
  assert.match(html, /type="file"/);
  assert.match(html, /multiple=""/);
  assert.match(html, /选择文件/);
  assert.match(html, /快速文本/);
  assert.match(html, /placeholder="例如：项目复盘要点"/);
  assert.match(html, /加入知识库/);
});

test('飞书、文件和快速文本入口连接约定的回调', () => {
  includesAll(componentSource, [
    'await onOpenFeishu()',
    'await onImportFiles(list)',
    'await onImportText(normalized)',
    'onOpenLibrary?.(lastResult)',
    'onChange={event => void handleFiles(event.target.files)}',
    'void handleFiles(event.dataTransfer.files)',
    'onSubmit={handleTextSubmit}'
  ], 'callback contract');
});

test('文件导入一次传递全部文件，并发布加载与逐文件完成状态', async () => {
  const files = [{ name: '项目方案.pdf', size: 120 }, { name: '会议记录.docx', size: 240 }];
  const snapshots = [];
  let callbackFiles;
  const result = await collectionModule.importCollectionFiles(files, async received => {
    callbackFiles = received;
    return { ok: true, results: received.map(file => ({ name: file.name, status: 'success', message: `${file.name} 已解析` })) };
  }, status => snapshots.push(status.map(item => ({ ...item }))));

  assert.deepEqual(callbackFiles, files);
  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots[0].map(item => item.status), ['loading', 'loading']);
  assert.deepEqual(snapshots[1].map(item => item.status), ['success', 'success']);
  assert.equal(result.total, 2);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.ok, true);
});

test('文件导入也兼容只有整体计数的回调结果', async () => {
  const files = [{ name: '成功.md' }, { name: '失败.pdf' }];
  const result = await collectionModule.importCollectionFiles(files, async () => ({ imported: 1, failed: 1, message: '部分完成' }));
  assert.equal(result.partial, true);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.items.map(item => item.status), ['success', 'error']);
});
test('文件失败时逐文件状态可见且保留回调错误', async () => {
  const files = [{ name: '损坏文件.pdf' }];
  const snapshots = [];
  const expected = new Error('解析失败');
  await assert.rejects(
    collectionModule.importCollectionFiles(files, async () => { throw expected; }, state => snapshots.push(state)),
    error => error === expected
  );
  assert.equal(snapshots.at(-1)[0].status, 'error');
  assert.equal(snapshots.at(-1)[0].message, '解析失败');
});

test('快速文本严格以 title 和 content 对象调用异步回调', async () => {
  let payload;
  const result = await collectionModule.importCollectionText({ title: '  周会要点  ', content: '  本周完成知识库导入。  ' }, async received => {
    payload = received;
    return { ok: true, message: '已保存' };
  });
  assert.deepEqual(payload, { title: '周会要点', content: '本周完成知识库导入。' });
  assert.equal(result.kind, 'text');
  assert.equal(result.ok, true);
  assert.equal(result.title, '文本已加入知识库');
});

test('Modal 支持关闭按钮、Esc、遮罩关闭，并阻止内部点击冒泡', () => {
  includesAll(componentSource, [
    "event.key === 'Escape'",
    "document.addEventListener('keydown', handleKeyDown)",
    'className="collection-center-backdrop" onClick={onClose}',
    'onClick={event => event.stopPropagation()}',
    'aria-label="关闭收集中心"',
    'if (!open) return null'
  ], 'modal close contract');
});

test('加载、禁用、导入结果和知识库跳转状态清晰可访问', () => {
  includesAll(componentSource, [
    "disabled={feishuBusy || typeof onOpenFeishu !== 'function'}",
    "disabled={fileBusy || typeof onImportFiles !== 'function'}",
    "disabled={textBusy || !title.trim() || !content.trim() || typeof onImportText !== 'function'}",
    'aria-busy={feishuBusy}',
    'aria-busy={textBusy}',
    'aria-label="文件导入状态"',
    'aria-live="polite"',
    '查看知识库',
    'lastResult?.title',
    'lastResult?.message'
  ], 'state contract');
});

test('样式覆盖桌面、移动端、拖放、加载、成功与失败状态', () => {
  includesAll(cssSource, [
    '.collection-center-backdrop', '.collection-center-grid', '.collection-dropzone.is-dragging',
    '.collection-dropzone.is-busy', '.collection-file-statuses li[data-status="success"]',
    '.collection-file-statuses li[data-status="error"]', '.collection-result.is-success',
    '.collection-result.is-error', '@media (max-width: 760px)', '@media (max-width: 390px)',
    'grid-template-columns: minmax(0, 1fr)', 'overflow-x: hidden', '@media (prefers-reduced-motion: reduce)'
  ], 'responsive state styles');
});
