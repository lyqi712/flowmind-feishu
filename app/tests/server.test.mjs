import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.mjs';
import { createFakeModelService } from './helpers/fake-model.mjs';

async function createHarness(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ima-feishu-server-'));
  const stateFile = options.stateFile || join(directory, 'runtime-data', 'state.json');
  // 隔离飞书/模型凭据文件到临时目录，避免读取 runtime-data 中的真实配置（2026-08-12：真实凭据已保存后必须隔离）。
  const app = createApp({
    ...options,
    stateFile,
    modelService: options.modelService || createFakeModelService(),
    feishuOptions: { secretFile: join(directory, 'feishu-secret.enc'), masterKeyFile: join(directory, '.feishu-master-key') },
    modelOptions: { secretFile: join(directory, 'model-secret.enc'), masterKeyFile: join(directory, '.model-master-key') }
  });
  await app.locals.ready;
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    app,
    directory,
    stateFile,
    baseUrl,
    async close({ keepDirectory = false } = {}) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (!keepDirectory) await rm(directory, { recursive: true, force: true });
    }
  };
}

async function postJson(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function readNdjson(response) {
  const text = await response.text();
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('API rejects non-local browser origins while allowing the local development origin', async () => {
  const harness = await createHarness();
  try {
    const blocked = await fetch(`${harness.baseUrl}/api/health`, { headers: { Origin: 'https://not-local.example' } });
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).error.code, 'LOCAL_ORIGIN_REQUIRED');
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);

    const allowed = await fetch(`${harness.baseUrl}/api/health`, { headers: { Origin: 'http://127.0.0.1:5179' } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5179');
  } finally {
    await harness.close();
  }
});

test('Mock 同步写入 JSON，/api/state 可在新 app 实例恢复', async () => {
  const harness = await createHarness();
  let persistedDirectory = harness.directory;
  try {
    const initial = await fetch(`${harness.baseUrl}/api/state`).then((response) => response.json());
    assert.equal(initial.documents.length, 0);
    assert.equal(initial.runtime.apiPort, 8789);

    const response = await postJson(harness.baseUrl, '/api/sync', { source: 'mock' });
    assert.equal(response.status, 200);
    const sync = await response.json();
    assert.equal(sync.ok, true);
    assert.equal(sync.source, 'mock');
    assert.equal(sync.fallbackUsed, false);
    assert.ok(sync.documents.length >= 5);

    const diskState = JSON.parse(await readFile(harness.stateFile, 'utf8'));
    assert.equal(diskState.sync.status, 'completed');
    assert.equal(diskState.documents.length, sync.documents.length);
    assert.equal(diskState.knowledgeBases[0].documentCount, sync.documents.length);

    await harness.close({ keepDirectory: true });
    const restored = await createHarness({ stateFile: harness.stateFile });
    try {
      const restoredState = await fetch(`${restored.baseUrl}/api/state`).then((result) => result.json());
      assert.equal(restoredState.documents.length, sync.documents.length);
      assert.equal(restoredState.sync.cursor, sync.cursor);
    } finally {
      await restored.close({ keepDirectory: true });
    }
  } finally {
    await rm(persistedDirectory, { recursive: true, force: true });
  }
});

test('聊天接口输出 NDJSON 增量、引用，并保存会话', async () => {
  const harness = await createHarness();
  try {
    await postJson(harness.baseUrl, '/api/sync', { mode: 'mock' });
    const response = await postJson(harness.baseUrl, '/api/chat/stream', {
      question: '飞书同步如何处理凭据和 Mock 回退？'
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/x-ndjson/);

    const events = await readNdjson(response);
    assert.equal(events[0].type, 'start');
    assert.ok(events.some((event) => event.type === 'retrieval' && event.citations.length > 0));
    assert.ok(events.some((event) => event.type === 'delta'));
    const done = events.find((event) => event.type === 'done');
    assert.ok(done.answer.includes('[1]'));
    assert.ok(done.citations.some((citation) => citation.title.includes('同步') || citation.title.includes('安全')));

    const state = await fetch(`${harness.baseUrl}/api/state`).then((result) => result.json());
    assert.equal(state.conversations.length, 1);
    assert.equal(state.conversations[0].question, '飞书同步如何处理凭据和 Mock 回退？');
    assert.equal(state.conversations[0].messages, undefined);
    const saved = await fetch(`${harness.baseUrl}/api/conversations`).then((result) => result.json());
    assert.ok(saved.conversations[0].messages.length >= 2);
  } finally {
    await harness.close();
  }
});

test('十四个 Skill 均输出流式步骤、持久化来源与真实任务产物', async () => {
  const harness = await createHarness({
    taskArtifactOptions: {
      synthesizeSpeech: async ({ outputPath }) => writeFile(outputPath, Buffer.from('RIFF0000WAVEfmt data', 'ascii'))
    }
  });
  try {
    const syncResponse = await postJson(harness.baseUrl, '/api/sync', { source: 'mock' });
    await syncResponse.json();
    const documentList = await fetch(harness.baseUrl + '/api/documents').then((response) => response.json());
    const documentIds = documentList.documents.map((document) => document.id);
    const selectionDocument = documentList.documents.find((document) => document.title.includes('安全')) || documentList.documents.at(-1);
    const selection = { documentId: selectionDocument.id, quote: '凭据不会在前端展示', anchor: 'root', startOffset: 3, endOffset: 13 };
    const skillIds = ['summary', 'compare', 'research-report', 'mind-map', 'quiz', 'podcast', 'document-insight', 'smart-writing', 'action-items', 'faq', 'timeline', 'q2-planning', 'tech-selection', 'customer-proposal'];
    const skillListResponse = await fetch(`${harness.baseUrl}/api/skills`);
    const skillList = await skillListResponse.json();
    assert.deepEqual(skillList.skills.map((skill) => skill.id), skillIds);

    for (const skillId of skillIds) {
      const response = await postJson(harness.baseUrl, '/api/skills/run', {
        skillId,
        input: '知识库连接与引用',
        documentIds,
        selection
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
      const events = await readNdjson(response);
      assert.equal(events[0].type, 'start');
      assert.equal(events.filter((event) => event.type === 'step').length, 3, skillId + ': ' + JSON.stringify(events.at(-1)));
      assert.ok(events.some((event) => event.type === 'artifact' && event.artifact.content.length > 50));
      const done = events.at(-1);
      assert.equal(done.type, 'done');
      assert.ok(done.result.artifact.sourceRefs.length > 0);
      const selectionRef = done.result.artifact.sourceRefs.find((reference) => reference.documentId === selection.documentId);
      assert.equal(selectionRef.quote, selection.quote);
      assert.equal(selectionRef.startOffset, 3);
      assert.equal(selectionRef.endOffset, 13);
      assert.ok(done.result.artifact.files.some((file) => file.kind === 'document'));
      if (skillId === 'mind-map') {
        assert.equal(done.result.artifact.kind, 'mind-map');
        assert.ok(done.result.artifact.tree.children.length > 0);
        assert.ok(done.result.artifact.tree.children.every((branch) => branch.documentId && Array.isArray(branch.children)));
        assert.equal(done.result.artifact.tree.children.find((branch) => branch.documentId === selection.documentId)?.quote, selection.quote);
      }
      if (skillId === 'quiz') {
        assert.equal(done.result.artifact.kind, 'quiz');
        assert.ok(done.result.artifact.questions.length >= 2);
        assert.ok(done.result.artifact.questions.every((question) => question.choices.length >= 3));
        assert.ok(done.result.artifact.questions.every((question) => Number.isInteger(question.correctIndex) && question.explanation && question.sourceRef?.documentId));
      }
      if (skillId === 'podcast') {
        const file = done.result.artifact.files.find((item) => item.kind === 'audio');
        assert.ok(file.fileName.endsWith('.wav'));
        const download = await fetch(`${harness.baseUrl}${file.downloadUrl}`);
        assert.equal(download.status, 200);
        assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
      }
    }

    const state = await fetch(`${harness.baseUrl}/api/state`).then((result) => result.json());
    assert.equal(state.skillRuns.length, 14);
    assert.ok(state.skillRuns.every((run) => run.status === 'completed'));
    assert.ok(state.skillRuns.every((run) => run.artifact.sourceRefs.length > 0));
  } finally {
    await harness.close();
  }
});
test('真实飞书连接器获取 tenant token、遍历 wiki 节点并读取 docx raw_content', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v3/tenant_access_token/internal')) {
      const credentials = JSON.parse(options.body);
      assert.equal(credentials.app_id, 'test-app-id');
      assert.equal(credentials.app_secret, 'test-app-secret');
      return Response.json({ code: 0, tenant_access_token: 'tenant-secret-token', expire: 7200 });
    }
    if (String(url).includes('/wiki/v2/spaces/test-space/nodes')) {
      const parsed = new URL(url);
      const parent = parsed.searchParams.get('parent_node_token');
      if (!parent) {
        return Response.json({
          code: 0,
          data: {
            has_more: false,
            items: [
              { node_token: 'folder-node', obj_token: 'folder-token', obj_type: 'wiki', title: '目录', has_child: true },
              { node_token: 'doc-node-1', obj_token: 'doc-1', obj_type: 'docx', title: '根文档', has_child: false }
            ]
          }
        });
      }
      assert.equal(parent, 'folder-node');
      return Response.json({
        code: 0,
        data: {
          has_more: false,
          items: [{ node_token: 'doc-node-2', obj_token: 'doc-2', obj_type: 'docx', title: '子文档', has_child: false }]
        }
      });
    }
    if (String(url).includes('/docx/v1/documents/doc-1/raw_content')) {
      assert.equal(options.headers.Authorization, 'Bearer tenant-secret-token');
      return Response.json({ code: 0, data: { content: '根文档真实正文' } });
    }
    if (String(url).includes('/docx/v1/documents/doc-2/raw_content')) {
      assert.equal(options.headers.Authorization, 'Bearer tenant-secret-token');
      return Response.json({ code: 0, data: { content: '子文档真实正文' } });
    }
    return Response.json({ code: 999, msg: 'unexpected endpoint' }, { status: 500 });
  };

  const harness = await createHarness({
    env: {
      FEISHU_APP_ID: 'test-app-id',
      FEISHU_APP_SECRET: 'test-app-secret',
      FEISHU_SPACE_ID: 'test-space'
    },
    fetchImpl,
    connectorOptions: { minDocRequestIntervalMs: 0 }
  });
  try {
    const response = await postJson(harness.baseUrl, '/api/sync', { source: 'feishu' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, 'feishu');
    assert.equal(body.documents.length, 2);
    assert.equal(body.stats.skipped, 1);
    assert.ok(calls.some((call) => call.url.includes('parent_node_token=folder-node')));

    const persisted = await readFile(harness.stateFile, 'utf8');
    assert.doesNotMatch(persisted, /test-app-secret|tenant-secret-token|test-app-id/);
  } finally {
    await harness.close();
  }
});

test('飞书失败默认不回退，只有请求显式允许时才使用 Mock', async () => {
  const harness = await createHarness({ env: {} });
  try {
    const failed = await postJson(harness.baseUrl, '/api/sync', { source: 'feishu' });
    assert.equal(failed.status, 400);
    const failedBody = await failed.json();
    assert.equal(failedBody.ok, false);
    assert.equal(failedBody.fallbackUsed, false);
    assert.equal(failedBody.error.code, 'FEISHU_CONFIG_MISSING');

    const fallback = await postJson(harness.baseUrl, '/api/sync', {
      source: 'feishu',
      fallbackToMock: true
    });
    assert.equal(fallback.status, 200);
    const fallbackBody = await fallback.json();
    assert.equal(fallbackBody.source, 'mock');
    assert.equal(fallbackBody.requestedSource, 'feishu');
    assert.equal(fallbackBody.fallbackUsed, true);
    assert.equal(fallbackBody.warning.code, 'FEISHU_CONFIG_MISSING');
  } finally {
    await harness.close();
  }
});

test('飞书上游错误会脱敏应用标识和密钥', async () => {
  const harness = await createHarness({
    env: {
      FEISHU_APP_ID: 'sensitive-app-id',
      FEISHU_APP_SECRET: 'sensitive-app-secret',
      FEISHU_SPACE_ID: 'space-for-error-test'
    },
    fetchImpl: async () => Response.json({
      code: 10003,
      msg: 'invalid sensitive-app-id / sensitive-app-secret'
    }, { status: 401 })
  });
  try {
    const response = await postJson(harness.baseUrl, '/api/sync', { source: 'feishu' });
    assert.equal(response.status, 401);
    const raw = await response.text();
    assert.doesNotMatch(raw, /sensitive-app-id|sensitive-app-secret/);
    assert.match(raw, /\[REDACTED\]/);
  } finally {
    await harness.close();
  }
});
