import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('来源笔记使用独立持久化 note Tab 并保留来源文档关系', () => {
  assert.match(source, /function openCreatedWorkspaceNote/);
  assert.match(source, /sourceDocumentId: item\?\.id/);
  assert.match(source, /kind: 'note', type: 'note', route: 'notes', noteId/);
  assert.match(source, /initialNoteId=\{tab\?\.noteId \|\| noteDeepLinkId\}/);
});

test('回答重新生成保留旧版本且不重复插入用户问题', () => {
  assert.match(source, /targetAssistantId/);
  assert.match(source, /versions: \[\.\.\.\(message\.versions \|\| \[\]\),/);
  assert.match(source, /重新生成/);
  assert.match(source, /查看 \{message\.versions\.length\} 个历史版本/);
});

test('回答版本控件具备明确样式', () => {
  assert.match(css, /\.answer-version-actions/);
  assert.match(css, /\.answer-versions/);
});
