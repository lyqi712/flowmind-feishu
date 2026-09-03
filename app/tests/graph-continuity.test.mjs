import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';
import { ContentRepository } from '../server/content/index.mjs';
import { GraphIndex } from '../server/graph/index.mjs';

function repository() {
  return new ContentRepository({ forceSearchFallback: true });
}

test('one explicit index covers Feishu metadata links, note backlinks, unresolved targets, and source version anchors', () => {
  const repo = repository();
  try {
    const source = repo.upsertSourceConnection({ sourceType: 'feishu', externalId: 'tenant-fixture', name: 'Feishu fixture' });
    const space = repo.upsertSpace({ sourceConnectionId: source.id, externalId: 'space-fixture', name: 'Fixture space' });
    const target = repo.upsertContentItem({
      sourceConnectionId: source.id, spaceId: space.id, externalId: 'doc-target', contentType: 'docx',
      title: 'Feishu target', content: '# Target anchor\n\nTarget evidence', revision: 'target-v1'
    }).item;
    const origin = repo.upsertContentItem({
      sourceConnectionId: source.id, spaceId: space.id, externalId: 'doc-origin', contentType: 'docx',
      title: 'Feishu origin', content: '# Origin\n\nFeishu body', revision: 'origin-v3',
      metadata: {
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
    const graph = new GraphIndex({ repository: repo });
    const snapshot = graph.rebuild();
    const originNode = snapshot.nodes.find(node => node.sourceId === origin.id);
    const targetNode = snapshot.nodes.find(node => node.sourceId === target.id);
    const noteNode = snapshot.nodes.find(node => node.sourceId === note.id);
    const metadataEdge = snapshot.edges.find(edge => edge.from === originNode.id && edge.to === targetNode.id && edge.createdSource === 'feishu-metadata-link');
    const noteLink = snapshot.edges.find(edge => edge.from === noteNode.id && edge.to === originNode.id && edge.type === 'link');
    const noteSource = snapshot.edges.find(edge => edge.from === noteNode.id && edge.to === originNode.id && edge.type === 'source');

    assert.ok(metadataEdge);
    assert.equal(metadataEdge.sourceAnchor, 'block:origin-link');
    assert.equal(metadataEdge.targetAnchor, 'heading:target-anchor:1');
    assert.equal(metadataEdge.sourceVersionId, origin.currentVersionId);
    assert.equal(metadataEdge.provenance.targetVersionId, target.currentVersionId);
    assert.ok(noteLink);
    assert.ok(noteSource);
    assert.equal(snapshot.unresolved.length, 1);
    assert.equal(snapshot.unresolved[0].rawTarget, 'Missing Feishu document');
    const relations = graph.getRelations(originNode.id);
    assert.ok(relations.incoming.some(row => row.node.id === noteNode.id && row.edge.type === 'link'));
  } finally {
    repo.close();
  }
});

test('note writes rebuild the server index so the next snapshot has current backlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-graph-continuity-'));
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
    const document = repo.upsertContentItem({
      sourceConnectionId: source.id, spaceId: space.id, externalId: 'continuity-doc', contentType: 'docx',
      title: 'Continuity document', content: '# Source\n\nVerifiable source', revision: 'v1'
    }).item;
    app.locals.graphIndex.rebuild();
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const before = await fetch(`${base}/api/graph`).then(response => response.json());
    assert.equal(before.graph.edges.some(edge => edge.type === 'source'), false);
    const created = await fetch(`${base}/api/notes`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Live backlink', content: '[[Continuity document#Source]]', sourceRefs: [{ documentId: document.id, anchor: 'heading:source:1', provenance: { kind: 'explicit' } }] })
    });
    assert.equal(created.status, 201);
    const after = await fetch(`${base}/api/graph`).then(response => response.json());
    assert.ok(after.graph.edges.some(edge => edge.type === 'link' && edge.rawTarget === 'Continuity document'));
    assert.ok(after.graph.edges.some(edge => edge.type === 'source' && edge.targetAnchor === 'heading:source:1'));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await app?.locals?.close?.().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
