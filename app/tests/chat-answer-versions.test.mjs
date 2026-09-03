import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { retryChatRequest } from '../src/workspace/chat-retry.js';

const source = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('来源笔记使用独立持久化 note Tab 并保留来源文档关系', () => {
  assert.match(source, /function openCreatedWorkspaceNote/);
  assert.match(source, /sourceDocumentId: item\?\.id/);
  assert.match(source, /kind: 'note', type: 'note', route: 'notes', noteId/);
  assert.match(source, /initialNoteId=\{tab\?\.noteId \|\| noteDeepLinkId\}/);
});

test('回答重新生成保留已完成旧版本且不重复插入用户问题', () => {
  assert.match(source, /targetAssistantId/);
  assert.match(source, /message\.done && message\.text \? \[\.\.\.\(message\.versions \|\| \[\]\),/);
  assert.match(source, /重新生成/);
  assert.match(source, /查看 \{message\.versions\.length\} 个历史版本/);
});

test('失败答案重试回放它自身对应的用户请求，而不是会话最后一条消息', () => {
  assert.match(source, /function retryLast\(failedMessage = null\)/);
  assert.match(source, /retryChatRequest\(messages, failedMessage/);
  assert.match(source, /onClick=\{\(\) => retryLast\(message\)\}/);
  const retry = retryChatRequest([
    { id: 'user-1', role: 'user', text: '旧问题', documentIds: ['doc-old'] },
    { id: 'assistant-1', role: 'assistant', error: '旧失败' },
    { id: 'user-2', role: 'user', text: '目标问题', documentIds: ['doc-target'], mode: 'research' },
    { id: 'assistant-2', role: 'assistant', error: '目标失败', mode: 'research' },
    { id: 'user-3', role: 'user', text: '更晚的问题', documentIds: ['doc-later'] }
  ], { id: 'assistant-2', role: 'assistant', error: '目标失败' });
  assert.equal(retry.prompt, '目标问题');
  assert.deepEqual(retry.documentIds, ['doc-target']);
  assert.equal(retry.targetAssistantId, 'assistant-2');
  assert.equal(retry.mode, 'research');
});

test('回答版本控件具备明确样式', () => {
  assert.match(css, /\.answer-version-actions/);
  assert.match(css, /\.answer-versions/);
});
