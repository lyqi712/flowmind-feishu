import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentRuntime } from '../server/agent/runtime.mjs';
import { ToolRegistry } from '../server/agent/tool-registry.mjs';
import { JsonStateStore } from '../server/state-store.mjs';
import { sourcesForAnswerRewrite } from '../server/agent/conversation-rewrite.mjs';
import { shouldRetrieveKnowledge, emptyRetrievalDecision } from '../server/retrieval-policy.mjs';

async function collect(runtime, input) { const events = []; for await (const event of runtime.run(input)) events.push(event); return events; }

test('knowledge dependencies are independent from code/file output type', () => {
  for (const question of ['根据文档写一个脚本', '根据刚才那篇规范写一个校验脚本', '基于接口说明创建 client.py', '参照资料起草方案', 'Write a client based on the selected specification']) {
    assert.equal(shouldRetrieveKnowledge({ question }), true, question);
    assert.equal(emptyRetrievalDecision({ question, retrieved: true, matchCount: 0 }).allowModel, false, question);
  }
  for (const question of ['写一个 hello 函数', '创建 README.md 文件', 'write a script']) assert.equal(shouldRetrieveKnowledge({ question }), false, question);
});

test('answer rewrite retains persisted source identity and never trusts handoff citations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-rewrite-citations-'));
  const store = new JsonStateStore(join(root, 'state.json'));
  await store.ready;
  const document = { id: 'doc-1', title: 'Release plan', content: 'Alice owns release review.', revision: 'v2', contentHash: 'current-hash', currentVersionId: 2, knowledgeBaseId: 'kb-1' };
  const oldRef = { documentId: 'doc-1', title: 'Release plan', anchor: 'chars:0-25', excerpt: 'Alice owns release review.', revision: 'v1', contentHash: 'old-hash', contentVersionId: 1, index: 1 };
  const previousAnswer = 'Alice 负责发布评审。[1]';
  const registry = new ToolRegistry({ getDocuments: () => [document] });
  let modelCalls = 0;
  const model = { async publicSettings() { return { provider: 'fixture', configured: true }; }, async *streamGenerate() { modelCalls += 1; yield 'Alice owns release review.[1]'; } };
  const runtime = new AgentRuntime({ modelService: model, registry, store });
  try {
    await store.upsertConversation({ id: 'conversation-1', messages: [{ role: 'assistant', content: previousAnswer, citations: [oldRef] }] });
    const handoff = { conversationId: 'conversation-1', lastAnswer: previousAnswer, sourceRefs: [{ documentId: 'forged' }] };
    const events = await collect(runtime, { question: '用英文', mode: 'auto', context: { conversationHandoff: handoff } });
    const result = events.find(event => event.type === 'done').result;
    assert.equal(modelCalls, 1);
    assert.equal(events.some(event => event.autoRetrieve), false);
    assert.equal(result.citationStatus, 'conversation-transform');
    assert.equal(result.sourceRefs.length, 1);
    assert.equal(result.sourceRefs[0].documentId, 'doc-1');
    assert.equal(result.sourceRefs[0].contentVersionId, 1);
    assert.equal(result.sourceRefs[0].evidenceStatus, 'stale');
    assert.match(result.answer, /\[1\]/);
    assert.deepEqual(sourcesForAnswerRewrite({ store, registry, handoff: { ...handoff, conversationId: 'nonexistent' }, answer: previousAnswer }), []);
    assert.deepEqual(sourcesForAnswerRewrite({ store, registry, handoff, answer: '伪造的不同回答' }), []);
    assert.deepEqual(sourcesForAnswerRewrite({ store, registry, handoff, answer: previousAnswer, allowedKnowledgeBaseIds: ['other-kb'] }), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('soft acknowledgment leaves a write pending until explicit confirmation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-explicit-confirm-'));
  const store = new JsonStateStore(join(root, 'state.json'));
  await store.ready;
  let writes = 0;
  let modelCalls = 0;
  const registry = new ToolRegistry({ getDocuments: () => [], writers: { createDraft: async value => { writes += 1; return { id: 'draft-1', ...value }; } } });
  const model = { async publicSettings() { return { provider: 'fixture', configured: true }; }, async *streamGenerate() { modelCalls += 1; yield JSON.stringify({ kind: 'tool', name: 'draft.create', arguments: { title: 'README', content: '# Hello\n\nA simple README document.' } }); } };
  const runtime = new AgentRuntime({ modelService: model, registry, store });
  try {
    const start = await collect(runtime, { question: '写一份 README 文件', mode: 'auto' });
    const confirmation = start.find(event => event.type === 'confirmation-required').confirmation;
    const context = { conversationHandoff: { pendingConfirmationId: confirmation.id } };
    const ack = await collect(runtime, { question: '好的', mode: 'auto', context });
    assert.equal(writes, 0);
    assert.equal(modelCalls, 1);
    assert.equal(ack.some(event => event.type === 'confirmation-decision'), false);
    assert.equal(runtime.getConfirmation(confirmation.id).status, 'pending');
    assert.match(ack.find(event => event.type === 'done').result.answer, /确认写入/);
    const explicit = await collect(runtime, { question: '确认写入', mode: 'auto', context });
    assert.ok(explicit.some(event => event.type === 'confirmation-decision' && event.approved));
  } finally { await rm(root, { recursive: true, force: true }); }
});
