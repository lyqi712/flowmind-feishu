import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonStateStore, sidecarDir, sidecarPath } from '../server/state-store.mjs';

test('JSON state writes recover after one persistence failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-state-store-'));
  const filePath = join(root, 'state.json');
  const store = new JsonStateStore(filePath);
  try {
    await store.ready;
    const persist = store.persist.bind(store);
    let failNextWrite = true;
    store.persist = async state => {
      if (failNextWrite) {
        failNextWrite = false;
        throw Object.assign(new Error('simulated disk failure'), { code: 'EIO' });
      }
      return persist(state);
    };

    const failed = store.update(state => {
      state.documents.push({ id: 'not-persisted', title: '不应落盘' });
    });
    const next = store.update(state => {
      state.documents.push({ id: 'persisted-after-failure', title: '恢复后的写入' });
    });

    await assert.rejects(failed, /simulated disk failure/);
    await next;
    assert.deepEqual(store.get().documents.map(document => document.id), ['persisted-after-failure']);
    const disk = JSON.parse(await readFile(filePath, 'utf8'));
    assert.deepEqual(disk.documents.map(document => document.id), ['persisted-after-failure']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('conversations and agent persist to sidecar files instead of core state.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-state-sidecar-'));
  const filePath = join(root, 'state.json');
  const store = new JsonStateStore(filePath);
  try {
    await store.ready;
    await store.update(state => {
      state.conversations.push({ id: 'c1', question: 'hello', messages: [{ role: 'user', content: 'hello' }] });
      state.agent.runs.push({ id: 'r1', status: 'completed' });
      state.notes.push({ id: 'n1', title: 'note' });
    });
    const disk = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(disk.conversations.length, 0);
    assert.equal(disk.agent.runs.length, 0);
    assert.equal(disk.notes[0].id, 'n1');
    const conversation = JSON.parse(await readFile(join(sidecarDir(filePath, 'conversations'), 'c1.json'), 'utf8'));
    const agent = JSON.parse(await readFile(sidecarPath(filePath, 'agent'), 'utf8'));
    assert.equal(conversation.id, 'c1');
    assert.equal(conversation.messages[0].content, 'hello');
    assert.equal(agent.runs[0].id, 'r1');
    assert.equal(store.get().conversations[0].id, 'c1');
    assert.equal(store.get().agent.runs[0].id, 'r1');
    const snapshot = store.get();
    snapshot.conversations.push({ id: 'ghost' });
    assert.equal(store.get().conversations.some(item => item.id === 'ghost'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('note updates do not rewrite the conversations sidecar', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-state-sidecar-skip-'));
  const filePath = join(root, 'state.json');
  const store = new JsonStateStore(filePath);
  try {
    await store.ready;
    await store.update(state => {
      state.conversations.push({ id: 'c1', question: 'keep me' });
    });
    let conversationWrites = 0;
    const persistConversationRecords = store.persistConversationRecords.bind(store);
    store.persistConversationRecords = async (...args) => {
      conversationWrites += 1;
      return persistConversationRecords(...args);
    };
    await store.update(state => {
      state.notes.push({ id: 'n1', title: 'note' });
    });
    assert.equal(conversationWrites, 0);
    const conversation = JSON.parse(await readFile(join(sidecarDir(filePath, 'conversations'), 'c1.json'), 'utf8'));
    assert.equal(conversation.id, 'c1');
    assert.equal(store.get().notes[0].id, 'n1');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy embedded conversations migrate onto the sidecar once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-state-migrate-'));
  const filePath = join(root, 'state.json');
  await writeFile(filePath, `${JSON.stringify({
    version: 2,
    conversations: [{ id: 'legacy', question: 'old', messages: [{ role: 'user', content: 'old' }] }],
    agent: { runs: [{ id: 'run1', status: 'completed' }], confirmations: [] }
  })}\n`, 'utf8');
  const store = new JsonStateStore(filePath);
  try {
    await store.ready;
    const disk = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(disk.conversations.length, 0);
    assert.equal(disk.agent.runs.length, 0);
    const conversation = JSON.parse(await readFile(join(sidecarDir(filePath, 'conversations'), 'legacy.json'), 'utf8'));
    const agent = JSON.parse(await readFile(sidecarPath(filePath, 'agent'), 'utf8'));
    assert.equal(conversation.id, 'legacy');
    assert.equal(agent.runs[0].id, 'run1');
    assert.equal(store.get().conversations[0].question, 'old');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('upsertConversation writes one conversation file without cloning the rest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-state-upsert-'));
  const filePath = join(root, 'state.json');
  const store = new JsonStateStore(filePath);
  try {
    await store.ready;
    await store.upsertConversation({ id: 'keep', question: 'keep', messages: [{ id: 'm1', role: 'user', content: 'keep' }], updatedAt: '2026-08-30T00:00:00.000Z' });
    const keepPath = join(sidecarDir(filePath, 'conversations'), 'keep.json');
    const before = await readFile(keepPath, 'utf8');
    await store.upsertConversation({ id: 'next', question: 'next', messages: [{ id: 'm2', role: 'user', content: 'next' }], updatedAt: '2026-08-30T00:01:00.000Z' });
    assert.equal(await readFile(keepPath, 'utf8'), before);
    assert.equal(store.getConversation('next').question, 'next');
    assert.equal(store.get().conversations.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
