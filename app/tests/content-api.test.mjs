import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';
import { createDefaultState } from '../server/state-store.mjs';
import { createFakeModelService } from './helpers/fake-model.mjs';

async function harness(initialState = null) {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-content-api-'));
  const stateFile = join(root, 'state.json');
  if (initialState) await writeFile(stateFile, `${JSON.stringify(initialState)}\n`, 'utf8');
  const app = await createInitializedApp({
    stateFile, env: {}, modelService: createFakeModelService(),
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
    assert.equal(detail.current.versionId, detail.item.currentVersionId);
    assert.equal(detail.evidence.evidenceStatus, 'current');
    assert.equal(detail.evidence.contentVersionId, detail.item.currentVersionId);
    assert.ok(detail.versions.some(version => String(version.id) === String(detail.item.currentVersionId)));
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

test('全局搜索同时返回文档、笔记和未归档历史会话，并报告完整匹配计数', async () => {
  const h = await harness();
  try {
    const marker = '跨工作区检索标记';
    const uploaded = await upload(h, 'search-source.md', `# 搜索资料\n\n${marker} 出现在知识文档中。`, 'text/markdown');
    assert.equal(uploaded.response.status, 201);
    const noteResponse = await fetch(`${h.base}/api/notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '搜索笔记', content: `${marker} 出现在个人笔记中。`, tags: ['检索'] }) });
    assert.equal(noteResponse.status, 201);
    const chatResponse = await fetch(`${h.base}/api/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: `请解释${marker}`, documentIds: [uploaded.body.items[0].item.id] }) });
    const events = ndjson(await chatResponse.text());
    assert.ok(events.some(event => event.type === 'done'));
    const search = await (await fetch(`${h.base}/api/search?q=${encodeURIComponent(marker)}&limit=40`)).json();
    assert.ok(search.results.some(item => item.type === 'document' && item.id === uploaded.body.items[0].item.id));
    assert.ok(search.results.some(item => item.type === 'note' && item.title === '搜索笔记'));
    assert.ok(search.results.some(item => item.type === 'conversation' && item.conversationId));
    assert.ok(search.total >= search.results.length);
    assert.equal(search.limited, false);
  } finally { await h.close(); }
});

test('全局搜索直接走内容索引，能找到首批 2000 条之外的资料并保留来源/标签过滤', async () => {
  const marker = 'SearchWindowMarker2026';
  const initialState = createDefaultState();
  initialState.documents = [
    { id: 'legacy-target', title: '索引窗口外目标', content: `${marker} 只在这一份资料中出现。`, source: 'feishu', sourceType: 'docx', tags: ['Release'], updatedAt: '2026-01-01T00:00:00.000Z' },
    ...Array.from({ length: 2005 }, (_, index) => ({ id: `legacy-filler-${index}`, title: `填充资料 ${index}`, content: `没有目标词的填充正文 ${index}`, source: 'feishu', sourceType: 'docx', tags: ['Archive'], updatedAt: `2026-08-01T00:00:${String(index % 60).padStart(2, '0')}.000Z` }))
  ];
  const h = await harness(initialState);
  try {
    const search = await (await fetch(`${h.base}/api/search?q=${marker}&source=feishu&tag=release&type=docx`)).json();
    assert.equal(search.total, 1);
    assert.equal(search.limited, false);
    assert.equal(search.results.length, 1);
    assert.equal(search.results[0].title, '索引窗口外目标');
    assert.equal(search.results[0].sourceType, 'feishu');
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

test('阅读器相关文档接口只返回有依据的篇目', async () => {
  const h = await harness();
  try {
    const loop = await upload(h, 'Agent Loop 实践.md', '# Agent Loop 实践\n\n继续看 [[Hermes Agent 团队]]。', 'text/markdown');
    const team = await upload(h, 'Hermes Agent 团队.md', '# Hermes Agent 团队\n\n团队规格。', 'text/markdown');
    const tape = await upload(h, '胶带效果.md', '# 胶带效果\n\n视觉实验。', 'text/markdown');
    assert.equal(loop.response.status, 201);
    const loopId = loop.body.items[0].item.id;
    const teamId = team.body.items[0].item.id;
    const tapeId = tape.body.items[0].item.id;
    const related = await (await fetch(`${h.base}/api/content/items/${loopId}/related`)).json();
    assert.equal(related.ok, true);
    assert.ok(related.items.some((row) => row.documentId === teamId));
    assert.ok(!related.items.some((row) => row.documentId === tapeId));
    assert.ok(related.items.every((row) => row.reason));
    const missing = await fetch(`${h.base}/api/content/items/missing/related`);
    assert.equal(missing.status, 404);
  } finally { await h.close(); }
});
