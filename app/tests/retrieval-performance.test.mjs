import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { answerQuestion, childWindows, parentEvidenceWindow, pruneDocumentsForQuery, searchDocuments, searchEvidenceChunks, tokenize } from '../server/retrieval.mjs';

test('Chinese retrieval stays bounded on long documents and returns readable UTF-8 answers', () => {
  const repeated = '飞书知识库支持跨文档关联、引用、时间线、共识与冲突分析。';
  const documents = [
    { id: 'long-1', title: '飞书知识工作流', content: repeated.repeat(12000), url: 'https://example.com/1' },
    { id: 'long-2', title: '模型接入与 MCP', content: '模型 URL、API Key、MCP 接入和第三方中转站配置。'.repeat(4000), url: 'https://example.com/2' }
  ];
  const question = '请梳理飞书知识库的跨文档关联、共识、冲突和时间线';
  assert.ok(tokenize(question).length <= 48);
  const started = performance.now();
  const result = answerQuestion(documents, question, { limit: 4 });
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 2000, 'retrieval took ' + elapsedMs.toFixed(1) + 'ms');
  assert.ok(result.citations.length >= 1);
  assert.match(result.answer, /根据本地知识库/);
  assert.match(result.answer, /以上结论来自/);
  assert.doesNotMatch(result.answer, /�|(?:\?{2,}|？{2,})/u);
});


test('search excerpts keep stable offsets without sentence-array expansion', () => {
  const prefix = '无关前缀。'.repeat(2000);
  const marker = '关键结论：知识地图必须保留双向关联理由。';
  const document = { id: 'offset-1', title: '知识地图规范', content: prefix + marker + '尾部。'.repeat(2000) };
  const [match] = searchDocuments([document], '知识地图双向关联理由', { limit: 1 });
  assert.ok(match.excerpt.includes('知识地图'));
  assert.ok(match.excerptStart >= 0);
  assert.ok(match.excerpt.length <= 224);
});

test('parent-child retrieval scores a small window then returns a larger evidence span', () => {
  const prefix = '无关说明。'.repeat(280);
  const marker = '关键结论：发布必须先完成安全审批，负责人是 Alice。';
  const suffix = '尾部填充。'.repeat(280);
  const document = { id: 'pc-1', title: '发布计划', content: prefix + marker + suffix };
  assert.ok(childWindows(document.content).length > 3);
  assert.ok(parentEvidenceWindow(document.content, prefix.length).includes('Alice'));
  const matches = searchEvidenceChunks([document], '发布安全审批 Alice', { limit: 1 });
  assert.match(matches[0].evidenceText, /Alice/);
  assert.equal(matches[0].parentChild, true);
  assert.ok(matches[0].evidenceText.length <= 2000);
  assert.ok(matches[0].evidenceText.length > 400);
});

test('chunk evidence retrieval finds late conclusions and preserves stable chunk anchors', () => {
  const documents = [
    { id: 'long-plan', title: '发布计划', content: '背景资料'.repeat(9000) },
    { id: 'status', title: '状态记录', content: '其他项目状态。'.repeat(800) }
  ];
  const chunksByDocument = {
    'long-plan': [
      { id: 'plan-start', ordinal: 0, text: '项目背景和例行说明。'.repeat(80), metadata: { anchor: 'chars:0-640' } },
      { id: 'plan-decision', ordinal: 8, text: '关键结论：发布必须先完成安全审批，负责人是 Alice，截止时间为周五。', metadata: { anchor: 'chars:9400-9470', startChar: 9400 } }
    ],
    status: [{ id: 'status-1', ordinal: 0, text: '项目状态正常。', metadata: { anchor: 'chars:0-8' } }]
  };
  const matches = searchEvidenceChunks(documents, '发布安全审批负责人截止时间', { limit: 2, chunksByDocument });
  assert.equal(matches[0].chunkId, 'plan-decision');
  assert.equal(matches[0].anchor, 'chars:9400-9470');
  assert.match(matches[0].evidenceText, /Alice/);
  const answer = answerQuestion(documents, '发布安全审批负责人截止时间', { limit: 2, chunksByDocument });
  assert.equal(answer.citations[0].chunkId, 'plan-decision');
  assert.equal(answer.citations[0].anchor, 'chars:9400-9470');
});

