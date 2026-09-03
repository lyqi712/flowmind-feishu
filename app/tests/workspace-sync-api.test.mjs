import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';

async function startApp(prefix) {
  const root = await mkdtemp(join(tmpdir(), `flowmind-${prefix}-`));
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    env: {},
    ocrService: false,
    transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') },
    workspaceSyncOptions: { secretFile: join(root, 'sync.enc'), masterKeyFile: join(root, 'sync.key'), relayFile: join(root, 'relay.json') }
  });
  const server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  return {
    root,
    app,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise(resolveServer => server.close(() => resolveServer()));
      await rm(root, { recursive: true, force: true });
    }
  };
}

async function json(base, path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, body: await response.json().catch(() => ({})) };
}

function session(reading = { scrollTop: 10, progress: 0.2, anchor: 'chars:1-4' }) {
  return {
    version: 4,
    tabs: [{ id: 'tab-doc', kind: 'document', type: 'document', route: 'knowledge', resourceId: 'doc-1', title: '跨设备资料', content: 'private body', contentVersionId: 2, revision: 'r2', contentHash: 'hash-2' }],
    activeTabId: 'tab-doc',
    recentWork: [{ id: 'recent-doc', kind: 'document', type: 'document', documentId: 'doc-1', title: '跨设备资料', useCount: 1 }],
    readingPositions: { 'doc-1': reading },
    aiContextItems: [{ id: 'context-doc', kind: 'document', documentId: 'doc-1', title: '跨设备资料', anchor: 'chars:1-4', quote: 'private body' }],
    tasks: [{ id: 'task-1', type: 'skill', status: 'running', title: '继续研究', output: 'private output', documentIds: ['doc-1'] }],
    draftMarkers: { 'doc-1': { dirty: true } }
  };
}

test('workspace sync pairs two temporary apps, applies an encrypted relay snapshot and recovers active tasks safely', async () => {
  const hub = await startApp('sync-hub');
  const deviceA = await startApp('sync-device-a');
  const deviceB = await startApp('sync-device-b');
  try {
    const created = await json(hub.base, '/api/workspace-sync/relay', 'POST', { endpoint: hub.base });
    assert.equal(created.response.status, 201);
    const { workspaceId, pairingToken } = created.body.relay;
    assert.ok(workspaceId);
    assert.ok(pairingToken);

    for (const device of [deviceA, deviceB]) {
      const configured = await json(device.base, '/api/workspace-sync/settings', 'PUT', { endpoint: hub.base, workspaceId, accessToken: pairingToken, enabled: true });
      assert.equal(configured.body.settings.enabled, true);
      assert.equal(configured.body.settings.accessTokenConfigured, true);
      assert.equal(JSON.stringify(configured.body), JSON.stringify(configured.body).replace(pairingToken, '[redacted]'));
    }

    const initialPreview = await json(deviceA.base, '/api/workspace-sync/preview', 'POST', { session: session() });
    assert.equal(initialPreview.body.remoteMissing, true);
    assert.equal(initialPreview.body.plan.canApply, true);
    const applied = await json(deviceA.base, '/api/workspace-sync/apply', 'POST', { session: session(), expectedRevision: null });
    assert.equal(applied.response.status, 200);
    assert.equal(applied.body.status, 'synced');
    assert.equal(applied.body.revision, 1);

    const pulled = await json(deviceB.base, '/api/workspace-sync/preview', 'POST', { session: { version: 4, tabs: [], activeTabId: null, recentWork: [], readingPositions: {}, aiContextItems: [], tasks: [], draftMarkers: {} } });
    assert.equal(pulled.body.remoteMissing, false);
    assert.equal(pulled.body.plan.canApply, true);
    assert.equal(pulled.body.plan.session.tabs[0].resourceId, 'doc-1');
    assert.equal(pulled.body.plan.session.tasks[0].status, 'paused');
    const pulledApplied = await json(deviceB.base, '/api/workspace-sync/apply', 'POST', {
      session: { version: 4, tabs: [], activeTabId: null, recentWork: [], readingPositions: {}, aiContextItems: [], tasks: [], draftMarkers: {} },
      expectedRevision: pulled.body.remoteRevision
    });
    assert.equal(pulledApplied.response.status, 200);
    assert.equal(pulledApplied.body.revision, 2);
    assert.equal(pulledApplied.body.session.tasks[0].recoverable, true);

    const stateRaw = await readFile(join(deviceA.root, 'state.json'), 'utf8');
    const syncRaw = await readFile(join(deviceA.root, 'sync.enc'), 'utf8');
    const relayRaw = await readFile(join(hub.root, 'relay.json'), 'utf8');
    assert.doesNotMatch(stateRaw, new RegExp(pairingToken));
    assert.doesNotMatch(syncRaw, new RegExp(pairingToken));
    assert.doesNotMatch(relayRaw, /private body|private output|private body/);
  } finally {
    await deviceB.close();
    await deviceA.close();
    await hub.close();
  }
});

