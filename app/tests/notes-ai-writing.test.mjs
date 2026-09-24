import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { dirname, resolve, join } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, transformWithEsbuild } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const componentPath = resolve(appRoot, 'src/components/NotesWorkspace.jsx');
const source = readFileSync(componentPath, 'utf8');
const electronExecutable = (() => {
  try {
    const require = createRequire(import.meta.url);
    const electronRoot = dirname(require.resolve('electron/package.json'));
    const pathFile = join(electronRoot, 'path.txt');
    const relativeExecutable = existsSync(pathFile) ? readFileSync(pathFile, 'utf8').trim() : '';
    const candidate = process.env.ELECTRON_OVERRIDE_DIST_PATH
      ? join(process.env.ELECTRON_OVERRIDE_DIST_PATH, relativeExecutable || (process.platform === 'win32' ? 'electron.exe' : 'electron'))
      : relativeExecutable
        ? join(electronRoot, 'dist', relativeExecutable)
        : '';
    return candidate && existsSync(candidate) ? candidate : '';
  } catch {
    return '';
  }
})();

test('queued 写回拒绝不发布成功、不改 dirty，显式写入仍可重试', () => {
  const updateCode = source.slice(source.indexOf('  function update(patch,'), source.indexOf('  function openLinkedNote('));
  const writeCode = source.slice(source.indexOf('  function writeAssistantIntoNote('), source.indexOf('  function updateQaField('));
  const make = new Function('env', `with (env) { ${updateCode}\n${writeCode}\nreturn { update, writeAssistantIntoNote }; }`);
  for (const rejection of ['content', 'token', 'generation', 'document', 'attachment', 'none']) {
    let state = { id: 'n1', content: 'base' };
    let valid = true;
    let generation = 1;
    let queue = [];
    let messages = [{ id: 'm1', applied: '' }];
    const dirty = [];
    const toasts = [];
    const token = { generation: 1 };
    const env = {
      draftRef: { current: state }, attachmentBusyRef: { current: '' },
      aiRequestRef: { current: { isCurrent: () => false } },
      assistantRequestRef: { current: { isCurrent: t => valid && t === token && t.generation === generation } },
      setDraft: updater => queue.push(updater),
      flushSync: callback => { callback(); for (const updater of queue) state = updater(state); queue = []; env.draftRef.current = state; },
      setDirty: value => dirty.push(value), setSaveError() {},
      setAssistantThread: updater => { messages = updater(messages); },
      isProblemNote: () => false,
      appendAssistantAnswerToNote: (content, answer) => `${content}\n${answer}`,
      mergeAppliedFields: (_, fields) => fields,
      onToast: text => toasts.push(text)
    };
    if (rejection === 'content') queue.push(current => ({ ...current, content: 'queued edit' }));
    if (rejection === 'document') queue.push(() => ({ id: 'n2', content: 'base' }));
    if (rejection === 'token') queue.push(current => { valid = false; return current; });
    if (rejection === 'generation') queue.push(current => { generation++; return current; });
    if (rejection === 'attachment') env.attachmentBusyRef.current = 'image';
    const api = make(env);
    const result = api.writeAssistantIntoNote({ id: 'm1', documentId: 'n1', text: 'answer' }, 'note', { requestToken: token, baseContent: 'base' });
    const accepted = rejection === 'none';
    assert.equal(result.accepted, accepted, rejection);
    assert.equal(result.applied, accepted ? 'note' : '', rejection);
    assert.equal(messages[0].applied, accepted ? 'note' : '', rejection);
    assert.deepEqual(dirty, accepted ? [true] : [], rejection);
    assert.equal(toasts.length, accepted ? 1 : 0, rejection);
    assert.equal(state.content.includes('answer'), accepted, rejection);
    if (rejection === 'content' || rejection === 'token' || rejection === 'generation') {
      const manual = api.writeAssistantIntoNote({ id: 'm1', documentId: 'n1', text: 'answer' }, 'note');
      assert.equal(manual.accepted, true, 'explicit user write does not depend on expired automatic token');
      assert.equal(messages[0].applied, 'note');
      if (rejection === 'content') assert.equal(state.content, 'queued edit\nanswer');
    }
  }
});

