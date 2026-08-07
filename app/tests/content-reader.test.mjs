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
const componentPath = resolve(appRoot, 'src/components/ContentReader.jsx');
const cssPath = resolve(appRoot, 'src/components/ContentReader.css');
const componentSource = readFileSync(componentPath, 'utf8');
const cssSource = readFileSync(cssPath, 'utf8');
let vite;
let readerModule;

before(async () => {
  vite = await createServer({ root: appRoot, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  readerModule = await vite.ssrLoadModule('/src/components/ContentReader.jsx');
});
after(async () => { await vite?.close(); });

const item = {
  id: 'doc-1', title: '飞书项目手册', contentType: 'feishu-docx', sourceUrl: 'https://example.feishu.cn/docx/demo',
  content: ['# 总览', '', '> 这是引用。', '', '- [x] 已完成', '- [ ] 待处理', '', '| 模块 | 状态 |', '| --- | --- |',
    '| 阅读器 | 可用 |', '', '```js', 'const ready = true;', '```', '', '[外部链接](https://example.com)', '',
    '![架构图](feishu-asset://image-token)', '', '[📎 需求附件](feishu-asset://file-token)'].join('\n'),
  metadata: {
    outline: [{ level: 1, title: '总览', anchor: 'block:heading-1' }],
    blockAnchors: [{ anchor: 'block:heading-1', blockId: 'heading-1', kind: 'heading1' }],
    attachmentManifest: [
      { externalId: 'image-token', fileName: '架构图.png', mimeType: 'image/png', byteSize: 2048 },
      { externalId: 'file-token', fileName: '需求.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', byteSize: 4096 }
    ]
  }
};
const attachments = [
  { id: 'att image/1', externalId: 'image-token', fileName: '架构图.png', mimeType: 'image/png', byteSize: 2048 },
  { id: 'att-file-2', externalId: 'file-token', fileName: '需求.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', byteSize: 4096 }
];

test('ContentReader 导出为可复用组件并支持空 item', () => {
  assert.equal(typeof readerModule.ContentReader, 'function');
  assert.equal(readerModule.default, readerModule.ContentReader);
  assert.equal(renderToStaticMarkup(React.createElement(readerModule.ContentReader, { item: null })), '');
});

test('feishu-asset 按 manifest externalId 与持久化附件 id 映射为安全 API URL', () => {
  const resolved = readerModule.resolveFeishuAsset('feishu-asset://image-token', item, attachments);
  assert.equal(resolved.id, 'att image/1');
  assert.equal(resolved.fileName, '架构图.png');
  assert.equal(resolved.url, '/api/content/attachments/att%20image%2F1');
  assert.equal(resolved.downloadUrl, '/api/content/attachments/att%20image%2F1/download');
  const rewritten = readerModule.rewriteFeishuAssetUrls(item.content, item, attachments);
  assert.match(rewritten, /\/api\/content\/attachments\/att%20image%2F1/);
  assert.match(rewritten, /\/api\/content\/attachments\/att-file-2/);
  assert.doesNotMatch(rewritten, /feishu-asset:\/\//);
});

test('无法匹配的飞书资源保持可诊断占位，不产生危险自定义协议', () => {
  const markdown = readerModule.rewriteFeishuAssetUrls('![缺失](feishu-asset://missing-token)', item, attachments);
  assert.equal(markdown, '![缺失](#missing-feishu-asset-missing-token)');
  assert.equal(readerModule.resolveFeishuAsset('missing-token', item, attachments), null);
});

test('附件列表合并 manifest 与 attachments、去重并提供查看和下载地址', () => {
  const rows = readerModule.listReaderAttachments(item, [...attachments,
    { id: 'standalone', externalId: 'standalone', fileName: '补充.pdf', mimeType: 'application/pdf', byteSize: 1024 }]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.fileName), ['架构图.png', '需求.docx', '补充.pdf']);
  assert.equal(rows[0].available, true);
  assert.equal(rows[1].downloadUrl, '/api/content/attachments/att-file-2/download');
  assert.equal(rows[2].url, '/api/content/attachments/standalone');
});

test('SSR 呈现标题、表格、任务列表、引用、代码、链接、图片与附件卡', () => {
  const html = renderToStaticMarkup(React.createElement(readerModule.ContentReader, {
    item, attachments, inQuestionScope: false, onToggleQuestionScope() {}, onWriteSourceNote() {}, onClose() {}
  }));
  assert.match(html, /aria-label="飞书项目手册阅读器"/);
  assert.match(html, /<h1[^>]*id="block:heading-1"[^>]*>总览<\/h1>/);
  assert.match(html, /<blockquote/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /checked=""/);
  assert.match(html, /<table>/);
  assert.match(html, /<pre>/);
  assert.match(html, /const ready = true/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /src="\/api\/content\/attachments\/att%20image%2F1"/);
  assert.match(html, /架构图\.png/);
  assert.match(html, /需求\.docx/);
  assert.match(html, /href="\/api\/content\/attachments\/att-file-2\/download"/);
});

test('问答范围、来源笔记和关闭操作有明确按钮与回调契约', () => {
  const inactive = renderToStaticMarkup(React.createElement(readerModule.ContentReader, { item, attachments, inQuestionScope: false }));
  const active = renderToStaticMarkup(React.createElement(readerModule.ContentReader, { item, attachments, inQuestionScope: true }));
  assert.match(inactive, /加入问答范围/);
  assert.match(inactive, /aria-pressed="false"/);
  assert.match(active, /移出问答范围/);
  assert.match(active, /aria-pressed="true"/);
  assert.match(active, /问这篇/);
  assert.match(active, /AI 阅读助手/);
  assert.match(active, /概括核心结论/);
  assert.match(active, /提取行动项/);
  assert.match(active, /观察知识关联/);
  assert.match(active, /创建写作草稿/);
  assert.match(active, /思维导图/);
  assert.match(active, />测验</);
  assert.match(active, /写来源笔记/);
  assert.match(active, /aria-label="关闭"/);
  assert.match(componentSource, /onToggleQuestionScope\?\.\(item, !inQuestionScope\)/);
  assert.match(componentSource, /onWriteSourceNote\?\.\(item, selectionContext\)/);
  assert.match(componentSource, /onAsk\?\.\(question\.prompt, selectionContext\)/);
  assert.match(componentSource, /onCreateWriting\?\.\(selectionContext\)/);
  assert.match(componentSource, /onClick=\{onClose\}/);
});

test('阅读器快捷问题随整篇和选区上下文自然切换', () => {
  const documentQuestions = readerModule.buildReaderQuickQuestions(item);
  assert.deepEqual(documentQuestions.map(row => row.label), ['概括核心结论', '提取行动项', '观察知识关联']);
  const selectionQuestions = readerModule.buildReaderQuickQuestions(item, { quote: '关键结论' });
  assert.deepEqual(selectionQuestions.map(row => row.label), ['解释这段', '总结这段', '形成行动']);
  assert.ok(selectionQuestions.every(row => row.prompt.includes('飞书项目手册')));
});

test('Outline 导航使用块锚点，并为目录和阅读区提供可访问语义', () => {
  const html = renderToStaticMarkup(React.createElement(readerModule.ContentReader, { item, attachments }));
  assert.match(html, /aria-label="文档目录"/);
  assert.match(html, />文档目录</);
  assert.match(html, />总览</);
  assert.match(componentSource, /target\.scrollIntoView\(\{ behavior: smooth \? 'smooth' : 'auto', block: 'start' \}\)/);
  assert.match(componentSource, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(componentSource, /tabIndex="-1"/);
});

test('Markdown 管线固定使用 GFM 与 sanitize，CSS 覆盖桌面和移动阅读体验', () => {
  for (const fragment of ["import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'", "import remarkGfm from 'remark-gfm'",
    "import rehypeSanitize from 'rehype-sanitize'", 'remarkPlugins={[remarkGfm]}', 'rehypePlugins={[rehypeSanitize]}'])
    assert.ok(componentSource.includes(fragment), `missing Markdown pipeline: ${fragment}`);
  for (const selector of ['.content-reader-markdown blockquote', '.content-reader-table-wrap', '.content-reader-code-wrap',
    '.content-reader-image', '.content-reader-attachment-grid', '.content-reader-ai-bar', '.content-reader-ai-prompts', '@media (max-width:560px)'])
    assert.ok(cssSource.includes(selector), `missing reader style: ${selector}`);
});

test('思维导图与互动测验在 Reader 内横向融合并支持持久历史、回源和重新生成', () => {
  for (const fragment of [
    "onRunInterpretation, interpretationRuns = []",
    "currentRuns.find(run => run.skillId === kind)",
    "onRunInterpretation(kind, selectionContext, force)",
    "content-reader-interpretation-history",
    "chooseHistoryRun(event.target.value)",
    "openSource(currentQuestion.sourceRef)",
    "setQuizAnswers(current => ({ ...current, [currentQuestion.id]: choiceIndex }))",
    "setQuizIndex(0); setQuizAnswers({});",
    "openInterpretation(activeInterpretation, true)"
  ]) assert.ok(componentSource.includes(fragment), `missing interpretation behavior: ${fragment}`);
  for (const selector of [
    '.content-reader-layout.has-outline.has-interpretation',
    '.content-reader-interpretation',
    '.content-reader-map-tree',
    '.content-reader-quiz-choices',
    '.content-reader-quiz-explanation',
    '@media(max-width:1050px)',
    '@media(max-width:680px)'
  ]) assert.ok(cssSource.includes(selector), `missing horizontal interpretation style: ${selector}`);
});
test('飞书持久化 externalId 前缀与 metadata.feishuToken 都能匹配 Markdown 裸 token', () => {
  const item = { metadata: { attachmentManifest: [{ externalId: 'feishu:image:asset-real-token', metadata: { feishuToken: 'asset-real-token' } }] } };
  const attachments = [{ id: 'attachment-real', externalId: 'feishu:image:asset-real-token', metadata: { feishuToken: 'asset-real-token' } }];
  assert.equal(readerModule.resolveFeishuAsset('asset-real-token', item, attachments)?.url, '/api/content/attachments/attachment-real');
});
test('阅读位置快照归一化滚动进度并保留 Anchor', () => {
  assert.deepEqual(readerModule.readingPositionFromElement({ scrollTop: 300, scrollHeight: 1000, clientHeight: 400 }, '#chapter-2'), { scrollTop: 300, progress: 0.5, anchor: 'chapter-2' });
});

test('文档选区生成可持久化的引用载荷，并拒绝阅读区外选区', () => {
  const anchorNode = { id: 'block:42' };
  const parentElement = { closest() { return anchorNode; } };
  const commonAncestorContainer = { nodeType: 3, parentElement };
  const range = { commonAncestorContainer, startOffset: 2, endOffset: 8 };
  const selection = { rangeCount: 1, toString() { return '关键结论'; }, getRangeAt() { return range; } };
  const container = { contains(node) { return node === commonAncestorContainer; } };
  assert.deepEqual(readerModule.selectionPayload(selection, container, 'doc-1'), { documentId: 'doc-1', text: '关键结论', quote: '关键结论', anchor: 'block:42', startOffset: 2, endOffset: 8 });
  assert.equal(readerModule.selectionPayload(selection, { contains() { return false; } }, 'doc-1'), null);
});

test('阅读器向工作区发布选区、滚动位置和 Anchor 回调', () => {
  for (const fragment of ['onSelectionChange?.(payload, item)', 'onReadingPositionChange?.(readingPositionFromElement', 'onAnchorChange?.(normalized)', 'initialReadingPosition', 'initialAnchor'])
    assert.ok(componentSource.includes(fragment), `missing reader continuity contract: ${fragment}`);
});
