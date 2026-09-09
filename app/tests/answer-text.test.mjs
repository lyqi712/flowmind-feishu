import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSubstantiveEvidenceAnalysis,
  looksTemplatedAnswer,
  shouldAttachRelationsAnalysis,
  stripTemplatedAnswerSections
} from '../shared/answer-text.mjs';

test('stripTemplatedAnswerSections removes canned section headers and coverage lines', () => {
  const input = '## 结论\n只保留这一句。\n引用覆盖率 42%';
  assert.equal(stripTemplatedAnswerSections(input), '只保留这一句。');
});

test('stripTemplatedAnswerSections removes hollow openings and summary headers', () => {
  const input = '根据以上材料，\nAgent Loop 用责任闭环约束长任务 [1]。\n## 总结\n';
  assert.equal(stripTemplatedAnswerSections(input), 'Agent Loop 用责任闭环约束长任务 [1]。');
});

test('stripTemplatedAnswerSections removes comparative report scaffolding', () => {
  const input = '从以上分析可以看出，Hermes 偏 Harness [1]。\n## 核心差异\nAgent Loop 强调验收闭环 [2]。';
  const output = stripTemplatedAnswerSections(input);
  assert.match(output, /Hermes 偏 Harness \[1\]/);
  assert.match(output, /Agent Loop 强调验收闭环 \[2\]/);
  assert.doesNotMatch(output, /核心差异/);
});

test('stripTemplatedAnswerSections removes lone about-section bold headers', () => {
  const input = '两份材料差别很大。\n\n**关于长时运行幻觉**\n\nAgent Loop 正面处理这个问题 [1]。\n\n**关于可验证闭环**\n\nAgent Loop 讲验收闭环 [2]。';
  const output = stripTemplatedAnswerSections(input);
  assert.doesNotMatch(output, /关于长时运行幻觉/);
  assert.doesNotMatch(output, /关于可验证闭环/);
  assert.match(output, /Agent Loop 正面处理/);
});

test('stripTemplatedAnswerSections removes contrast report openers', () => {
  const input = '这两份材料对“长时运行幻觉”的讲法差异很大，核心区别在于：Hermes 偏 Harness [1]。';
  const output = stripTemplatedAnswerSections(input);
  assert.doesNotMatch(output, /差异很大/);
  assert.doesNotMatch(output, /核心区别在于/);
  assert.match(output, /Hermes 偏 Harness \[1\]/);
});

test('stripTemplatedAnswerSections removes the I-mainly-read closer', () => {
  const input = 'Hermes 讲 Harness [1]。\n我主要看了《Agent Loop》和《Agent Reach》这两篇，另外参考了说明书。';
  const output = stripTemplatedAnswerSections(input);
  assert.match(output, /Hermes 讲 Harness \[1\]/);
  assert.doesNotMatch(output, /我主要看了/);
});

test('looksTemplatedAnswer flags empty skeleton answers', () => {
  assert.equal(looksTemplatedAnswer('## 结论\n'), true);
  assert.equal(looksTemplatedAnswer('引用覆盖率 80%'), true);
  assert.equal(looksTemplatedAnswer('Hermes 和 Agent Loop 都谈闭环 [1][2]'), false);
});

test('shouldAttachRelationsAnalysis only keeps multi-source or conflict relations', () => {
  const relations = { relatedDocuments: [{ documentId: 'a' }], conflicts: [] };
  assert.equal(shouldAttachRelationsAnalysis(relations, [{ documentId: 'a' }]), false);
  assert.equal(shouldAttachRelationsAnalysis(relations, [{ documentId: 'a' }, { documentId: 'b' }]), true);
  assert.equal(shouldAttachRelationsAnalysis({ ...relations, conflicts: [{ topic: '日期' }] }, [{ documentId: 'a' }]), true);
  assert.equal(shouldAttachRelationsAnalysis(relations, [{ documentId: 'a' }], { status: 'downgraded', invalidMarkers: [99] }), true);
  assert.equal(shouldAttachRelationsAnalysis({ ...relations, rewrittenQuestion: '比较飞书同步和知识库问答', intent: { type: 'compare' } }, [{ documentId: 'a' }]), true);
});

test('hasSubstantiveEvidenceAnalysis matches multi-doc or conflict panels', () => {
  assert.equal(hasSubstantiveEvidenceAnalysis({ relatedDocuments: [{ documentId: 'a' }] }), false);
  assert.equal(hasSubstantiveEvidenceAnalysis({ relatedDocuments: [{ documentId: 'a' }, { documentId: 'b' }] }), true);
  assert.equal(hasSubstantiveEvidenceAnalysis({ conflicts: [{ topic: 'x' }] }), true);
});
