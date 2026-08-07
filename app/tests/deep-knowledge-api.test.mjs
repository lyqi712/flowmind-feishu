import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-deep-knowledge-'));
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    env: {},
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise((resolve) => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  return { base: `http://127.0.0.1:${server.address().port}`, async close() { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); } };
}

async function json(h, path, method = 'GET', body) {
  const response = await fetch(h.base + path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { response, body: await response.json() };
}

async function chat(h, body) {
  const response = await fetch(h.base + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  return (await response.text()).trim().split('\n').filter(Boolean).map(JSON.parse);
}

test('chat done event and persisted conversation include deep knowledge relations', async () => {
  const h = await harness();
  try {
    await json(h, '/api/sync', 'POST', { source: 'mock' });
    const events = await chat(h, { question: '比较飞书同步、知识库问答和安全配置之间的联系' });
    const done = events.find((event) => event.type === 'done');
    assert.ok(done?.conversationId);
    assert.equal(done.question, '比较飞书同步、知识库问答和安全配置之间的联系');
    assert.ok(done.relations?.rewrittenQuestion);
    assert.ok(done.relations?.intent?.label);
    assert.ok(done.relations?.plan?.steps?.length >= 3);
    assert.ok(Array.isArray(done.relations?.relatedDocuments));
    assert.ok(Number.isFinite(done.relations?.citationCoverage?.score));
    assert.ok(done.relations?.followUpSuggestions?.length >= 1);

    const saved = await json(h, '/api/conversations/' + done.conversationId);
    assert.deepEqual(saved.body.conversation.relations, done.relations);
    assert.deepEqual(saved.body.conversation.messages.at(-1).relations, done.relations);
  } finally { await h.close(); }
});

test('knowledge relation endpoint respects document scope and returns stable analysis schema', async () => {
  const h = await harness();
  try {
    const sync = await json(h, '/api/sync', 'POST', { source: 'mock' });
    const documentIds = sync.body.state.documents.slice(0, 2).map((item) => item.id);
    const result = await json(h, '/api/knowledge/relations', 'POST', { question: '这两篇文档有哪些共同主题？', documentIds, answer: '它们都与知识工作有关。', citations: [] });
    assert.equal(result.response.status, 200);
    assert.ok(result.body.relations.rewrittenQuestion);
    assert.ok(result.body.relations.plan.steps.length >= 3);
    assert.ok(result.body.relations.relatedDocuments.every((item) => documentIds.includes(item.documentId)));
  } finally { await h.close(); }
});

test('answer artifacts create note, task and writing records with source references', async () => {
  const h = await harness();
  try {
    await json(h, '/api/sync', 'POST', { source: 'mock' });
    const done = (await chat(h, { question: '飞书知识库同步后如何形成日常工作流？' })).find((event) => event.type === 'done');
    assert.ok(done.citations.length > 0);
    const input = { question: done.question, answer: done.answer, citations: done.citations, relations: done.relations };
    for (const kind of ['note', 'task', 'writing']) {
      const created = await json(h, '/api/answers/artifacts', 'POST', { kind, ...input });
      assert.equal(created.response.status, 201);
      assert.equal(created.body.kind, kind);
      assert.ok(created.body.artifact.title.length > 0);
      assert.ok(created.body.artifact.content.length > 0);
      assert.ok(created.body.artifact.sourceRefs.length > 0);
    }
    const notes = await json(h, '/api/notes?archived=true');
    assert.equal(notes.body.notes.length, 2);
    assert.ok(notes.body.notes.some((item) => item.artifactKind === 'task' && item.tags.includes('行动任务')));
    const drafts = await json(h, '/api/writing/drafts');
    assert.equal(drafts.body.drafts.length, 1);
    assert.equal(drafts.body.drafts[0].template, 'knowledge-answer');
  } finally { await h.close(); }
});

test('note creation without a title uses a stable default', async () => {
  const h = await harness();
  try {
    const created = await json(h, '/api/notes', 'POST', { content: '默认标题回归测试' });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.note.title, '无标题笔记');
  } finally { await h.close(); }
});
