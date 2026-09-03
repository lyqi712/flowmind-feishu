import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLocalProjection,
  createWorkspaceBundle,
  createWorkspaceSyncEnvelope,
  mergeWorkspaceProjections,
  sanitizeWorkspaceSession,
  sessionFromProjection,
  verifyWorkspaceBundle,
  verifyWorkspaceSyncEnvelope
} from '../shared/workspace-sync.mjs';

function session(overrides = {}) {
  return {
    version: 4,
    tabs: [{ id: 'tab-doc', kind: 'document', type: 'document', route: 'knowledge', resourceId: 'doc-1', title: '资料', content: 'DO NOT SYNC', messages: [{ role: 'assistant', content: 'DO NOT SYNC' }], apiKey: 'secret', localPath: 'C:/private/file' }],
    activeTabId: 'tab-doc',
    recentWork: [{ id: 'recent-doc', kind: 'document', type: 'document', documentId: 'doc-1', title: '资料', summary: '正文摘要不应同步', useCount: 2 }],
    readingPositions: { 'doc-1': { scrollTop: 10, progress: 0.2, anchor: 'chars:1-4', quote: 'DO NOT SYNC' } },
    aiContextItems: [{ id: 'ctx-1', kind: 'selection', documentId: 'doc-1', anchor: 'chars:1-4', quote: 'DO NOT SYNC', text: 'DO NOT SYNC', content: 'DO NOT SYNC' }],
    tasks: [{ id: 'task-1', type: 'skill', status: 'running', title: '继续任务', output: 'DO NOT SYNC', message: 'DO NOT SYNC', documentIds: ['doc-1'] }],
    draftMarkers: { 'doc-1': { dirty: true, localPath: 'C:/private/file' } },
    ...overrides
  };
}

test('workspace projection is an explicit allowlist and excludes content, output, paths and secrets', () => {
  const safe = sanitizeWorkspaceSession(session());
  const raw = JSON.stringify(safe);
  assert.doesNotMatch(raw, /DO NOT SYNC|apiKey|localPath|messages|output|quote|content|message/i);
  assert.equal(safe.tabs[0].content, undefined);
  assert.equal(safe.tabs[0].chat?.selection?.quote, undefined);
  assert.equal(safe.aiContextItems[0].anchor, 'chars:1-4');
  assert.equal(safe.tasks[0].status, 'paused');
  assert.equal(safe.tasks[0].recoverable, true);
});

test('local projections retain tombstones so a closed tab cannot be resurrected by an old peer', () => {
  const first = createLocalProjection(session(), null, { actorId: 'device-a' });
  const removed = createLocalProjection({ ...session(), tabs: [], activeTabId: null }, first.projection, { actorId: 'device-a', counter: first.counter });
  const merged = mergeWorkspaceProjections({ localProjection: removed.projection, remoteProjection: first.projection, baseProjection: first.projection, localSession: { activeTabId: null } });
  assert.ok(Object.values(removed.projection.collections.tabs).some(entry => entry.deleted === true));
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.session.tabs.length, 0);
});

test('divergent reading positions become explicit conflicts and resolve without changing local active tab', () => {
  const base = createLocalProjection(session(), null, { actorId: 'base' });
  const local = createLocalProjection({ ...session(), readingPositions: { 'doc-1': { scrollTop: 120, progress: 0.4, anchor: 'chars:10-20' } } }, base.projection, { actorId: 'local', counter: base.counter });
  const remote = createLocalProjection({ ...session(), readingPositions: { 'doc-1': { scrollTop: 620, progress: 0.8, anchor: 'chars:80-90' } } }, base.projection, { actorId: 'remote', counter: base.counter });
  const conflicted = mergeWorkspaceProjections({ localProjection: local.projection, remoteProjection: remote.projection, baseProjection: base.projection, localSession: { activeTabId: 'tab-doc' } });
  assert.equal(conflicted.canApply, false);
  assert.ok(conflicted.conflicts.some(item => item.collection === 'readingPositions'));
  const choice = conflicted.conflicts.find(item => item.collection === 'readingPositions');
  const resolved = mergeWorkspaceProjections({ localProjection: local.projection, remoteProjection: remote.projection, baseProjection: base.projection, localSession: { activeTabId: 'tab-doc' }, resolutions: { [choice.id]: 'remote' } });
  assert.equal(resolved.canApply, true);
  assert.equal(resolved.session.activeTabId, 'tab-doc');
  assert.equal(resolved.session.readingPositions['doc-1'].scrollTop, 620);
});

test('remote active tasks are recoverable and never presented as still running', () => {
  const remote = createLocalProjection(session(), null, { actorId: 'remote' });
  const restored = sessionFromProjection(remote.projection, { activeTabId: null });
  assert.equal(restored.tasks[0].status, 'paused');
  assert.equal(restored.tasks[0].recoverable, true);
});

test('bundle checksum and sync envelope reject tampering and future schema', async () => {
  const bundle = await createWorkspaceBundle(session(), { deviceId: 'device-a' });
  assert.equal((await verifyWorkspaceBundle(bundle)).session.tabs.length, 1);
  await assert.rejects(() => verifyWorkspaceBundle({ ...bundle, session: { ...bundle.session, tabs: [] } }), error => error.code === 'WORKSPACE_BUNDLE_CHECKSUM_INVALID');

  const projection = createLocalProjection(session(), null, { actorId: 'device-a' }).projection;
  const envelope = await createWorkspaceSyncEnvelope({ workspaceId: 'workspace-1', deviceId: 'device-a', projection });
  assert.equal((await verifyWorkspaceSyncEnvelope(envelope, { workspaceId: 'workspace-1' })).workspaceId, 'workspace-1');
  await assert.rejects(() => verifyWorkspaceSyncEnvelope({ ...envelope, schemaVersion: 99 }), error => error.code === 'WORKSPACE_SYNC_FORMAT_INVALID');
  await assert.rejects(() => verifyWorkspaceSyncEnvelope({ ...envelope, digest: 'tampered' }), error => error.code === 'WORKSPACE_SYNC_DIGEST_INVALID');
});
