import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-workspace-'));
  const app = await createInitializedApp({ stateFile: join(root, 'state.json'), env: {}, modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') }, feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') } });
  const server = await new Promise((resolve) => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  return { base: `http://127.0.0.1:${server.address().port}`, async close() { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); } };
}
async function json(h, path, method = 'GET', body) { const response = await fetch(`${h.base}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); return { response, body: await response.json() }; }

test('笔记支持创建、自动保存式更新、搜索、归档和软删除', async () => {
  const h = await harness();
  try {
    const created = await json(h, '/api/notes', 'POST', { title: '同步复盘', content: '飞书多来源同步需要关注限流与重试', tags: ['飞书', '复盘'], sourceRefs: [{ documentId: 'doc-1', anchor: 'p3' }] });
    assert.equal(created.response.status, 201);
    assert.deepEqual(created.body.note.sourceRefs, [{ documentId: 'doc-1', anchor: 'p3' }]);
    const noteId = created.body.note.id;
    const updated = await json(h, `/api/notes/${noteId}`, 'PATCH', { content: '飞书多来源同步需要关注限流、重试与断点恢复', archived: true });
    assert.equal(updated.body.note.archived, true);
    const search = await json(h, '/api/search?q=断点恢复&type=note');
    assert.equal(search.body.total, 1);
    assert.equal(search.body.results[0].id, noteId);
    const active = await json(h, '/api/notes');
    assert.equal(active.body.total, 0);
    const archived = await json(h, '/api/notes?archived=true');
    assert.equal(archived.body.total, 1);
    assert.equal((await json(h, `/api/notes/${noteId}`, 'DELETE')).response.status, 200);
    assert.equal((await json(h, '/api/notes?archived=true')).body.total, 0);
  } finally { await h.close(); }
});

test('写作草稿保存版本并可恢复历史内容', async () => {
  const h = await harness();
  try {
    const created = await json(h, '/api/writing/drafts', 'POST', { title: '周报', content: '第一版', template: 'weekly', audience: '团队', tone: '专业' });
    const draftId = created.body.draft.id;
    const updated = await json(h, `/api/writing/drafts/${draftId}`, 'PATCH', { content: '第二版' });
    assert.equal(updated.body.draft.content, '第二版');
    assert.equal(updated.body.draft.versions.length, 1);
    assert.equal(updated.body.draft.versions[0].content, '第一版');
  } finally { await h.close(); }
});

test('Copilot 可独立创建、激活、配置知识范围和记忆', async () => {
  const h = await harness();
  try {
    const created = await json(h, '/api/copilots', 'POST', { name: '研究助手', systemPrompt: '优先给出证据链', knowledgeBaseIds: ['kb-research'], skillIds: ['research-report'], memories: ['偏好表格'], activate: true });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.copilot.userPrompt, '优先给出证据链');
    const list = await json(h, '/api/copilots');
    assert.equal(list.body.copilots.length, 2);
    assert.equal(list.body.activeCopilotId, created.body.copilot.id);
    const updated = await json(h, `/api/copilots/${created.body.copilot.id}`, 'PATCH', { memoryEnabled: false, memories: [] });
    assert.equal(updated.body.copilot.memoryEnabled, false);
    assert.deepEqual(updated.body.copilot.memories, []);
  } finally { await h.close(); }
});

test('会话支持多轮追加、重命名、归档、恢复和单条删除', async () => {
  const h = await harness();
  try {
    await json(h, '/api/sync', 'POST', { source: 'mock' });
    const firstResponse = await fetch(`${h.base}/api/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '同步如何工作？' }) });
    const firstEvents = (await firstResponse.text()).trim().split('\n').map(JSON.parse);
    const conversationId = firstEvents.find((event) => event.type === 'done').conversationId;
    const secondResponse = await fetch(`${h.base}/api/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '刚才的重点是什么？', conversationId }) });
    assert.equal(secondResponse.status, 200); await secondResponse.text();
    const restored = await json(h, `/api/conversations/${conversationId}`);
    assert.equal(restored.body.conversation.messages.length, 4);
    const renamed = await json(h, `/api/conversations/${conversationId}`, 'PATCH', { title: '同步讨论', archived: true });
    assert.equal(renamed.body.conversation.title, '同步讨论');
    assert.equal((await json(h, '/api/conversations')).body.total, 0);
    assert.equal((await json(h, '/api/conversations?archived=true')).body.total, 1);
    assert.equal((await json(h, `/api/conversations/${conversationId}`, 'DELETE')).response.status, 200);
  } finally { await h.close(); }
});
