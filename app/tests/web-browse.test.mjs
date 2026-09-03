import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendWebClipToProblemContent,
  createWebWorkspaceTab,
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

test('client URL normalizer accepts public http(s) and blocks private hosts', () => {
  assert.equal(normalizeClientBrowseUrl('example.com').href, 'https://example.com/');
  assert.equal(normalizeBrowseUrl('https://docs.example.com/path').href, 'https://docs.example.com/path');
  assert.throws(() => normalizeClientBrowseUrl('javascript:alert(1)'), /http\/https/);
  assert.throws(() => normalizeClientBrowseUrl('http://127.0.0.1/secret'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://192.168.1.8/'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://localhost:8789'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://[::1]/'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://[fc00::1]/'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://user:pass@example.com/'), /凭据/);
  assert.equal(webSourceHostname('https://example.com/recipe'), 'example.com');
  assert.equal(webEmbedIsReliable(true), true);
  assert.equal(webEmbedIsReliable(false), false);
  assert.equal(webBrowseLimitation(true), '');
  assert.match(webBrowseLimitation(false), /禁止嵌入/);
  assert.match(webBrowseLimitation(false), /桌面版才能完整浏览/);
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

test('public page preview rejects loopback before fetch', async () => {
  let called = 0;
  await assert.rejects(() => fetchPublicPagePreview('http://127.0.0.1/', { fetchImpl: async () => { called += 1; return { ok: true, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }; } }), /内网/);
  assert.equal(called, 0);
});

test('public page preview does not follow redirects into private hosts', async () => {
  let fetched = [];
  await assert.rejects(() => fetchPublicPagePreview('https://example.com/go', {
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

test('public page preview uses injected fetch and truncates HTML', async () => {
  const preview = await fetchPublicPagePreview('https://example.com/a', {
    fetchImpl: async url => {
      assert.equal(String(url), 'https://example.com/a');
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        arrayBuffer: async () => Buffer.from('<title>Example</title><p>hello clip</p>')
      };
    }
  });
  assert.equal(preview.title, 'Example');
  assert.match(preview.excerpt, /hello clip/);
});
