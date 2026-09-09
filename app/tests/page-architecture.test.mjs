import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAGE_AI_VERBS,
  PAGE_APPLY_MODES,
  PAPER_RHYTHM,
  WORKSPACE_MODULES,
  applyPageAiResult,
  normalizePageAiResult,
  normalizePageAskSelection,
  buildPageAskContext,
  pageAiApplyLabel,
  pageKind,
  resolvePageAiPlan,
  resolvePageSurface,
  resolvePaperChrome
} from '../src/workspace/page-architecture.js';

test('workspace modules are a workbench, not a product plaza', () => {
  assert.deepEqual(WORKSPACE_MODULES.shell.owns, ['rail', 'composer', 'tabs', 'context-overlay']);
  assert.ok(WORKSPACE_MODULES.shell.not.includes('plaza'));
  assert.ok(WORKSPACE_MODULES.shell.not.includes('calendar'));
  assert.ok(WORKSPACE_MODULES.shell.not.includes('whiteboard'));
  assert.equal(WORKSPACE_MODULES.notes.object, 'page');
  assert.deepEqual(WORKSPACE_MODULES.notes.ai, ['ask', 'rewrite']);
  assert.deepEqual(WORKSPACE_MODULES.knowledge.ai, ['ask']);
  assert.equal(WORKSPACE_MODULES.composer.verb, 'ask');
});

test('a note is one page: look at it, click to type, blank page is already editable', () => {
  assert.equal(resolvePageSurface({ kind: 'note', mode: 'edit', content: '', bodyFocused: false }).showSource, true);
  assert.equal(resolvePageSurface({ kind: 'note', mode: 'edit', content: '已有正文', bodyFocused: false }).showSource, false);
  assert.equal(resolvePageSurface({ kind: 'note', mode: 'edit', content: '已有正文', bodyFocused: false }).showPage, true);
  assert.equal(resolvePageSurface({ kind: 'note', mode: 'edit', content: '已有正文', bodyFocused: false }).reason, 'look-at-page');
  assert.equal(resolvePageSurface({ kind: 'note', mode: 'edit', content: '已有正文', bodyFocused: true }).showSource, true);
  assert.equal(resolvePageSurface({ kind: 'note', mode: 'edit', content: '已有正文', bodyFocused: true }).showPage, false);
  assert.equal(resolvePageSurface({ kind: 'note', mode: 'read', content: '已有正文', bodyFocused: true }).showSource, false);
  assert.equal(resolvePageSurface({ kind: 'problem', mode: 'read', content: '## 问题' }).reason, 'problem-cards');
  assert.equal(resolvePageSurface({ kind: 'problem', mode: 'edit', content: '## 问题' }).showSource, true);
  assert.equal(resolvePageSurface({ kind: 'note', mode: 'edit', content: '', bodyFocused: true }).showPage, false);
  assert.equal(resolvePageSurface({ kind: 'note', mode: 'edit', content: '已有正文', bodyFocused: true }).reason, 'type-on-paper');
});

test('paper chrome stays away until tags exist or a web clip is open', () => {
  assert.equal(PAPER_RHYTHM.proseSize, '16px');
  assert.equal(PAPER_RHYTHM.proseLeading, '1.8');
  assert.equal(PAPER_RHYTHM.column, '720px');
  const looking = resolvePaperChrome({ kind: 'note', mode: 'edit', bodyFocused: false, hasTags: false });
  assert.equal(looking.lookAtPage, true);
  assert.equal(looking.showFormatToolbar, false);
  assert.equal(looking.showTags, false);
  assert.equal(resolvePaperChrome({ kind: 'note', mode: 'edit', bodyFocused: true }).paperEditing, true);
  assert.equal(resolvePaperChrome({ kind: 'note', mode: 'edit', webClipOpen: true }).showFormatToolbar, true);
  assert.equal(resolvePaperChrome({ kind: 'note', hasTags: true }).showTags, true);
  assert.equal(resolvePaperChrome({ kind: 'problem', bodyFocused: true }).paperEditing, false);
});

test('page AI has two verbs and three apply modes, never a second product', () => {
  assert.equal(pageKind({ tags: ['问题记录'] }), 'problem');
  assert.equal(pageKind({ title: '普通笔记' }), 'note');
  assert.deepEqual(
    resolvePageAiPlan({ verb: PAGE_AI_VERBS.ask, kind: 'note', hasSelection: true, requestedMode: 'auto' }),
    { verb: 'ask', applyMode: PAGE_APPLY_MODES.replace, field: 'note', autoWrite: false }
  );
  assert.equal(resolvePageAiPlan({ verb: 'ask', kind: 'note', hasSelection: false, requestedMode: 'auto' }).applyMode, 'insert');
  assert.equal(resolvePageAiPlan({ verb: 'ask', kind: 'problem', requestedMode: 'auto' }).field, 'pitfall');
  assert.equal(resolvePageAiPlan({ verb: 'ask', kind: 'problem', requestedMode: 'resolution' }).field, 'resolution');
  assert.equal(pageAiApplyLabel({ applyMode: 'replace' }, { hasSelection: true }), '替换选区');
  assert.equal(pageAiApplyLabel({ applyMode: 'insert', field: 'note' }, { hasSelection: false }), '用上');
  assert.equal(applyPageAiResult({ content: '开头选区结尾', result: '新句', range: { start: 2, end: 4 }, mode: 'replace' }).content, '开头新句结尾');
  assert.equal(applyPageAiResult({ content: '开头选区结尾', result: '补充', range: { start: 2, end: 4 }, mode: 'insert' }).content.includes('补充'), true);
  assert.equal(normalizePageAiResult('```markdown\n正文\n```'), '正文');
  assert.throws(() => applyPageAiResult({ content: 'x', result: '   ', mode: 'replace' }), /结果为空/);
});

test('composer, reader and notes ask share one page+selection context', () => {
  assert.equal(normalizePageAskSelection({ id: 'n1' }, null), null);
  assert.deepEqual(normalizePageAskSelection({ id: 'doc-1' }, { quote: '划中的话', startOffset: 2, endOffset: 6 }), {
    documentId: 'doc-1',
    quote: '划中的话',
    text: '划中的话',
    anchor: null,
    startOffset: 2,
    endOffset: 6
  });
  const noteAsk = buildPageAskContext({ id: 'note-1', title: '周会', type: 'note' }, { selection: { text: '待办' } });
  assert.equal(noteAsk.currentDocument.type, 'note');
  assert.equal(noteAsk.currentDocument.noteId, 'note-1');
  assert.equal(noteAsk.selection.quote, '待办');
});
