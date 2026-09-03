import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentRuntime } from '../server/agent/runtime.mjs';
import { ToolRegistry } from '../server/agent/tool-registry.mjs';
import { JsonStateStore } from '../server/state-store.mjs';
import { EMPTY_RETRIEVAL_ANSWER } from '../server/retrieval-policy.mjs';
import { expandQueryAliases, searchDocuments, searchEvidenceChunks } from '../server/retrieval.mjs';
import { looksTemplatedAnswer } from '../shared/answer-text.mjs';

function percentile(values, p) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

class TokenModel {
  constructor({ answer = '根据材料，发布前要完成安全审批，负责人是 Alice [1]。', delayMs = 0, chunk = 8 } = {}) {
    this.answer = answer;
    this.delayMs = delayMs;
    this.chunk = chunk;
    this.inFlight = 0;
    this.maxInFlight = 0;
    this.calls = 0;
  }

  async publicSettings() {
    return { provider: 'openai-chat', model: 'fixture', configured: true };
  }

  async *streamGenerate() {
    this.calls += 1;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      const text = String(this.answer);
      for (let index = 0; index < text.length; index += this.chunk) {
        if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
        yield text.slice(index, index + this.chunk);
      }
    } finally {
      this.inFlight -= 1;
    }
  }
}

class UnconfiguredModel {
  constructor() { this.calls = 0; }
  async publicSettings() {
    this.calls += 1;
    return { provider: 'local', model: '', configured: false };
  }
  async *streamGenerate() {
    throw new Error('unconfigured model must not generate');
  }
}

async function harness({ model, documents } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-ai-stress-'));
  const store = new JsonStateStore(join(root, 'state.json'));
  await store.ready;
  const docs = documents || [];
  const registry = new ToolRegistry({ getDocuments: () => docs });
  return {
    root,
    model,
    runtime: new AgentRuntime({ modelService: model, registry, store, firstTokenTimeoutMs: 250, maxResearchSteps: 3 }),
    async close() { await rm(root, { recursive: true, force: true }); }
  };
}

async function collect(runtime, input) {
  const result = [];
  const started = performance.now();
  for await (const event of runtime.run(input)) result.push(event);
  return { events: result, elapsedMs: performance.now() - started };
}

function corpus(count = 80) {
  return Array.from({ length: count }, (_, index) => {
    if (index === 7) {
      return { id: 'doc-gate', title: '发布闸门', content: '关键结论：上线前必须完成安全审批，负责人是 Alice，截止周五。'.repeat(40) };
    }
    if (index === 19) {
      return { id: 'doc-conflict', title: '风险清单', content: '风险清单把同一功能的审批改成事后抽查，和发布闸门冲突。'.repeat(24) };
    }
    return {
      id: `noise-${index}`,
      title: `资料 ${index}：日常同步备忘`,
      content: `第 ${index} 份备忘只记录例会纪要、食堂菜单和无关进度，不涉及审批闸门。`.repeat(30)
    };
  });
}

test('spoken workplace paraphrases still hit the approval document in a noisy corpus', () => {
  const documents = corpus(60);
  assert.match(expandQueryAliases('谁点头放行'), /审批/);
  const started = performance.now();
  const ranked = searchDocuments(documents, '谁点头放行', { limit: 4 });
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 250, `alias retrieval took ${elapsedMs.toFixed(1)}ms`);
  assert.equal(ranked[0].document.id, 'doc-gate');
  const chunks = searchEvidenceChunks(documents, '发车门槛谁签字', { limit: 2 });
  assert.equal(chunks[0].document.id, 'doc-gate');
  assert.match(chunks[0].evidenceText, /Alice/);
});

test('large-corpus retrieval stays within a comfortable latency budget', () => {
  const documents = corpus(120);
  const queries = [
    '发布前要完成什么安全审批',
    '谁点头放行',
    '闸门谁拍板',
    '发车门槛',
    '风险清单和发布闸门有没有打架',
    '食堂周菜单',
    'ORBIT-DELTA 窗口',
    'Alice 负责哪一段'
  ];
  const samples = [];
  for (let round = 0; round < 4; round += 1) {
    for (const query of queries) {
      const started = performance.now();
      searchEvidenceChunks(documents, query, { limit: 4 });
      samples.push(performance.now() - started);
    }
  }
  const p95 = percentile(samples, 95);
  const max = Math.max(...samples);
  assert.ok(p95 < 350, `retrieval p95 ${p95.toFixed(1)}ms exceeded 350ms`);
  assert.ok(max < 900, `retrieval max ${max.toFixed(1)}ms exceeded 900ms`);
});