test('chunk evidence preserves a precise character anchor when a page fallback also exists', () => {
  const document = { id: 'precise-anchor', title: '发布审计', content: '无关正文。关键审批结论在这一段。' };
  const [match] = searchEvidenceChunks([document], '关键审批结论', {
    limit: 1,
    chunksByDocument: {
      'precise-anchor': [{
        id: 'precise-chunk',
        text: '关键审批结论在这一段。',
        metadata: { anchor: 'page:3:chars:80-92', pageAnchor: 'page:3', pageNumber: 3, startChar: 80 }
      }]
    }
  });
  assert.equal(match.anchor, 'page:3:chars:80-92');
  assert.equal(answerQuestion([document], '关键审批结论', {
    limit: 1,
    chunksByDocument: { 'precise-anchor': [{ id: 'precise-chunk', text: '关键审批结论在这一段。', metadata: { anchor: 'page:3:chars:80-92', pageAnchor: 'page:3', pageNumber: 3, startChar: 80 } }] }
  }).citations[0].anchor, 'page:3:chars:80-92');
});

test('selected-source coverage keeps nonmatching documents visible without treating arbitrary chunks as evidence', () => {
  const documents = [
    { id: 'source-a', title: '来源 A', content: 'A'.repeat(4000) },
    { id: 'source-b', title: '来源 B', content: 'B'.repeat(4000) }
  ];
  const chunksByDocument = {
    'source-a': [{ id: 'a-1', text: '来源 A 的事实。', metadata: { anchor: 'chars:0-8' } }],
    'source-b': [{ id: 'b-1', text: '来源 B 的事实。', metadata: { anchor: 'chars:0-8' } }]
  };
  const matches = searchEvidenceChunks(documents, '未出现的词', { limit: 1, requiredDocumentIds: ['source-a', 'source-b'], chunksByDocument });
  assert.equal(matches.length, 2);
  assert.deepEqual(new Set(matches.map(match => match.document.id)), new Set(['source-a', 'source-b']));
  assert.ok(matches.every(match => match.score >= 0.25 && match.matchKind === 'scope-fallback'));
  const answer = answerQuestion(documents, '未出现的词', { limit: 1, requiredDocumentIds: ['source-a', 'source-b'], chunksByDocument });
  const attachmentAnswer = answerQuestion(documents, '未出现的词', {
    limit: 1,
    requiredDocumentIds: ['source-a', 'source-b'],
    chunksByDocument,
    allowScopeFallbackDocumentIds: ['source-a']
  });
  assert.deepEqual(attachmentAnswer.citations.map(citation => citation.documentId), ['source-a']);
  assert.match(attachmentAnswer.answer, /明确加入当前对话的附件/);
});

test('document-level retrieval labels title-only and scope fallback results without citing them as body evidence', () => {
  const titleOnly = { id: 'title-only', title: '安全审批负责人', content: '这是不包含问题事实的背景资料。' };
  const fallback = { id: 'fallback', title: '另一份资料', content: '完全不同的正文。' };
  const titleResult = searchDocuments([titleOnly], '安全审批负责人', { limit: 1 })[0];
  assert.equal(titleResult.matchKind, 'title-only');
  assert.deepEqual(answerQuestion([titleOnly], '安全审批负责人', { limit: 1 }).citations, []);
  const fallbackResult = searchDocuments([fallback], '未出现的关键词', { limit: 1, requiredDocumentIds: ['fallback'] })[0];
  assert.equal(fallbackResult.matchKind, 'scope-fallback');
  assert.deepEqual(answerQuestion([fallback], '未出现的关键词', { limit: 1, requiredDocumentIds: ['fallback'] }).citations, []);
});

