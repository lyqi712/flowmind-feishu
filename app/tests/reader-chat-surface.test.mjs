import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';
import { createFakeModelService } from './helpers/fake-model.mjs';

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-reader-surface-'));
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    env: {},
    modelService: createFakeModelService(),
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise(resolve => {
    const current = app.listen(0, '127.0.0.1', () => resolve(current));
  });
  return {
    app,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise(resolve => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  };
}

async function chat(base, body) {
  const response = await fetch(`${base}/api/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  assert.equal(response.status, 200);
  return (await response.text()).trim().split('\n').filter(Boolean).map(JSON.parse);
}

test('reader surface conversations stay bound to one document and stay out of ordinary chat history', async () => {
  const h = await harness();
  try {
    await fetch(`${h.base}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'mock' }) });
    const documents = await (await fetch(`${h.base}/api/documents`)).json();
    const documentId = documents.documents[0].id;
    const first = await chat(h.base, {
      question: '这篇在讲什么？',
      documentIds: [documentId],
      surface: 'reader',
      readerDocumentId: documentId
    });
    const done = first.find(event => event.type === 'done');
    assert.ok(done?.conversationId);
    const second = await chat(h.base, {
      question: '继续解释第一点',
      documentIds: [documentId],
      conversationId: done.conversationId,
      surface: 'reader',
      readerDocumentId: documentId
    });
    assert.equal(second.find(event => event.type === 'done')?.conversationId, done.conversationId);
    const saved = await (await fetch(`${h.base}/api/conversations/${done.conversationId}`)).json();
    assert.equal(saved.conversation.surface, 'reader');
    assert.equal(saved.conversation.readerDocumentId, documentId);
    assert.equal(saved.conversation.messages.length, 4);
    const listed = await (await fetch(`${h.base}/api/conversations`)).json();
    assert.equal(listed.conversations.some(item => item.id === done.conversationId), false);
    const readerListed = await (await fetch(`${h.base}/api/conversations?surface=reader`)).json();
    assert.equal(readerListed.conversations.some(item => item.id === done.conversationId), true);
  } finally {
    await h.close();
  }
});

async function agent(base, body) {
  const response = await fetch(`${base}/api/agent/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  assert.equal(response.status, 200);
  return (await response.text()).trim().split('\n').filter(Boolean).map(JSON.parse);
}

test('agent reader ask uses the same locked surface as the reader panel', async () => {
  const h = await harness();
  try {
    await fetch(`${h.base}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'mock' }) });
    const documents = await (await fetch(`${h.base}/api/documents`)).json();
    const documentId = documents.documents[0].id;
    const outsiderId = documents.documents[1]?.id;
    const events = await agent(h.base, {
      question: '这篇在讲什么？',
      documentIds: outsiderId ? [documentId, outsiderId] : [documentId],
      surface: 'reader',
      readerDocumentId: documentId,
      mode: 'auto'
    });
    const start = events.find(event => event.type === 'start');
    const done = events.find(event => event.type === 'done');
    assert.ok(done?.conversationId);
    assert.deepEqual(start.scope.documentIds || start.scope.documents?.map(item => item.id), [documentId]);
    const saved = await (await fetch(`${h.base}/api/conversations/${done.conversationId}`)).json();
    assert.equal(saved.conversation.surface, 'reader');
    assert.equal(saved.conversation.readerDocumentId, documentId);
    const listed = await (await fetch(`${h.base}/api/conversations`)).json();
    assert.equal(listed.conversations.some(item => item.id === done.conversationId), false);
  } finally {
    await h.close();
  }
});
