import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';

function ndjson(text) {
  return String(text || '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-agent-api-'));
  const fetchImpl = async (url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    const answer = JSON.stringify({ kind: 'tool', name: 'note.create', arguments: { title: 'Agent decision', content: '# Agent decision\n\n[[Linked source]]', tags: ['agent'] } });
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  };
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'), env: {}, fetchImpl, ocrService: false, transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { root, app, base, async close() { await new Promise(resolve => server.close(resolve)); await app.locals.close(); await rm(root, { recursive: true, force: true }); } };
}

test('Agent HTTP run persists an auditable pending confirmation and only writes after confirmation', async () => {
  const h = await harness();
  try {
    const settings = await fetch(`${h.base}/api/settings/model`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'fixture', apiKey: 'fixture-key', retries: 0 })
    });
    assert.equal(settings.status, 200);
    const beforeNotes = h.app.locals.store.get().notes;
    const runResponse = await fetch(`${h.base}/api/agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Create a tracked decision', mode: 'write' })
    });
    assert.equal(runResponse.status, 200);
    const events = ndjson(await runResponse.text());
    const proposal = events.find(event => event.type === 'confirmation-required');
    assert.ok(proposal);
    assert.deepEqual(h.app.locals.store.get().notes, beforeNotes);
    const run = h.app.locals.agentRuntime.getRuns()[0];
    assert.equal(run.status, 'awaiting_confirmation');
    assert.equal(run.tools[0].status, 'confirmation_required');
    const confirmationResponse = await fetch(`${h.base}/api/agent/confirmations/${encodeURIComponent(proposal.confirmation.id)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved: true })
    });
    const confirmed = await confirmationResponse.json();
    assert.equal(confirmationResponse.status, 200);
    assert.equal(confirmed.confirmation.status, 'confirmed');
    assert.equal(h.app.locals.store.get().notes.length, 1);
    const graph = await (await fetch(`${h.base}/api/graph`)).json();
    assert.ok(graph.graph.nodes.some(node => node.title === 'Agent decision'));
  } finally { await h.close(); }
});

test('Agent HTTP exposes the selected knowledge scope and rejects stale selection IDs', async () => {
  const h = await harness();
  try {
    const settings = await fetch(`${h.base}/api/settings/model`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'fixture', apiKey: 'fixture-key', retries: 0 })
    });
    assert.equal(settings.status, 200);
    const sync = await fetch(`${h.base}/api/sync`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'mock' })
    });
    assert.equal(sync.status, 200);
    const documents = await (await fetch(`${h.base}/api/documents`)).json();
    const selected = documents.documents[0];
    assert.ok(selected?.id);

    const scopedRun = await fetch(`${h.base}/api/agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Read the selected knowledge source', mode: 'research', documentIds: [selected.id] })
    });
    const events = ndjson(await scopedRun.text());
    const start = events.find(event => event.type === 'start');
    const bootstrap = events.find(event => event.type === 'observation' && event.scopeBootstrap);
    assert.deepEqual(start.scope.documentIds, [selected.id]);
    assert.equal(start.scope.documents[0].title, selected.title);
    assert.deepEqual(bootstrap.observation.scopeDocumentIds, [selected.id]);
    assert.deepEqual(h.app.locals.agentRuntime.getRuns()[0].scope.documentIds, [selected.id]);

    const staleRun = await fetch(`${h.base}/api/agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Read a stale selection', mode: 'research', documentIds: ['missing-document'] })
    });
    const staleEvents = ndjson(await staleRun.text());
    assert.equal(staleEvents.find(event => event.type === 'error')?.error?.code, 'AGENT_DOCUMENT_SCOPE_UNAVAILABLE');
  } finally { await h.close(); }
});