test('direct body evidence outranks title-only background chunks and internal candidate pools exceed ten documents', () => {
  const documents = [
    { id: 'title-heavy', title: '安全审批负责人截止时间', content: '背景资料' },
    { id: 'body-answer', title: '执行记录', content: '关键结论：发布前必须完成安全审批，负责人是 Alice，截止时间为周五。' },
    ...Array.from({ length: 10 }, (_, index) => ({ id: `candidate-${index}`, title: `发布相关资料 ${index}`, content: '普通背景。' }))
  ];
  const chunksByDocument = {
    'title-heavy': [
      { id: 'title-0', ordinal: 0, text: '无关背景段落。', metadata: { anchor: 'chars:0-8' } },
      { id: 'title-1', ordinal: 1, text: '仍然是无关背景。', metadata: { anchor: 'chars:9-18' } }
    ],
    'body-answer': [{ id: 'body-0', ordinal: 0, text: documents[1].content, metadata: { anchor: 'chars:0-31' } }]
  };
  const [best] = searchEvidenceChunks(documents, '安全审批负责人截止时间', { limit: 1, chunksByDocument });
  assert.equal(best.chunkId, 'body-0');
  assert.equal(best.matchKind, 'text-match');
  const candidates = searchDocuments(documents, '发布相关资料', { limit: 48 });
  assert.ok(candidates.length > 10, 'internal retrieval may retain more than ten document candidates');
});

test('title-exact entities stay ahead of long documents that only match generic query terms', () => {
  const generic = '对比差异场景适用 Agent 提示词模板。'.repeat(400);
  const documents = [
    { id: 'long-generic', title: '各种提示词和智能体问题汇总', content: generic },
    { id: 'agent-loop', title: 'Agent Loop：从长时运行幻觉到可验证的责任闭环', content: 'Agent Loop 强调可验证的责任闭环，适合需要验收的长时运行任务。' },
    { id: 'hermes', title: 'Hermes Agent 实战解析', content: 'Hermes Agent 适合多工具协作和技能组合。' },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `noise-${index}`,
      title: `Hermes 课程笔记 ${index}`,
      content: 'Hermes Agent 课程记录，包含对比和适用场景说明。'.repeat(20)
    }))
  ];
  const query = '对比 Hermes Agent 和 Agent Loop 的核心差异，并指出各自适用场景';
  const ranked = searchDocuments(documents, query, { limit: 8 });
  const ids = ranked.map((entry) => entry.document.id);
  assert.ok(ids.includes('agent-loop'), 'title-exact Agent Loop must enter the first page');
  assert.ok(ids.includes('hermes'), 'title-exact Hermes Agent must enter the first page');
  const loopRank = ids.indexOf('agent-loop');
  const genericRank = ids.indexOf('long-generic');
  if (genericRank >= 0) assert.ok(loopRank < genericRank, 'exact title entity outranks generic long dump');
  const chunks = searchEvidenceChunks(documents, query, { limit: 8, maxChunksPerDocument: 3 });
  const chunkDocs = new Set(chunks.map((chunk) => chunk.document.id));
  assert.ok(chunkDocs.has('agent-loop'), 'Agent Loop chunks must stay in the first evidence page');
  assert.ok(chunkDocs.has('hermes'), 'Hermes Agent chunks must stay in the first evidence page');
});

