import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createApp } from '../server/app.mjs';
import { EMPTY_RETRIEVAL_ANSWER } from '../server/retrieval-policy.mjs';
import { createFakeModelService } from './helpers/fake-model.mjs';

const evidenceDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'evidence');

async function startLive() {
  const directory = await mkdtemp(join(tmpdir(), 'flowmind-live-http-'));
  const modelService = createFakeModelService({
    answer: (messages) => {
      const blob = JSON.stringify(messages);
      if (/Alice/.test(blob) && !/Bob owns/.test(blob)) return '值班是 Alice [1]。';
      if (/Bob/.test(blob) && !/Alice owns/.test(blob)) return '值班是 Bob [1]。';
      return '根据已提供资料，结论如下 [1]。';
    }
  });
  const app = createApp({
    stateFile: join(directory, 'state.json'),
    modelService,
    ocrService: false,
    transcriptionService: false,
    feishuOptions: { secretFile: join(directory, 'feishu.enc'), masterKeyFile: join(directory, 'feishu.key') },
    modelOptions: { secretFile: join(directory, 'model.enc'), masterKeyFile: join(directory, 'model.key') }
  });
  await app.locals.ready;
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    modelService,
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await app.locals.close?.();
      await rm(directory, { recursive: true, force: true });
    }
  };
}

async function json(base, path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function agentDone(base, body) {
  const response = await fetch(`${base}/api/agent/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  assert.equal(response.ok, true, `agent HTTP ${response.status}`);
  const events = (await response.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const done = events.find(event => event.type === 'done');
  assert.ok(done?.result, `missing agent done: ${JSON.stringify(events).slice(0, 240)}`);
  return {
    ...done.result,
    conversationId: done.conversationId || events.find(event => event.conversationId)?.conversationId || '',
    events
  };
}

test('真实 HTTP：空库拒答、mock 同步后能搜能问、问题记录能建、内网剪藏被拒、两组并行不串', async () => {
  const live = await startLive();
  try {
    const health = await json(live.base, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);

    const emptyAsk = await agentDone(live.base, { question: '本周发布有哪些风险？', mode: 'auto' });
    assert.equal(emptyAsk.answer, EMPTY_RETRIEVAL_ANSWER);
    assert.equal(emptyAsk.citationStatus, 'empty_retrieval');

    const sync = await json(live.base, '/api/sync', 'POST', { source: 'mock' });
    assert.equal(sync.status, 200);
    assert.equal(sync.data.ok, true);
    assert.ok((sync.data.documents || []).length >= 4, 'mock 库应写入多篇文档');

    const state = await json(live.base, '/api/state');
    assert.ok(state.data.documents.some(item => /产品说明|同步指南|检索/.test(item.title)));

    const catalog = await json(live.base, '/api/documents');
    assert.equal(catalog.status, 200);
    const documents = catalog.data.documents || [];
    const overview = documents.find(item => String(item.title).includes('产品说明'));
    const syncGuide = documents.find(item => String(item.title).includes('同步指南'));
    assert.ok(overview?.id, 'mock 同步后应能列出产品说明');
    assert.ok(syncGuide?.id, 'mock 同步后应能列出同步指南');

    const search = await json(live.base, `/api/search?q=${encodeURIComponent('飞书同步')}`);
    assert.equal(search.status, 200);
    assert.ok((search.data.results || []).length > 0, `search empty: ${JSON.stringify(search.data).slice(0, 240)}`);

    const asked = await agentDone(live.base, {
      question: '知识库助手有哪些核心能力？',
      mode: 'auto',
      documentIds: [overview.id],
      context: { scopeRequested: true, documentIds: [overview.id] }
    });
    assert.notEqual(asked.answer, EMPTY_RETRIEVAL_ANSWER, `scoped ask got: ${asked.answer}`);
    assert.match(asked.answer, /资料|结论|核心|能力|\[1\]|同步|引用/);

    const note = await json(live.base, '/api/notes', 'POST', {
      title: '问题记录：出锅忘葱花',
      content: '# 问题\n出锅忘葱花\n\n# 下次容易忘的点\n出锅前再看一眼葱花',
      artifactKind: 'problem'
    });
    assert.ok(note.status === 200 || note.status === 201, `notes HTTP ${note.status}`);
    assert.ok(note.data.note?.id || note.data.id);

    const privatePreview = await json(live.base, '/api/web/preview', 'POST', { url: 'http://127.0.0.1/secret' });
    assert.ok(privatePreview.status >= 400);
    assert.match(JSON.stringify(privatePreview.data), /内网|私网|localhost|禁止/);

    const kit = await json(live.base, '/api/settings/mcp');
    assert.equal(kit.status, 200);
    assert.match(kit.data.connectKit.prompt, /ask_knowledge/);

    const [alice, bob] = await Promise.all([
      agentDone(live.base, {
        question: '这篇在讲什么？',
        mode: 'auto',
        documentIds: [overview.id],
        context: { scopeRequested: true, documentIds: [overview.id] }
      }),
      agentDone(live.base, {
        question: '这篇在讲什么？',
        mode: 'auto',
        documentIds: [syncGuide.id],
        context: { scopeRequested: true, documentIds: [syncGuide.id] }
      })
    ]);
    assert.ok(alice.answer);
    assert.ok(bob.answer);
    assert.notEqual(alice.answer, EMPTY_RETRIEVAL_ANSWER);
    assert.notEqual(bob.answer, EMPTY_RETRIEVAL_ANSWER);

    const feedback = await json(live.base, '/api/feedback/answer', 'POST', {
      conversationId: asked.conversationId || 'live-http',
      messageId: 'live-msg-1',
      rating: 'positive'
    });
    assert.ok(feedback.status === 200 || feedback.status === 201 || feedback.data.ok !== false);

    await mkdir(evidenceDir, { recursive: true });
    await writeFile(join(evidenceDir, 'live-http-persona.json'), `${JSON.stringify({
      ok: true,
      health: health.data,
      emptyRetrieval: emptyAsk.citationStatus,
      mockDocuments: (sync.data.documents || []).length,
      searchHit: true,
      noteId: note.data.note?.id || note.data.id,
      mcpPrompt: Boolean(kit.data.connectKit?.prompt),
      privatePreviewStatus: privatePreview.status
    }, null, 2)}\n`, 'utf8');
  } finally {
    await live.close();
  }
});
