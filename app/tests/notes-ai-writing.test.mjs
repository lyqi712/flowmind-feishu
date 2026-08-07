import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, transformWithEsbuild } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const componentPath = resolve(appRoot, 'src/components/NotesWorkspace.jsx');
const source = readFileSync(componentPath, 'utf8');
let vite;
let module;

before(async () => {
  vite = await createServer({ root: appRoot, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  module = await vite.ssrLoadModule('/src/components/NotesWorkspace.jsx');
});

after(async () => { await vite?.close(); });

test('NotesWorkspace 真实编译并暴露笔记 AI 帮写契约', async () => {
  const transformed = await transformWithEsbuild(source, componentPath, { loader: 'jsx', jsx: 'automatic' });
  assert.ok(transformed.code.length > 18000);
  assert.equal(typeof module.NotesModule, 'function');
  assert.equal(typeof module.NotesAiWritingPanel, 'function');
  assert.deepEqual(module.NOTES_AI_ACTIONS.map(item => item.id), ['polish', 'continue', 'summarize', 'tone']);
  assert.deepEqual(module.NOTES_AI_ACTIONS.map(item => item.label), ['润色', '续写', '总结', '改写语气']);
});

test('帮写提示词使用当前范围、语气、原文与来源，并要求保留引用', () => {
  const prompt = module.buildNotesAiWritingPrompt({
    action: 'tone', tone: '自然友好', title: '发布复盘', scope: '当前选区',
    original: '原句包含 [1] 与 [[相关笔记]]。',
    sourceRefs: [{ documentId: 'doc-1', title: '来源文档', pageNumber: 3 }]
  });
  for (const fragment of ['改写语气', '自然友好', '当前选区', '原句包含 [1]', '[[相关笔记]]', '来源文档', '第 3 页', '不得编造事实或来源']) {
    assert.ok(prompt.includes(fragment), `missing prompt fragment: ${fragment}`);
  }
});

test('AI 帮写结果会清理代码围栏和模型误加的首尾分隔线', () => {
  assert.equal(module.normalizeNotesAiWritingResult('```markdown\n# 标题\n正文\n```'), '# 标题\n正文');
  assert.equal(module.normalizeNotesAiWritingResult('---\n# 标题\n正文\n---'), '# 标题\n正文');
  assert.equal(module.applyNotesAiWritingResult({ content: '旧正文', result: '---\n新正文\n---', range: { start: 0, end: 3 }, mode: 'replace' }).content, '新正文');
});
test('插入与替换必须由显式应用函数执行，且不会修改范围外原文', () => {
  const content = '开头\n需要修改的句子\n结尾';
  const start = content.indexOf('需要');
  const end = start + '需要修改的句子'.length;
  const replaced = module.applyNotesAiWritingResult({ content, result: '更清楚的句子 [1]', range: { start, end }, mode: 'replace' });
  assert.equal(replaced.content, '开头\n更清楚的句子 [1]\n结尾');
  assert.equal(replaced.selection.start, start);

  const inserted = module.applyNotesAiWritingResult({ content, result: '补充说明', range: { start, end }, mode: 'insert', action: 'continue' });
  assert.ok(inserted.content.startsWith('开头\n需要修改的句子'));
  assert.ok(inserted.content.includes('\n\n补充说明\n\n结尾'));
  assert.throws(() => module.applyNotesAiWritingResult({ content, result: '', range: { start, end }, mode: 'replace' }), /结果为空/);
});

test('流式 smart-writing 响应支持 loading 增量、最终产物和来源引用', async () => {
  const events = [
    { type: 'start', runId: 'run-1' },
    { type: 'model-delta', delta: '更清楚' },
    { type: 'model-delta', delta: '的表达' },
    { type: 'artifact', artifact: { content: '更清楚的表达 [1]', references: [{ id: 'ref-1', title: '来源文档' }] } },
    { type: 'done', result: { artifact: { content: '更清楚的表达 [1]', references: [{ id: 'ref-1', title: '来源文档' }] }, model: { provider: 'custom', id: 'writer' } } }
  ];
  const deltas = [];
  const response = new Response(events.map(event => JSON.stringify(event)).join('\n') + '\n', { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
  const result = await module.readNotesAiWritingStream(response, { onDelta: value => deltas.push(value) });
  assert.deepEqual(deltas, ['更清楚', '更清楚的表达']);
  assert.equal(result.result, '更清楚的表达 [1]');
  assert.equal(result.citations[0].title, '来源文档');
  assert.equal(result.model.id, 'writer');
});

test('预览面板同时呈现原文、结果、来源、错误和显式插入/替换动作', () => {
  const html = renderToStaticMarkup(React.createElement(module.NotesAiWritingPanel, {
    writer: {
      open: true, action: 'polish', tone: '专业简洁', scope: '当前选区', status: 'preview',
      original: '这是原文 [1]', result: '这是润色结果 [1]', error: '', appliedMode: '',
      citations: [{ id: 'ref-1', title: '来源文档', pageNumber: 2 }]
    },
    onAction() {}, onToneChange() {}, onApply() {}, onClose() {}
  }));
  for (const fragment of ['笔记 AI 帮写', '润色', '续写', '总结', '改写语气', '查看原文快照', '结果预览', '这是润色结果 [1]', '来源与引用', '来源文档', '插入到原文后', '替换当前选区']) {
    assert.ok(html.includes(fragment), `missing rendered fragment: ${fragment}`);
  }
});

test('loading 与 error 状态有明确反馈，且流式片段完成前不暴露写入按钮', () => {
  const base = { open: true, action: 'polish', tone: '专业简洁', scope: '全文', original: '原文', citations: [], appliedMode: '' };
  const loadingHtml = renderToStaticMarkup(React.createElement(module.NotesAiWritingPanel, {
    writer: { ...base, status: 'loading', result: '尚未完成的片段', error: '' },
    onAction() {}, onToneChange() {}, onApply() {}, onClose() {}
  }));
  assert.ok(loadingHtml.includes('AI 正在处理，原文保持不变'));
  assert.ok(loadingHtml.includes('尚未完成的片段'));
  assert.ok(!loadingHtml.includes('插入到原文后'));
  assert.ok(!loadingHtml.includes('替换全文'));

  const errorHtml = renderToStaticMarkup(React.createElement(module.NotesAiWritingPanel, {
    writer: { ...base, status: 'error', result: '', error: '模型暂时繁忙' },
    onAction() {}, onToneChange() {}, onApply() {}, onClose() {}
  }));
  assert.ok(errorHtml.includes('模型暂时繁忙'));
  assert.ok(errorHtml.includes('role="alert"'));
});

test('NotesModule 复用 smart-writing API，保留 sourceRefs，并防止生成期间覆盖新编辑', () => {
  assert.match(source, /fetch\('\/api\/skills\/run'/);
  assert.match(source, /skillId: 'smart-writing'/);
  assert.match(source, /sourceRefs: draft\.sourceRefs \|\| \[\]/);
  assert.match(source, /生成期间笔记内容已经变化/);
  assert.match(source, /结果先预览，不会直接覆盖笔记/);
  assert.match(source, /onSelect=\{event => setEditorSelection/);
  assert.match(source, /onApply\('insert'\)/);
  assert.match(source, /onApply\('replace'\)/);
});
test('附件 Markdown 会在当前光标位置横向插入且保留前后正文', () => {
  const inserted = module.insertNoteAttachmentMarkdown({ content: '第一段\n第二段', markdown: '![截图](/api/notes/n1/attachments/a1)', selection: { start: 3, end: 3 } });
  assert.equal(inserted.content, '第一段\n\n![截图](/api/notes/n1/attachments/a1)\n\n第二段');
  assert.deepEqual(inserted.selection, { start: 40, end: 40 });
  assert.equal(module.formatNoteAttachmentSize(67), '67 B');
  assert.equal(module.formatNoteAttachmentSize(1536), '1.5 KB');
});