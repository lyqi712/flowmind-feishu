import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolRegistry } from '../server/agent/tool-registry.mjs';

test('生产 ToolRegistry 默认注册只读扩展工具', async () => {
  const documents = [
    { id: 'doc-a', title: 'Alpha', content: 'Alpha 文档。2024年1月1日启动。满意。', revision: 1, contentHash: 'a', currentVersionId: 'v1' },
    { id: 'doc-b', title: 'Beta', content: 'Beta 文档。需要改进。', revision: 1, contentHash: 'b', currentVersionId: 'v1' }
  ];
  const registry = createToolRegistry({ getDocuments: () => documents });
  const names = registry.list({ includeWrite: false }).map(tool => tool.name);
  for (const name of ['knowledge.compare', 'knowledge.timeline', 'knowledge.extract', 'writing.draft', 'analyze.keywords', 'task.breakdown']) {
    assert.ok(names.includes(name), `missing ${name}`);
    const tool = registry.list({ includeWrite: false }).find(item => item.name === name);
    assert.equal(tool.effect, 'read');
  }
  const compared = await registry.execute('knowledge.compare', { documentId1: 'doc-a', documentId2: 'doc-b' });
  assert.equal(compared.status, 'completed');
  assert.equal(compared.result.document1.id, 'doc-a');
  const missing = await registry.execute('knowledge.timeline', { documentId: 'missing' }).then(() => null, error => error);
  assert.equal(missing?.code, 'KNOWLEDGE_DOCUMENT_NOT_FOUND');
  const scoped = await registry.execute('knowledge.compare', { documentId1: 'doc-a', documentId2: 'doc-b' }, { documentIds: ['doc-a'] }).then(() => null, error => error);
  assert.equal(scoped?.code, 'KNOWLEDGE_DOCUMENT_OUT_OF_SCOPE');
});

test('web.fetch reads public pages and rejects private URLs', async () => {
  const registry = createToolRegistry({ getDocuments: () => [] });
  const names = registry.list({ includeWrite: false }).map(tool => tool.name);
  assert.ok(names.includes('web.fetch'));
  const privateUrl = await registry.execute('web.fetch', { url: 'http://127.0.0.1/secret' }).then(() => null, error => error);
  assert.equal(privateUrl?.code, 'WEB_URL_FORBIDDEN');
  const fileUrl = await registry.execute('web.fetch', { url: 'file:///etc/passwd' }).then(() => null, error => error);
  assert.equal(fileUrl?.code, 'WEB_URL_FORBIDDEN');
});
