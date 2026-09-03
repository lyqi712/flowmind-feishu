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
  const modelRequests = [];
  const fetchImpl = async (url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    modelRequests.push(body);
    const system = String(body.messages?.[0]?.content || '');
    const answer = system.includes('Task classification: research')
      ? JSON.stringify({ kind: 'final', answer: 'Research result with observed evidence.' })
      : JSON.stringify({ kind: 'tool', name: 'note.create', arguments: { title: 'Agent decision', content: '# Agent decision\n\n[[Linked source]]', tags: ['agent'] } });
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
  return { root, app, base, modelRequests, async close() { await new Promise(resolve => server.close(resolve)); await app.locals.close(); await rm(root, { recursive: true, force: true }); } };
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
    const done = events.find(event => event.type === 'done');
    assert.ok(proposal);
    assert.match(String(done?.result?.answer || ''), /已准备好写入提案|确认后才会写入/);
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
    const persisted = h.app.locals.store.get().conversations.find(item => item.id === events.find(event => event.conversationId)?.conversationId);
    assert.equal(persisted?.lastWritten?.kind, 'note');
    assert.equal(persisted?.lastWritten?.title, 'Agent decision');
    assert.match(String(persisted?.lastWritten?.content || ''), /Agent decision/);
    const conversationId = events.find(event => event.conversationId)?.conversationId;
    const spoken = await fetch(`${h.base}/api/agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: '确认', mode: 'auto', conversationId })
    });
    const spokenEvents = ndjson(await spoken.text());
    const idle = spokenEvents.find(event => event.type === 'done');
    assert.match(String(idle?.result?.answer || ''), /没有待确认|已确认写入|已写入/);
    const graph = await (await fetch(`${h.base}/api/graph`)).json();
    assert.ok(graph.graph.nodes.some(node => node.title === 'Agent decision'));
  } finally { await h.close(); }
});

test('spoken confirmation after a pending write commits through the same confirmation path', async () => {
  const h = await harness();
  try {
    const settings = await fetch(`${h.base}/api/settings/model`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'fixture', apiKey: 'fixture-key', retries: 0 })
    });
    assert.equal(settings.status, 200);
    const runResponse = await fetch(`${h.base}/api/agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Create a tracked decision', mode: 'write' })
    });
    const events = ndjson(await runResponse.text());
    const proposal = events.find(event => event.type === 'confirmation-required');
    const conversationId = events.find(event => event.conversationId)?.conversationId;
    assert.ok(proposal?.confirmation?.id);
    assert.equal(h.app.locals.store.get().notes.length, 0);
    const spoken = await fetch(`${h.base}/api/agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: '确认', mode: 'auto', conversationId })
    });
    const spokenEvents = ndjson(await spoken.text());
    assert.ok(spokenEvents.some(event => event.type === 'confirmation-decision' && event.approved === true));
    assert.ok(spokenEvents.some(event => event.type === 'confirmation-applied' && event.artifact?.kind === 'note'));
    const done = spokenEvents.find(event => event.type === 'done');
    assert.match(String(done?.result?.answer || ''), /已写入知识库笔记/);
    assert.equal(h.app.locals.store.get().notes.length, 1);
    const persisted = h.app.locals.store.get().conversations.find(item => item.id === conversationId);
    assert.equal(persisted?.lastWritten?.kind, 'note');
    assert.match(String(persisted?.lastWritten?.content || ''), /Agent decision/);
  } finally { await h.close(); }
});


test('Agent detail, capability and decision-note APIs retain a server-evidence proposal', async () => {
  const h = await harness();
  try {
    const settings = await fetch(`${h.base}/api/settings/model`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'fixture', apiKey: 'fixture-key', retries: 0 })
    });
    assert.equal(settings.status, 200);
    await fetch(`${h.base}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'mock' }) });
    const documents = await (await fetch(`${h.base}/api/documents`)).json();
    const selected = documents.documents.find(document => document.title === '知识库助手产品说明');
    assert.ok(selected, 'mock sync should expose the product overview for a body-evidence research run');
    const capabilities = await (await fetch(`${h.base}/api/agent/capabilities`)).json();
    assert.equal(capabilities.contractVersion, 2);
    assert.ok(capabilities.capabilities.some(item => item.name === 'decision.note.create'));

    const runResponse = await fetch(`${h.base}/api/agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: '知识库助手有哪些核心能力？', mode: 'research', documentIds: [selected.id] })
    });
    const events = ndjson(await runResponse.text());
    const start = events.find(event => event.type === 'start');
    const done = events.find(event => event.type === 'done');
    assert.ok(start?.runId);
    assert.ok(done?.result?.evidenceIds?.length);
    const detail = await (await fetch(`${h.base}/api/agent/runs/${encodeURIComponent(start.runId)}`)).json();
    assert.equal(detail.run.contract.version, 2);
    assert.equal(detail.run.evidence.length, done.result.evidenceIds.length);

    const proposedResponse = await fetch(`${h.base}/api/agent/runs/${encodeURIComponent(start.runId)}/decision-note`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Release decision' })
    });
    const proposed = await proposedResponse.json();
    assert.equal(proposedResponse.status, 202);
    assert.equal(proposed.confirmation.status, 'pending');
    assert.ok(proposed.evidenceIds.length);
    assert.equal(h.app.locals.store.get().notes.length, 0);
    const confirmed = await fetch(`${h.base}/api/agent/confirmations/${encodeURIComponent(proposed.confirmation.id)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved: true })
    }).then(response => response.json());
    assert.equal(confirmed.confirmation.status, 'confirmed');
    assert.equal(h.app.locals.store.get().notes.length, 1);
    const graph = await (await fetch(`${h.base}/api/graph`)).json();
    assert.ok(graph.graph.edges.some(edge => edge.type === 'source'), 'validated evidence appears as an explicit source edge');
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
    assert.equal(start.scope.selection.requested, false, 'an omitted selection must not be misreported as a failed selection');
    assert.equal(start.scope.documents[0].title, selected.title);
    assert.ok(start.scope.documents[0].contentChars > 0, 'the public Agent scope should expose indexed character count without exposing content');
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

