import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveWorkspaceHomeItems, workspaceTaskRoute } from '../src/workspace/workspace-integrations.js';
import { createInitialWorkspaceSession, normalizeWorkspaceSession, workspaceSessionReducer } from '../src/workspace/workspace-session.js';

const NOW = Date.parse('2026-08-09T12:00:00.000Z');

function home(overrides = {}) {
  return deriveWorkspaceHomeItems({
    now: NOW,
    limit: 8,
    documents: [
      { id: 'doc-followed', title: '关注库资料', knowledgeBaseId: 'kb-followed', updatedAt: '2026-08-01T12:00:00.000Z' },
      { id: 'doc-recent', title: '最近资料', knowledgeBaseId: 'kb-other', updatedAt: '2026-08-09T11:00:00.000Z' },
      { id: 'doc-old', title: '旧资料', knowledgeBaseId: 'kb-other', updatedAt: '2026-07-01T12:00:00.000Z' }
    ],
    libraries: [{ id: 'kb-followed', name: '关注知识库', followed: true }, { id: 'kb-other', name: '其他知识库', followed: false }],
    ...overrides
  });
}

test('首页把未完成任务放在首位，并把相关资料一起提升', () => {
  const items = home({
    recentWork: [{ id: 'recent-old', kind: 'document', type: 'document', documentId: 'doc-old', useCount: 6, lastUsedAt: '2026-08-09T10:00:00.000Z' }],
    tasks: [{ id: 'task-1', type: 'skill', title: '继续研究报告', detail: '还差证据核对', status: 'paused', documentIds: ['doc-old'], updatedAt: '2026-08-09T09:00:00.000Z' }]
  });

  assert.equal(items[0].kind, 'task');
  assert.equal(items[0].taskStatus, 'paused');
  assert.equal(items[0].priorityReason, '继续任务');
  assert.equal(items[1].documentId, 'doc-old');
  assert.equal(items[1].relatedTaskId, 'task-1');
  assert.equal(items[1].priorityReason, '有未完成任务');
  assert.deepEqual(items.map(item => item.homeRank), [1, 2, 3, 4]);
});

test('关注库是显式信号，能提升旧资料但不会伪造关注状态', () => {
  const items = home({ recentWork: [] });
  const followed = items.find(item => item.documentId === 'doc-followed');
  const recent = items.find(item => item.documentId === 'doc-recent');
  assert.ok(followed.priorityScore > recent.priorityScore);
  assert.equal(followed.priorityReason, '已关注知识库');
  assert.equal(followed.followedLibraryName, '关注知识库');

  const unFollowed = home({ libraries: [{ id: 'kb-followed', name: '关注知识库', followed: false }, { id: 'kb-other', followed: false }] });
  const noBoost = unFollowed.find(item => item.documentId === 'doc-followed');
  assert.equal(noBoost.followedLibraryId, undefined);
  assert.notEqual(noBoost.priorityReason, '已关注知识库');
});

test('使用次数、最近使用、脏草稿和阅读位置都会留下可解释信号', () => {
  const items = home({
    recentWork: [{ id: 'recent-old', kind: 'document', type: 'document', documentId: 'doc-old', useCount: 4, lastUsedAt: '2026-08-09T11:30:00.000Z' }],
    draftMarkers: { 'doc-old': { dirty: true } },
    readingPositions: { 'doc-old': { progress: 0.42, updatedAt: '2026-08-09T11:00:00.000Z' } }
  });
  const old = items.find(item => item.documentId === 'doc-old');
  assert.ok(old);
  assert.deepEqual(old.prioritySignals.slice(0, 4), ['有未保存修改', '经常使用', '上次读到这里']);
  assert.equal(old.priorityReason, '有未保存修改');
});

test('已完成或取消的任务不会制造首页幽灵项目，任务状态别名仍可恢复', () => {
  const items = home({
    tasks: [
      { id: 'done', type: 'skill', title: '已完成', status: 'completed', updatedAt: '2026-08-09T11:00:00.000Z' },
      { id: 'cancelled', type: 'skill', title: '已取消', status: 'cancelled', updatedAt: '2026-08-09T11:00:00.000Z' },
      { id: 'failed', type: 'skill', title: '失败待重试', status: 'error', updatedAt: '2026-08-09T11:00:00.000Z' }
    ]
  });
  assert.equal(items.filter(item => item.kind === 'task').length, 1);
  assert.equal(items.find(item => item.kind === 'task').taskId, 'failed');
  assert.equal(items.find(item => item.kind === 'task').taskStatus, 'failed');
});

