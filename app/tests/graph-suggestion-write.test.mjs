import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { GraphIndex } from '../server/graph/graph-index.mjs';

function createHarness() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE graph_nodes (
      id TEXT PRIMARY KEY,
      content_item_id TEXT,
      node_type TEXT NOT NULL,
      space_id TEXT,
      path TEXT,
      title TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      properties_json TEXT NOT NULL DEFAULT '{}',
      version_id INTEGER,
      content_hash TEXT,
      provenance_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE graph_edges (
      id TEXT PRIMARY KEY,
      source_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      target_node_id TEXT REFERENCES graph_nodes(id) ON DELETE CASCADE,
      edge_type TEXT NOT NULL,
      directed INTEGER NOT NULL DEFAULT 1,
      source_anchor TEXT,
      target_anchor TEXT,
      label TEXT NOT NULL DEFAULT '',
      parsing_status TEXT NOT NULL DEFAULT 'resolved',
      created_source TEXT NOT NULL,
      source_content_item_id TEXT,
      source_version_id INTEGER,
      raw_target TEXT,
      occurrence INTEGER NOT NULL DEFAULT 1,
      provenance_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE graph_suggestions (
      id TEXT PRIMARY KEY,
      source_node_id TEXT REFERENCES graph_nodes(id) ON DELETE SET NULL,
      target_node_id TEXT REFERENCES graph_nodes(id) ON DELETE SET NULL,
      edge_type TEXT NOT NULL DEFAULT 'link',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','applied','failed')),
      reason TEXT NOT NULL DEFAULT '',
      evidence_json TEXT NOT NULL DEFAULT '[]',
      proposed_content_item_id TEXT,
      proposed_patch_json TEXT NOT NULL DEFAULT '{}',
      created_source TEXT NOT NULL DEFAULT 'agent',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT
    );
  `);
  const items = [
    { id: 'note-a', contentType: 'note', title: '方案 A', content: '方案 A 正文。', spaceId: 'space-notes', sourceConnectionId: 'src-local', externalId: 'note-a', currentVersionId: 1, contentHash: 'hash-a', metadata: {}, tags: [], sourceUrl: null },
    { id: 'note-b', contentType: 'note', title: '方案 B', content: '方案 B 正文。', spaceId: 'space-notes', sourceConnectionId: 'src-local', externalId: 'note-b', currentVersionId: 2, contentHash: 'hash-b', metadata: {}, tags: [], sourceUrl: null }
  ];
  const repository = {
    db,
    listContentItems() { return items; },
    listSpaces() { return [{ id: 'space-notes', name: 'Notes', spaceType: 'notes', sourceConnectionId: 'src-local', externalId: 'notes' }]; },
    listSourceConnections() { return [{ id: 'src-local', sourceType: 'local' }]; },
    getContentItem(id) { return items.find(item => item.id === id) || null; },
    transaction(fn) { return fn(); }
  };
  return { db, repository, graph: new GraphIndex({ repository }) };
}

test('确认建议会写入图谱边，重建后边还在；忽略不会写边', () => {
  const { db, graph } = createHarness();
  try {
    graph.rebuild();
    const sourceNode = graph.getNodeByContentItem('note-a');
    const targetNode = graph.getNodeByContentItem('note-b');
    assert.ok(sourceNode && targetNode);

    const pending = graph.createSuggestion({
      sourceNodeId: sourceNode.id,
      targetNodeId: targetNode.id,
      edgeType: 'link',
      reason: '两篇方案互相引用同一结论',
      createdSource: 'agent'
    });
    assert.equal(pending.status, 'pending');
    assert.equal(graph.snapshot().edges.some(edge => edge.from === sourceNode.id && edge.to === targetNode.id && edge.createdSource === 'suggestion-approved'), false);

    const ignored = graph.createSuggestion({
      sourceNodeId: targetNode.id,
      targetNodeId: sourceNode.id,
      edgeType: 'link',
      reason: '应被忽略',
      createdSource: 'agent'
    });
    const rejected = graph.transitionSuggestion(ignored.id, 'rejected');
    assert.equal(rejected.status, 'rejected');
    assert.equal(graph.insertApprovedSuggestionEdge(rejected), false);

    const approved = graph.transitionSuggestion(pending.id, 'approved');
    assert.equal(approved.status, 'approved');
    assert.equal(graph.insertApprovedSuggestionEdge(approved), true);
    const afterApprove = graph.snapshot();
    const written = afterApprove.edges.find(edge => edge.from === sourceNode.id && edge.to === targetNode.id && edge.createdSource === 'suggestion-approved');
    assert.ok(written);
    assert.equal(written.label, '两篇方案互相引用同一结论');
    assert.equal(written.provenance?.kind, 'approved-suggestion');
    assert.equal(written.provenance?.suggestionId, pending.id);
    assert.equal(afterApprove.edges.some(edge => edge.from === targetNode.id && edge.to === sourceNode.id && edge.createdSource === 'suggestion-approved'), false);

    const rebuilt = graph.rebuild();
    const survived = rebuilt.edges.find(edge => edge.from === sourceNode.id && edge.to === targetNode.id && edge.createdSource === 'suggestion-approved');
    assert.ok(survived, 'rebuild 会删边，已确认建议必须写回');
    assert.equal(survived.provenance?.suggestionId, pending.id);
    assert.equal(rebuilt.edges.some(edge => edge.from === targetNode.id && edge.to === sourceNode.id && edge.createdSource === 'suggestion-approved'), false);
    assert.equal(graph.listSuggestions({ status: 'pending' }).length, 0);
    assert.equal(graph.listSuggestions({ status: 'approved' }).some(item => item.id === pending.id), true);
    assert.equal(graph.hasResolvedPair(sourceNode.id, targetNode.id, 'link'), true);
    assert.equal(graph.hasResolvedPair(targetNode.id, sourceNode.id, 'link'), true);
  } finally {
    db.close();
  }
});

test('同一对节点不会重复建 pending，已确认边会挡住新建议', () => {
  const { db, graph } = createHarness();
  try {
    graph.rebuild();
    const sourceNode = graph.getNodeByContentItem('note-a');
    const targetNode = graph.getNodeByContentItem('note-b');
    const first = graph.createSuggestion({
      sourceNodeId: sourceNode.id,
      targetNodeId: targetNode.id,
      edgeType: 'link',
      reason: '首次建议',
      createdSource: 'agent-answer'
    });
    assert.equal(first.status, 'pending');
    assert.equal(graph.hasResolvedPair(sourceNode.id, targetNode.id), false);
    const open = graph.findOpenSuggestionPair(sourceNode.id, targetNode.id, 'link');
    assert.equal(open.id, first.id);
    const reverseOpen = graph.findOpenSuggestionPair(targetNode.id, sourceNode.id, 'link');
    assert.equal(reverseOpen.id, first.id);

    const approved = graph.transitionSuggestion(first.id, 'approved');
    assert.equal(graph.insertApprovedSuggestionEdge(approved), true);
    assert.equal(graph.hasResolvedPair(sourceNode.id, targetNode.id), true);
    assert.equal(graph.findOpenSuggestionPair(sourceNode.id, targetNode.id, 'link')?.id, first.id);
  } finally {
    db.close();
  }
});
