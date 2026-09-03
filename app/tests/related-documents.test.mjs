import assert from 'node:assert/strict';
import test from 'node:test';
import { extractOutboundRefs, findRelatedDocuments, formatRelatedReason } from '../server/related-documents.mjs';

const loop = {
  id: 'doc-loop',
  title: 'Agent Loop 实践',
  content: '继续看 [[Hermes Agent 团队]]，以及 https://feishu.cn/docx/TokenTeam。',
  tags: ['来源笔记']
};
const team = {
  id: 'doc-team',
  title: 'Hermes Agent 团队',
  content: '团队规格。',
  externalId: 'TokenTeam',
  sourceUrl: 'https://feishu.cn/docx/TokenTeam',
  tags: ['组织']
};
const tape = {
  id: 'doc-tape',
  title: '胶带效果源码分享',
  content: '和 Agent 无关的视觉效果。',
  spaceId: 'space-same',
  tags: []
};
const sibling = {
  id: 'doc-sibling',
  title: '同库闲置文档',
  content: '只是和胶带效果放在同一个飞书文件夹。',
  spaceId: 'space-same',
  tags: []
};

test('能从正文抽出飞书链接和 wiki 链接', () => {
  const refs = extractOutboundRefs(loop.content);
  assert.deepEqual(refs.map((ref) => ref.kind).sort(), ['url', 'wiki']);
});

test('正文互链会进入相关 3 篇，并写明原因', () => {
  const related = findRelatedDocuments({ item: loop, documents: [loop, team, tape, sibling] });
  assert.equal(related.length, 1);
  assert.equal(related[0].documentId, 'doc-team');
  assert.match(related[0].reason, /提到了《Hermes Agent 团队》/);
});

test('被其他文档点名时显示回链', () => {
  const related = findRelatedDocuments({ item: team, documents: [loop, team, tape] });
  assert.equal(related[0].documentId, 'doc-loop');
  assert.match(related[0].reason, /提到了这篇/);
});

test('共同笔记能关联两篇文档', () => {
  const related = findRelatedDocuments({
    item: tape,
    documents: [loop, team, tape, sibling],
    notes: [{ id: 'note-1', title: '对照笔记', sourceRefs: [{ documentId: 'doc-tape' }, { documentId: 'doc-sibling' }] }]
  });
  assert.equal(related[0].documentId, 'doc-sibling');
  assert.match(related[0].reason, /共同笔记/);
});

test('只在同一个文件夹里，不会假装有关系', () => {
  const related = findRelatedDocuments({ item: tape, documents: [loop, team, tape, sibling] });
  assert.deepEqual(related, []);
});

test('相关篇最多 3 条，且原因函数不编空话', () => {
  assert.equal(formatRelatedReason([]), '');
  const extras = Array.from({ length: 5 }, (_, index) => ({
    id: `doc-extra-${index}`,
    title: `Hermes Agent 扩展 ${index}`,
    content: `参考 [[Agent Loop 实践]] ${index}`
  }));
  const related = findRelatedDocuments({ item: loop, documents: [loop, team, ...extras] });
  assert.ok(related.length <= 3);
});

test('标题二字重叠和系列署名不算关系', () => {
  const hermes = { id: 'doc-hermes', title: 'hermesAgent多智能体的几种用法', content: '用法说明' };
  const course = { id: 'doc-course', title: '【6230】已经实现的45套智能体--自动化Coze工作流 -> 俗人六哥', content: '课程目录' };
  const unnamedA = { id: 'doc-unnamed-a', title: '未命名飞书文档', content: '空白一' };
  const unnamedB = { id: 'doc-unnamed-b', title: '未命名飞书文档', content: '空白二' };
  const agentLoop = { id: 'doc-loop-b', title: 'Agent Loop 实践', content: '正文' };
  const agentLong = { id: 'doc-loop-c', title: 'Agent Loop 长时运行', content: '另一篇' };
  assert.deepEqual(findRelatedDocuments({ item: hermes, documents: [hermes, course] }), []);
  assert.deepEqual(findRelatedDocuments({ item: unnamedA, documents: [unnamedA, unnamedB] }), []);
  const related = findRelatedDocuments({ item: agentLoop, documents: [agentLoop, agentLong, course] });
  assert.equal(related.length, 1);
  assert.equal(related[0].documentId, 'doc-loop-c');
  assert.match(related[0].reason, /Agent|Loop/i);
});
