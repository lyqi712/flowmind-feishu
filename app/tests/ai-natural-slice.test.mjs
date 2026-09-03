import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAnswerArtifactPayload } from '../server/knowledge-relations.mjs';

const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const deep = readFileSync(new URL('../src/components/DeepAnswerPanel.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('证据图表 artifact 具备可渲染数据与来源锚点', () => {
  const artifact = createAnswerArtifactPayload('chart', {
    question: '知识库结论',
    answer: '结论正文',
    citations: [{ documentId: 'doc-1', title: '材料一', anchor: 'block:summary', excerpt: '证据一' }],
    relations: {
      topics: [{ name: '知识库', score: 8, documentIds: ['doc-1'], sourceRefs: [{ documentId: 'doc-1', title: '材料一', anchor: 'block:summary', excerpt: '证据一' }] }, { name: '工作流', score: 5, documentIds: ['doc-1'], sourceRefs: [] }],
      relatedDocuments: [{ documentId: 'doc-1', title: '材料一', score: 8, relationReason: '共同主题', sourceRefs: [{ documentId: 'doc-1', title: '材料一', anchor: 'block:summary', excerpt: '证据一' }] }]
    }
  });
  assert.equal(artifact.tags[0], '证据图表');
  assert.ok(artifact.chartSpec.labels.length >= 2);
  assert.equal(artifact.chartSpec.values.length, artifact.chartSpec.labels.length);
  assert.ok(artifact.sourceRefs.some(ref => ref.anchor === 'block:summary'));
});

test('跨资料深度回答才展开问题理解、覆盖率和执行计划', () => {
  assert.match(main, /showProcessDetails: hasSubstantiveEvidenceAnalysis\(message\.relations\)/);
  assert.match(main, /stripTemplatedAnswerSections/);
  assert.match(main, /ask\('精简一下'\)/);
  assert.match(deep, /const showProcessDetails = message\.showProcessDetails === true/);
});

test('Composer 语音入口和回答内图表保持在同一上下文流', () => {
  for (const fragment of ['deep-answer-chart', 'chartArtifact']) assert.ok(deep.includes(fragment), fragment);
  assert.ok(css.includes('.composer-voice-button'));
});

test('覆盖率留在深度过程里，不挡默认回答', () => {
  assert.match(main, /message\.relations \? <Suspense/);
  assert.match(main, /将回答转为笔记/);
  assert.match(deep, /未被引用覆盖的结论/);
  assert.match(deep, /citationIntegrity/);
  assert.match(deep, /deep-answer-extras/);
  assert.match(deep, /showProcessDetails \? <div className="deep-answer-overview">/);
  assert.doesNotMatch(deep, /: coverage \? <CoverageCard/);
});
