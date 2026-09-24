import assert from 'node:assert/strict';
import test from 'node:test';
import { attachLocalApiAuthorization } from '../desktop/local-api-session.mjs';

const base = {
  origin: 'http://127.0.0.1:8789',
  webContentsId: 17,
  mainWebContentsId: 17,
  requestHeaders: { Accept: 'application/json' },
  token: 'session-secret'
};

test('desktop API credential is attached only to the main window local API requests', () => {
  const headers = attachLocalApiAuthorization({ ...base, resourceType: 'xhr', url: `${base.origin}/api/state` });
  assert.equal(headers.Authorization, 'Bearer session-secret');
  assert.equal(headers.Accept, 'application/json');
});

test('desktop API credential is not attached to static files, external origins, or other windows', () => {
  for (const request of [
    { resourceType: 'xhr', url: `${base.origin}/assets/app.js` },
    { resourceType: 'xhr', url: 'https://example.com/api/state' },
    { resourceType: 'xhr', url: `${base.origin}/api/state`, webContentsId: 18 },
    { resourceType: 'subFrame', url: `${base.origin}/api/state` },
    { resourceType: 'image', url: `${base.origin}/api/state` }
  ]) {
    const headers = attachLocalApiAuthorization({ ...base, ...request });
    assert.equal(headers.Authorization, undefined);
  }
});

test('malformed request URLs do not receive desktop credentials', () => {
  const headers = attachLocalApiAuthorization({ ...base, url: 'not a url' });
  assert.equal(headers.Authorization, undefined);
});
