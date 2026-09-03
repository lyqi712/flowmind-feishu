import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';

const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../server/app.mjs', import.meta.url), 'utf8');

function ndjson(text) {
  return String(text || '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('ask() routes attachments through askAgent instead of /api/chat/stream', () => {
  const askBody = mainSource.slice(mainSource.indexOf('async function ask('), mainSource.indexOf('async function runChatSkill('));
  assert.match(askBody, /return askAgent\(/);
  assert.doesNotMatch(askBody, /\/api\/chat\/stream/);
});

test('agent run resolves attachments into document scope and persists them on the conversation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-attachment-agent-'));
  const fetchImpl = async (_url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    const system = String(body.messages?.[0]?.content || '');
    const answer = system.includes('Task classification')
      ? JSON.stringify({ kind: 'final', answer: 'Attachment summary from agent path.' })
      : JSON.stringify({ kind: 'final', answer: 'Attachment summary from agent path.' });
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
    stateFile: join(root, 'state.json'),
    env: {},
    fetchImpl,
    ocrService: false,
    transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const settings = await fetch(`${base}/api/settings/model`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai-chat', baseUrl: 'https://fixture.example/v1', model: 'fixture', apiKey: 'fixture-key', retries: 0 })
    });
    assert.equal(settings.status, 200);
    const encoded = Buffer.from('ATTACHMENT_FIXTURE_SENTENCE for agent path', 'utf8').toString('base64');
    const runResponse = await fetch(`${base}/api/agent/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: '请总结附件要点',
        mode: 'auto',
        attachments: [{ fileName: 'brief.txt', mimeType: 'text/plain', dataUrl: `data:text/plain;base64,${encoded}` }]
      })
    });
    assert.equal(runResponse.status, 200);
    const events = ndjson(await runResponse.text());
    const error = events.find(event => event.type === 'error');
    assert.equal(error, undefined, error?.error?.message || 'agent run failed');
    const done = events.find(event => event.type === 'done');
    assert.ok(done?.conversationId, 'agent run must return conversation id');
    assert.match(String(done?.result?.answer || ''), /Attachment summary|附件|要点/);
    const persisted = app.locals.store.get().conversations.find(item => item.id === done.conversationId);
    assert.ok(persisted, 'conversation must be persisted');
    assert.equal(persisted.messages.at(-2)?.attachments?.length, 1);
    assert.ok(persisted.lastScope?.documentIds?.length >= 1, 'attachment document must merge into agent scope');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await app.locals.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('server exposes attachment merge helper for agent scope', () => {
  for (const fragment of [
    'function mergeAttachmentIntoAgentScope(scope, attachmentContext = {}, { includeKnowledgeBase = false } = {})',
    'attachmentContext = await chatAttachments.resolveRequest(body, { signal: controller.signal })',
    'mergeAttachmentIntoAgentScope(baseScope, attachmentContext, { includeKnowledgeBase })',
    'attachments: attachmentContext.attachments',
    'requiredDocumentIds: scope.requiredDocumentIds'
  ]) assert.ok(appSource.includes(fragment), `missing ${fragment}`);
});
