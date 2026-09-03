import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildWorkspaceContextNote, buildWorkspaceContextWritingDraft, normalizeWorkspaceSourceRefs } from '../src/workspace/workspace-integrations.js';

const mainSource = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');

test('当前文档、选区和附加材料规范化为去重且可恢复的 sourceRefs', () => {
  const context = {
    currentDocument: { id: 'doc-1', documentId: 'doc-1', title: '当前原文', source: '飞书', type: 'document', url: 'https://example.test/doc-1' },
    selection: { id: 'selection-1', kind: 'selection', documentId: 'doc-1', text: '用户体验来自连续工作机制。', anchor: 'chars:12-27', startOffset: 12, endOffset: 27 },
    resources: [
      { id: 'duplicate-current', kind: 'document', documentId: 'doc-1', title: '重复当前文档' },
      { id: 'doc-2', kind: 'document', documentId: 'doc-2', title: '补充方案', source: '飞书' },
      { id: 'attachment-1', kind: 'file', title: '补充截图.png', type: 'image/png', sourceUrl: 'file:///attachment-1.png' }
    ]
  };

  const refs = normalizeWorkspaceSourceRefs(context);
  assert.equal(refs.length, 3);
  assert.deepEqual(refs[0], {
    documentId: 'doc-1',
    title: '当前原文',
    source: '飞书',
    kind: 'document',
    url: 'https://example.test/doc-1',
    anchor: 'chars:12-27',
    quote: '用户体验来自连续工作机制。',
    selection: true,
    startOffset: 12,
    endOffset: 27
  });
  assert.equal(refs[1].documentId, 'doc-2');
  assert.equal(refs[2].sourceId, 'attachment-1');
  assert.equal(refs[2].url, 'file:///attachment-1.png');
});

test('上下文笔记草稿自然带入标题、选区、标签和全部来源', () => {
  const draft = buildWorkspaceContextNote({
    currentDocument: { documentId: 'doc-1', title: '季度策略', source: '飞书', type: 'document' },
    selection: { kind: 'selection', documentId: 'doc-1', quote: '增长来自复购，而不是一次性流量。', anchor: 'chars:88-104' },
    resources: [{ id: 'knowledge-base-feishu', kind: 'knowledge-base', title: '飞书经营知识库', source: '飞书知识库', type: '42 篇文档' }]
  });

  assert.equal(draft.title, '选区 · 季度策略');
  assert.doesNotMatch(draft.content, /## 摘要|## 关键观点|## 行动项/);
  assert.ok(draft.content.includes('> 增长来自复购，而不是一次性流量。'));
  assert.deepEqual(draft.tags, ['来源笔记', '选区笔记']);
  assert.equal(draft.sourceRefs.length, 2);
  assert.equal(draft.sourceRefs[0].anchor, 'chars:88-104');
  assert.equal(draft.sourceRefs[1].sourceId, 'knowledge-base-feishu');
});

test('Ctrl+K 与 Context 创建笔记直接 POST、打开持久化 Tab 并 deep-link', () => {
  for (const fragment of [
    'async function handleWorkspaceCreateNote(context = workspaceContext)',
    'const draft = buildWorkspaceContextNote(context)',
    "await fetch('/api/notes'",
    'body: JSON.stringify(draft)',
    'openCreatedWorkspaceNote(data.note',
    'setNoteDeepLinkId(noteId)',
    "kind: 'note', type: 'note', route: 'notes', noteId",
    'initialNoteId={tab?.noteId || noteDeepLinkId}',
    'onCreateNote={handleWorkspaceCreateNote}'
  ]) assert.ok(mainSource.includes(fragment), `missing ${fragment}`);
  assert.doesNotMatch(mainSource, /已打开笔记工作区，可新建笔记并附加来源/);
  assert.doesNotMatch(mainSource, /return writeSourceNote\(readerDetail\.item\)/);
});

test('context writing draft preserves selection and sourceRefs', () => {
  const draft = buildWorkspaceContextWritingDraft({
    currentDocument: { documentId: 'doc-9', title: 'Project Review', source: 'Feishu', type: 'document' },
    selection: { kind: 'selection', documentId: 'doc-9', quote: 'Lead with conclusions and then add evidence.', anchor: 'chars:20-31' },
    resources: [{ id: 'doc-10', kind: 'document', documentId: 'doc-10', title: 'User Feedback' }]
  });
  assert.equal(draft.title, 'Project Review ' + String.fromCharCode(183) + ' ' + '\u5199\u4f5c\u8349\u7a3f');
  assert.ok(draft.content.includes('> Lead with conclusions and then add evidence.'));
  assert.equal(draft.sourceRefs.length, 2);
  assert.equal(draft.sourceRefs[0].anchor, 'chars:20-31');
  assert.equal(draft.sourceRefs[1].documentId, 'doc-10');
});

test('Context command persists a writing draft and deep-links its Writing tab', () => {
  for (const fragment of [
    'async function handleWorkspaceCreateWriting(context = workspaceContext)',
    'const payload = buildWorkspaceContextWritingDraft(context)',
    "fetch('/api/writing/drafts'",
    'body: JSON.stringify(payload)',
    'setWritingDeepLinkId(draftId)',
    "route: 'writing', draftId",
    'initialDraftId={tab?.draftId || writingDeepLinkId}',
    'onCreateWriting={handleWorkspaceCreateWriting}'
  ]) assert.ok(mainSource.includes(fragment), `missing ${fragment}`);
});
