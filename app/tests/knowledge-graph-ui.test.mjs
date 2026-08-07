import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const componentPath = resolve(appRoot, 'src/components/KnowledgeGraph.jsx');
const cssPath = resolve(appRoot, 'src/components/KnowledgeGraph.css');
const componentSource = readFileSync(componentPath, 'utf8');
const cssSource = readFileSync(cssPath, 'utf8');
const appSource = readFileSync(resolve(appRoot, 'src/main.jsx'), 'utf8');
let vite;
let graphModule;

before(async () => {
  vite = await createServer({ root: appRoot, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  graphModule = await vite.ssrLoadModule('/src/components/KnowledgeGraph.jsx');
});
after(async () => { await vite?.close(); });

const documents = [
  { id: 'doc-alpha', title: 'Alpha 方案', contentType: 'feishu-docx', tags: ['工作'], metadata: { outboundLinks: [{ target: 'Beta 手册' }], unresolvedLinks: { 'Ghost 页面': 1 } } },
  { id: 'doc-beta', title: 'Beta 手册', contentType: 'markdown', metadata: { fileName: 'Beta 手册.md', tags: [{ name: '工作' }] } },
  { id: 'doc-lonely', title: '孤立资料', tags: ['归档'] }
];
const notes = [
  { id: 'note-research', title: '研究笔记', content: '关联 [[Alpha 方案|主方案]] 和 [[Missing Note]]，重复 [[Alpha 方案]]。', tags: ['想法'], sourceRefs: [{ documentId: 'doc-beta', anchor: 'block:summary' }] },
  { id: 'note-archived', title: '已归档', content: '[[Alpha 方案]]', archived: true }
];

function edge(graph, from, to, type) {
  return graph.edges.find(row => row.from === from && row.to === to && row.type === type);
}

test('从文档 outbound links、笔记双链、sourceRefs 与 tags 构建持久图谱', () => {
  const graph = graphModule.buildKnowledgeGraph({ documents, notes });
  assert.equal(graph.nodes.filter(node => node.type === 'document').length, 3);
  assert.equal(graph.nodes.filter(node => node.type === 'note').length, 1);
  assert.equal(graph.nodes.filter(node => node.type === 'tag').length, 3);
  assert.equal(graph.nodes.filter(node => node.type === 'unresolved').length, 2);
  assert.ok(edge(graph, 'document:doc-alpha', 'document:doc-beta', 'link'));
  assert.ok(edge(graph, 'note:note-research', 'document:doc-alpha', 'link'));
  assert.ok(edge(graph, 'note:note-research', 'document:doc-beta', 'source'));
  assert.ok(edge(graph, 'document:doc-alpha', 'tag:工作', 'tag'));
  assert.ok(edge(graph, 'document:doc-beta', 'tag:工作', 'tag'));
  assert.equal(graph.nodes.some(node => node.label === '已归档'), false);
  assert.equal(graph.nodes.find(node => node.id === 'document:doc-lonely').orphan, true, '仅有标签的文档仍应识别为结构孤立节点');
});

test('兼容图谱不会把 Vault 模板残片当成未解析节点或主图关系', () => {
  const graph = graphModule.buildKnowledgeGraph({ documents: [{
    id: 'doc-template', title: '模板说明', metadata: {
      outboundLinks: [
        { target: '02-Areas/Area Name' }, { target: '05-People/Name' },
        { target: 'MOC/Index' }, { target: 'note title' }
      ]
    }, content: '[[wikilink]] [[01-Projects/Project Name]] [[Note Title 1]]'
  }] });
  assert.equal(graph.nodes.some(node => node.type === 'unresolved'), false);
  assert.equal(graph.edges.some(row => row.type === 'link'), false);
});

test('双链解析支持别名与锚点，并对重复链接去重', () => {
  const links = graphModule.extractWikiLinks('[[Alpha#概要|别名]] [[Alpha#概要]] [[Beta]]');
  assert.deepEqual(links.map(link => ({ target: link.target, alias: link.alias, anchor: link.anchor })), [
    { target: 'Alpha', alias: '别名', anchor: '概要' },
    { target: 'Beta', alias: '', anchor: '' }
  ]);
  const graph = graphModule.buildKnowledgeGraph({ documents, notes });
  const alphaLink = edge(graph, 'note:note-research', 'document:doc-alpha', 'link');
  assert.equal(alphaLink.count, 1, '内容中的重复双链不应膨胀边数量');
});

test('搜索及文档、笔记、标签、孤立节点过滤保持节点边一致', () => {
  const graph = graphModule.buildKnowledgeGraph({ documents, notes });
  const exact = graphModule.filterKnowledgeGraph(graph, { query: '研究笔记', includeSearchNeighbors: false });
  assert.deepEqual(exact.nodes.map(node => node.id), ['note:note-research']);
  assert.equal(exact.edges.length, 0);
  const filtered = graphModule.filterKnowledgeGraph(graph, { showNotes: false, showTags: false, showUnresolved: false, showOrphans: false });
  assert.deepEqual(filtered.nodes.map(node => node.id).sort(), ['document:doc-alpha', 'document:doc-beta']);
  assert.ok(filtered.edges.every(row => filtered.nodes.some(node => node.id === row.from) && filtered.nodes.some(node => node.id === row.to)));
});

test('局部图谱支持 1 至 3 跳并标记中心节点', () => {
  const graph = graphModule.buildKnowledgeGraph({ documents, notes });
  const oneJump = graphModule.buildLocalGraph(graph, 'document:doc-alpha', 1);
  const twoJumps = graphModule.buildLocalGraph(graph, 'document:doc-alpha', 2);
  assert.ok(oneJump.nodes.find(node => node.id === 'document:doc-alpha').isLocalRoot);
  assert.ok(oneJump.nodes.some(node => node.id === 'document:doc-beta'));
  assert.ok(oneJump.nodes.some(node => node.id === 'note:note-research'));
  assert.ok(twoJumps.nodes.length >= oneJump.nodes.length);
  assert.equal(graphModule.buildLocalGraph(graph, 'document:doc-alpha', 99).nodes.length, graphModule.buildLocalGraph(graph, 'document:doc-alpha', 3).nodes.length);
});

test('力导向布局使用 Obsidian 参数、确定性输出并限制在画布内', () => {
  const graph = graphModule.buildKnowledgeGraph({ documents, notes });
  assert.deepEqual(graphModule.GRAPH_DEFAULTS, {
    centerStrength: 0.518713248970312, repelStrength: 10, linkStrength: 1, linkDistance: 250,
    nodeSizeMultiplier: 1, lineSizeMultiplier: 1, showArrow: false
  });
  const first = graphModule.createKnowledgeGraphLayout(graph);
  const second = graphModule.createKnowledgeGraphLayout(graph);
  assert.deepEqual(first, second);
  assert.equal(Object.keys(first).length, graph.nodes.length);
  for (const point of Object.values(first)) {
    assert.ok(Number.isFinite(point.x) && point.x >= 34 && point.x <= graphModule.GRAPH_VIEWBOX.width - 34);
    assert.ok(Number.isFinite(point.y) && point.y >= 34 && point.y <= graphModule.GRAPH_VIEWBOX.height - 34);
  }
});

test('节点打开契约按文档和笔记分派，标签和未解析节点不误触发', () => {
  const graph = graphModule.buildKnowledgeGraph({ documents, notes });
  const calls = [];
  const callbacks = { onOpenDocument: item => calls.push(['document', item.id]), onOpenNote: item => calls.push(['note', item.id]) };
  assert.equal(graphModule.openKnowledgeGraphNode(graph.nodes.find(node => node.id === 'document:doc-alpha'), callbacks), true);
  assert.equal(graphModule.openKnowledgeGraphNode(graph.nodes.find(node => node.id === 'note:note-research'), callbacks), true);
  assert.equal(graphModule.openKnowledgeGraphNode(graph.nodes.find(node => node.type === 'tag'), callbacks), false);
  assert.deepEqual(calls, [['document', 'doc-alpha'], ['note', 'note-research']]);
});

test('关系侧栏数据区分出链、反链、来源和标签关系', () => {
  const graph = graphModule.buildKnowledgeGraph({ documents, notes });
  const relations = graphModule.getKnowledgeGraphRelations(graph, 'document:doc-beta');
  assert.ok(relations.incoming.some(row => row.node.id === 'document:doc-alpha' && row.edge.type === 'link'));
  assert.ok(relations.incoming.some(row => row.node.id === 'note:note-research' && row.edge.type === 'source'));
  assert.ok(relations.outgoing.some(row => row.node.id === 'tag:工作' && row.edge.type === 'tag'));
});

test('关系概览以节点名称、关系类型和理由提供可扫描入口', () => {
  const graph = graphModule.buildKnowledgeGraph({ documents, notes });
  const summary = graphModule.summarizeKnowledgeGraphRelations(graph, 10);
  assert.ok(summary.length > 0);
  assert.ok(summary.some(row => row.fromLabel === 'Alpha 方案' && row.toLabel === 'Beta 手册'));
  assert.equal(summary.some(row => row.toLabel === 'Ghost 页面'), false, 'unresolved targets stay out of the relation overview');
  assert.ok(summary.every(row => row.label && row.fromId && row.toId));
});

test('知识观察为节点生成核心结论、关联观察和待验证问题', () => {
  const graph = graphModule.buildKnowledgeGraph({ documents, notes });
  const node = graph.nodes.find(row => row.id === 'document:doc-alpha');
  const relations = graphModule.getKnowledgeGraphRelations(graph, node.id);
  const questions = graphModule.buildKnowledgeObservationQuestions(node, relations);
  assert.deepEqual(questions.map(row => row.label), ['核心结论', '关联观察', '待验证问题']);
  assert.ok(questions.every(row => row.prompt.includes('Alpha 方案')));
  assert.match(componentSource, /onAskNode\?\.\(question\.prompt, selectedNode, relatedNodes\)/);
  assert.match(componentSource, /onCreateNote\?\.\(selectedNode\)/);
});

test('工作区恢复的知识图谱使用服务端索引快照，而不是兼容图谱作为主图', () => {
  assert.match(appSource, /route === 'graph' && !graphData/);
  assert.match(appSource, /requestGraphSnapshot\(\)/);
  assert.match(appSource, /graph=\{graphData \|\| EMPTY_INDEXED_GRAPH\}/);
  assert.match(componentSource, /loading = false/);
  assert.match(componentSource, /主图仅显示可回查的显式链接、来源、标签和文件夹关系/);
});

test('SSR 暴露完整搜索、过滤、局部图谱、箭头、缩放和关闭契约', () => {
  const html = renderToStaticMarkup(React.createElement(graphModule.KnowledgeGraph, { documents, notes, onOpenDocument() {}, onOpenNote() {}, onClose() {} }));
  assert.match(html, /aria-label="知识观察"/);
  assert.match(html, /aria-label="关系概览"/);
  assert.match(html, /RELATION INDEX/);
  assert.match(html, /先看清谁和谁有关，再打开节点查看来源。/);
  assert.match(html, /搜索文档、笔记或标签/);
  assert.match(html, />文档 <span>3<\/span>/);
  assert.match(html, />笔记 <span>1<\/span>/);
  assert.match(html, />标签 <span>3<\/span>/);
  assert.match(html, />未解析 <span>2<\/span>/);
  assert.match(html, /孤立节点/);
  assert.match(html, /方向箭头/);
  assert.match(html, /全库图谱/);
  assert.match(html, /aria-label="放大"/);
  assert.match(html, /aria-label="缩小"/);
  assert.match(html, /aria-label="适应画布"/);
  assert.match(html, /aria-label="关闭知识图谱"/);
  assert.match(componentSource, /showUnresolved: false, showOrphans: false/);
  assert.match(componentSource, /visibleLabelIds/);
  for (const fragment of [
    'onWheel={handleWheel}', 'onPointerDown={handleCanvasPointerDown}', 'onPointerMove={handlePointerMove}',
    'setPointerCapture?.(event.pointerId)', 'hasPointerCapture?.(event.pointerId)', "dragRef.current = { type: 'node'", 'setPositions(current =>',
    "event.key === 'Enter' || event.key === ' '", 'openKnowledgeGraphNode(node, { onOpenDocument, onOpenNote })',
    'aria-label="关系侧栏"', 'aria-label="关系概览"', 'GraphRelationOverview', 'RelationGroup title="反向链接"'
  ]) assert.ok(componentSource.includes(fragment), 'missing interaction contract: ' + fragment);
});

test('样式提供图谱层次、关系类型区分和桌面/移动响应式布局', () => {
  for (const selector of [
    '.knowledge-graph-canvas', '.knowledge-graph-edge.is-source', '.knowledge-graph-edge.is-tag',
    '.knowledge-graph-node.is-tag .knowledge-graph-node-label', '.knowledge-graph-inspector', '.knowledge-graph-overview',
    '.knowledge-graph-overview-list', '.knowledge-graph-relation-group', '@media(max-width:900px)', '@media(max-width:680px)'
  ]) assert.ok(cssSource.includes(selector), 'missing graph style: ' + selector);
});

test('没有显式双链时，按共同主题生成可解释的语义关联', () => {
  const graph = graphModule.buildKnowledgeGraph({ documents: [
    { id: 'doc-memory-a', title: '记忆系统设计', content: '记忆系统用于长期项目和知识库工作流。' },
    { id: 'doc-memory-b', title: '知识库工作流', content: '长期项目需要稳定的记忆系统和知识库工作流。' }
  ] });
  const relation = graph.edges.find(edge => edge.type === 'semantic');
  assert.ok(relation);
  assert.match(relation.label, /共同主题/);
  assert.ok(relation.weight >= 1);
});