test('首页最近摘要剥掉 Markdown 标记，只给人看一行正文', () => {
  const items = deriveWorkspaceHomeItems({
    now: NOW,
    limit: 1,
    documents: [{
      id: 'doc-md',
      title: 'Agent Loop',
      knowledgeBaseId: 'kb-other',
      updatedAt: '2026-08-09T11:50:00.000Z',
      content: '## 学完你应该获得什么\n\n- 理解上下文隔离\n- 能自己写一条责任闭环'
    }]
  });
  assert.equal(items[0].documentId, 'doc-md');
  assert.doesNotMatch(items[0].summary, /#|^\s*- /);
  assert.match(items[0].summary, /学完你应该获得什么/);
  assert.match(items[0].summary, /理解上下文隔离/);
});

test('首页最近会剥掉已缓存 recentWork 里的 Markdown 摘要', () => {
  const items = deriveWorkspaceHomeItems({
    now: NOW,
    limit: 1,
    recentWork: [{
      id: 'recent-md',
      kind: 'document',
      type: 'document',
      documentId: 'doc-cached',
      title: '缓存文档',
      summary: '## 学完你应该获得什么\n- 理解上下文隔离',
      lastUsedAt: '2026-08-09T11:55:00.000Z'
    }]
  });
  assert.equal(items[0].documentId, 'doc-cached');
  assert.doesNotMatch(items[0].summary, /#/);
  assert.match(items[0].summary, /学完你应该获得什么/);
});

test('首页最近会剥掉畸形加粗和 callout 残留', () => {
  const items = deriveWorkspaceHomeItems({
    now: NOW,
    limit: 1,
    recentWork: [{
      id: 'recent-stars',
      kind: 'document',
      type: 'document',
      documentId: 'doc-stars',
      title: '公益养虾',
      summary: '公益养虾养马交流群 **我们有一个****公益性质****的养虾交流群** [!NOTE] 【第126期】',
      lastUsedAt: '2026-08-09T11:56:00.000Z'
    }]
  });
  assert.equal(items[0].documentId, 'doc-stars');
  assert.doesNotMatch(items[0].summary, /\*\*|\[!NOTE\]/);
  assert.match(items[0].summary, /公益性质/);
});

test('冷启动仍按更新时间稳定排序并按资源去重', () => {
  const items = home({ libraries: [], recentWork: [] });
  assert.deepEqual(items.filter(item => item.kind === 'document').map(item => item.documentId), ['doc-recent', 'doc-followed', 'doc-old']);
  assert.equal(new Set(items.map(item => item.documentId || item.id)).size, items.length);
  assert.deepEqual(home({ libraries: [], recentWork: [] }).map(item => item.id), items.map(item => item.id));
});

test('任务类型回到对应的工作面，未知类型才回退知识库', () => {
  assert.equal(workspaceTaskRoute('skill'), 'skills');
  assert.equal(workspaceTaskRoute({ type: 'recording' }), 'recording');
  assert.equal(workspaceTaskRoute({ type: 'sync' }), 'sync');
  assert.equal(workspaceTaskRoute({ type: 'feishu-sync' }), 'sync');
  assert.equal(workspaceTaskRoute({ type: 'import' }), 'collect');
  assert.equal(workspaceTaskRoute({ type: 'unknown' }), 'knowledge');
});

test('旧 recent 条目按资源语义合并而不是按历史显示 id 分裂', () => {
  const normalized = normalizeWorkspaceSession({
    recentWork: [
      { id: 'legacy-id', kind: 'document', documentId: 'doc-old', title: '旧标题', useCount: 2 },
      { id: 'canonical-id', kind: 'document', documentId: 'doc-old', title: '新标题', useCount: 3 }
    ]
  });
  const old = normalized.recentWork.filter(item => item.documentId === 'doc-old');
  assert.equal(old.length, 1);
  assert.equal(old[0].title, '新标题');
  assert.equal(old[0].useCount, 5);
});

test('合法 epoch 0 与字符串时间都产生稳定结果，非法时间回退当前时刻', () => {
  const epochItems = deriveWorkspaceHomeItems({ now: 0, documents: [{ id: 'epoch', title: 'Epoch', updatedAt: 0 }], limit: 1 });
  assert.ok(epochItems[0].priorityScore > 0);
  const stringItems = deriveWorkspaceHomeItems({ now: '1970-01-01T00:00:00.001Z', documents: [{ id: 'epoch', title: 'Epoch', updatedAt: 0 }], limit: 1 });
  assert.equal(stringItems[0].priorityScore, epochItems[0].priorityScore);
});

test('启动恢复不会把浏览器侧 running 任务伪装成仍在后台执行', () => {
  const snapshot = { tasks: [{ id: 'recoverable-skill', type: 'skill', status: 'running', progress: 0.5, title: '研究报告' }] };
  const live = normalizeWorkspaceSession(snapshot);
  const restored = normalizeWorkspaceSession(snapshot, { recoverRunningTasks: true });
  assert.equal(live.tasks[0].status, 'running');
  assert.equal(restored.tasks[0].status, 'paused');
  assert.equal(restored.tasks[0].recoverable, true);
});

test('TOUCH_RECENT_WORK 累积真实使用次数并保留旧字段', () => {
  let state = createInitialWorkspaceSession();
  state = workspaceSessionReducer(state, { type: 'TOUCH_RECENT_WORK', at: '2026-08-09T10:00:00.000Z', item: { id: 'recent-doc', kind: 'document', documentId: 'doc-1', title: '资料', source: '飞书' } });
  state = workspaceSessionReducer(state, { type: 'TOUCH_RECENT_WORK', at: '2026-08-09T11:00:00.000Z', item: { id: 'recent-doc', kind: 'document', documentId: 'doc-1', title: '新标题' } });
  assert.equal(state.recentWork.length, 1);
  assert.equal(state.recentWork[0].useCount, 2);
  assert.equal(state.recentWork[0].lastUsedAt, '2026-08-09T11:00:00.000Z');
  assert.equal(state.recentWork[0].source, '飞书');
  assert.equal(state.recentWork[0].title, '新标题');
});
