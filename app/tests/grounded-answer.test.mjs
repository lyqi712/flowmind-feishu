import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';
import { EMPTY_RETRIEVAL_ANSWER } from '../server/retrieval-policy.mjs';
import { createFakeModelService } from './helpers/fake-model.mjs';

async function harness(modelService) {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-grounded-'));
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    env: {},
    modelService: modelService || createFakeModelService(),
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise((resolve) => {
    const current = app.listen(0, '127.0.0.1', () => resolve(current));
  });
  return {
    app,
    modelService,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
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

test('ordinary questions retrieve by default, greetings stay conversational', async () => {
  const model = createFakeModelService({ answer: '模型已生成结果 [1]。' });
  const h = await harness(model);
  try {
    await fetch(`${h.base}/api/content/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ fileName: 'release-plan.md', content: '# 发布计划\n\n下周发布需要完成安全审批，负责人 Alice。' }] })
    });
    const ordinary = await chat(h.base, { question: '请帮我拟定下周发布计划' });
    assert.equal(ordinary.find((event) => event.type === 'retrieval')?.mode, 'knowledge');
    assert.ok(ordinary.find((event) => event.type === 'done')?.citations?.length >= 1);
    assert.equal(model.seen.length, 1);

    const greeting = await chat(h.base, { question: '你好' });
    assert.equal(greeting.find((event) => event.type === 'retrieval')?.mode, 'conversation');
    assert.equal(greeting.find((event) => event.type === 'done')?.citations?.length, 0);
    assert.equal(model.seen.length, 2);
  } finally {
    await h.close();
  }
});

test('empty retrieval refuses factual answers without calling the model', async () => {
  const model = createFakeModelService({ answer: '这是不该出现的自由发挥。' });
  const h = await harness(model);
  try {
    await fetch(`${h.base}/api/content/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ fileName: 'orchard.md', content: '# 苹果种植\n\n春季修剪有利于坐果。' }] })
    });
    const events = await chat(h.base, { question: 'ORBIT-DELTA 发布窗口的负责人是谁？' });
    const retrieval = events.find((event) => event.type === 'retrieval');
    const done = events.find((event) => event.type === 'done');
    assert.equal(retrieval.mode, 'knowledge');
    assert.equal(retrieval.matchCount, 0);
    assert.equal(events.some((event) => event.type === 'model'), false);
    assert.equal(events.some((event) => event.type === 'delta'), false);
    assert.equal(done.answer, EMPTY_RETRIEVAL_ANSWER);
    assert.equal(done.model.id, 'empty-retrieval');
    assert.equal(done.citationIntegrity.status, 'empty');
    assert.equal(done.relations.citationCoverage.score, 0);
    assert.ok(done.relations.citationCoverage.uncoveredClaims.some((claim) => claim.includes('ORBIT-DELTA')));
    assert.equal(model.seen.length, 0);
  } finally {
    await h.close();
  }
});

test('invalid citation markers downgrade the answer instead of voiding it', async () => {
  const model = createFakeModelService({ answer: '库内结论见 [1]。库外数字是 [99]。' });
  const h = await harness(model);
  try {
    await fetch(`${h.base}/api/content/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ fileName: 'cite.md', content: '# 发布清单\n\n库内结论：必须保留来源锚点。' }] })
    });
    const events = await chat(h.base, { question: '库内结论要求保留什么？' });
    const done = events.find((event) => event.type === 'done');
    assert.equal(events.some((event) => event.type === 'error'), false);
    assert.match(done.answer, /\[1\]/);
    assert.doesNotMatch(done.answer, /\[99\]/);
    assert.equal(done.citationIntegrity.status, 'downgraded');
    assert.deepEqual(done.citationIntegrity.invalidMarkers, [99]);
    assert.ok(done.relations?.citationCoverage);
    assert.ok(Array.isArray(done.relations.citationCoverage.uncoveredClaims));
    assert.ok(done.relations.citationCoverage.uncoveredClaims.some((claim) => String(claim).includes('库外数字') || String(claim).includes('[99]')));
  } finally {
    await h.close();
  }
});

test('reader ask stays locked to the current document even if the library has more', async () => {
  const model = createFakeModelService({ answer: '这篇只讲当前文档 [1]。' });
  const h = await harness(model);
  try {
    const imported = await (await fetch(`${h.base}/api/content/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          { fileName: 'current.md', content: '# 当前文档\n\n只回答这篇的唯一事实：保存时必须保留来源锚点。' },
          { fileName: 'outside.md', content: '# 外部资料\n\n这份资料不应在问这篇时自动扩大范围。' }
        ]
      })
    })).json();
    const currentId = imported.items[0].item.id;
    const outsideId = imported.items[1].item.id;
    const events = await chat(h.base, {
      question: '这篇在讲什么？',
      documentIds: [currentId, outsideId],
      includeKnowledgeBase: true,
      surface: 'reader',
      readerDocumentId: currentId
    });
    const retrieval = events.find((event) => event.type === 'retrieval');
    const done = events.find((event) => event.type === 'done');
    assert.equal(retrieval.mode, 'knowledge');
    assert.deepEqual(retrieval.scope?.documentIds, [currentId]);
    assert.ok(retrieval.citations.every((citation) => citation.documentId === currentId));
    assert.equal(retrieval.citations.some((citation) => citation.documentId === outsideId), false);
    assert.equal(done.citations.some((citation) => citation.documentId === outsideId), false);
    const saved = await (await fetch(`${h.base}/api/conversations/${done.conversationId}`)).json();
    assert.equal(saved.conversation.surface, 'reader');
    assert.equal(saved.conversation.readerDocumentId, currentId);
  } finally {
    await h.close();
  }
});