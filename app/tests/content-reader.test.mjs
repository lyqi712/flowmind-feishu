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

test('真实飞书 feishu:image:TOKEN externalId 也能匹配 markdown 中的裸 token', () => {
  const realAttachments = [
    { id: 'attachment_real_1', externalId: 'feishu:image:Y1b3bzIx3ozzFvxf02ocXoYonse', fileName: '真实图.png', mimeType: 'image/png', byteSize: 1024 },
    { id: 'attachment_real_2', externalId: 'feishu:file:YPDsbeAAvotru4xL47qccaNqn7g', fileName: 'index.html', mimeType: 'text/html', byteSize: 2048 }
  ];
  const rewritten = readerModule.rewriteFeishuAssetUrls('![真实图](feishu-asset://Y1b3bzIx3ozzFvxf02ocXoYonse)\n[📎 index.html](feishu-asset://YPDsbeAAvotru4xL47qccaNqn7g)', { id: 'item-1' }, realAttachments);
  assert.match(rewritten, /\/api\/content\/attachments\/attachment_real_1/);
  assert.match(rewritten, /\/api\/content\/attachments\/attachment_real_2/);
  assert.doesNotMatch(rewritten, /feishu-asset:\/\//);
  assert.doesNotMatch(rewritten, /图片附件未同步/);
});

test('无法匹配的飞书资源保持友好占位与可诊断 token，不产生危险自定义协议或悬空链接', () => {
  const markdown = readerModule.rewriteFeishuAssetUrls('![缺失](feishu-asset://missing-token)', item, attachments);
  // 行为修复（2026-08-12）：缺失附件不再生成 #missing-feishu-asset 悬空链接污染正文，改为一行短提示并保留 token 可诊断。
  assert.equal(markdown, '> ⚠️ 图片附件未同步（缺失 · missing-token）');
  assert.doesNotMatch(markdown, /#missing-feishu-asset/);
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
  assert.match(active, /这篇在讲什么/);
  assert.match(active, /有哪些要点/);
  assert.match(active, /和其他材料的关系/);
  assert.match(active, /创建写作草稿/);
  assert.match(active, /思维导图/);
  assert.match(active, />测验</);
  assert.match(active, /写来源笔记/);
  assert.match(active, /aria-label="关闭"/);
  assert.match(componentSource, /askSelection\(question.prompt\)/);
  assert.match(componentSource, /onClick=\{openAskComposer\}/);
  assert.match(componentSource, /onToggleQuestionScope\?\.\(item, !inQuestionScope\)/);
  assert.match(componentSource, /onWriteSourceNote\?\.\(item, selectionContext\)/);
  assert.match(componentSource, /onCreateWriting\?\.\(selectionContext\)/);
  assert.match(componentSource, /onClick=\{onClose\}/);
});

test('阅读器快捷问题随整篇和选区上下文自然切换', () => {
  const documentQuestions = readerModule.buildReaderQuickQuestions(item);
  assert.deepEqual(documentQuestions.map(row => row.label), ['这篇在讲什么', '有哪些要点', '和其他材料的关系']);
  const selectionQuestions = readerModule.buildReaderQuickQuestions(item, { quote: '关键结论' });
  assert.deepEqual(selectionQuestions.map(row => row.label), ['解释这段', '精简这段', '改写这段']);
  assert.ok(selectionQuestions[0].prompt.includes('飞书项目手册'));
});

test('Outline 导航使用块锚点，并为目录和阅读区提供可访问语义', () => {
  const html = renderToStaticMarkup(React.createElement(readerModule.ContentReader, { item, attachments }));
  assert.match(html, /aria-label="文档目录"/);
  assert.match(html, />文档目录</);
  assert.match(html, />总览</);
  assert.match(componentSource, /fallback\.scrollIntoView\(\{ behavior: smooth \? 'smooth' : 'auto', block: 'start' \}\)/);
  assert.match(componentSource, /fallback\.focus\(\{ preventScroll: true \}\)/);
  assert.match(componentSource, /tabIndex="-1"/);
});

test('引用定位先尝试服务器锚点，再明确回退到片段或未定位状态', () => {
  assert.deepEqual(readerModule.readerExcerptNeedles('  第一段\n\n第二段  '), ['第一段 第二段']);
  assert.match(componentSource, /findExcerptTarget\(reader, excerpt\)/);
  assert.match(componentSource, /kind: 'unresolved'/);
  assert.match(componentSource, /原始锚点不可用，已按引用片段定位/);
  assert.match(componentSource, /initialExcerpt = ''/);
  assert.match(cssSource, /\.content-reader-location-status/);
  assert.match(cssSource, /\.is-citation-target/);
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
  for (const fragment of ['onSelectionChange?.(payload, item)', 'onReadingPositionChange?.(readingPositionFromElement', 'onAnchorChange?.(locatedAnchor)', 'initialReadingPosition', 'initialAnchor', 'initialExcerpt'])
    assert.ok(componentSource.includes(fragment), `missing reader continuity contract: ${fragment}`);
});

test('HTML 附件在正文中以内嵌预览呈现，OCR 噪声降为引用，未同步素材给出补拉入口', () => {
  const htmlItem = {
    ...item,
    content: ['# 演示', '', '![封面](feishu-asset://image-token)', '', '[📎 index.html](feishu-asset://file-token)', '', '# [图片 OCR 提取 · 封面.png]', '乱码文字'].join('\n'),
    metadata: {
      ...item.metadata,
      assetCount: 3,
      assetWarnings: [{ code: 'FEISHU_MEDIA_DOWNLOAD_FAILED', kind: 'image' }],
      attachmentManifest: [
        { externalId: 'image-token', fileName: '封面.png', mimeType: 'image/png', byteSize: 2048 },
        { externalId: 'file-token', fileName: 'index.html', mimeType: 'text/html', byteSize: 4096 }
      ]
    }
  };
  const htmlAttachments = [
    { id: 'att-image', externalId: 'image-token', fileName: '封面.png', mimeType: 'image/png', byteSize: 2048 },
    { id: 'att-html', externalId: 'file-token', fileName: 'index.html', mimeType: 'text/html', byteSize: 4096 }
  ];
  const rewritten = readerModule.softenOcrNoise(readerModule.rewriteFeishuAssetUrls(htmlItem.content, htmlItem, htmlAttachments));
  assert.match(rewritten, /\/api\/content\/attachments\/att-html/);
  assert.match(rewritten, /图片里识别出的文字/);
  assert.ok(readerModule.isPreviewableHtmlUrl('/api/content/attachments/att-html', htmlAttachments));
  assert.equal(readerModule.countUnsyncedAssets(htmlItem, htmlAttachments), 1);
  const html = renderToStaticMarkup(React.createElement(readerModule.ContentReader, {
    item: htmlItem, attachments: htmlAttachments, onResyncAttachments() {}
  }));
  assert.match(html, /<iframe[^>]+src="\/api\/content\/attachments\/att-html"/);
  assert.match(html, /sandbox="allow-scripts allow-forms"/);
  assert.match(html, /针对这篇接着问/);
  assert.match(html, /重新拉取附件/);
  assert.match(cssSource, /\.content-reader-html-embed/);
  assert.match(cssSource, /\.content-reader-ask-form/);
});

test('阅读器区分飞书素材权限不足和超时，并给出原文入口', () => {
  const forbiddenItem = {
    ...item,
    sourceUrl: 'https://feishu.cn/docx/doc-forbidden',
    metadata: {
      ...item.metadata,
      assetCount: 2,
      assetWarnings: [
        { code: 'FEISHU_MEDIA_FORBIDDEN', kind: 'image' },
        { code: 'FEISHU_MEDIA_FORBIDDEN', kind: 'image' }
      ]
    }
  };
  const status = readerModule.describeReaderMediaStatus(forbiddenItem, []);
  assert.match(status.message, /没有素材权限/);
  assert.match(status.message, /飞书打开原文/);
  assert.equal(status.sourceUrl, 'https://feishu.cn/docx/doc-forbidden');
  const html = renderToStaticMarkup(React.createElement(readerModule.ContentReader, {
    item: forbiddenItem, attachments: [], onResyncAttachments() {}
  }));
  assert.match(html, /没有素材权限/);
  assert.match(html, /在飞书中打开/);
  assert.match(html, /重新拉取附件/);
  const legacy = readerModule.describeReaderMediaStatus({
    ...forbiddenItem,
    metadata: {
      ...forbiddenItem.metadata,
      assetWarnings: [{ code: 'FEISHU_MEDIA_DOWNLOAD_FAILED', message: '飞书资源下载失败（docx-image-download，HTTP 403）' }]
    }
  }, []);
  assert.match(legacy.message, /没有素材权限/);
  assert.equal(status.needsLogin, true);
  const loggedInHtml = renderToStaticMarkup(React.createElement(readerModule.ContentReader, {
    item: forbiddenItem, attachments: [], userLoggedIn: true, onLoginFeishu() {}, onResyncAttachments() {}
  }));
  const loggedInStatus = readerModule.describeReaderMediaStatus(forbiddenItem, [], { userLoggedIn: true });
  assert.match(loggedInStatus.message, /你的账号也没有下载权限/);
  assert.doesNotMatch(loggedInHtml, /登录飞书拉图/);
  const loginHtml = renderToStaticMarkup(React.createElement(readerModule.ContentReader, {
    item: forbiddenItem, attachments: [], onLoginFeishu() {}, onResyncAttachments() {}
  }));
  assert.match(loginHtml, /登录飞书拉图/);
});

test('阅读器问答面板留在文档旁边，并保留来源跳转', () => {
  const html = renderToStaticMarkup(React.createElement(readerModule.ContentReader, {
    item,
    conversation: {
      documentId: item.id,
      streaming: false,
      error: '',
      messages: [
        { id: 'u1', role: 'user', text: '这篇在讲什么？' },
        { id: 'a1', role: 'assistant', text: '先看封面图和 HTML 演示。', citations: [{ id: 'c1', title: item.title, documentId: item.id, anchor: 'root' }], done: true }
      ]
    }
  }));
  assert.match(html, /data-reader-conversation="true"/);
  assert.match(html, /针对这篇/);
  assert.match(html, /这篇在讲什么？/);
  assert.match(html, /先看封面图和 HTML 演示。/);
  assert.match(html, /\[1\] 飞书项目手册/);
  assert.match(cssSource, /\.content-reader-layout\.has-conversation/);
});

test('无选区问这篇留在当前阅读器问答栏', () => {
  const block = componentSource.slice(componentSource.indexOf('const openAskComposer = () => {'), componentSource.indexOf('const askSelection = (prompt) => {'));
  assert.match(block, /setConversationOpen\(true\)/);
  assert.match(block, /askInputRef\.current\?\.focus/);
  assert.doesNotMatch(block, /onAsk\('', null\)/);
  assert.match(componentSource, /content-reader-conversation-composer/);
});

test('阅读器回答仅在多资料或冲突时展示覆盖率，空证据时只给简短说明', () => {
  assert.match(componentSource, /onClick=\{openAskComposer\}/);
  assert.match(componentSource, /function ReaderAnswerCoverage/);
  assert.match(componentSource, /hasSubstantiveEvidenceAnalysis/);
  assert.match(componentSource, /content-reader-conversation-markdown/);
  assert.match(componentSource, /conversationOpen \? <aside/);
  assert.match(cssSource, /.content-reader-conversation-coverage/);
  const html = renderToStaticMarkup(React.createElement(readerModule.ContentReader, {
    item,
    conversation: {
      documentId: item.id,
      streaming: false,
      error: '',
      messages: [{
        id: 'a1',
        role: 'assistant',
        text: '知识库里没有找到能支撑这个问题的材料。',
        done: true,
        citationIntegrity: { status: 'empty' },
        relations: {
          citationCoverage: {
            score: 0,
            uncoveredClaims: ['本周发布有哪些风险？']
          }
        }
      }]
    }
  }));
  assert.doesNotMatch(html, /引用覆盖率 0%/);
  assert.match(html, /没有找到可引用证据/);
  assert.doesNotMatch(html, /本周发布有哪些风险？/);
  assert.match(html, /data-integrity="empty"/);
});

test('阅读器提供文内搜索、选区就地操作、回答沉淀和关联图谱入口', () => {
  for (const fragment of [
    'aria-label="文内搜索"',
    '在这篇里找…',
    'aria-label="选区操作"',
    '高亮',
    '记笔记',
    "askSelection('精简一下')",
    '存成笔记',
    '关联图谱',
    'onOpenGraph',
    'onSaveAnswer',
    'readerAnnotationPayload(selectionContext)',
    "wrapTextMatches(root, searchQuery.trim(), 'is-reader-search')",
    'copiedSelection',
    "copiedSelection === 'copied' ? '已复制' : copiedSelection === 'failed' ? '复制失败' : '复制'",
    'const copySelection = async () => {',
    'Promise.race(['
  ]) assert.ok(componentSource.includes(fragment), `missing reader convenience fragment: ${fragment}`);
  for (const selector of [
    '.content-reader-search',
    '.content-reader-selection-menu',
    '.content-reader-conversation-actions',
    'mark.is-reader-search',
    'mark.is-reader-highlight'
  ]) assert.ok(cssSource.includes(selector), `missing reader convenience style: ${selector}`);
  const html = renderToStaticMarkup(React.createElement(readerModule.ContentReader, {
    item,
    onOpenGraph() {},
    onSaveAnswer() {},
    conversation: {
      documentId: item.id,
      streaming: false,
      error: '',
      messages: [{ id: 'a1', role: 'assistant', text: '可保存的回答', done: true }]
    }
  }));
  assert.match(html, /关联图谱/);
  assert.match(html, />精简</);
  assert.match(html, /存成笔记/);
  assert.match(html, /aria-label="文内搜索"/);
});

test('current document version select defaults to the current version instead of an empty placeholder', () => {
  assert.match(componentSource, /contentVersionId \?\? sourceItem\.currentVersionId \?\? null/);
  const html = renderToStaticMarkup(React.createElement(readerModule.ContentReader, {
    item: { ...item, currentVersionId: 576 },
    evidenceRef: { evidenceStatus: 'current', currentVersionId: 576 },
    versions: [{ id: 576, revision: 'now' }, { id: 564, revision: 'old' }],
    onOpenVersion() {}
  }));
  assert.match(html, /<option[^>]*value="576"[^>]*selected/);
  assert.doesNotMatch(html, /<option[^>]*value=""[^>]*selected/);
});

test('相关文档有依据才渲染，空列表不占位', () => {
  assert.equal(typeof readerModule.RelatedDocuments, 'function');
  assert.equal(renderToStaticMarkup(React.createElement(readerModule.RelatedDocuments, { items: [] })), '');
  const html = renderToStaticMarkup(React.createElement(readerModule.RelatedDocuments, {
    items: [{ documentId: 'doc-team', title: 'Hermes Agent 团队', reason: '这篇提到了《Hermes Agent 团队》' }]
  }));
  assert.match(html, /相关 1 篇/);
  assert.match(html, /Hermes Agent 团队/);
  assert.match(html, /这篇提到了/);
});

test('阅读器把 [[wikilink]] 改写成可点的 wiki 锚点', () => {
  assert.equal(typeof readerModule.rewriteWikiLinks, 'function');
  assert.equal(readerModule.rewriteWikiLinks('见 [[Feishu origin#Origin|原文]]'), '见 [原文](#wiki:Feishu%20origin)');
  assert.equal(readerModule.rewriteWikiLinks('![[embed note]]'), '[embed note](#wiki:embed%20note)');
  const html = renderToStaticMarkup(React.createElement(readerModule.ContentReader, {
    item: { ...item, content: '正文引用 [[Feishu origin]]' }
  }));
  assert.match(html, /class="content-reader-wiki-link"/);
  assert.match(html, /Feishu origin/);
  assert.match(componentSource, /\/api\/content\/items\/\$\{encodeURIComponent\(id\)\}\/links/);
  assert.match(componentSource, /function DocumentLinksDock/);
  assert.match(componentSource, /aria-label="文档关系"/);
  assert.match(componentSource, /const \[linksDockOpen, setLinksDockOpen\] = useState\(false\)/);
  assert.match(componentSource, /收起关系/);
  assert.match(componentSource, /content-reader-dock-toggle/);
  assert.match(componentSource, /筛选关系/);
  assert.match(componentSource, /activeOutlineAnchor/);
  assert.match(componentSource, /复制双链/);
  assert.match(componentSource, /收起助手/);
  assert.match(componentSource, /Boolean\(needle\) \|\| openSections\[key\] !== false/);
  assert.match(componentSource, /const \[outlineOpen, setOutlineOpen\]/);
  assert.match(componentSource, /content-reader-more/);
  assert.match(componentSource, /document\.execCommand\('copy'\)/);
  assert.match(cssSource, /\.content-reader-links-dock/);
  assert.match(cssSource, /\.content-reader-wiki-link/);
  assert.match(cssSource, /\.has-links-dock/);
  assert.match(cssSource, /\.content-reader-dock-filter/);
  assert.match(cssSource, /\.content-reader-outline-link\.is-active/);
  assert.match(cssSource, /\.content-reader-more-menu/);
});
