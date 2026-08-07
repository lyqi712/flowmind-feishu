import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';

async function createHarness(fetchImpl) {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-feishu-settings-'));
  const stateFile = join(root, 'state.json');
  const feishuOptions = { secretFile: join(root, 'feishu-secret.enc'), masterKeyFile: join(root, '.feishu-master-key') };
  const modelOptions = { secretFile: join(root, 'model-secret.enc'), masterKeyFile: join(root, '.model-master-key') };
  const app = await createInitializedApp({ stateFile, env: {}, fetchImpl, feishuOptions, modelOptions });
  const server = await new Promise((resolve) => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  return {
    root,
    stateFile,
    feishuOptions,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
  };
}

async function request(h, path, method = 'GET', body) {
  return fetch(`${h.base}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
}

function feishuFixtureFetch(url, options = {}) {
  const target = String(url);
  if (target.includes('/auth/v3/tenant_access_token/internal')) {
    const submitted = JSON.parse(options.body);
    assert.equal(submitted.app_id, 'cli_test_app');
    assert.equal(submitted.app_secret, 'test-app-secret');
    return Promise.resolve(Response.json({ code: 0, tenant_access_token: 'tenant-test-token' }));
  }
  if (target.includes('/wiki/v2/spaces?')) {
    assert.equal(options.headers?.Authorization, 'Bearer tenant-test-token');
    return Promise.resolve(Response.json({ code: 0, data: { items: [{ space_id: 'space-auto', name: '自动发现空间', description: 'fixture' }], has_more: false } }));
  }
  if (target.includes('/docx/v1/documents/doccn-test')) {
    return Promise.resolve(Response.json({ code: 0, data: { document: { title: '直接链接文档' } } }));
  }
  return Promise.resolve(Response.json({ code: 0, data: {} }));
}

test('飞书设置加密保存且 API、state.json、密文均不泄露 App Secret', async () => {
  const h = await createHarness(feishuFixtureFetch);
  try {
    const response = await request(h, '/api/settings/feishu', 'PUT', {
      appId: 'cli_test_app',
      appSecret: 'test-app-secret',
      documentUrls: ['https://example.feishu.cn/docx/doccn-test'],
      recursiveLinks: true,
      maxDepth: 3,
      maxDocuments: 120
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.settings.credentialsConfigured, true);
    assert.equal(body.settings.configured, true);
    assert.equal(body.settings.sourceCount, 1);
    assert.equal(body.settings.appSecret, undefined);
    assert.equal(body.settings.appId, undefined);
    assert.match(body.settings.appIdMasked, /•/);

    const getBody = await (await request(h, '/api/settings/feishu')).json();
    assert.equal(getBody.documentUrls.length, 1);
    assert.equal(getBody.appSecret, undefined);

    const stateRaw = await readFile(h.stateFile, 'utf8');
    assert.doesNotMatch(stateRaw, /test-app-secret|cli_test_app/);
    const encryptedRaw = await readFile(h.feishuOptions.secretFile, 'utf8');
    assert.doesNotMatch(encryptedRaw, /test-app-secret|cli_test_app|doccn-test/);
  } finally { await h.close(); }
});

test('飞书自动发现空间与直接文档，无需手填 Space ID', async () => {
  const h = await createHarness(feishuFixtureFetch);
  try {
    const response = await request(h, '/api/feishu/discover', 'POST', {
      appId: 'cli_test_app',
      appSecret: 'test-app-secret',
      documentUrls: ['https://example.feishu.cn/docx/doccn-test']
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.spaces, [{ id: 'space-auto', name: '自动发现空间', description: 'fixture', visibility: null }]);
    assert.equal(body.sources[0].type, 'docx');
    assert.equal(body.sources[0].title, '直接链接文档');
    assert.equal(body.settings.spaceIds.length, 0);
    assert.equal(body.settings.credentialsConfigured, false, '临时测试凭据不应自动持久化');
    assert.doesNotMatch(JSON.stringify(body), /test-app-secret|tenant-test-token/);
  } finally { await h.close(); }
});

test('飞书设置可清除并在新实例中从加密文件恢复', async () => {
  const h = await createHarness(feishuFixtureFetch);
  try {
    await request(h, '/api/settings/feishu', 'PUT', { appId: 'cli_test_app', appSecret: 'test-app-secret', spaceIds: ['space-auto'] });
    const health = await (await request(h, '/api/health')).json();
    assert.equal(health.feishu.configured, true);
    assert.equal(health.feishu.credentialsConfigured, true);
    const cleared = await (await request(h, '/api/settings/feishu', 'DELETE')).json();
    assert.equal(cleared.settings.configured, false);
    assert.equal(cleared.settings.credentialsConfigured, false);
  } finally { await h.close(); }
});
