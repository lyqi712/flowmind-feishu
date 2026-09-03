import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentRuntime } from '../server/agent/runtime.mjs';
import { ToolRegistry } from '../server/agent/tool-registry.mjs';
import { JsonStateStore } from '../server/state-store.mjs';
import { createInitializedApp } from '../server/app.mjs';

function ndjson(text) {
  return String(text || '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

class PromptAwareModel {
  constructor() {
    this.messages = [];
    this.inFlight = 0;
    this.maxInFlight = 0;
  }

  async publicSettings() {
    return { provider: 'openai-chat', model: 'fixture', configured: true };
  }

  async *streamGenerate({ messages = [] }) {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    this.messages.push(structuredClone(messages));
    await new Promise(resolve => setTimeout(resolve, 40));
    const blob = JSON.stringify(messages);
    try {
      if (/写一个 hello 函数|hello\.js/.test(blob)) {
        yield JSON.stringify({
          kind: 'tool',
          name: 'draft.create',
          arguments: {
            title: 'hello',
            content: 'export function hello() { return "ok"; }',
            fileName: 'hello.js',
            language: 'javascript',
            kind: 'code'
          }
        });
        return;
      }
      if (blob.includes('Alice owns team A')) {
        yield JSON.stringify({ kind: 'final', answer: 'A 组负责人是 Alice。' });
        return;
      }
      if (blob.includes('Bob owns team B')) {
        yield JSON.stringify({ kind: 'final', answer: 'B 组负责人是 Bob。' });
        return;
      }
      yield JSON.stringify({ kind: 'final', answer: '没有对应材料。' });
    } finally {
      this.inFlight -= 1;
    }
  }
}

async function events(runtime, input) {
  const result = [];
  for await (const event of runtime.run(input)) result.push(event);
  return result;
}

test('parallel Agent runs keep document scope, answers and pending writes isolated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-parallel-'));
  const store = new JsonStateStore(join(root, 'state.json'));
  await store.ready;
  const model = new PromptAwareModel();
  const drafts = [];
  const documents = [
    { id: 'doc-alice', title: 'A 组', content: 'Alice owns team A. 项目负责人：Alice。' },
    { id: 'doc-bob', title: 'B 组', content: 'Bob owns team B. 项目负责人：Bob。' }
  ];
  const registry = new ToolRegistry({
    getDocuments: () => documents,
    writers: {
      createDraft: async payload => {
        const draft = { id: `draft_${drafts.length + 1}`, ...payload };
        drafts.push(draft);
        return draft;
      }
    }
  });
  const runtime = new AgentRuntime({ modelService: model, registry, store, firstTokenTimeoutMs: 400, maxResearchSteps: 4 });
  try {
    const [alice, bob, code] = await Promise.all([
      events(runtime, { question: '项目负责人是谁？', mode: 'auto', context: { scopeRequested: true, documentIds: ['doc-alice'], selectedDocuments: [{ id: 'doc-alice', title: 'A 组' }] } }),
      events(runtime, { question: '项目负责人是谁？', mode: 'auto', context: { scopeRequested: true, documentIds: ['doc-bob'], selectedDocuments: [{ id: 'doc-bob', title: 'B 组' }] } }),
      events(runtime, { question: '写一个 hello 函数', mode: 'auto' })
    ]);
    assert.ok(model.maxInFlight >= 2, 'runs should overlap instead of queuing one-by-one');

    const aliceDone = alice.find(event => event.type === 'done');
    const bobDone = bob.find(event => event.type === 'done');
    const codePending = code.find(event => event.type === 'confirmation-required' && event.tool === 'draft.create');
    assert.match(String(aliceDone.result.answer), /Alice/);
    assert.doesNotMatch(String(aliceDone.result.answer), /Bob/);
    assert.match(String(bobDone.result.answer), /Bob/);
    assert.doesNotMatch(String(bobDone.result.answer), /Alice/);
    assert.ok(codePending);
    assert.equal(code.some(event => event.autoRetrieve), false);
    assert.equal(drafts.length, 0);

    const aliceIds = (alice.find(event => event.type === 'start')?.scope?.documentIds || []).map(String);
    const bobIds = (bob.find(event => event.type === 'start')?.scope?.documentIds || []).map(String);
    assert.deepEqual(aliceIds, ['doc-alice']);
    assert.deepEqual(bobIds, ['doc-bob']);
    assert.equal(code.find(event => event.type === 'start')?.scope?.documentIds?.length || 0, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('HTTP parallel conversations persist separately and do not mix lastWritten', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-parallel-http-'));
  const model = new PromptAwareModel();
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    env: {},
    modelService: model,
    ocrService: false,
    transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise(resolve => {
    const current = app.listen(0, '127.0.0.1', () => resolve(current));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const imported = await fetch(`${base}/api/content/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          { fileName: 'a.md', content: '# A 组\n\nAlice owns team A. 项目负责人：Alice。' },
          { fileName: 'b.md', content: '# B 组\n\nBob owns team B. 项目负责人：Bob。' }
        ]
      })
    });
    assert.equal(imported.status, 201);
    const importedBody = await imported.json();
    const docs = (importedBody.items || []).map(item => item.item || item);
    const aliceDoc = docs.find(item => /A 组/.test(String(item.title || ''))) || docs[0];
    const bobDoc = docs.find(item => /B 组/.test(String(item.title || ''))) || docs[1];
    assert.ok(aliceDoc?.id && bobDoc?.id && aliceDoc.id !== bobDoc.id);

    const run = body => fetch(`${base}/api/agent/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(async response => ({ status: response.status, events: ndjson(await response.text()) }));

    const [alice, bob, code] = await Promise.all([
      run({ question: '项目负责人是谁？', mode: 'auto', documentIds: [aliceDoc.id] }),
      run({ question: '项目负责人是谁？', mode: 'auto', documentIds: [bobDoc.id] }),
      run({ question: '写一个 hello 函数', mode: 'auto' })
    ]);
    assert.equal(alice.status, 200);
    assert.equal(bob.status, 200);
    assert.equal(code.status, 200);

    const aliceDone = alice.events.find(event => event.type === 'done');
    const bobDone = bob.events.find(event => event.type === 'done');
    const codePending = code.events.find(event => event.type === 'confirmation-required');
    assert.ok(aliceDone.conversationId);
    assert.ok(bobDone.conversationId);
    assert.notEqual(aliceDone.conversationId, bobDone.conversationId);
    assert.notEqual(aliceDone.conversationId, code.events.find(event => event.type === 'done')?.conversationId);
    assert.match(String(aliceDone.result?.answer || ''), /Alice/);
    assert.doesNotMatch(String(aliceDone.result?.answer || ''), /Bob/);
    assert.match(String(bobDone.result?.answer || ''), /Bob/);
    assert.doesNotMatch(String(bobDone.result?.answer || ''), /Alice/);
    assert.ok(codePending);

    const state = app.locals.store.get();
    const aliceConversation = state.conversations.find(item => item.id === aliceDone.conversationId);
    const bobConversation = state.conversations.find(item => item.id === bobDone.conversationId);
    const codeConversation = state.conversations.find(item => item.id === code.events.find(event => event.type === 'done')?.conversationId);
    assert.match(String(aliceConversation?.answer || ''), /Alice/);
    assert.match(String(bobConversation?.answer || ''), /Bob/);
    assert.equal(aliceConversation?.lastWritten || null, null);
    assert.equal(bobConversation?.lastWritten || null, null);
    assert.equal(codeConversation?.lastWritten || null, null);
    assert.equal((state.writingDrafts || []).length, 0);
    assert.equal((state.notes || []).filter(item => !item.deletedAt).length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await app.locals.close();
    await rm(root, { recursive: true, force: true });
  }
});