test('Agent selection context is server-verified, issued as evidence, and keeps the stable character anchor', async () => {
  const h = await harness();
  try {
    await fetch(`${h.base}/api/settings/model`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'fixture', apiKey: 'fixture-key', retries: 0 })
    });
    await fetch(`${h.base}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'mock' }) });
    const documents = await (await fetch(`${h.base}/api/documents`)).json();
    const selected = documents.documents.find(document => document.title === '知识库助手产品说明');
    assert.ok(selected);
    const quote = '知识库助手用于连接飞书知识空间';
    const response = await fetch(`${h.base}/api/agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: '这段选区说明了什么？', mode: 'research', documentIds: [selected.id], selection: { documentId: selected.id, quote } })
    });
    const events = ndjson(await response.text());
    const start = events.find(event => event.type === 'start');
    const selectionObservation = events.find(event => event.type === 'observation' && event.tool === 'knowledge.selection');
    const done = events.find(event => event.type === 'done');
    const startSelection = start.scope.selection;
    assert.equal(startSelection.requested, true);
    assert.equal(startSelection.accepted, true);
    assert.match(startSelection.anchor, /^chars:\d+-\d+$/);
    assert.ok(selectionObservation?.evidence?.length);
    assert.ok(done.result.evidenceIds.includes(selectionObservation.evidence[0].id));
    assert.ok(done.result.sourceRefs.some(ref => ref.anchor === startSelection.anchor));
  } finally { await h.close(); }
});

test('Agent reuses a server-derived conversation handoff, persists the visible turn, and lets an explicit empty scope clear prior selection', async () => {
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
    const conversationId = 'conversation-handoff';
    await h.app.locals.store.update(state => {
      state.conversations.push({
        id: conversationId,
        title: 'Release thread',
        question: 'What should we preserve?',
        answer: 'Keep evidence and scope.',
        messages: [
          { id: 'history-user', role: 'user', content: 'The release must remain evidence-based.', createdAt: '2026-08-07T00:00:00.000Z' },
          { id: 'history-assistant', role: 'assistant', content: 'I will preserve that constraint.', createdAt: '2026-08-07T00:00:01.000Z' }
        ],
        lastScope: { documentIds: [selected.id], requested: true, updatedAt: '2026-08-07T00:00:01.000Z' },
        lastMode: 'chat',
        createdAt: '2026-08-07T00:00:00.000Z',
        updatedAt: '2026-08-07T00:00:01.000Z'
      });
    });

    const inheritedResponse = await fetch(`${h.base}/api/agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Research the next release decision.', mode: 'research', conversationId })
    });
    const inheritedEvents = ndjson(await inheritedResponse.text());
    const inheritedStart = inheritedEvents.find(event => event.type === 'start');
    const inheritedDone = inheritedEvents.find(event => event.type === 'done');
    assert.equal(inheritedStart.conversationId, conversationId);
    assert.equal(inheritedStart.handoff.messageCount, 2);
    assert.deepEqual(inheritedStart.scope.documentIds, [selected.id]);
    assert.ok(inheritedDone?.result?.answer);
    const modelRequest = h.modelRequests.at(-1);
    const modelText = modelRequest.messages.map(message => message.content).join('\n');
    assert.match(modelText, /UNTRUSTED_CONVERSATION_HANDOFF_BEGIN/);
    assert.match(modelText, /release must remain evidence-based/);

    const persisted = h.app.locals.store.get().conversations.find(item => item.id === conversationId);
    assert.equal(persisted.lastMode, 'research');
    assert.deepEqual(persisted.lastScope.documentIds, [selected.id]);
    assert.ok(persisted.messages.some(message => message.agentRunId === inheritedStart.runId));

    const inheritedChatResponse = await fetch(`${h.base}/api/chat/stream`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Continue with the selected source.', conversationId })
    });
    const inheritedChatEvents = ndjson(await inheritedChatResponse.text());
    assert.deepEqual(inheritedChatEvents.find(event => event.type === 'retrieval')?.scope?.documentIds, [selected.id]);
    assert.equal(inheritedChatEvents.find(event => event.type === 'done')?.conversationId, conversationId);

    const clearedChatResponse = await fetch(`${h.base}/api/chat/stream`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Continue without a selected source.', conversationId, documentIds: [] })
    });
    const clearedChatEvents = ndjson(await clearedChatResponse.text());
    assert.deepEqual(clearedChatEvents.find(event => event.type === 'retrieval')?.scope?.documentIds, []);

    const clearedResponse = await fetch(`${h.base}/api/agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Research without a selected source.', mode: 'research', conversationId, documentIds: [] })
    });
    const clearedEvents = ndjson(await clearedResponse.text());
    assert.deepEqual(clearedEvents.find(event => event.type === 'start').scope.documentIds, []);
  } finally { await h.close(); }
});

