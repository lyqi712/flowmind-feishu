import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInitializedApp } from '../server/app.mjs';
import { buildWorkspaceSearchUrl } from '../src/workspace/search-filters.js';

test('search categories reach the actual API and filter documents, conversations and tags', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-search-categories-'));
  const app = await createInitializedApp({ stateFile: join(root, 'state.json'), env: {}, ocrService: false, transcriptionService: false });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const repo = app.locals.contentRepository;
    const source = repo.upsertSourceConnection({ sourceType: 'local', externalId: 'search-fixture', name: '搜索测试' });
    repo.upsertContentItem({ sourceConnectionId: source.id, externalId: 'document', title: '共同关键词文档', content: '正文', tags: ['专用标签'] });
    await app.locals.store.update(state => {
      state.notes.push({ id: 'search-note', title: '共同关键词笔记', content: '正文', tags: [] });
      state.conversations.push({ id: 'search-chat', title: '共同关键词对话', messages: [] });
    });
    for (const [category, expected] of [['documents', 'document'], ['notes', 'note'], ['conversations', 'conversation']]) {
      const response = await fetch(base + buildWorkspaceSearchUrl('共同关键词', { category }));
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.results.length, 1, category);
      assert.equal(body.results[0].type, expected);
    }
    const all = await fetch(base + buildWorkspaceSearchUrl('共同关键词')).then(response => response.json());
    assert.equal(all.results.length, 3);
    const tagged = await fetch(base + buildWorkspaceSearchUrl('专用标签', { category: 'tags' })).then(response => response.json());
    assert.equal(tagged.results.length, 1);
    assert.ok(tagged.results[0].tags.some(tag => (tag.name || tag) === '专用标签'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await app.locals.close();
    await rm(root, { recursive: true, force: true });
  }
});
