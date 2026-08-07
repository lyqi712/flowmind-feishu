import assert from 'node:assert/strict';
import test from 'node:test';
import { ContentRepository } from '../server/content/index.mjs';
import { GraphIndex, parseExplicitLinks } from '../server/graph/index.mjs';
import { MarkdownMirrorService } from '../server/markdown-mirror/index.mjs';

function repository() {
  return new ContentRepository({ forceSearchFallback: true });
}

test('explicit graph index keeps only attributable links in the main graph and isolates unresolved targets', () => {
  const repo = repository();
  try {
    const target = repo.createNote({ title: 'Target Note', content: '# Overview\n\nEvidence lives here.' }).item;
    const source = repo.createNote({
      title: 'Source Note',
      content: '[[Target Note#Overview|Target alias]]\n\n![[Missing Note]]\n\n[[02-Areas/Area Name]]\n\n`[[Code literal]]`',
      metadata: { sourceRefs: [{ documentId: target.id, anchor: 'heading:overview:1', provenance: { kind: 'explicit' } }] },
      tags: ['work']
    }).item;
    const graph = new GraphIndex({ repository: repo });
    const snapshot = graph.rebuild();
    const sourceNode = snapshot.nodes.find(node => node.sourceId === source.id);
    const targetNode = snapshot.nodes.find(node => node.sourceId === target.id);
    const link = snapshot.edges.find(edge => edge.from === sourceNode.id && edge.to === targetNode.id && edge.type === 'link');
    const sourceEdge = snapshot.edges.find(edge => edge.from === sourceNode.id && edge.to === targetNode.id && edge.type === 'source');
    assert.ok(link);
    assert.equal(link.sourceAnchor.startsWith('line:'), true);
    assert.equal(link.targetAnchor, 'Overview');
    assert.ok(sourceEdge);
    assert.equal(snapshot.edges.some(edge => edge.type === 'semantic'), false);
    assert.equal(snapshot.nodes.some(node => /Area Name|Missing Note/.test(node.title)), false);
    assert.equal(snapshot.unresolved.length, 1);
    assert.equal(snapshot.unresolved[0].rawTarget, 'Missing Note');
    assert.ok(snapshot.edges.every(edge => edge.provenance?.kind));
  } finally { repo.close(); }
});

test('renaming preserves the old title as an alias and resolves existing explicit backlinks', () => {
  const repo = repository();
  try {
    const target = repo.createNote({ title: 'Initial Title', content: '# Heading' }).item;
    const source = repo.createNote({ title: 'Referrer', content: '[[Initial Title#Heading]]' }).item;
    const graph = new GraphIndex({ repository: repo });
    graph.rebuild();
    repo.updateNote(target.id, { title: 'Renamed Title' });
    const snapshot = graph.rebuild();
    const targetNode = snapshot.nodes.find(node => node.sourceId === target.id);
    const sourceNode = snapshot.nodes.find(node => node.sourceId === source.id);
    assert.equal(targetNode.title, 'Renamed Title');
    assert.ok(targetNode.aliases.includes('Initial Title'));
    assert.ok(snapshot.edges.some(edge => edge.from === sourceNode.id && edge.to === targetNode.id && edge.type === 'link'));
  } finally { repo.close(); }
});

test('link parser supports aliases, anchors, embeds and Markdown files while ignoring fenced code', () => {
  const links = parseExplicitLinks('[[Alpha#part|Shown]] ![[Beta]] [Gamma](folder/Gamma.md#top)\n```md\n[[Ignored]]\n```');
  assert.deepEqual(links.map(link => ({ kind: link.kind, target: link.target, anchor: link.anchor, alias: link.alias })), [
    { kind: 'wikilink', target: 'Alpha', anchor: 'part', alias: 'Shown' },
    { kind: 'embed', target: 'Beta', anchor: null, alias: null },
    { kind: 'markdown-link', target: 'folder/Gamma.md', anchor: 'top', alias: 'Gamma' }
  ]);
});

test('link parser discards common vault template fragments in Wiki and Markdown forms', () => {
  const links = parseExplicitLinks([
    '[[02-Areas/Area Name]]', '[Person](05-People/Name)', '[Index](MOC/Index)', '[[wikilink]]',
    '[Project](01-Projects/Project Name)', '[[note title]]', '[[Note Title 1]]',
    '[Example](02-Areas/Marketing/Old Campaign Brief)', '[Real](Folder/Real Note.md)'
  ].join('\n'));
  assert.deepEqual(links.map(link => ({ kind: link.kind, target: link.target })), [
    { kind: 'markdown-link', target: 'Folder/Real Note.md' }
  ]);
});

test('Markdown mirror detects a two-sided conflict without overwriting either side', () => {
  const repo = repository();
  try {
    const graph = new GraphIndex({ repository: repo });
    const mirror = new MarkdownMirrorService({ repository: repo, graphIndex: graph });
    const root = mirror.registerRoot({ rootToken: 'fixture-root', displayName: 'Fixture vault' });
    const first = mirror.scan(root.id, [{ relativePath: 'notes/alpha.md', content: '# Alpha\n\nOriginal' }]);
    assert.equal(first.stats.created, 1);
    const entry = mirror.listEntries(root.id)[0];
    const item = repo.getContentItem(entry.contentItemId);
    repo.upsertContentItem({
      id: item.id, sourceConnectionId: item.sourceConnectionId, spaceId: item.spaceId, externalId: item.externalId,
      contentType: item.contentType, title: item.title, content: '# Alpha\n\nDatabase change', revision: 'database-change',
      mimeType: item.mimeType, metadata: item.metadata, tags: item.tags
    });
    const databaseOnly = mirror.scan(root.id, [{ relativePath: 'notes/alpha.md', content: '# Alpha\n\nOriginal' }]);
    assert.equal(databaseOnly.stats.pendingWrites, 1);
    const conflicted = mirror.scan(root.id, [{ relativePath: 'notes/alpha.md', content: '# Alpha\n\nDisk change' }]);
    assert.equal(conflicted.stats.conflicts, 1);
    assert.equal(repo.getContentItem(entry.contentItemId).content.includes('Database change'), true);
    assert.equal(mirror.listConflicts({ rootId: root.id }).length, 1);
  } finally { repo.close(); }
});

test('graph rebuild remains interactive for 1000 notes and 5000 explicit edges', () => {
  const repo = repository();
  try {
    const { source, space } = repo.ensureLocalNotesSpace();
    for (let index = 0; index < 1000; index += 1) {
      const links = Array.from({ length: 5 }, (_, offset) => `[[Note ${(index + offset + 1) % 1000}]]`).join(' ');
      repo.upsertContentItem({
        id: `perf-${index}`, sourceConnectionId: source.id, spaceId: space.id, externalId: `perf-${index}`,
        contentType: 'note', title: `Note ${index}`, content: links, revision: `r-${index}`, metadata: {}, tags: index % 5 === 0 ? ['perf'] : []
      });
    }
    const graph = new GraphIndex({ repository: repo });
    const started = performance.now();
    const snapshot = graph.rebuild();
    const elapsed = performance.now() - started;
    assert.equal(snapshot.nodes.filter(node => node.type === 'note').length, 1000);
    assert.equal(snapshot.edges.filter(edge => edge.type === 'link').length, 5000);
    assert.ok(elapsed <= 3000, `expected graph rebuild <= 3000ms, received ${elapsed.toFixed(1)}ms`);
  } finally { repo.close(); }
});
