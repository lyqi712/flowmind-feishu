import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-content-api-'));
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'), env: {},
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise((resolve) => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  return { base: `http://127.0.0.1:${server.address().port}`, async close() { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); } };
}
async function upload(h, name, content, type = 'application/octet-stream', lastModified = '') {
  const response = await fetch(`${h.base}/api/content/import/file`, { method: 'POST', headers: { 'content-type': type, 'x-file-name': encodeURIComponent(name), 'x-file-last-modified': String(lastModified) }, body: Buffer.from(content) });
  return { response, body: await response.json() };
}
function ndjson(text) { return text.trim().split('\n').filter(Boolean).map(JSON.parse); }

test('上传 Markdown 后进入统一内容、文档读取、Chunk、搜索和文档级问答', async () => {
  const h = await harness();
  try {
    const uploaded = await upload(h, '项目会议纪要.md', '\uFEFF# 项目会议纪要\n\n决定完成本地文件导入、统一阅读器和文档级问答。\n负责人：FlowMind 团队。', 'text/markdown', Date.UTC(2026, 7, 3, 10, 0, 0));
    assert.equal(uploaded.response.status, 201);
    assert.equal(uploaded.body.ok, true);
    assert.equal(uploaded.body.stats.created, 1);
    const itemId = uploaded.body.items[0].item.id;
    const detail = await (await fetch(`${h.base}/api/content/items/${itemId}`)).json();
    assert.equal(detail.item.title, '项目会议纪要');
    assert.equal(detail.item.sourceModifiedAt, '2026-08-03T10:00:00.000Z');
    assert.match(detail.item.content, /统一阅读器/);
    assert.ok(detail.chunks.length >= 1);
    assert.equal(detail.item.metadata.localPath, undefined);
    const jsonUploaded = await upload(h, '??.json', '{"feature":"raw-json-upload","enabled":true}', 'application/json');
    assert.equal(jsonUploaded.response.status, 201);
    assert.equal(jsonUploaded.body.items[0].item.contentType, 'json');
    assert.match(jsonUploaded.body.items[0].item.content, /raw-json-upload/);
    const documents = await (await fetch(`${h.base}/api/documents?q=${encodeURIComponent('统一阅读器')}`)).json();
    assert.ok(documents.documents.some((document) => document.id === itemId));
    const search = await (await fetch(`${h.base}/api/search?q=${encodeURIComponent('文档级问答')}`)).json();
    assert.ok(search.results.some((item) => item.id === itemId));
    const chatResponse = await fetch(`${h.base}/api/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '接下来要完成什么？', documentIds: [itemId] }) });
    const done = ndjson(await chatResponse.text()).find((event) => event.type === 'done');
    assert.ok(done);
    assert.ok(done.citations.some((citation) => citation.documentId === itemId));
  } finally { await h.close(); }
});

test('上传内容按哈希去重，不支持类型形成可见 warning，备份不含本地路径和秘密', async () => {
  const h = await harness();
  try {
    const first = await upload(h, 'first.txt', '唯一正文：FlowMind 本地导入去重测试。', 'text/plain', 'Invalid Date');
    const second = await upload(h, 'second.txt', '唯一正文：FlowMind 本地导入去重测试。');
    assert.equal(first.body.stats.created, 1);
    assert.equal(first.body.items[0].item.sourceModifiedAt, null);
    assert.equal(second.body.stats.duplicates, 1);
    const unsupported = await upload(h, 'unknown.flowmind', 'unsupported fixture');
    assert.equal(unsupported.response.status, 201);
    assert.equal(unsupported.body.stats.failed, 1);
    assert.equal(unsupported.body.warnings[0].code, 'CONTENT_PARSER_UNSUPPORTED');
    const backupText = await (await fetch(`${h.base}/api/content/backup`)).text();
    const backup = JSON.parse(backupText);
    assert.equal(backup.format, 'flowmind-content-backup');
    assert.doesNotMatch(backupText, /localPath|appSecret|apiKey|tenant_access_token/i);
  } finally { await h.close(); }
});
