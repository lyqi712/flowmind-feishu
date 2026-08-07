import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentRuntime } from '../server/agent/runtime.mjs';
import { ToolRegistry } from '../server/agent/tool-registry.mjs';
import { JsonStateStore } from '../server/state-store.mjs';

class FixtureModel {
  constructor(responses = []) { this.responses = [...responses]; this.messages = []; }
  async publicSettings() { return { provider: 'openai-chat', model: 'fixture', configured: true }; }
  async *streamGenerate({ signal, messages = [] }) {
    this.messages.push(structuredClone(messages));
    const response = this.responses.shift();
    if (response === 'wait') {
      await new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason || Object.assign(new Error('aborted'), { code: 'MODEL_REQUEST_ABORTED' }));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
      return;
    }
    if (response instanceof Error) throw response;
    for (const part of Array.isArray(response) ? response : [response]) yield String(part || '');
  }
}

async function harness(responses, { writers = {}, modelService = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-agent-test-'));
  const store = new JsonStateStore(join(root, 'state.json'));
  await store.ready;
  const model = modelService || new FixtureModel(responses);
  const registry = new ToolRegistry({
    getDocuments: () => [
      { id: 'doc-1', title: 'Release plan', content: 'Alice owns the release review and the source anchor is section one.' },
      { id: 'doc-2', title: 'Private plan', content: 'Mallory owns a private plan that must not enter the selected release scope.' }
    ],
    writers
  });
  return {
    root,
    store,
    model,
    runtime: new AgentRuntime({ modelService: model, registry, store, firstTokenTimeoutMs: 25, maxResearchSteps: 4 }),
    async close() { await rm(root, { recursive: true, force: true }); }
  };
}

async function events(runtime, input) {
  const result = [];
  for await (const event of runtime.run(input)) result.push(event);
  return result;
}

test('research runtime performs model-to-tool-to-observation-to-model without exposing hidden reasoning', async () => {
  const h = await harness([
    JSON.stringify({ kind: 'tool', name: 'knowledge.search', arguments: { query: 'release', limit: 3 } }),
    JSON.stringify({ kind: 'final', answer: 'Alice owns the release review.', sourceRefs: [{ documentId: 'doc-1', anchor: 'section-1' }] })
  ]);
  try {
    const result = await events(h.runtime, { question: 'Who owns the release?', mode: 'research' });
    assert.ok(result.some(event => event.type === 'tool' && event.tool === 'knowledge.search'));
    assert.ok(result.some(event => event.type === 'observation' && event.status === 'completed'));
    const done = result.find(event => event.type === 'done');
    assert.equal(done.result.answer, 'Alice owns the release review.');
    assert.equal(done.result.sourceRefs[0].documentId, 'doc-1');
    assert.equal(JSON.stringify(result).includes('chain-of-thought'), false);
  } finally { await h.close(); }
});

test('selected knowledge scope is visible, preloaded, and enforced across Agent modes', async () => {
  const h = await harness([
    JSON.stringify({ kind: 'tool', name: 'knowledge.read', arguments: { documentId: 'doc-2' } }),
    JSON.stringify({ kind: 'final', answer: 'Release plan is the selected source.', sourceRefs: [{ documentId: 'doc-1', title: 'Release plan', anchor: 'forged-anchor' }] })
  ]);
  try {
    const context = {
      scopeRequested: true,
      requestedDocumentIds: ['doc-1'],
      documentIds: ['doc-1'],
      selectedDocuments: [{ id: 'doc-1', title: 'Release plan' }]
    };
    const result = await events(h.runtime, { question: 'Is the selected source available?', mode: 'research', context });
    const start = result.find(event => event.type === 'start');
    const bootstrap = result.find(event => event.type === 'observation' && event.scopeBootstrap);
    const denied = result.find(event => event.type === 'observation' && event.observation?.error?.code === 'KNOWLEDGE_DOCUMENT_OUT_OF_SCOPE');
    const done = result.find(event => event.type === 'done');
    assert.deepEqual(start.scope.documents, [{ id: 'doc-1', title: 'Release plan' }]);
    assert.equal(bootstrap.tool, 'knowledge.search');
    assert.deepEqual(bootstrap.observation.scopeDocumentIds, ['doc-1']);
    assert.ok(denied, 'a selected Agent cannot read outside its document scope');
    assert.equal(done.result.answer, 'Release plan is the selected source.');
    assert.deepEqual(done.result.sourceRefs.map(ref => ref.documentId), ['doc-1']);
    assert.equal(done.result.sourceRefs[0].anchor, null, 'the runtime keeps the observed anchor instead of the model-supplied one');
    assert.match(h.model.messages[0][0].content, /Server-verified selected document scope: Release plan/);
    assert.match(h.model.messages[0][1].content, /Server scope observation/);
  } finally { await h.close(); }

  const quick = await harness(['The selected source is ready.']);
  try {
    const result = await events(quick.runtime, {
      question: 'Read my selected source', mode: 'quick',
      context: { scopeRequested: true, documentIds: ['doc-1'], selectedDocuments: [{ id: 'doc-1', title: 'Release plan' }] }
    });
    const done = result.find(event => event.type === 'done');
    assert.deepEqual(done.result.sourceRefs.map(ref => ref.documentId), ['doc-1']);
    assert.match(quick.model.messages[0][0].content, /Server-verified selected document scope: Release plan/);
  } finally { await quick.close(); }
});

test('a stale selected knowledge scope fails explicitly instead of pretending nothing was selected', async () => {
  const h = await harness([]);
  try {
    const result = await events(h.runtime, {
      question: 'Read the selected source', mode: 'research',
      context: { scopeRequested: true, requestedDocumentIds: ['gone-doc'], missingDocumentIds: ['gone-doc'] }
    });
    assert.equal(result.find(event => event.type === 'error')?.error?.code, 'AGENT_DOCUMENT_SCOPE_UNAVAILABLE');
  } finally { await h.close(); }
});

test('write tools create a durable confirmation and do not mutate notes before approval', async () => {
  const writes = [];
  const h = await harness([JSON.stringify({ kind: 'tool', name: 'note.create', arguments: { title: 'Decision', content: '# Decision\n\nConfirmed content', tags: ['release'] } })], {
    writers: { createNote: async payload => { writes.push(payload); return { id: 'note-1', ...payload }; } }
  });
  try {
    const beforeNotes = structuredClone(h.store.get().notes);
    const result = await events(h.runtime, { question: 'Create a decision note', mode: 'write' });
    const pending = result.find(event => event.type === 'confirmation-required');
    assert.ok(pending);
    assert.deepEqual(h.store.get().notes, beforeNotes);
    assert.equal(writes.length, 0);
    const confirmed = await h.runtime.confirm(pending.confirmation.id, { approved: true });
    assert.equal(confirmed.result.id, 'note-1');
    assert.equal(writes.length, 1);
    assert.equal(h.runtime.getConfirmation(pending.confirmation.id).status, 'confirmed');
  } finally { await h.close(); }
});

test('non-streaming model services remain bootable and Agent reports a capability error only when invoked', async () => {
  const h = await harness([], { modelService: { async publicSettings() { return { provider: 'openai-chat', model: 'fixture', configured: true }; } } });
  try {
    const result = await events(h.runtime, { question: 'Try Agent', mode: 'quick' });
    assert.equal(result.find(event => event.type === 'error')?.error?.code, 'AGENT_MODEL_CAPABILITY_UNAVAILABLE');
  } finally { await h.close(); }
});

test('malformed tool calls, unconfigured MCP, first-token timeout, cancellation and model 500 all become explicit failures', async () => {
  const malformed = await harness([
    JSON.stringify({ kind: 'tool', name: 'knowledge.search', arguments: {} }),
    JSON.stringify({ kind: 'final', answer: 'I need a valid query.' })
  ]);
  try {
    const result = await events(malformed.runtime, { question: 'Research', mode: 'research' });
    assert.ok(result.some(event => event.type === 'observation' && event.status === 'failed' && event.observation.error.code === 'TOOL_ARGUMENT_INVALID'));
    assert.equal(result.find(event => event.type === 'done').result.answer, 'I need a valid query.');
  } finally { await malformed.close(); }

  const unavailableMcp = await harness([
    JSON.stringify({ kind: 'tool', name: 'mcp.list', arguments: {} }),
    JSON.stringify({ kind: 'final', answer: 'MCP is not configured.' })
  ]);
  try {
    const result = await events(unavailableMcp.runtime, { question: 'List MCP tools', mode: 'research' });
    assert.ok(result.some(event => event.type === 'observation' && event.observation.error.code === 'MCP_CAPABILITY_UNAVAILABLE'));
  } finally { await unavailableMcp.close(); }

  const timeout = await harness(['wait']);
  try {
    const result = await events(timeout.runtime, { question: 'Quick answer', mode: 'quick', firstTokenTimeoutMs: 15 });
    assert.ok(result.some(event => event.type === 'error' && event.error.code === 'AGENT_FIRST_TOKEN_TIMEOUT'));
  } finally { await timeout.close(); }

  const cancelled = await harness(['wait']);
  try {
    const controller = new AbortController();
    const promise = events(cancelled.runtime, { question: 'Cancel me', mode: 'quick', signal: controller.signal, firstTokenTimeoutMs: 1000 });
    setTimeout(() => controller.abort(), 5);
    const result = await promise;
    assert.ok(result.some(event => event.type === 'error' && event.error.code === 'AGENT_CANCELLED'));
  } finally { await cancelled.close(); }

  const upstream = await harness([Object.assign(new Error('upstream 500'), { code: 'MODEL_UPSTREAM_ERROR', status: 500 })]);
  try {
    const result = await events(upstream.runtime, { question: 'Will fail', mode: 'quick' });
    assert.ok(result.some(event => event.type === 'error' && event.error.code === 'MODEL_UPSTREAM_ERROR'));
  } finally { await upstream.close(); }
});
