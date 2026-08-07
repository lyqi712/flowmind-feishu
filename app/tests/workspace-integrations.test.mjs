import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveWorkspaceContext, deriveWorkspaceRecentItems } from '../src/workspace/workspace-integrations.js';

test('首页在没有 session recentWork 时直接展示真实知识库文档', () => {
  const items = deriveWorkspaceRecentItems({
    recentWork: [],
    documents: [
      { id: 'doc-old', title: '旧资料', source: 'feishu', updatedAt: '2026-08-03T08:00:00.000Z' },
      { id: 'doc-new', title: '最新飞书资料', source: 'feishu', updatedAt: '2026-08-04T08:00:00.000Z' }
    ]
  });

  assert.deepEqual(items.map(item => item.documentId), ['doc-new', 'doc-old']);
  assert.equal(items[0].title, '最新飞书资料');
  assert.equal(items[0].kind, 'document');
});

test('首页合并 recentWork 与文档并按资源去重', () => {
  const items = deriveWorkspaceRecentItems({
    recentWork: [{ id: 'recent-doc-1', kind: 'document', documentId: 'doc-1', title: '最近打开的标题', updatedAt: '2026-08-04T09:00:00.000Z' }],
    documents: [
      { id: 'doc-1', title: '后端标题', updatedAt: '2026-08-04T08:00:00.000Z' },
      { id: 'doc-2', title: '另一篇资料', updatedAt: '2026-08-04T07:00:00.000Z' }
    ],
    limit: 8
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].title, '最近打开的标题');
  assert.equal(items[1].documentId, 'doc-2');
});

test('知识工作区默认把整个飞书知识库暴露给统一上下文', () => {
  const context = deriveWorkspaceContext({
    activeRoute: 'knowledge',
    knowledgeBase: { id: 'feishu-space', name: '飞书多来源资料库', source: 'feishu', documentCount: 27 },
    documents: Array.from({ length: 27 }, (_, index) => ({ id: `doc-${index}` }))
  });

  assert.equal(context.currentDocument, null);
  assert.equal(context.resources.length, 1);
  assert.deepEqual(context.resources[0], {
    id: 'knowledge-base-feishu-space',
    kind: 'knowledge-base',
    type: '27 篇文档',
    title: '飞书多来源资料库',
    source: '飞书知识库',
    removable: false
  });
});


test('首页与笔记默认继承当前知识库，避免跨模块时右侧上下文归零', () => {
  for (const activeRoute of ['home', 'notes']) {
    const context = deriveWorkspaceContext({
      activeRoute,
      knowledgeBase: { id: 'feishu-space', name: '飞书多来源资料库', source: 'feishu', documentCount: 27 }
    });
    assert.equal(context.resources[0].id, 'knowledge-base-feishu-space');
    assert.equal(context.resources[0].removable, false);
  }
});
test('用户勾选文档后统一上下文显示真实文档而不是虚拟知识库占位', () => {
  const context = deriveWorkspaceContext({
    activeRoute: 'knowledge',
    knowledgeBase: { id: 'feishu-space', name: '飞书多来源资料库', source: 'feishu', documentCount: 27 },
    selectedDocumentIds: ['doc-2', 'doc-1'],
    documents: [
      { id: 'doc-1', title: '方案一', source: 'feishu' },
      { id: 'doc-2', title: '方案二', source: 'feishu' }
    ]
  });

  assert.deepEqual(context.resources.map(item => item.documentId), ['doc-2', 'doc-1']);
  assert.equal(context.resources.some(item => item.kind === 'knowledge-base'), false);
});

test('当前文档、选区与显式附件在模块切换时保持且不重复当前文档', () => {
  const currentDocument = { id: 'doc-1', documentId: 'doc-1', title: '当前原文', source: '飞书' };
  const context = deriveWorkspaceContext({
    activeRoute: 'notes',
    currentDocument,
    aiContextItems: [
      { id: 'selection-1', kind: 'selection', documentId: 'doc-1', text: '选中的结论' },
      { id: 'duplicate-current', kind: 'document', documentId: 'doc-1', title: '当前原文' },
      { id: 'attachment-1', kind: 'file', title: '补充截图', type: 'image/png' }
    ]
  });

  assert.equal(context.currentDocument, currentDocument);
  assert.equal(context.selection.text, '选中的结论');
  assert.deepEqual(context.resources.map(item => item.id), ['attachment-1']);
});
