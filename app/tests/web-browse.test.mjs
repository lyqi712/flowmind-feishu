import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendWebClipToProblemContent,
  createWebWorkspaceTab,
  observeWebviewNavigation,
  mergeNoteSourceRefs,
  normalizeClientBrowseUrl,
  pickProblemNoteForWebClip,
  problemNoteFromWebClip,
  webBrowseLimitation,
  webClipSourceRef,
  webEmbedIsReliable,
  webSourceHostname
} from '../src/workspace/web-browse.js';
import { extractHtmlPreview, fetchPublicPagePreview, normalizeBrowseUrl } from '../server/web-clip.mjs';
import { fetchPublicHttp, isPrivateOrReservedIp } from '../server/public-http.mjs';

test('client URL normalizer accepts public http(s) and blocks private hosts', () => {
  assert.equal(normalizeClientBrowseUrl('example.com').href, 'https://example.com/');
  assert.equal(normalizeBrowseUrl('https://docs.example.com/path').href, 'https://docs.example.com/path');
  assert.throws(() => normalizeClientBrowseUrl('javascript:alert(1)'), /http\/https/);
  assert.throws(() => normalizeClientBrowseUrl('http://127.0.0.1/secret'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://192.168.1.8/'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://localhost:8789'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://[::1]/'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://[fc00::1]/'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://[::ffff:127.0.0.1]/'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://[::ffff:7f00:1]/'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://2130706433/'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://127.1/'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://localhost./'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://user:pass@example.com/'), /凭据/);
  assert.equal(isPrivateOrReservedIp('::1'), true);
  assert.equal(isPrivateOrReservedIp('::ffff:7f00:1'), true);
  assert.equal(isPrivateOrReservedIp('2001:db8::1'), true);
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
  assert.equal(webSourceHostname('https://example.com/recipe'), 'example.com');
  assert.equal(webEmbedIsReliable(true), true);
  assert.equal(webEmbedIsReliable(false), false);
  assert.equal(webBrowseLimitation(true), '');
  assert.match(webBrowseLimitation(false), /禁止嵌入/);
  assert.match(webBrowseLimitation(false), /桌面版才能完整浏览/);
});

test('web tab IDs remain unique for long URLs', () => {
  const a = createWebWorkspaceTab({ url: `https://example.com/${'a'.repeat(100)}?x=1` });
  const b = createWebWorkspaceTab({ url: `https://example.com/${'a'.repeat(100)}?x=2` });
  assert.notEqual(a.id, b.id);
  assert.equal(createWebWorkspaceTab({ url: a.url }).id, a.id);
  assert.equal(createWebWorkspaceTab({ url: b.url, id: 'existing' }).id, 'existing');
  assert.notEqual(createWebWorkspaceTab().id, createWebWorkspaceTab().id);
});

test('webview navigation observer syncs URL and title and cleans up', () => {
  const listeners = new Map();
  const view = { getURL: () => 'https://example.com/next', getTitle: () => 'Next', addEventListener: (k, f) => listeners.set(k, f), removeEventListener: (k, f) => listeners.delete(k), canGoBack: () => true, canGoForward: () => false };
  const seen = [];
  const dispose = observeWebviewNavigation(view, { onNavigate: url => seen.push(['url', url]), onTitle: (...args) => seen.push(['title', ...args]) });
  listeners.get('did-navigate')({ isMainFrame: true, url: view.getURL() });
  listeners.get('page-title-updated')({ title: 'Next' });
  dispose();
  assert.deepEqual(seen.slice(0, 2), [['url', 'https://example.com/next'], ['title', 'https://example.com/next', 'Next']]);
  assert.equal(listeners.size, 0);
});


test('webview observer handles in-page navigation, rejects private URLs and ignores subframes', () => {
  const listeners = new Map();
  const urls = [], errors = [], history = [];
  let stopped = 0;
  const view = {
    addEventListener: (key, fn) => listeners.set(key, fn),
    removeEventListener: key => listeners.delete(key),
    stop: () => { stopped++; },
    canGoBack: () => true,
    canGoForward: () => false
  };
  const dispose = observeWebviewNavigation(view, {
    onNavigate: url => urls.push(url), onError: error => errors.push(error.message),
    onHistory: value => history.push(value)
  });
  listeners.get('did-navigate')({ isMainFrame: false, url: 'https://example.com/ad' });
  listeners.get('did-navigate-in-page')({ isMainFrame: true, url: 'https://example.com/#section' });
  listeners.get('did-navigate')({ url: 'http://127.0.0.1/private' });
  listeners.get('did-fail-load')({ isMainFrame: true, errorCode: -3 });
  assert.deepEqual(urls, ['https://example.com/']);
  assert.deepEqual(history, [{ back: true, forward: false }]);
  assert.equal(stopped, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /内网/);
  dispose();
});

test('web clip keeps URL sourceRefs and appends to the problem-record resolution', () => {
  const clip = { url: 'https://example.com/recipe', title: '炒蛋', excerpt: '出锅前放葱花' };
  const ref = webClipSourceRef(clip);
  assert.equal(ref.kind, 'web');
  assert.equal(ref.url, clip.url);
  const merged = mergeNoteSourceRefs(
    [{ documentId: 'doc-1', title: '原资料', anchor: 'chars:0-8' }],
    [ref, { title: '没有文档也没有网址' }]
  );
  assert.equal(merged.length, 2);
  assert.ok(merged.some(item => item.url === clip.url));
  const content = appendWebClipToProblemContent('## 问题\n忘放葱花\n\n## 这次怎么解决的\n\n## 下次容易忘的点\n- 看一眼葱花\n\n## 关联资料\n- 菜谱文档', clip);
  const resolution = content.split('## 这次怎么解决的')[1].split('##')[0];
  assert.match(resolution, /炒蛋/);
  assert.match(resolution, /example.com\/recipe/);
  assert.doesNotMatch(resolution, /出锅前放葱花/);
  assert.match(content, /## 关联资料/);
  assert.match(content, /下次容易忘的点[\s\S]*出锅前放葱花/);
  const draft = problemNoteFromWebClip(clip);
  assert.equal(draft.artifactKind, 'problem');
  assert.equal(draft.sourceRefs[0].url, clip.url);
  const encyclopedia = appendWebClipToProblemContent(content, {
    url: 'https://example.com/long',
    title: '长文',
    excerpt: '这是一段超过一百六十字的百科摘要，不应该整段灌进下次容易忘的点，而应该被截断成真正能回头看的一句例外。'.repeat(4)
  });
  const pitfall = encyclopedia.split('## 下次容易忘的点')[1].split('##')[0];
  assert.ok([...pitfall].length < 400);
  const tab = createWebWorkspaceTab({ url: clip.url, title: clip.title });
  assert.equal(tab.kind, 'web');
  assert.equal(tab.route, 'web');
  assert.equal(tab.url, clip.url);
  const chosen = pickProblemNoteForWebClip({
    tabs: [
      { id: 'note-plain', kind: 'note', noteId: 'n-plain', lastActiveAt: 30 },
      { id: 'note-problem', kind: 'note', noteId: 'n-problem', lastActiveAt: 10 },
      { id: 'web-1', kind: 'web', url: clip.url, lastActiveAt: 40 }
    ],
    notes: [
      { id: 'n-plain', title: '普通笔记', content: '随便写', tags: [] },
      { id: 'n-problem', title: '问题记录：葱花', artifactKind: 'problem', tags: ['问题记录'], content: content }
    ]
  });
  assert.equal(chosen.id, 'n-problem');
  assert.equal(pickProblemNoteForWebClip({ tabs: [{ id: 'note-plain', kind: 'note', noteId: 'n-plain', lastActiveAt: 30 }], notes: [{ id: 'n-plain', tags: [] }] }), null);
  assert.equal(pickProblemNoteForWebClip({
    tabs: [{ id: 'web-1', kind: 'web', lastActiveAt: 40 }],
    notes: [{ id: 'n-preferred', artifactKind: 'problem', tags: ['问题记录'] }],
    preferredId: 'n-preferred'
  }).id, 'n-preferred');
});

test('HTML preview extraction prefers title and description', () => {
  const preview = extractHtmlPreview('<html><head><title>西红柿炒鸡蛋</title><meta name="description" content="出锅前放葱花"></head><body><p>正文</p></body></html>', 'https://example.com');
  assert.equal(preview.title, '西红柿炒鸡蛋');
  assert.equal(preview.excerpt, '出锅前放葱花');
});

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function htmlResponse(html, { status = 200, contentType = 'text/html', location } = {}) {
  const headers = new Headers({ 'content-type': contentType });
  if (location) headers.set('location', location);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    arrayBuffer: async () => Buffer.from(html)
  };
}

test('public page preview rejects loopback before fetch', async () => {
  let called = 0;
  await assert.rejects(() => fetchPublicPagePreview('http://127.0.0.1/', { fetchImpl: async () => { called += 1; return { ok: true, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }; } }), /内网/);
  assert.equal(called, 0);
  await assert.rejects(() => fetchPublicPagePreview('http://[::1]/', { fetchImpl: async () => { called += 1; return htmlResponse(''); } }), /内网/);
  await assert.rejects(() => fetchPublicPagePreview('http://[::ffff:127.0.0.1]/', { fetchImpl: async () => { called += 1; return htmlResponse(''); } }), /内网/);
  assert.equal(called, 0);
});

test('public page preview does not follow redirects into private hosts', async () => {
  let fetched = [];
  await assert.rejects(() => fetchPublicPagePreview('https://example.com/go', {
    lookupImpl: publicLookup,
    fetchImpl: async (url, options) => {
      fetched.push({ url: String(url), redirect: options.redirect });
      if (String(url).includes('/go')) {
        return { ok: false, status: 302, headers: new Headers({ location: 'http://127.0.0.1/secret' }), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      throw new Error('should not fetch private redirect');
    }
  }), /内网/);
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].redirect, 'manual');
});

test('public page preview rejects DNS that resolves to a private address', async () => {
  let fetched = 0;
  await assert.rejects(() => fetchPublicPagePreview('https://intranet.example/', {
    lookupImpl: async () => [{ address: '10.0.0.8', family: 4 }],
    fetchImpl: async () => {
      fetched += 1;
      return htmlResponse('<title>nope</title>');
    }
  }), /内网/);
  assert.equal(fetched, 0);
});

test('public page preview pins the validated DNS address instead of re-resolving', async () => {
  const page = await fetchPublicHttp('https://example.com/pinned', {
    lookupImpl: publicLookup,
    requestImpl: async ({ href, pinnedAddress, pinnedFamily }) => {
      assert.equal(href, 'https://example.com/pinned');
      assert.equal(pinnedAddress, '93.184.216.34');
      assert.equal(pinnedFamily, 4);
      return htmlResponse('<title>Pinned</title><p>ok</p>');
    }
  });
  assert.equal(page.pinnedAddress, '93.184.216.34');
  assert.equal(page.url.href, 'https://example.com/pinned');
});

test('public page preview stops oversized streamed bodies', async () => {
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(64 * 1024).fill(65));
      if (pulled > 40) controller.error(new Error('read too far'));
    }
  });
  await assert.rejects(() => fetchPublicPagePreview('https://example.com/huge', {
    lookupImpl: publicLookup,
    maxBytes: 256 * 1024,
    fetchImpl: async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } })
  }), error => error.code === 'WEB_FETCH_TOO_LARGE');
  assert.ok(pulled <= 8, `stream should cancel early, pulled=${pulled}`);
});