test('workspace sync exposes a three-way conflict and refuses stale revision writes', async () => {
  const hub = await startApp('conflict-hub');
  const deviceA = await startApp('conflict-a');
  const deviceB = await startApp('conflict-b');
  try {
    const created = await json(hub.base, '/api/workspace-sync/relay', 'POST', { endpoint: hub.base });
    const { workspaceId, pairingToken } = created.body.relay;
    for (const device of [deviceA, deviceB]) await json(device.base, '/api/workspace-sync/settings', 'PUT', { endpoint: hub.base, workspaceId, accessToken: pairingToken, enabled: true });
    await json(deviceA.base, '/api/workspace-sync/apply', 'POST', { session: session(), expectedRevision: null });
    const baseForB = await json(deviceB.base, '/api/workspace-sync/preview', 'POST', { session: { version: 4, tabs: [], activeTabId: null, recentWork: [], readingPositions: {}, aiContextItems: [], tasks: [], draftMarkers: {} } });
    assert.equal(baseForB.body.plan.canApply, true);
    const pulledB = await json(deviceB.base, '/api/workspace-sync/apply', 'POST', { session: { version: 4, tabs: [], activeTabId: null, recentWork: [], readingPositions: {}, aiContextItems: [], tasks: [], draftMarkers: {} }, expectedRevision: baseForB.body.remoteRevision });
    assert.equal(pulledB.response.status, 200);
    const bChangeSession = session({ scrollTop: 800, progress: 0.9, anchor: 'chars:90-100' });
    const bChangePreview = await json(deviceB.base, '/api/workspace-sync/preview', 'POST', { session: bChangeSession });
    const bChangeApply = await json(deviceB.base, '/api/workspace-sync/apply', 'POST', { session: bChangeSession, expectedRevision: bChangePreview.body.remoteRevision, resolutions: Object.fromEntries(bChangePreview.body.plan.conflicts.map(item => [item.id, 'local'])) });
    assert.equal(bChangeApply.response.status, 200);

    const localPreview = await json(deviceA.base, '/api/workspace-sync/preview', 'POST', { session: session({ scrollTop: 140, progress: 0.3, anchor: 'chars:14-24' }) });
    assert.equal(localPreview.response.status, 200);
    assert.ok(localPreview.body.plan.conflicts.some(item => item.collection === 'readingPositions'));
    const conflict = localPreview.body.plan.conflicts.find(item => item.collection === 'readingPositions');
    const unresolved = await json(deviceA.base, '/api/workspace-sync/apply', 'POST', { session: session({ scrollTop: 140, progress: 0.3, anchor: 'chars:14-24' }), expectedRevision: localPreview.body.remoteRevision });
    assert.equal(unresolved.response.status, 409);
    assert.equal(unresolved.body.error.code, 'WORKSPACE_SYNC_CONFLICTS_UNRESOLVED');

    const resolved = await json(deviceA.base, '/api/workspace-sync/apply', 'POST', {
      session: session({ scrollTop: 140, progress: 0.3, anchor: 'chars:14-24' }),
      expectedRevision: localPreview.body.remoteRevision,
      resolutions: { [conflict.id]: 'local' }
    });
    assert.equal(resolved.response.status, 200);
    assert.equal(resolved.body.session.readingPositions['doc-1'].scrollTop, 140);

    const stalePreview = await json(deviceA.base, '/api/workspace-sync/preview', 'POST', { session: session({ scrollTop: 200, progress: 0.35, anchor: 'chars:20-30' }) });
    const bPreview = await json(deviceB.base, '/api/workspace-sync/preview', 'POST', { session: session({ scrollTop: 300, progress: 0.45, anchor: 'chars:30-40' }) });
    assert.equal(bPreview.response.status, 200);
    const bApply = await json(deviceB.base, '/api/workspace-sync/apply', 'POST', { session: session({ scrollTop: 300, progress: 0.45, anchor: 'chars:30-40' }), expectedRevision: bPreview.body.remoteRevision, resolutions: Object.fromEntries(bPreview.body.plan.conflicts.map(item => [item.id, 'local'])) });
    assert.equal(bApply.response.status, 200);
    const staleApply = await json(deviceA.base, '/api/workspace-sync/apply', 'POST', { session: session({ scrollTop: 200, progress: 0.35, anchor: 'chars:20-30' }), expectedRevision: stalePreview.body.remoteRevision, resolutions: Object.fromEntries(stalePreview.body.plan.conflicts.map(item => [item.id, 'local'])) });
    assert.equal(staleApply.response.status, 409);
    assert.equal(staleApply.body.error.code, 'WORKSPACE_SYNC_REMOTE_CHANGED');
  } finally {
    await deviceB.close();
    await deviceA.close();
    await hub.close();
  }
});

test('workspace bundle API validates and returns a sanitized session without changing the local session', async () => {
  const device = await startApp('bundle');
  try {
    const exported = await json(device.base, '/api/workspace-sync/bundle/export', 'POST', { session: session() });
    assert.equal(exported.response.status, 200);
    assert.equal(exported.body.format, 'flowmind-workspace-bundle');
    assert.doesNotMatch(JSON.stringify(exported.body), /private body|private output|apiKey|localPath|messages|quote/);
    const imported = await json(device.base, '/api/workspace-sync/bundle/import', 'POST', { bundle: exported.body });
    assert.equal(imported.response.status, 200);
    assert.equal(imported.body.session.tabs[0].resourceId, 'doc-1');
    const status = await json(device.base, '/api/workspace-sync/status');
    assert.equal(status.body.settings.enabled, false);
  } finally { await device.close(); }
});
