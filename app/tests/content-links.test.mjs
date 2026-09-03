import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';

test('GET /api/content/items/:id/links returns outline and explicit link/embed/source edges only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-content-links-'));
  let app;
  let server;
  try {
    app = await createInitializedApp({
      stateFile: join(root, 'state.json'), env: {}, ocrService: false, transcriptionService: false,
      modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
      feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
    });
    const repo = app.locals.contentRepository;
    const source = repo.upsertSourceConnection({ sourceType: 'feishu', externalId: 'tenant-links', name: 'Feishu links' });
    const space = repo.upsertSpace({ sourceConnectionId: source.id, externalId: 'space-links', name: 'Links space' });
    const target = repo.upsertContentItem({
      sourceConnectionId: source.id, spaceId: space.id, externalId: 'doc-target', contentType: 'docx',
      title: 'Feishu target', content: '# Target anchor\n\nTarget evidence', revision: 'target-v1'
    }).item;
    const origin = repo.upsertContentItem({
      sourceConnectionId: source.id, spaceId: space.id, externalId: 'doc-origin', contentType: 'docx',
      title: 'Feishu origin', content: '# Origin\n\nFeishu body', revision: 'origin-v3',
      metadata: {
        outline: [{ level: 1, title: 'Origin', anchor: 'block:origin' }],
        links: [
          { documentId: target.id, label: 'Explicit Feishu target', sourceAnchor: 'block:origin-link', targetAnchor: 'heading:target-anchor:1' },
          { target: 'Missing Feishu document', sourceAnchor: 'block:missing-link' }
        ]
      }
    }).item;
    const note = repo.createNote({
      title: 'Research backlink', content: '[[Feishu origin#Origin]]',
      metadata: { sourceRefs: [{ documentId: origin.id, anchor: 'block:origin-link', provenance: { kind: 'explicit' } }] }
    }).item;
    app.locals.graphIndex.rebuild();
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const originLinks = await fetch(`${base}/api/content/items/${encodeURIComponent(origin.id)}/links`).then(response => response.json());
    assert.equal(originLinks.ok, true);
    assert.equal(originLinks.contentItemId, origin.id);
    assert.equal(originLinks.type, 'document');
    assert.ok(originLinks.outline.some(entry => entry.title === 'Origin'));
    assert.ok(originLinks.outgoing.some(row => row.contentItemId === target.id && row.edgeType === 'link' && row.type === 'document'));
    assert.ok(originLinks.incoming.some(row => row.contentItemId === note.id && row.type === 'note' && ['link', 'source'].includes(row.edgeType)));
    assert.equal(originLinks.outgoing.every(row => ['link', 'embed', 'source'].includes(row.edgeType)), true);
    assert.equal(originLinks.incoming.every(row => ['link', 'embed', 'source'].includes(row.edgeType)), true);
    assert.equal(originLinks.outgoing.some(row => row.title === 'Missing Feishu document'), false);

    const noteLinks = await fetch(`${base}/api/content/items/${encodeURIComponent(note.id)}/links`).then(response => response.json());
    assert.equal(noteLinks.ok, true);
    assert.equal(noteLinks.type, 'note');
    assert.ok(noteLinks.outgoing.some(row => row.contentItemId === origin.id && row.type === 'document'));

    const missing = await fetch(`${base}/api/content/items/missing-item/links`);
    assert.equal(missing.status, 404);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await app?.locals?.close?.().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('GET /api/content/items/:id/links keeps empty arrays when the graph has no explicit edges', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-content-links-empty-'));
  let app;
  let server;
  try {
    app = await createInitializedApp({
      stateFile: join(root, 'state.json'), env: {}, ocrService: false, transcriptionService: false,
      modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
      feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
    });
    const repo = app.locals.contentRepository;
    const { source, space } = repo.ensureLocalNotesSpace();
    const isolated = repo.upsertContentItem({
      sourceConnectionId: source.id, spaceId: space.id, externalId: 'isolated-doc', contentType: 'markdown',
      title: 'Isolated markdown', content: '# Only heading\n\nNo links here.', revision: 'v1'
    }).item;
    app.locals.graphIndex.rebuild();
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const links = await fetch(`${base}/api/content/items/${encodeURIComponent(isolated.id)}/links`).then(response => response.json());
    assert.equal(links.ok, true);
    assert.deepEqual(links.outgoing, []);
    assert.deepEqual(links.incoming, []);
    assert.ok(links.outline.some(entry => entry.title === 'Only heading'));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await app?.locals?.close?.().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
