import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readerConversationMatchesDocument,
  readerMessagesFromConversation,
  restoredReaderChat
} from '../src/workspace/reader-conversation.js';

const conversation = {
  id: 'conversation-1',
  surface: 'reader',
  readerDocumentId: 'doc-1',
  lastScope: { documentIds: ['doc-1'] },
  messages: [
    { id: 'user-1', role: 'user', content: '第一问', documentIds: ['doc-1'] },
    { id: 'assistant-1', role: 'assistant', content: '第一答', citations: [{ documentId: 'doc-1' }] },
    { id: 'user-2', role: 'user', content: '继续解释' },
    { id: 'assistant-2', role: 'assistant', content: '续答' }
  ]
};

test('reader conversation is bound to its document instead of accepting another chat scope', () => {
  assert.equal(readerConversationMatchesDocument(conversation, 'doc-1'), true);
  assert.equal(readerConversationMatchesDocument(conversation, 'doc-2'), false);
  assert.equal(readerConversationMatchesDocument({ lastScope: { documentIds: ['doc-1'] } }, 'doc-1'), true);
  assert.equal(readerConversationMatchesDocument({ lastScope: { documentIds: ['doc-1', 'doc-2'] } }, 'doc-1'), false);
});

test('server messages restore reader text, citations and previous question context', () => {
  const messages = readerMessagesFromConversation(conversation);
  assert.equal(messages.length, 4);
  assert.equal(messages[1].text, '第一答');
  assert.equal(messages[1].question, '第一问');
  assert.equal(messages[1].done, true);
  assert.deepEqual(messages[1].citations, [{ documentId: 'doc-1' }]);
  assert.equal(messages[3].question, '继续解释');
});

test('restored reader chat rejects mismatched documents', () => {
  assert.equal(restoredReaderChat(conversation, 'doc-2'), null);
  assert.deepEqual(restoredReaderChat(conversation, 'doc-1'), {
    documentId: 'doc-1',
    conversationId: 'conversation-1',
    messages: readerMessagesFromConversation(conversation),
    streaming: false,
    error: ''
  });
});
