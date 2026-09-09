import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolRegistry } from '../server/agent/tool-registry.mjs';

test('生产 ToolRegistry 默认注册只读扩展工具', async () => {
  const documents = [
    { id: 'doc-a', title: 'Alpha', content: 'Alpha 文档。2024年1月1日启动。满意。', revision: 1, contentHash: 'a', currentVersionId: 'v1' },
    { id: 'doc-b', title: 'Beta', content: 'Beta 文档。需要改进。', revision: 1, contentHash: 'b', currentVersionId: 'v1' }
  ];
  const registry = createToolRegistry({ getDocuments: () => documents });
  const names = registry.list({ includeWrite: false }).map(tool => tool.name);
  for (const name of ['knowledge.compare', 'knowledge.timeline', 'knowledge.extract', 'writing.draft', 'analyze.keywords', 'task.breakdown']) {
    assert.ok(names.includes(name), `missing ${name}`);
    const tool = registry.list({ includeWrite: false }).find(item => item.name === name);
    assert.equal(tool.effect, 'read');
  }
  const compared = await registry.execute('knowledge.compare', { documentId1: 'doc-a', documentId2: 'doc-b' });
  assert.equal(compared.status, 'completed');
  assert.equal(compared.result.document1.id, 'doc-a');
  const missing = await registry.execute('knowledge.timeline', { documentId: 'missing' }).then(() => null, error => error);
  assert.equal(missing?.code, 'KNOWLEDGE_DOCUMENT_NOT_FOUND');
  const scoped = await registry.execute('knowledge.compare', { documentId1: 'doc-a', documentId2: 'doc-b' }, { documentIds: ['doc-a'] }).then(() => null, error => error);
  assert.equal(scoped?.code, 'KNOWLEDGE_DOCUMENT_OUT_OF_SCOPE');
});

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function mockPage({ html = '', status = 200, contentType = 'text/html', location, url } = {}) {
  const headers = new Headers({ 'content-type': contentType });
  if (location) headers.set('location', location);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    url,
    arrayBuffer: async () => Buffer.from(html)
  };
}

test('web.fetch reads public pages and rejects private URLs', async () => {
  const registry = createToolRegistry({
    getDocuments: () => [],
    lookupImpl: publicLookup,
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, 'manual');
      if (String(url) === 'https://example.com/docs') {
        return mockPage({ html: '<title>Docs</title><p>public article body</p>' });
      }
      throw new Error(`unexpected fetch ${url}`);
    }
  });
  const names = registry.list({ includeWrite: false }).map(tool => tool.name);
  assert.ok(names.includes('web.fetch'));
  const privateUrl = await registry.execute('web.fetch', { url: 'http://127.0.0.1/secret' }).then(() => null, error => error);
  assert.equal(privateUrl?.code, 'WEB_URL_FORBIDDEN');
  const ipv6Loopback = await registry.execute('web.fetch', { url: 'http://[::1]/audit-probe' }).then(() => null, error => error);
  assert.equal(ipv6Loopback?.code, 'WEB_URL_FORBIDDEN');
  const mapped = await registry.execute('web.fetch', { url: 'http://[::ffff:127.0.0.1]/secret' }).then(() => null, error => error);
  assert.equal(mapped?.code, 'WEB_URL_FORBIDDEN');
  const fileUrl = await registry.execute('web.fetch', { url: 'file:///etc/passwd' }).then(() => null, error => error);
  assert.equal(fileUrl?.code, 'WEB_URL_FORBIDDEN');
  const credentials = await registry.execute('web.fetch', { url: 'https://user:pass@example.com/docs' }).then(() => null, error => error);
  assert.equal(credentials?.code, 'WEB_URL_FORBIDDEN');
  const page = await registry.execute('web.fetch', { url: 'https://example.com/docs' });
  assert.equal(page.status, 'completed');
  assert.equal(page.result.url, 'https://example.com/docs');
  assert.equal(page.result.status, 200);
  assert.equal(page.result.title, 'Docs');
  assert.match(page.result.text, /public article body/);
});

test('web.fetch rejects private DNS and private redirects without contacting them', async () => {
  const fetched = [];
  const registry = createToolRegistry({
    getDocuments: () => [],
    lookupImpl: async hostname => {
      if (hostname === 'intranet.example') return [{ address: '192.168.0.10', family: 4 }];
      return [{ address: '93.184.216.34', family: 4 }];
    },
    fetchImpl: async (url, options) => {
      fetched.push({ url: String(url), redirect: options.redirect });
      if (String(url).includes('/go')) {
        return mockPage({ status: 302, location: 'http://169.254.169.254/latest/meta-data' });
      }
      throw new Error(`unexpected fetch ${url}`);
    }
  });
  const dnsPrivate = await registry.execute('web.fetch', { url: 'https://intranet.example/secret' }).then(() => null, error => error);
  assert.equal(dnsPrivate?.code, 'WEB_URL_FORBIDDEN');
  const redirected = await registry.execute('web.fetch', { url: 'https://example.com/go' }).then(() => null, error => error);
  assert.equal(redirected?.code, 'WEB_URL_FORBIDDEN');
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].url, 'https://example.com/go');
  assert.equal(fetched[0].redirect, 'manual');
});

test('web.fetch presents HTTP errors, keeps the source URL, and caps streamed downloads', async () => {
  let pulled = 0;
  const missingRegistry = createToolRegistry({
    getDocuments: () => [],
    lookupImpl: publicLookup,
    fetchImpl: async () => mockPage({ html: 'missing page', status: 404, contentType: 'text/plain' })
  });
  const missing = await missingRegistry.execute('web.fetch', { url: 'https://example.com/missing' });
  assert.equal(missing.status, 'completed');
  assert.equal(missing.result.status, 404);
  assert.equal(missing.result.url, 'https://example.com/missing');
  assert.match(missing.result.text, /missing page/);

  const redirectedRegistry = createToolRegistry({
    getDocuments: () => [],
    lookupImpl: publicLookup,
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, 'manual');
      if (String(url).endsWith('/start')) {
        return mockPage({ status: 301, location: 'https://example.com/final' });
      }
      return mockPage({ html: '<title>Final</title><p>arrived</p>' });
    }
  });
  const redirected = await redirectedRegistry.execute('web.fetch', { url: 'https://example.com/start' });
  assert.equal(redirected.result.url, 'https://example.com/final');
  assert.equal(redirected.result.title, 'Final');

  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(64 * 1024).fill(66));
      if (pulled > 40) controller.error(new Error('read too far'));
    }
  });
  const hugeRegistry = createToolRegistry({
    getDocuments: () => [],
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } })
  });
  const huge = await hugeRegistry.execute('web.fetch', { url: 'https://example.com/huge' }).then(() => null, error => error);
  assert.equal(huge?.code, 'WEB_FETCH_FAILED');
  assert.match(huge?.message || '', /过大/);
  assert.ok(pulled <= 12, `stream should cancel early, pulled=${pulled}`);
});