test('Agent Feishu document tool stays unavailable until connected and only writes after confirmation', async () => {
  const missing = await harness();
  try {
    const settings = await fetch(`${missing.base}/api/settings/model`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'fixture', apiKey: 'fixture-key', retries: 0 })
    });
    assert.equal(settings.status, 200);
    const capabilities = await (await fetch(`${missing.base}/api/agent/capabilities`)).json();
    const feishuTool = capabilities.capabilities.find(item => item.name === 'feishu.document.create');
    assert.ok(feishuTool);
    assert.equal(feishuTool.available, false);
    assert.match(String(feishuTool.reason || ''), /连接飞书/);
  } finally { await missing.close(); }

  const root = await mkdtemp(join(tmpdir(), 'flowmind-agent-feishu-'));
  const created = [];
  const connector = {
    publicSettings() {
      return { configured: false, credentialsConfigured: true };
    },
    async createDocument({ title, folderToken }) {
      const document = { document_id: 'doxcn-agent', url: 'https://feishu.cn/docx/doxcn-agent', title, folder_token: folderToken || 'fld-export' };
      created.push(document);
      return { document };
    },
    async ensureExportDestination() {
      return { id: 'fld-export', name: 'FlowMind 导出' };
    }
  };
  const fetchImpl = async (url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    const answer = JSON.stringify({ kind: 'tool', name: 'feishu.document.create', arguments: { title: '发布对照', content: '# 发布对照\n\nAlice owns the release review.' } });
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    });
    if (String(url).includes('fixture.example')) return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    throw new Error(`unexpected fetch ${url}`);
  };
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'), env: {}, fetchImpl, connector, ocrService: false, transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const settings = await fetch(`${base}/api/settings/model`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'fixture', apiKey: 'fixture-key', retries: 0 })
    });
    assert.equal(settings.status, 200);
    const capabilities = await (await fetch(`${base}/api/agent/capabilities`)).json();
    assert.ok(capabilities.capabilities.some(item => item.name === 'feishu.document.create' && item.available));
    const runResponse = await fetch(`${base}/api/agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: '把这段发到飞书', mode: 'auto' })
    });
    assert.equal(runResponse.status, 200);
    const events = ndjson(await runResponse.text());
    const proposal = events.find(event => event.type === 'confirmation-required' && event.tool === 'feishu.document.create');
    assert.ok(proposal);
    assert.equal(created.length, 0);
    const confirmed = await fetch(`${base}/api/agent/confirmations/${encodeURIComponent(proposal.confirmation.id)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved: true })
    }).then(response => response.json());
    assert.equal(confirmed.confirmation.status, 'confirmed');
    assert.equal(created.length, 1);
    assert.equal(confirmed.artifact.kind, 'feishu');
    assert.equal(confirmed.artifact.url, 'https://feishu.cn/docx/doxcn-agent');
    assert.ok(confirmed.artifact.contentItemId);
    assert.ok((app.locals.store.get().feishuExports || []).some(item => item.documentId === 'doxcn-agent'));
    const persisted = app.locals.store.get().conversations.find(item => item.lastWritten?.kind === 'feishu');
    assert.equal(persisted?.lastWritten?.title, '发布对照');
    assert.equal(persisted?.lastWritten?.url, 'https://feishu.cn/docx/doxcn-agent');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await app.locals.close();
    await rm(root, { recursive: true, force: true });
  }
});
