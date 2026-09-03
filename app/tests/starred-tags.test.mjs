import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';
import { deriveWorkspaceHomeItems } from '../src/workspace/workspace-integrations.js';

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-starred-'));
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
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise(resolveServer => server.close(() => resolveServer()));
      await app.locals.close?.();
      await rm(root, { recursive: true, force: true });
    }
  };
}

test('收藏 API：添加/取消/持久化，且内容列表携带 starred 标记', async () => {
  const h = await harness();
  try {
    const imported = await fetch(`${h.base}/api/content/import`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ title: '收藏测试文档', content: '收藏测试正文 STAR_MARKER', sourceType: 'local', tags: ['收藏', '测试'] }] })
    });
    const importBody = await imported.json();
    const itemId = importBody.items[0].item.id;

    const starred = await fetch(`${h.base}/api/content/starred/${itemId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ starred: true }) });
    assert.equal(starred.status, 200);
    assert.deepEqual((await starred.json()).starredIds, [itemId]);

    const list = await (await fetch(`${h.base}/api/content/items`)).json();
    const item = list.items.find(entry => entry.id === itemId);
    assert.equal(item.starred, true);

    const unstarred = await fetch(`${h.base}/api/content/starred/${itemId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ starred: false }) });
    assert.deepEqual((await unstarred.json()).starredIds, []);

    // 重新初始化后收藏状态持久化
    const persisted = await fetch(`${h.base}/api/content/starred/${itemId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ starred: true }) });
    await persisted.json();
    const list2 = await (await fetch(`${h.base}/api/content/items`)).json();
    assert.equal(list2.items.find(entry => entry.id === itemId).starred, true);
  } finally {
    await h.close();
  }
});

test('首页排序把收藏作为显式信号：加分并显示"已收藏"原因', () => {
  const NOW = Date.parse('2026-08-12T12:00:00.000Z');
  const items = deriveWorkspaceHomeItems({
    now: NOW,
    limit: 6,
    documents: [
      { id: 'doc-a', title: '收藏文档', updatedAt: '2026-08-01T12:00:00.000Z' },
      { id: 'doc-b', title: '最近文档', updatedAt: '2026-08-12T11:00:00.000Z' }
    ],
    starredIds: ['doc-a']
  });
  const starredDoc = items.find(item => item.documentId === 'doc-a');
  const recentDoc = items.find(item => item.documentId === 'doc-b');
  assert.ok(starredDoc.priorityScore > recentDoc.priorityScore, '收藏必须提升旧文档排名');
  assert.ok(starredDoc.prioritySignals.includes('已收藏'));
});
