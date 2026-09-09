import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInitializedApp } from '../server/app.mjs';
import { createDefaultState } from '../server/state-store.mjs';

async function open(root) {
  const stateFile = join(root, 'state.json');
  const app = await createInitializedApp({
    stateFile, env: {}, ocrService: false, transcriptionService: false,
    fetchImpl: async () => { throw new Error('External network is forbidden in this fixture'); },
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  return { app, stateFile, async request(path, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, async close() { await new Promise(resolve => server.close(resolve)); await app.locals.close(); } };
}

test('backup restore accepts bodies above the ordinary 16 MB JSON limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-backup-body-limit-'));
  const h = await open(root);
  try {
    await h.request('/api/notes', 'POST', { title: '大备份恢复', content: '原文' });
    const archive = (await h.request('/api/content/backup')).body;
    const response = await h.request('/api/content/backup/restore', 'POST', { archive, padding: ' '.repeat(17 * 1024 * 1024) });
    assert.equal(response.status, 200);
    assert.equal((await h.request('/api/notes')).body.notes[0].title, '大备份恢复');
  } finally { await h.close(); await rm(root, { recursive: true, force: true }); }
});

test('concurrent edits require the original note version and reject a stale overwrite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-note-conflict-'));
  const h = await open(root);
  try {
    const created = (await h.request('/api/notes', 'POST', { title: '并发保护', content: '原始内容' })).body.note;
    assert.ok(created.contentVersionId);
    const results = await Promise.all(['编辑甲', '编辑乙'].map(content => h.request(`/api/notes/${created.id}`, 'PATCH', { content, baseVersion: created.contentVersionId })));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winner = results.find(result => result.status === 200).body.note;
    const conflict = results.find(result => result.status === 409).body;
    assert.equal(conflict.error.code, 'NOTE_VERSION_CONFLICT');
    assert.equal((await h.request('/api/notes')).body.notes[0].content, winner.content);
    const retried = await h.request(`/api/notes/${created.id}`, 'PATCH', { content: `${winner.content}\n合并后的内容`, baseVersion: winner.contentVersionId });
    assert.equal(retried.status, 200);
  } finally { await h.close(); await rm(root, { recursive: true, force: true }); }
});

test('legacy notes migrate once to SQLite without losing raw body, archive state or old IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-note-migrate-'));
  const state = createDefaultState();
  state.notes = [{ id: 'legacy-note', title: '旧笔记', content: '  原始正文\n\n', artifactKind: 'problem', tags: ['保留'], archived: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', sourceRefs: [{ url: 'https://example.com', title: '来源' }] }];
  await writeFile(join(root, 'state.json'), JSON.stringify(state));
  let h;
  try {
    h = await open(root);
    const notes = (await h.request('/api/notes?archived=true')).body.notes;
    assert.equal(notes[0].id, 'legacy-note');
    assert.equal(notes[0].content, state.notes[0].content);
    assert.equal(notes[0].archived, true);
    assert.equal(notes[0].artifactKind, 'problem');
    assert.deepEqual(notes[0].tags, ['保留']);
    assert.equal((await h.request('/api/notes')).body.notes.length, 0);
    assert.deepEqual(JSON.parse(await readFile(h.stateFile, 'utf8')).notes, []);
    await h.request('/api/notes/legacy-note', 'PATCH', { content: 'SQLite 最新正文' });
    await h.close(); h = null;
    // Simulate an old state.json copy left beside the new authoritative database.
    await writeFile(join(root, 'state.json'), JSON.stringify(state));
    h = await open(root);
    assert.equal((await h.request('/api/notes?archived=true')).body.notes[0].content, 'SQLite 最新正文');
  } finally { await h?.close(); await rm(root, { recursive: true, force: true }); }
});

