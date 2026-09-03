import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';
import {
  buildAuthorizeUrl,
  createPendingOAuthStore,
  oauthCallbackPage,
  parseOAuthTokenPayload,
  publicUserSession,
  safeReturnTo
} from '../server/feishu-oauth.mjs';
import { consumeFeishuLoginQuery } from '../src/workspace/feishu-login.js';

test('授权地址、回跳和用户会话不泄露令牌', () => {
  const url = buildAuthorizeUrl({
    appId: 'cli_test_app',
    redirectUri: 'http://127.0.0.1:8789/api/feishu/oauth/callback',
    state: 'state-1'
  });
  assert.match(url, /accounts\.feishu\.cn/);
  assert.match(url, /client_id=cli_test_app/);
  assert.match(url, /offline_access/);
  assert.match(url, /docx%3Adocument%3Areadonly/);
  assert.doesNotMatch(url, /docs%3Adocument%3Areadonly/);
  assert.equal(safeReturnTo('https://evil.example/x', 'http://127.0.0.1:5179/'), 'http://127.0.0.1:5179/');
  assert.equal(safeReturnTo('http://127.0.0.1:5179/settings', ''), 'http://127.0.0.1:5179/settings');
  const session = parseOAuthTokenPayload({
    code: 0,
    access_token: 'u-secret',
    refresh_token: 'ur-secret',
    expires_in: 7200,
    refresh_token_expires_in: 86400
  });
  const publicSession = publicUserSession(session);
  assert.equal(publicSession.loggedIn, true);
  assert.doesNotMatch(JSON.stringify(publicSession), /u-secret|ur-secret/);
  const html = oauthCallbackPage({ ok: true, title: '飞书登录成功', message: '可以回去了', returnTo: 'http://127.0.0.1:5179/?feishuLogin=ok' });
  assert.match(html, /飞书登录成功/);
  assert.match(html, /feishuLogin=ok/);
  const pending = createPendingOAuthStore({ now: () => 1000, ttlMs: 10 });
  pending.set('alive', { redirectUri: 'http://127.0.0.1/cb' });
  assert.ok(pending.take('alive'));
  assert.equal(pending.take('alive'), null);
});

test('登录回跳查询只消费一次', () => {
  const first = consumeFeishuLoginQuery('?feishuLogin=ok&keep=1');
  assert.equal(first.ok, true);
  assert.equal(first.nextSearch, '?keep=1');
  assert.equal(consumeFeishuLoginQuery(first.nextSearch), null);
});

function oauthFetch(url, options = {}) {
  const target = String(url);
  if (target.includes('/auth/v3/tenant_access_token/internal')) {
    return Promise.resolve(Response.json({ code: 0, tenant_access_token: 'tenant-test-token' }));
  }
  if (target.includes('/authen/v2/oauth/token')) {
    const body = JSON.parse(options.body || '{}');
    assert.equal(body.client_id, 'cli_test_app');
    assert.equal(body.grant_type, 'authorization_code');
    assert.equal(body.code, 'auth-code');
    return Promise.resolve(Response.json({
      code: 0,
      access_token: 'u-user-token',
      refresh_token: 'ur-refresh',
      expires_in: 7200,
      refresh_token_expires_in: 86400,
      token_type: 'Bearer'
    }));
  }
  if (target.includes('/authen/v1/user_info')) {
    assert.equal(options.headers?.Authorization, 'Bearer u-user-token');
    return Promise.resolve(Response.json({ code: 0, data: { name: '陆星淇', open_id: 'ou_test_user' } }));
  }
  return Promise.resolve(Response.json({ code: 0, data: {} }));
}

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-feishu-oauth-'));
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    env: {},
    fetchImpl: oauthFetch,
    feishuOptions: { secretFile: join(root, 'feishu-secret.enc'), masterKeyFile: join(root, '.feishu-master-key') },
    modelOptions: { secretFile: join(root, 'model-secret.enc'), masterKeyFile: join(root, '.model-master-key') }
  });
  const server = await new Promise((resolve) => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  return {
    root,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
  };
}

test('飞书用户登录换令牌后设置里只暴露姓名', async () => {
  const h = await createHarness();
  try {
    const missing = await fetch(`${h.base}/api/feishu/oauth/start`);
    assert.equal(missing.status, 400);
    await fetch(`${h.base}/api/settings/feishu`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: 'cli_test_app', appSecret: 'test-app-secret', documentUrls: ['https://example.feishu.cn/docx/doccn-test'] })
    });
    const started = await (await fetch(`${h.base}/api/feishu/oauth/start?returnTo=${encodeURIComponent(h.base + '/')}`)).json();
    assert.match(started.url, /client_id=cli_test_app/);
    assert.match(started.redirectUri, /\/api\/feishu\/oauth\/callback$/);
    assert.match(started.hint, /重定向 URL/);
    const state = new URL(started.url).searchParams.get('state');
    const callback = await fetch(`${h.base}/api/feishu/oauth/callback?code=auth-code&state=${state}`);
    const html = await callback.text();
    assert.match(html, /飞书登录成功/);
    const settings = await (await fetch(`${h.base}/api/settings/feishu`)).json();
    assert.equal(settings.user.loggedIn, true);
    assert.equal(settings.user.name, '陆星淇');
    assert.equal(settings.user.accessToken, undefined);
    const encrypted = await readFile(join(h.root, 'feishu-secret.enc'), 'utf8');
    assert.doesNotMatch(encrypted, /u-user-token|ur-refresh|test-app-secret/);
    const loggedOut = await (await fetch(`${h.base}/api/feishu/oauth/logout`, { method: 'POST' })).json();
    assert.equal(loggedOut.settings.user.loggedIn, false);
  } finally {
    await h.close();
  }
});
