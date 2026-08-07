import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';

async function createHarness(root, fetchImpl) {
  const stateFile = join(root, 'state.json');
  const app = await createInitializedApp({
    stateFile,
    env: {},
    fetchImpl,
    feishuOptions: { secretFile: join(root, 'feishu-secret.enc'), masterKeyFile: join(root, '.feishu-master-key') },
    modelOptions: { secretFile: join(root, 'model-secret.enc'), masterKeyFile: join(root, '.model-master-key') }
  });
  const server = await new Promise((resolve) => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  return { app, stateFile, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function request(base, path, method = 'GET', body) {
  return fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
}

function fixtureFetch(url, options = {}) {
  const target = String(url);
  if (target.includes('/auth/v3/tenant_access_token/internal')) {
    const body = JSON.parse(options.body);
    assert.equal(body.app_id, 'cli_test_app');
    assert.equal(body.app_secret, 'test-app-secret');
    return Promise.resolve(Response.json({ code: 0, tenant_access_token: 'tenant-test-token' }));
  }
  if (target.includes('/wiki/v2/spaces?')) {
    assert.equal(options.headers?.Authorization, 'Bearer tenant-test-token');
    return Promise.resolve(Response.json({ code: 0, data: { items: [
      { space_id: 'space-auto', name: '自动发现空间', description: 'fixture', visibility: 'tenant' },
      { space_id: 'space-second', name: '第二知识空间', description: '', visibility: null }
    ], has_more: false } }));
  }
  return Promise.resolve(Response.json({ code: 0, data: {} }));
}

test('共享知识库发现、关注状态和重载持久化', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-knowledge-libraries-'));
  let harness;
  try {
    harness = await createHarness(root, fixtureFetch);
    const initial = await (await request(harness.base, '/api/knowledge/libraries')).json();
    assert.equal(initial.ok, true);
    assert.equal(initial.libraries.length, 1);
    assert.equal(initial.libraries[0].id, 'feishu-space');
    assert.equal(initial.libraries[0].followed, false);

    const refreshedResponse = await request(harness.base, '/api/knowledge/libraries/refresh', 'POST', {
      appId: 'cli_test_app', appSecret: 'test-app-secret'
    });
    assert.equal(refreshedResponse.status, 200);
    const refreshed = await refreshedResponse.json();
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.libraries.length, 2);
    assert.deepEqual(refreshed.libraries.map((item) => item.id).sort(), ['feishu:space-auto', 'feishu:space-second']);
    assert.equal(refreshed.libraries.find((item) => item.id === 'feishu:space-auto').shared, true);
    assert.equal(refreshed.libraries.find((item) => item.id === 'feishu:space-auto').synced, false);
    assert.equal(refreshed.refreshedAt !== null, true);

    const followedResponse = await request(harness.base, '/api/knowledge/libraries/feishu:space-auto', 'PATCH', { followed: true });
    assert.equal(followedResponse.status, 200);
    const followed = await followedResponse.json();
    assert.equal(followed.library.followed, true);
    assert.deepEqual(followed.followedIds, ['feishu:space-auto']);
    assert.equal(followed.libraries[0].id, 'feishu:space-auto');
    const activeResponse = await request(harness.base, '/api/knowledge/libraries/feishu:space-second', 'PATCH', { active: true });
    assert.equal(activeResponse.status, 200);
    const activeState = await (await request(harness.base, '/api/state')).json();
    assert.equal(activeState.settings.activeKnowledgeBaseId, 'feishu:space-second');
    const persisted = JSON.parse(await readFile(harness.stateFile, 'utf8'));
    assert.deepEqual(persisted.knowledgeLibraryState.followedIds, ['feishu:space-auto']);
    assert.equal(persisted.knowledgeLibraryState.discovered.length, 2);
  } finally {
    await harness?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('共享知识库刷新在飞书凭据不可用时返回真实错误状态', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-knowledge-libraries-error-'));
  const harness = await createHarness(root, fixtureFetch);
  try {
    const response = await request(harness.base, '/api/knowledge/libraries/refresh', 'POST');
    assert.notEqual(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.ok(body.error?.code);
  } finally {
    await harness.close();
    await rm(root, { recursive: true, force: true });
  }
});
