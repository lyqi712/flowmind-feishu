import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bindEvidenceRef, classifyEvidence } from '../server/evidence.mjs';
import { createInitializedApp } from '../server/app.mjs';
import { createFakeModelService } from './helpers/fake-model.mjs';

function ndjson(text) {
  return String(text || '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-evidence-continuity-'));
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'), env: {}, ocrService: false, transcriptionService: false,
    modelService: createFakeModelService(),
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  return {
    root,
    app,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise(resolve => server.close(resolve));
      await app.locals.close();
      await rm(root, { recursive: true, force: true });
    }
  };
}

async function json(base, path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  });
  return { response, body: await response.json() };
}

async function chat(base, body) {
  const response = await fetch(base + '/api/chat/stream', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  assert.equal(response.status, 200);
  return ndjson(await response.text());
}

test('shared Evidence contract distinguishes current, stale, unavailable and legacy refs', () => {
  const first = { id: 'doc-1', title: 'Release plan', currentVersionId: 7, revision: 'r7', contentHash: 'hash-7' };
  const ref = bindEvidenceRef({ documentId: 'doc-1', anchor: 'heading:owner:1', excerpt: 'Owner: Alice' }, first);
  assert.equal(ref.evidenceSchemaVersion, 1);
  assert.equal(ref.evidenceStatus, 'current');
  assert.equal(ref.contentVersionId, 7);
  assert.equal(ref.revision, 'r7');
  assert.equal(ref.contentHash, 'hash-7');
  assert.match(ref.evidenceId, /^evidence_[a-f0-9]{32}$/u);
  assert.equal(ref.excerptHash.length, 64);
  assert.deepEqual(ref.sourceVersion, { id: 7, revision: 'r7', contentHash: 'hash-7' });
  assert.equal(bindEvidenceRef({ ...ref }, first).evidenceId, ref.evidenceId, 'the same observed source is stable');

  const changed = { ...first, currentVersionId: 8, revision: 'r8', contentHash: 'hash-8' };
  assert.equal(classifyEvidence(ref, changed).status, 'stale');
  assert.equal(bindEvidenceRef(ref, changed).evidenceStatus, 'stale');
  assert.equal(bindEvidenceRef(ref, { ...changed, deletedAt: '2026-08-09T00:00:00.000Z' }).evidenceStatus, 'unavailable');
  assert.equal(bindEvidenceRef({ documentId: 'doc-1', excerpt: 'legacy' }, first).evidenceStatus, 'current', 'legacy refs are upgraded when the current document is known');
  assert.equal(bindEvidenceRef({ documentId: 'missing', excerpt: 'unknown' }, null).evidenceStatus, 'unavailable');
});

test('chat citations and saved source refs retain versions, then become stale without retargeting', async () => {
  const h = await harness();
  try {
    const imported = await json(h.base, '/api/content/import', 'POST', {
      items: [{ externalId: 'evidence-fixture', fileName: 'evidence.md', title: 'Evidence fixture', content: '# Evidence\n\nOwner: Alice.\n\nThe stable anchor remains observable.' }]
    });
    assert.equal(imported.response.status, 201);
    const item = imported.body.items[0].item;
    const firstVersionId = item.currentVersionId;
    const events = await chat(h.base, { question: 'Who is the owner?', documentIds: [item.id] });
    const done = events.find(event => event.type === 'done');
    assert.ok(done?.citations?.length);
    const citation = done.citations[0];
    assert.equal(citation.evidenceStatus, 'current');
    assert.equal(citation.contentVersionId, firstVersionId);
    assert.equal(citation.currentVersionId, firstVersionId);
    assert.equal(citation.contentHash, item.contentHash);
    assert.equal(citation.provenance.sourceVersionId, firstVersionId);

    const createdNote = await json(h.base, '/api/notes', 'POST', {
      title: 'Evidence note', content: 'Saved from the answer.', sourceRefs: [citation]
    });
    assert.equal(createdNote.response.status, 201);
    assert.equal(createdNote.body.note.sourceRefs[0].evidenceStatus, 'current');

    const updated = await json(h.base, '/api/content/import', 'POST', {
      items: [{ externalId: 'evidence-fixture', fileName: 'evidence.md', title: 'Evidence fixture', revision: 'fixture-r2', content: '# Evidence\n\nOwner: Bob.\n\nThe stable anchor remains observable, with a changed decision.' }]
    });
    assert.equal(updated.response.status, 201);
    assert.equal(updated.body.items[0].action, 'versioned');
    assert.notEqual(updated.body.items[0].item.currentVersionId, firstVersionId);

    const conversation = await json(h.base, `/api/conversations/${encodeURIComponent(done.conversationId)}`);
    const savedNote = await json(h.base, '/api/notes?archived=true');
    const staleConversationRef = conversation.body.conversation.citations.find(ref => ref.documentId === item.id);
    const staleNoteRef = savedNote.body.notes.find(note => note.id === createdNote.body.note.id).sourceRefs[0];
    assert.equal(staleConversationRef.evidenceStatus, 'stale');
    assert.equal(staleConversationRef.contentVersionId, firstVersionId);
    assert.notEqual(staleConversationRef.currentVersionId, firstVersionId);
    assert.equal(staleNoteRef.evidenceStatus, 'stale');
    assert.equal(staleNoteRef.contentVersionId, firstVersionId);

    const historical = await json(h.base, `/api/content/items/${encodeURIComponent(item.id)}/versions/${encodeURIComponent(firstVersionId)}`);
    assert.equal(historical.response.status, 200);
    assert.match(historical.body.version.content, /Owner: Alice/u);
    assert.equal(historical.body.evidence.evidenceStatus, 'stale');
    assert.equal(historical.body.evidence.contentVersionId, firstVersionId);
    assert.notEqual(historical.body.current.versionId, firstVersionId);

    const relations = await json(h.base, '/api/knowledge/relations', 'POST', {
      question: 'owner', documentIds: [item.id], citations: [citation], answer: 'old answer'
    });
    assert.equal(relations.response.status, 200);
    assert.equal(relations.body.unsupportedCitations[0].reason, 'version_mismatch');

    h.app.locals.contentRepository.softDeleteContentItem(item.id);
    const deletedConversation = await json(h.base, `/api/conversations/${encodeURIComponent(done.conversationId)}`);
    assert.equal(deletedConversation.body.conversation.citations.find(ref => ref.documentId === item.id).evidenceStatus, 'unavailable');
  } finally {
    await h.close();
  }
});

test('ordinary client source refs cannot claim a trusted current location from an ID or forged anchor', async () => {
  const h = await harness();
  try {
    const imported = await json(h.base, '/api/content/import', 'POST', {
      items: [{ externalId: 'unverified-fixture', fileName: 'unverified.md', title: 'Unverified fixture', content: '# Evidence\n\nOwner: Alice.\n\nOnly this text is observable.' }]
    });
    const item = imported.body.items[0].item;
    const forged = await json(h.base, '/api/notes', 'POST', {
      title: 'Forged source',
      content: 'This must not become trusted evidence.',
      sourceRefs: [{ documentId: item.id, contentVersionId: item.currentVersionId, revision: item.revision, contentHash: item.contentHash, anchor: 'forged-anchor', excerpt: 'Text that is not in the document' }]
    });
    assert.equal(forged.response.status, 201);
    assert.equal(forged.body.note.sourceRefs[0].evidenceStatus, 'unverified');
    assert.equal(forged.body.note.sourceRefs[0].evidenceStatusReason, 'source_location_not_observed');
    const forgedGraph = await json(h.base, '/api/graph');
    const forgedSourceEdge = forgedGraph.body.graph.edges.find(edge => edge.type === 'source' && edge.rawTarget === item.id);
    assert.equal(forgedSourceEdge?.provenance?.sourceRef?.evidenceStatus, 'unverified', 'graph source provenance must not upgrade an unverified ref to current');

    const idOnly = await json(h.base, '/api/notes', 'POST', {
      title: 'ID only source', content: 'The document ID alone is insufficient.', sourceRefs: [{ documentId: item.id }]
    });
    assert.equal(idOnly.response.status, 201);
    assert.equal(idOnly.body.note.sourceRefs[0].evidenceStatus, 'unverified');
    assert.equal(idOnly.body.note.sourceRefs[0].evidenceStatusReason, 'source_location_not_observed');

    const excerpt = 'Only this text is observable.';
    const start = item.content.indexOf(excerpt);
    const verifiedSelection = await json(h.base, '/api/notes', 'POST', {
      title: 'Verified character selection', content: 'A server-observed selection stays trusted.',
      sourceRefs: [{ documentId: item.id, contentVersionId: item.currentVersionId, revision: item.revision, contentHash: item.contentHash, anchor: `chars:${start}-${start + excerpt.length}`, excerpt }]
    });
    assert.equal(verifiedSelection.response.status, 201);
    assert.equal(verifiedSelection.body.note.sourceRefs[0].evidenceStatus, 'current');

    const partialRange = await json(h.base, '/api/notes', 'POST', {
      title: 'Partial range cannot claim full excerpt', content: 'A shortened anchor must not be trusted for a longer excerpt.',
      sourceRefs: [{ documentId: item.id, contentVersionId: item.currentVersionId, revision: item.revision, contentHash: item.contentHash, anchor: `chars:${start}-${start + 4}`, excerpt }]
    });
    assert.equal(partialRange.response.status, 201);
    assert.equal(partialRange.body.note.sourceRefs[0].evidenceStatus, 'unverified');
    assert.equal(partialRange.body.note.sourceRefs[0].evidenceStatusReason, 'source_location_not_observed');
  } finally {
    await h.close();
  }
});

test('deleted documents keep historical versions readable while current Evidence is unavailable', async () => {
  const h = await harness();
  try {
    const first = await json(h.base, '/api/content/import', 'POST', {
      items: [{ externalId: 'deleted-history-fixture', fileName: 'history.md', title: 'History fixture', content: 'Version one: Alice.' }]
    });
    const item = first.body.items[0].item;
    const oldVersionId = item.currentVersionId;
    const second = await json(h.base, '/api/content/import', 'POST', {
      items: [{ externalId: 'deleted-history-fixture', fileName: 'history.md', title: 'History fixture', revision: 'r2', content: 'Version two: Bob.' }]
    });
    assert.notEqual(second.body.items[0].item.currentVersionId, oldVersionId);
    h.app.locals.contentRepository.softDeleteContentItem(item.id);
    const historical = await json(h.base, `/api/content/items/${encodeURIComponent(item.id)}/versions/${encodeURIComponent(oldVersionId)}`);
    assert.equal(historical.response.status, 200);
    assert.match(historical.body.version.content, /Alice/u);
    assert.equal(historical.body.evidence.evidenceStatus, 'unavailable');
    assert.equal(historical.body.evidence.evidenceStatusReason, 'document_deleted');
    assert.equal(historical.body.versions.length, 2);
    assert.notEqual(historical.body.current.versionId, oldVersionId);
  } finally {
    await h.close();
  }
});
test('generated translations and graph nodes expose the same source version contract', async () => {
  const h = await harness();
  try {
    const imported = await json(h.base, '/api/content/import', 'POST', {
      items: [{ externalId: 'translation-fixture', fileName: 'translation.md', title: 'Translation fixture', content: '# Guide\n\nOwner is Alice.\n\nDeadline is Friday.' }]
    });
    const item = imported.body.items[0].item;
    const translation = await json(h.base, '/api/translations', 'POST', {
      documentId: item.id,
      segments: [{ index: 0, sourceText: 'Owner is Alice.', translatedText: '负责人是 Alice。', anchor: 'chars:0-45' }]
    });
    assert.equal(translation.response.status, 201);
    const source = translation.body.translation.sourceRefs[0];
    assert.equal(source.evidenceStatus, 'current');
    assert.equal(source.contentVersionId, item.currentVersionId);
    assert.equal(translation.body.translation.sourceVersionId, item.currentVersionId);

    const graph = await json(h.base, '/api/graph');
    const graphNode = graph.body.graph.nodes.find(node => node.sourceId === item.id);
    assert.ok(graphNode);
    assert.equal(graphNode.contentVersionId, item.currentVersionId);
    assert.equal(graphNode.sourceRef.evidenceStatus, 'current');
    assert.equal(graphNode.sourceRef.contentVersionId, item.currentVersionId);

    await json(h.base, '/api/content/import', 'POST', {
      items: [{ externalId: 'translation-fixture', fileName: 'translation.md', title: 'Translation fixture', revision: 'translation-r2', content: '# Guide\n\nOwner is Bob.\n\nDeadline is Monday.' }]
    });
    const restored = await json(h.base, `/api/translations/${encodeURIComponent(translation.body.translation.id)}`);
    assert.equal(restored.body.translation.sourceRefs[0].evidenceStatus, 'stale');
    const refreshedGraph = await json(h.base, '/api/graph');
    const refreshedNode = refreshedGraph.body.graph.nodes.find(node => node.sourceId === item.id);
    assert.equal(refreshedNode.sourceRef.evidenceStatus, 'current', 'content ingestion rebuilds graph to the new version');
  } finally {
    await h.close();
  }
});