test('content backup restores editable notes and attachments into a fresh app and survives restart', async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'flowmind-backup-source-'));
  const targetRoot = await mkdtemp(join(tmpdir(), 'flowmind-backup-target-'));
  let source, target;
  try {
    source = await open(sourceRoot);
    const created = await source.request('/api/notes', 'POST', { title: '恢复笔记', content: '正文不混入附件文本', artifactKind: 'problem', tags: ['备份'], sourceRefs: [{ url: 'https://example.com/doc', title: '网页证据' }] });
    const id = created.body.note.id;
    const attachment = source.app.locals.contentRepository.upsertAttachment({ contentItemId: id, externalId: 'restore-fixture', fileName: 'example.txt', mimeType: 'text/plain', data: Buffer.from('附件原件'), metadata: { kind: 'note-attachment', extractedText: '附件原件' } });
    await source.request(`/api/notes/${id}`, 'PATCH', { content: `正文不混入附件文本\n\n[附件](/api/notes/${id}/attachments/${attachment.id}/download)` });
    const expected = (await source.request('/api/notes')).body.notes[0];
    const archive = (await source.request('/api/content/backup')).body;
    target = await open(targetRoot);
    const restored = await target.request('/api/content/backup/restore', 'POST', { archive, mode: 'merge' });
    assert.equal(restored.status, 200);
    let notes = (await target.request('/api/notes')).body.notes;
    assert.equal(notes.length, 1);
    assert.equal(notes[0].id, id);
    assert.equal(notes[0].content, expected.content);
    assert.equal(notes[0].artifactKind, 'problem');
    assert.equal(notes[0].sourceRefs[0].url, 'https://example.com/doc');
    assert.equal(notes[0].attachments[0].fileName, 'example.txt');
    assert.equal(target.app.locals.contentRepository.getAttachmentData(notes[0].attachments[0].id).toString(), '附件原件');
    assert.ok((await target.request('/api/search?q=' + encodeURIComponent('恢复笔记'))).body.results.some(item => item.id === id || item.noteId === id));
    const edited = await target.request(`/api/notes/${id}`, 'PATCH', { content: '恢复后继续编辑' });
    assert.equal(edited.status, 200);
    await target.close(); target = null;
    target = await open(targetRoot);
    notes = (await target.request('/api/notes')).body.notes;
    assert.equal(notes[0].content, '恢复后继续编辑');
  } finally { await source?.close(); await target?.close(); await rm(sourceRoot, { recursive: true, force: true }); await rm(targetRoot, { recursive: true, force: true }); }
});

test('failed state persistence cannot partially create a canonical note; later writes recover', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-note-write-failure-'));
  const h = await open(root);
  try {
    const persist = h.app.locals.store.persist.bind(h.app.locals.store);
    h.app.locals.store.persist = async () => { throw new Error('synthetic persistence failure'); };
    assert.equal((await h.request('/api/notes', 'POST', { title: '不能部分创建', content: '测试' })).status, 500);
    assert.equal((await h.request('/api/notes')).body.notes.length, 0);
    assert.equal(h.app.locals.contentRepository.listContentItems({ contentType: 'note' }).length, 0);
    h.app.locals.store.persist = persist;
    assert.equal((await h.request('/api/notes', 'POST', { title: '恢复写入', content: '测试' })).status, 201);
    assert.equal((await h.request('/api/notes')).body.notes.length, 1);
  } finally { await h.close(); await rm(root, { recursive: true, force: true }); }
});

test('SQLite-only notes are editable and deleted notes stay deleted after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-note-sqlite-'));
  let h;
  try {
    h = await open(root);
    const item = h.app.locals.contentRepository.createNote({ title: 'SQL 原生笔记', content: 'SQLite 是内容真源' }).item;
    assert.equal((await h.request('/api/notes')).body.notes[0].id, item.id);
    assert.equal((await h.request(`/api/notes/${item.id}`, 'PATCH', { content: '可继续编辑' })).status, 200);
    assert.equal((await h.request(`/api/notes/${item.id}`, 'DELETE')).status, 200);
    await h.close(); h = null;
    h = await open(root);
    assert.equal((await h.request('/api/notes?archived=true')).body.notes.length, 0);
    assert.ok(h.app.locals.contentRepository.getContentItem(item.id, { includeDeleted: true }).deletedAt);
  } finally { await h?.close(); await rm(root, { recursive: true, force: true }); }
});