test('query-echo derived notes do not outrank title-exact source documents', () => {
  const query = '对比 Hermes Agent 和 Agent Loop 这两份材料，它们对长时运行幻觉、可验证闭环分别怎么说';
  const documents = [
    {
      id: 'acceptance-note',
      title: '知识笔记：对比 Hermes Agent 和 Agent Loop 这两份材料，它们对长时运行幻觉、可验证闭环分别怎么说',
      content: '两者都在谈长时运行幻觉和可验证闭环。这份验收笔记复述了用户问题，不能压过原文。',
      source: 'local-note',
      type: 'note'
    },
    { id: 'agent-loop', title: 'Agent Loop：从长时运行幻觉到可验证的责任闭环', content: 'Agent Loop 强调可验证的责任闭环，适合需要验收的长时运行任务。' },
    { id: 'hermes', title: 'Hermes Agent 实战解析', content: 'Hermes Agent 适合多工具协作和技能组合，也讨论长时运行幻觉。' }
  ];
  const ranked = searchDocuments(documents, query, { limit: 8 });
  const ids = ranked.map((entry) => entry.document.id);
  assert.ok(ids.includes('agent-loop'), 'Agent Loop must stay on the first page');
  assert.ok(ids.includes('hermes'), 'Hermes must stay on the first page');
  const noteRank = ids.indexOf('acceptance-note');
  const loopRank = ids.indexOf('agent-loop');
  const hermesRank = ids.indexOf('hermes');
  if (noteRank >= 0) {
    assert.ok(loopRank < noteRank, 'title-exact Agent Loop must outrank the query-echo note');
    assert.ok(hermesRank < noteRank, 'title-exact Hermes must outrank the query-echo note');
  }
  const chunks = searchEvidenceChunks(documents, query, { limit: 8, maxChunksPerDocument: 3 });
  const chunkDocs = chunks.map((chunk) => chunk.document.id);
  assert.ok(chunkDocs.includes('agent-loop'), 'Agent Loop chunks must remain available');
  assert.ok(chunkDocs.includes('hermes'), 'Hermes chunks must remain available');
  const firstSource = chunkDocs.find((id) => id === 'agent-loop' || id === 'hermes');
  assert.ok(firstSource, 'a source document must appear in chunk results');
  const noteChunkRank = chunkDocs.indexOf('acceptance-note');
  if (noteChunkRank >= 0) assert.ok(chunkDocs.indexOf(firstSource) < noteChunkRank, 'source chunks outrank the echo note');
});

test('compare queries keep both title-exact entities on the first page even when one side has more long documents', () => {
  const query = '对比 Hermes Agent 和 Agent Loop 这两份材料，它们对长时运行幻觉、可验证闭环分别怎么说';
  const documents = [
    { id: 'agent-loop', title: 'Agent Loop：从长时运行幻觉到可验证的责任闭环', content: 'Agent Loop 强调可验证的责任闭环。' },
    { id: 'hermes-main', title: 'Agent 为什么总是跑偏？Hermes Agent 实战解析：从 Harness 原理到飞书接入', content: 'Hermes Agent 讨论长时运行幻觉和 Harness。'.repeat(40) },
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `hermes-extra-${index}`,
      title: `Hermes Agent 效率翻倍技巧 ${index}`,
      content: 'Hermes Agent 效率、检索、线索挖掘、长时运行幻觉。'.repeat(30)
    }))
  ];
  const ranked = searchDocuments(documents, query, { limit: 8 });
  const ids = ranked.map((entry) => entry.document.id);
  assert.ok(ids.includes('agent-loop'), 'Agent Loop must stay on the first compare page');
  assert.ok(ids.includes('hermes-main') || ids.some((id) => id.startsWith('hermes-')), 'a Hermes source must stay on the first compare page');
  const chunks = searchEvidenceChunks(documents, query, { limit: 8, maxChunksPerDocument: 3 });
  const chunkDocs = new Set(chunks.map((chunk) => chunk.document.id));
  assert.ok(chunkDocs.has('agent-loop'), 'Agent Loop chunks must stay in compare evidence');
});

test('FTS candidate ids plus required docs prune the corpus before window scoring', () => {
  const documents = [
    { id: 'keep-fts', title: '发布计划', content: '发布必须先完成安全审批。' },
    { id: 'keep-required', title: '附件范围', content: '这篇被明确加入问答范围。' },
    ...Array.from({ length: 80 }, (_, index) => ({
      id: `noise-${index}`,
      title: `无关资料 ${index}`,
      content: '这段很长的无关正文不会进入父子窗口打分。'.repeat(40)
    }))
  ];
  const pruned = pruneDocumentsForQuery(documents, '发布安全审批', {
    requiredDocumentIds: ['keep-required'],
    ftsIds: ['keep-fts'],
    limit: 12
  });
  assert.deepEqual(pruned.map(item => item.id).sort(), ['keep-fts', 'keep-required']);
  const unfiltered = pruneDocumentsForQuery(documents, '发布安全审批', { limit: 12 });
  assert.ok(unfiltered.length <= 12);
  assert.ok(unfiltered.some(item => item.id === 'keep-fts'));
});
