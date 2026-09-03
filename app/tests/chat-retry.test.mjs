import assert from 'node:assert/strict';
import test from 'node:test';
import { retryChatRequest } from '../src/workspace/chat-retry.js';

test('retry targets the failed assistant response and preserves its preceding user request', () => {
  const attachments = [{ temporaryId: 'upload-1', fileName: 'brief.md' }];
  const selection = { documentId: 'doc-a', quote: '必须保留锚点。', anchor: 'chars:4-12' };
  const messages = [
    { id: 'user-a', role: 'user', text: '第一项任务', documentIds: ['doc-a'], mode: 'chat' },
    { id: 'assistant-a', role: 'assistant', text: '第一项完成', done: true },
    { id: 'user-b', role: 'user', text: '第二项任务', documentIds: ['doc-b', 'doc-b'], attachments, mode: 'research', selection },
    { id: 'assistant-b', role: 'assistant', error: '模型超时', mode: 'research', documentIds: ['doc-b'] },
    { id: 'user-c', role: 'user', text: '第三项任务', documentIds: ['doc-c'], mode: 'chat' }
  ];

  assert.deepEqual(retryChatRequest(messages, messages[3], { documentIds: ['fallback'] }), {
    prompt: '第二项任务',
    documentIds: ['doc-b'],
    targetAssistantId: 'assistant-b',
    attachments,
    mode: 'research',
    selection
  });
});

test('retry resolves the latest failed response when invoked from a global error banner', () => {
  const messages = [
    { id: 'user-a', role: 'user', text: '旧问题', documentIds: ['old'] },
    { id: 'assistant-a', role: 'assistant', error: '旧失败' },
    { id: 'user-b', role: 'user', text: '当前问题', documentIds: ['current'], mode: 'quick' },
    { id: 'assistant-b', role: 'assistant', error: '当前失败', mode: 'quick' }
  ];
  const retry = retryChatRequest(messages, null, { mode: 'chat' });
  assert.equal(retry.prompt, '当前问题');
  assert.deepEqual(retry.documentIds, ['current']);
  assert.equal(retry.targetAssistantId, 'assistant-b');
  assert.equal(retry.mode, 'quick');
});

test('retry refuses an incomplete client-side selection instead of replaying it as context', () => {
  const retry = retryChatRequest([
    { id: 'user-a', role: 'user', text: '解释这一段', selection: { quote: '没有绑定文档' } },
    { id: 'assistant-a', role: 'assistant', error: '请求失败' }
  ]);
  assert.equal(retry.selection, null);
});
