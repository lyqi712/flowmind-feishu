import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.mjs';
import { createFakeModelService } from './helpers/fake-model.mjs';

async function createHarness() {
  const directory = await mkdtemp(join(tmpdir(), 'ima-search-history-'));
  const app = createApp({
    stateFile: join(directory, 'runtime-data', 'state.json'),
    modelService: createFakeModelService(),
    feishuOptions: { secretFile: join(directory, 'feishu-secret.enc'), masterKeyFile: join(directory, '.feishu-master-key') },
    modelOptions: { secretFile: join(directory, 'model-secret.enc'), masterKeyFile: join(directory, '.model-master-key') }
  });
  await app.locals.ready;
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  };
}

test('搜索历史随有结果的查询记录，并可按条删除和清空', async () => {
  const harness = await createHarness();
  try {
    await fetch(`${harness.baseUrl}/api/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Q2 规划材料', content: '这是一份用于搜索的规划笔记。' })
    });
    const search = await fetch(`${harness.baseUrl}/api/search?q=${encodeURIComponent('规划')}`).then(res => res.json());
    assert.ok(search.total >= 1);

    const history = await fetch(`${harness.baseUrl}/api/search/history`).then(res => res.json());
    assert.ok(history.history.some(item => item.query === '规划'));

    await fetch(`${harness.baseUrl}/api/search/history/${encodeURIComponent('规划')}`, { method: 'DELETE' });
    const afterDelete = await fetch(`${harness.baseUrl}/api/search/history`).then(res => res.json());
    assert.equal(afterDelete.history.some(item => item.query === '规划'), false);

    await fetch(`${harness.baseUrl}/api/search?q=${encodeURIComponent('规划')}`);
    await fetch(`${harness.baseUrl}/api/search/history`, { method: 'DELETE' });
    const afterClear = await fetch(`${harness.baseUrl}/api/search/history`).then(res => res.json());
    assert.equal(afterClear.history.length, 0);

    const trending = await fetch(`${harness.baseUrl}/api/search/trending`).then(res => res.json());
    assert.ok(Array.isArray(trending.trending));
  } finally {
    await harness.close();
  }
});