test('parallel Agent conversations stay isolated, stream in order, and keep answers grounded', async () => {
  const documents = corpus(40);
  const model = new TokenModel({ delayMs: 1, chunk: 12 });
  const h = await harness({ model, documents });
  try {
    const jobs = [
      collect(h.runtime, { question: '发布前要完成什么安全审批？负责人是谁？', mode: 'auto' }),
      collect(h.runtime, {
        question: '项目负责人是谁？',
        mode: 'auto',
        context: {
          scopeRequested: true,
          documentIds: ['doc-gate'],
          selectedDocuments: [{ id: 'doc-gate', title: '发布闸门' }]
        }
      }),
      collect(h.runtime, {
        question: '对比发布闸门和风险清单，审批口径有没有打架',
        mode: 'auto'
      }),
      collect(h.runtime, { question: 'ZXCVBNMQUUX99xyzzy', mode: 'auto' })
    ];
    const results = await Promise.all(jobs);
    assert.ok(model.maxInFlight >= 2, 'parallel runs should overlap on the model');
    const answers = results.map(entry => entry.events.find(event => event.type === 'done')?.result);
    assert.match(answers[0].answer, /Alice|审批/);
    assert.equal(looksTemplatedAnswer(answers[0].answer), false);
    assert.ok((answers[0].sourceRefs || []).some(ref => ref.documentId === 'doc-gate'));
    assert.ok((answers[1].sourceRefs || []).every(ref => ref.documentId === 'doc-gate'));
    const observedIds = results[2].events.flatMap(event => {
      const observation = event.observation && typeof event.observation === 'object' ? event.observation : {};
      return [
        observation.documentId,
        ...(Array.isArray(observation.matches) ? observation.matches.map(match => match.documentId || match.document?.id) : []),
        ...(Array.isArray(event.work?.documents) ? event.work.documents.map(document => document.documentId) : [])
      ];
    });
    assert.ok(observedIds.includes('doc-gate'), 'comparison must observe the gate document');
    assert.ok(observedIds.includes('doc-conflict'), 'comparison must observe the conflict document');
    assert.equal(answers[3].answer, EMPTY_RETRIEVAL_ANSWER);
    assert.equal(answers[3].citationStatus, 'empty_retrieval');

    const first = results[0].events;
    const types = first.map(event => event.type);
    assert.equal(types[0], 'start');
    assert.ok(types.includes('status'));
    assert.ok(types.includes('delta'));
    assert.equal(types.at(-1), 'done');
    assert.ok(types.indexOf('delta') > types.indexOf('status'));
    const startToFirstDelta = first.findIndex(event => event.type === 'delta');
    assert.ok(startToFirstDelta >= 0);
    results.forEach(entry => {
      assert.ok(entry.elapsedMs < 4000, `agent run took ${entry.elapsedMs.toFixed(1)}ms`);
    });
  } finally {
    await h.close();
  }
});

test('burst sequential asks stay bounded and keep conversation-only replies off the model', async () => {
  const documents = corpus(24);
  const model = new TokenModel({ delayMs: 0, chunk: 40 });
  const h = await harness({ model, documents });
  try {
    const started = performance.now();
    const greeting = await collect(h.runtime, { question: '你好', mode: 'auto' });
    const thanks = await collect(h.runtime, { question: '谢谢', mode: 'auto' });
    const grounded = await collect(h.runtime, { question: '谁点头放行？', mode: 'auto' });
    const empty = await collect(h.runtime, { question: 'ZXCVBNMQUUX99xyzzy', mode: 'auto' });
    const elapsedMs = performance.now() - started;
    assert.match(greeting.events.find(event => event.type === 'done').result.answer, /你好/);
    assert.match(thanks.events.find(event => event.type === 'done').result.answer, /不客气/);
    assert.match(grounded.events.find(event => event.type === 'done').result.answer, /Alice|审批/);
    assert.equal(empty.events.find(event => event.type === 'done').result.answer, EMPTY_RETRIEVAL_ANSWER);
    assert.equal(model.calls, 1, 'only the grounded knowledge question should call the model');
    assert.ok(elapsedMs < 2500, `burst sequential asks took ${elapsedMs.toFixed(1)}ms`);
  } finally {
    await h.close();
  }
});
