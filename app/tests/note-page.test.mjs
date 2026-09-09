import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPaperTypeKey,
  NOTES_INDEX_TOKEN,
  buildNotesNavContent,
  detectNoteSlash,
  filterNoteSlashCommands,
  filterNotesIndexRows,
  findNoteTextRange,
  hasNotesIndex,
  insertNotesIndexBlock,
  isEmptyBlockCaret,
  notesIndexKindLabel,
  notesIndexRows,
  replaceNoteSlash,
  resetBlankNotePageSeed,
  seedBlankNotePage,
  shouldCreateBlankNotePage,
  wikiEntryCards,
  buildSelectionAskPrompt
} from '../src/workspace/note-page.js';

test('slash on an empty line opens page, file, index and AI actions — not a year template', () => {
  assert.deepEqual(detectNoteSlash('hello', 5), null);
  assert.equal(detectNoteSlash('/索', 2).query, '索');
  const line = '上一行\n/page';
  assert.equal(detectNoteSlash(line, line.length).query, 'page');
  const filtered = filterNoteSlashCommands('索引');
  assert.equal(filtered.some(item => item.id === 'index'), true);
  assert.equal(filterNoteSlashCommands('').length >= 6, true);
  const next = replaceNoteSlash('/索', { start: 0, end: 2 }, NOTES_INDEX_TOKEN);
  assert.equal(next.includes(NOTES_INDEX_TOKEN), true);
});

test('notes index is a live token on the current page, not a new workspace', () => {
  assert.equal(hasNotesIndex('正文'), false);
  const inserted = insertNotesIndexBlock('正文', 2);
  assert.equal(hasNotesIndex(inserted.content), true);
  assert.equal(insertNotesIndexBlock(inserted.content, 0).content, inserted.content);
  const notes = [
    { id: 'n1', title: '阅读笔记', content: '一段正文', updatedAt: '2026-09-08T02:00:00.000Z' },
    { id: 'n2', title: '问题记录：忘放葱', content: '## 问题\n忘放葱', tags: ['问题记录'], artifactKind: 'problem', updatedAt: '2026-09-08T03:00:00.000Z' }
  ];
  assert.equal(notesIndexRows(notes, { view: 'all' }).length, 2);
  assert.equal(notesIndexRows(notes, { view: 'problem' })[0].id, 'n2');
  assert.equal(notesIndexKindLabel(notes[1]), '问题记录');
  const nav = buildNotesNavContent({ title: '工作台', notes, content: '今天先写这里' });
  assert.match(nav, /今天先写这里/);
  assert.match(nav, /## 快速入口/);
  assert.match(nav, /\[\[阅读笔记\]\]/);
  assert.match(nav, /:::notes-index/);
  assert.doesNotMatch(nav, /周报|年度目标|健康|娱乐/);
  assert.equal(findNoteTextRange('开头\n选中这段\n结尾', '选中这段')?.start, 3);
  assert.equal(findNoteTextRange('开头\n选中这段\n结尾', '选中这段')?.end, 7);
  assert.match(buildSelectionAskPrompt('选中这段'), /选中这段/);
  assert.equal(shouldCreateBlankNotePage([], { archived: false }), true);
  assert.equal(shouldCreateBlankNotePage([{ id: 'n1' }], { archived: false }), false);
  assert.equal(shouldCreateBlankNotePage([], { archived: true }), false);
  assert.equal(isEmptyBlockCaret('', 0), true);
  assert.equal(isEmptyBlockCaret('已有一行', 4), false);
  assert.equal(isEmptyBlockCaret('第一行\n', 4), true);
  assert.equal(filterNotesIndexRows(notes, '葱')[0].id, 'n2');
});

test('looking at a page, / and [[ type onto the paper instead of opening a second editor', () => {
  assert.equal(applyPaperTypeKey('已有正文', 'a'), null);
  assert.equal(applyPaperTypeKey('已有正文', { key: '/', ctrlKey: true }), null);
  assert.equal(applyPaperTypeKey('已有正文', { key: '/', isComposing: true }), null);
  const slash = applyPaperTypeKey('已有正文', '/');
  assert.equal(slash.content, '已有正文\n/');
  assert.equal(slash.openSlash, true);
  assert.equal(slash.caret, '已有正文\n/'.length);
  const wiki = applyPaperTypeKey('已有正文\n', '[');
  assert.equal(wiki.content, '已有正文\n[');
  assert.equal(wiki.openSlash, false);
  const enter = applyPaperTypeKey('已有正文', 'Enter');
  assert.equal(enter.content, '已有正文');
  assert.equal(enter.caret, 4);
});

test('empty workspace seeds at most one blank page even if load runs twice', async () => {
  resetBlankNotePageSeed();
  let calls = 0;
  const create = () => {
    calls += 1;
    return Promise.resolve({ note: { id: 'blank-1', title: '无标题笔记', content: '' } });
  };
  const [first, second] = await Promise.all([seedBlankNotePage(create), seedBlankNotePage(create)]);
  assert.equal(calls, 1);
  assert.equal(first.note.id, 'blank-1');
  assert.equal(second.note.id, 'blank-1');
  resetBlankNotePageSeed();
});