test('真实 React 提交及 StrictMode：显式写入合并排队正文，自动拒绝后仍可重试', {
  timeout: 60000,
  skip: electronExecutable ? false : 'Electron runtime 未安装，跳过真实窗口测试'
}, async () => {
  const require = createRequire(import.meta.url);
  const updateCode = source.slice(source.indexOf('  function update(patch,'), source.indexOf('  function openLinkedNote('));
  const writeCode = source.slice(source.indexOf('  function writeAssistantIntoNote('), source.indexOf('  function updateQaField('));
  const mergeCode = source.slice(source.indexOf('function mergeAppliedFields('), source.indexOf('export function formatNoteAttachmentSize('));
  const captureCode = readFileSync(resolve(appRoot, 'src/workspace/note-capture.js'), 'utf8').replace(/^export /gm, '');
  // Electron is already a project dependency: exercise React DOM's real update
  // queue (including StrictMode replay), rather than emulating setState/flushSync.
  const renderer = `(() => {
    const React = require(${JSON.stringify(require.resolve('react'))});
    const { createRoot } = require(${JSON.stringify(require.resolve('react-dom/client'))});
    const { flushSync } = require(${JSON.stringify(require.resolve('react-dom'))});
    const assert = require('node:assert/strict');
    ${captureCode}
    ${mergeCode}
    let count = 0;
    for (const strict of [false, true]) for (const kind of ['note', 'problem']) {
      for (const fields of ['note', 'pitfall', 'resolution', 'both']) {
        for (const scenario of ['explicit', 'content', 'token', 'generation', 'document', 'attachment', 'automatic']) {
          const base = kind === 'problem'
            ? serializeQaNote({ question: 'old question', resolution: 'old resolution', pitfall: 'old pitfall', extra: '## Extra\\nold extra' }) : 'base';
          const edited = kind === 'problem'
            ? serializeQaNote({ question: 'queued question', resolution: 'queued resolution', pitfall: 'queued pitfall', extra: '## Extra\\nqueued extra' }) : 'queued edit';
          const initial = { id: 'n1', content: base, artifactKind: kind };
          let api, committed, valid = true, generation = 1;
          const token = { generation: 1 };
          const toasts = [];
          let dirtyCalls = 0;
          function Harness() {
            const [draft, setDraft] = React.useState(initial);
            const [dirty, setDirtyState] = React.useState(false);
            const [saveError, setSaveError] = React.useState('previous error');
            const [messages, setAssistantThread] = React.useState([{ id: 'm1', applied: '' }]);
            const draftRef = React.useRef(draft);
            draftRef.current = draft;
            const attachmentBusyRef = React.useRef(scenario === 'attachment' ? 'image' : '');
            const assistantRequestRef = React.useRef({ isCurrent: t => valid && t === token && t.generation === generation });
            const aiRequestRef = React.useRef({ isCurrent: () => false });
            const setDirty = value => { dirtyCalls++; setDirtyState(value); };
            const onToast = text => toasts.push(text);
            ${updateCode}
            ${writeCode}
            api = { setDraft, writeAssistantIntoNote, attachmentBusyRef };
            React.useLayoutEffect(() => { committed = { draft, dirty, saveError, messages }; });
            return React.createElement('pre', null, draft.content);
          }
          const container = document.createElement('div');
          document.body.appendChild(container);
          const root = createRoot(container);
          flushSync(() => root.render(strict ? React.createElement(React.StrictMode, null, React.createElement(Harness)) : React.createElement(Harness)));
          let result;
          const message = { id: 'm1', documentId: 'n1', text: 'answer' };
          flushSync(() => {
            // The first update can be evaluated eagerly; the second must remain
            // queued, while draftRef still points at the committed old render.
            api.setDraft(current => ({ ...current, title: 'queued title' }));
            if (scenario === 'explicit' || scenario === 'content') api.setDraft(current => ({ ...current, content: edited }));
            if (scenario === 'document') api.setDraft(current => ({ ...current, id: 'n2' }));
            if (scenario === 'token') valid = false;
            if (scenario === 'generation') generation++;
            result = api.writeAssistantIntoNote(message, fields, scenario === 'explicit' ? {} : { requestToken: token, baseContent: base });
          });
          const accepted = scenario === 'explicit' || scenario === 'automatic';
          const expectedFields = kind === 'problem' && fields !== 'note' ? fields : 'note';
          const expectedContent = content => expectedFields === 'note'
            ? appendAssistantAnswerToNote(content, 'answer')
            : applyAssistantAnswerToProblemNote({ content, question: parseQaNote(content).question, answer: 'answer', fields });
          assert.equal(result.accepted, accepted, [strict, kind, fields, scenario].join('/'));
          assert.equal(result.applied, accepted ? expectedFields : '');
          assert.equal(committed.messages[0].applied, accepted ? expectedFields : '');
          assert.equal(committed.dirty, accepted);
          assert.equal(dirtyCalls, accepted ? 1 : 0);
          assert.equal(toasts.length, accepted ? 1 : 0);
          assert.equal(committed.saveError, accepted ? '' : 'previous error');
          const preceding = scenario === 'explicit' || scenario === 'content' ? edited : base;
          assert.equal(committed.draft.content, accepted ? expectedContent(preceding) : preceding);
          assert.equal(container.textContent, committed.draft.content);
          if (['content', 'token', 'generation', 'attachment'].includes(scenario)) {
            api.attachmentBusyRef.current = '';
            // The explicit retry itself also encounters a fresh queued edit.
            flushSync(() => {
              api.setDraft(current => ({ ...current, title: 'retry title' }));
              api.setDraft(current => ({ ...current, content: edited }));
              result = api.writeAssistantIntoNote(message, fields);
            });
            assert.equal(result.accepted, true);
            assert.equal(committed.draft.content, expectedContent(edited));
            assert.equal(committed.messages[0].applied, expectedFields);
            assert.equal(dirtyCalls, 1);
            assert.equal(toasts.length, 1);
          }
          flushSync(() => root.unmount());
          container.remove();
          count++;
        }
      }
    }
    return count;
  })()`;
  const directory = mkdtempSync(resolve(tmpdir(), 'notes-react-'));
  const entry = resolve(directory, 'main.cjs');
  writeFileSync(entry, `const { app, BrowserWindow } = require('electron');
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
      await win.loadURL('about:blank');
      const count = await win.webContents.executeJavaScript(${JSON.stringify(renderer)});
      console.log('NOTES_REACT_CASES=' + count);
      app.exit(0);
    }).catch(error => { console.error(error.stack); app.exit(1); });`);
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(electronExecutable, [entry, '--no-sandbox'], { env, timeout: 45000, windowsHide: true });
    assert.match(stdout, /NOTES_REACT_CASES=112/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('自动助手和帮写调用方只按 accepted 结果发布已写入状态', () => {
  assert.match(source, /applied = writeResult\?\.accepted \? writeResult\.applied : ''/);
  assert.match(source, /if \(!result\?\.accepted\) return;\s*setAiWriter/);
  assert.match(source, /requestController: assistantRequestRef\.current/);
});

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

test('NotesModule 复用 smart-writing API，合并可验证来源，并防止生成或保存期间覆盖新编辑', () => {
  assert.match(source, /fetch\('\/api\/skills\/run'/);
  assert.match(source, /skillId: 'smart-writing'/);
  assert.match(source, /mergeNoteSourceRefs\(draft\.sourceRefs, aiWriter\.citations\)/);
  assert.match(source, /sourceRefs: snapshot\.sourceRefs/);
  assert.match(source, /createDocumentSaveController/);
  assert.match(source, /NOTE_SAVE_DEBOUNCE_MS/);
  assert.match(source, /prepareDocumentSwitch/);
  assert.match(source, /saveControllerRef\.current\.retry\(draft\.id\)/);
  assert.match(source, /jsonBodyWithBaseVersion/);
  assert.match(source, /requireSavedRecord\(data, 'note'/);
  assert.match(source, /acceptBaseline\(next\.id, next\)/);
  assert.match(source, /registerWorkspaceSaveGuard/);
  assert.match(source, /controller\.flushAll\(\)/);
  assert.match(source, /baseVersion: note\?\.baseVersion \?\? note\?\.contentVersionId/);
  assert.match(source, /保存失败，笔记仍保留在当前页面/);
  assert.match(source, /生成期间笔记内容已经变化/);
  assert.match(source, /结果先预览，不会直接覆盖笔记/);
  assert.match(source, /onSelect=\{event => \{ const start = event\.currentTarget\.selectionStart[\s\S]*?setEditorSelection\(\{ start, end \}\)/);
  assert.match(source, /onApply\('insert'\)/);
  assert.match(source, /onApply\('replace'\)/);
  assert.match(source, /onOpenDocument\?\.\(\{ \.\.\.ref, id: ref\.documentId, documentId: ref\.documentId \}\)/);
});

test('笔记 AI 来源按文档和锚点去重，并保留可定位字段', () => {
  const refs = module.mergeNoteSourceRefs(
    [{ documentId: 'doc-1', title: '原资料', anchor: 'chars:0-8', excerpt: '原文' }],
    [
      { documentId: 'doc-1', title: '模型资料', anchor: 'chars:0-8', excerpt: '重复' },
      { documentId: 'doc-1', title: '模型资料', anchor: 'chars:9-18', excerpt: '新段落' },
      { title: '没有文档 ID 的模型标签' }
    ]
  );
  assert.equal(refs.length, 2);
  assert.deepEqual(refs.map(ref => ref.anchor), ['chars:0-8', 'chars:9-18']);
  assert.ok(refs.every(ref => ref.documentId === 'doc-1' && ref.contentItemId === 'doc-1'));
});
test('附件 Markdown 会在当前光标位置横向插入且保留前后正文', () => {
  const inserted = module.insertNoteAttachmentMarkdown({ content: '第一段\n第二段', markdown: '![截图](/api/notes/n1/attachments/a1)', selection: { start: 3, end: 3 } });
  assert.equal(inserted.content, '第一段\n\n![截图](/api/notes/n1/attachments/a1)\n\n第二段');
  assert.deepEqual(inserted.selection, { start: 40, end: 40 });
  assert.equal(module.formatNoteAttachmentSize(67), '67 B');
  assert.equal(module.formatNoteAttachmentSize(1536), '1.5 KB');
});

test('AI 预览允许在应用前打开已验证来源，而不是只显示静态标签', () => {
  const html = renderToStaticMarkup(React.createElement(module.NotesAiWritingPanel, {
    writer: { open: true, action: 'polish', tone: '专业简洁', scope: '全文', status: 'preview', original: '原文', result: '结果', citations: [{ documentId: 'doc-1', title: '可回查来源', anchor: 'chars:4-12' }] },
    onAction() {}, onToneChange() {}, onApply() {}, onClose() {}, onOpenSource() {}
  }));
  assert.match(html, /可回查来源/);
  assert.match(html, /<button[^>]*>.*可回查来源/s);
  assert.match(source, /onOpenSource=\{openSourceRef\}/);
  assert.match(source, /onClick=\{\(\) => onOpenSource\(ref\)\}/);
});