import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInitializedApp } from '../server/app.mjs';

test('HTTP import reports failed, partial and usable content accurately and preserves same-name files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-import-http-'));
  const app = await createInitializedApp({ stateFile: join(root, 'state.json'), env: {}, ocrService: false, transcriptionService: false });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const upload = async (name, body) => {
    const response = await fetch(base + '/api/content/import/file', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) }, body });
    return { status: response.status, body: await response.json() };
  };
  try {
    const bad = await upload('broken.epub', 'invalid EPUB bytes');
    assert.equal(bad.status, 422);
    assert.equal(bad.body.ok, false);
    assert.equal(bad.body.failed, 1);
    assert.equal(bad.body.succeeded, 0);
    assert.equal(bad.body.items.length, 0);
    const mixedResponse = await fetch(base + '/api/content/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ title: '可用正文', content: '第一份测试资料' }, { title: '无正文', content: '' }] }) });
    const mixed = await mixedResponse.json();
    assert.equal(mixedResponse.status, 207);
    assert.equal(mixed.ok, false);
    assert.equal(mixed.partial, true);
    assert.equal(mixed.items.length, 1);
    assert.equal(mixed.job.status, 'partial');
    const first = await upload('report.txt', '项目甲正文');
    const second = await upload('report.txt', '项目乙正文');
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(first.body.items[0].item.id, second.body.items[0].item.id);
    assert.equal(app.locals.contentRepository.getContentItem(first.body.items[0].item.id).content, '项目甲正文');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await app.locals.close();
    await rm(root, { recursive: true, force: true });
  }
});
