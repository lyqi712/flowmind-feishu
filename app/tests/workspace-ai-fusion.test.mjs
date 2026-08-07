import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = (await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('阅读器快捷提问携带当前文档与选区进入统一问答 Tab', () => {
  for (const fragment of [
    'function handleReaderAsk(prompt, item, selection = null)',
    "handleWorkspaceAsk(prompt, readerWorkspaceContext(item, selection))",
    'onAsk={(prompt, selection) => handleReaderAsk(prompt, readerDetail.item, selection)}'
  ]) assert.ok(mainSource.includes(fragment), `missing ${fragment}`);
});

test('知识观察问题携带节点来源和相邻文档进入统一问答', () => {
  for (const fragment of [
    'function handleKnowledgeObservationAsk(prompt, node, relatedNodes = [])',
    'const sourceRefs = Array.isArray(node?.raw?.sourceRefs) ? node.raw.sourceRefs : []',
    'resources: [...sourceRefs, ...relatedDocuments]',
    'handleWorkspaceAsk(prompt, { currentDocument, resources: [...sourceRefs, ...relatedDocuments] });',
    'onAskNode={handleKnowledgeObservationAsk}'
  ]) assert.ok(mainSource.includes(fragment), `missing ${fragment}`);
});

test('阅读选区可直接沉淀为保留 quote、anchor 和 offset 的来源笔记', () => {
  for (const fragment of [
    'async function writeSourceNote(item, selection = null)',
    "quote ? { quote, selection: true, startOffset: selection?.startOffset, endOffset: selection?.endOffset }",
    "tags: quote ? ['来源笔记', '选区笔记'] : ['来源笔记']",
    "summary: quote ? '基于阅读选区创建' : '来源笔记'"
  ]) assert.ok(mainSource.includes(fragment), `missing ${fragment}`);
});
test('阅读器和选区直接复用持久 Writing 创建链并保留其他当前资源', () => {
  for (const fragment of [
    'function readerWorkspaceContext(item, selection = null)',
    "const resources = (workspaceContext.resources || []).filter",
    'function handleReaderCreateWriting(item, selection = null)',
    'return handleWorkspaceCreateWriting(readerWorkspaceContext(item, selection))',
    'onCreateWriting={selection => handleReaderCreateWriting(readerDetail.item, selection)}'
  ]) assert.ok(mainSource.includes(fragment), `missing ${fragment}`);
});

test('阅读器文档解读沿用当前材料、持久 Skill 历史和后台任务，不跳到独立页面', () => {
  for (const fragment of [
    'async function handleReaderInterpretation(kind, item, selection = null, force = false)',
    "const skillId = kind === 'quiz' ? 'quiz' : 'mind-map'",
    'const existing = !force ? runs.find(run =>',
    "documentIds: [item.id], selection",
    'setSkillRuns(current => [completed, ...current.filter(run => run.id !== completed.id)])',
    'interpretationRuns={runs.filter(run => ["mind-map", "quiz"].includes(run.skillId)'
  ]) assert.ok(mainSource.includes(fragment), `missing Reader interpretation integration: ${fragment}`);
  assert.doesNotMatch(mainSource, /route === ['"](?:mind-map|quiz)['"]/);
});