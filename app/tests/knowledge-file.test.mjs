import test from 'node:test';
import assert from 'node:assert/strict';
import { isLibraryNote, isNotesLibrary, libraryFileKind, libraryFileLabel } from '../src/workspace/knowledge-file.js';

test('notes stay markdown even when stored as text/markdown', () => {
  assert.equal(libraryFileKind({ type: 'note', mimeType: 'text/markdown', title: '验收笔记' }), 'markdown');
  assert.equal(libraryFileKind({ contentType: 'note', title: '问题记录' }), 'markdown');
});

test('feishu docs are DOC, not MD, even if mime is markdown', () => {
  assert.equal(libraryFileKind({ contentType: 'document', mimeType: 'text/markdown', source: 'docx', title: '飞书产品说明' }), 'doc');
  assert.equal(libraryFileKind({ contentType: 'docx', title: '飞书产品说明' }), 'doc');
  assert.equal(libraryFileKind({ contentType: 'document', source: 'wiki', title: '知识库页面' }), 'doc');
  assert.equal(libraryFileKind({ contentType: 'document', sourceType: 'feishu', mimeType: 'text/markdown' }), 'doc');
});

test('local office and pdf files keep their real types', () => {
  assert.equal(libraryFileKind({ source: 'local', contentType: 'docx', title: '方案.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'word');
  assert.equal(libraryFileKind({ source: 'local-files', title: '架构.pdf', mimeType: 'application/pdf' }), 'pdf');
  assert.equal(libraryFileKind({ title: '手册.epub' }), 'epub');
  assert.equal(libraryFileKind({ title: 'index.html' }), 'html');
  assert.equal(libraryFileKind({ title: 'README.md', source: 'local' }), 'markdown');
});

test('knowledge library cards exclude notes', () => {
  assert.equal(isLibraryNote({ type: 'note', title: '无标题笔记' }), true);
  assert.equal(isLibraryNote({ contentType: 'note', source: 'local-note' }), true);
  assert.equal(isLibraryNote({ contentType: 'document', source: 'feishu', title: '飞书手册' }), false);
  assert.equal(isNotesLibrary({ id: 'notes', name: 'Notes' }), true);
  assert.equal(isNotesLibrary({ id: 'feishu-space', name: '飞书多来源资料库' }), false);
});

test('labels match Friday file cards', () => {
  assert.equal(libraryFileLabel('pdf'), 'PDF');
  assert.equal(libraryFileLabel('word'), 'Word');
  assert.equal(libraryFileLabel('html'), 'HTML');
  assert.equal(libraryFileLabel('epub'), 'EPUB');
  assert.equal(libraryFileLabel('markdown'), 'MD');
  assert.equal(libraryFileLabel('doc'), 'DOC');
});