test('public page preview presents HTTP errors without fetching a private fallback', async () => {
  await assert.rejects(() => fetchPublicPagePreview('https://example.com/missing', {
    lookupImpl: publicLookup,
    fetchImpl: async () => htmlResponse('not found', { status: 404 })
  }), error => error.code === 'WEB_FETCH_FAILED' && /HTTP 404/.test(error.message));
});

test('public page preview uses injected fetch and truncates HTML', async () => {
  const preview = await fetchPublicPagePreview('https://example.com/a', {
    lookupImpl: publicLookup,
    fetchImpl: async url => {
      assert.equal(String(url), 'https://example.com/a');
      return htmlResponse('<title>Example</title><p>hello clip</p>');
    }
  });
  assert.equal(preview.title, 'Example');
  assert.match(preview.excerpt, /hello clip/);
  assert.equal(preview.url, 'https://example.com/a');
});

test('public fetch times out a lookup that never resolves', async () => {
  let fetched = 0;
  const started = Date.now();
  await assert.rejects(() => fetchPublicHttp('https://example.com/hang-lookup', {
    timeoutMs: 20,
    lookupImpl: () => new Promise(() => {}),
    fetchImpl: async () => {
      fetched += 1;
      throw new Error('should not fetch');
    }
  }), error => error.code === 'WEB_FETCH_TIMEOUT');
  assert.equal(fetched, 0);
  assert.ok(Date.now() - started < 400, `hanging lookup timed out too slowly: ${Date.now() - started}ms`);
});

test('public fetch times out a stalled body stream and cancels the reader', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull() {},
    cancel() { cancelled = true; }
  });
  const started = Date.now();
  await assert.rejects(() => fetchPublicHttp('https://example.com/stall', {
    timeoutMs: 20,
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } })
  }), error => error.code === 'WEB_FETCH_TIMEOUT');
  assert.equal(cancelled, true);
  assert.ok(Date.now() - started < 400, `stalled stream timed out too slowly: ${Date.now() - started}ms`);
});
