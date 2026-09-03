import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeKnowledgeRelations,
  candidateRelationSuggestionsFromRelations,
  createAnswerArtifactPayload
} from '../server/knowledge-relations.mjs';

const documents = [
  {
    id: 'doc-hermes',
    title: 'Hermes Agent Loop 实施方案',
    content: [
      '2026-07-01，Hermes 团队启动 Agent Loop 试运行。',
      '知识关联必须保留可点击来源。',
      '团队应该启用自动审批。',
      '内部附件位于 D:\\FlowMind-private\\roadmap.md，不应出现在回答中。'
    ].join('\n')
  },
  {
    id: 'doc-governance',
    title: 'Agent Loop 治理规范',
    content: [
      '2026年7月15日，Agent Loop 进入治理阶段。',
      '知识关联必须保留可点击来源。',
      '团队不应该启用自动审批。'
    ].join('\n')
  },
  {
    id: 'doc-graph',
    title: 'FlowMind 知识图谱计划',
    content: [
      '2026-08-01，FlowMind 工作台接入 Agent Loop。',
      '知识关联必须保留可点击来源。',
      '知识图谱用于发现跨文档关系。'
    ].join('\n')
  }
];

const chunksByDocument = {
  'doc-hermes': [
    {
      id: 'hermes-page-2',
      content: documents[0].content,
      metadata: { anchor: 'page:2', pageNumber: 2 }
    }
  ],
  'doc-governance': [
    {
      id: 'governance-audio',
      content: documents[1].content,
      metadata: { anchor: 'time:12-20', timeStart: 12, timeEnd: 20, speaker: 'Owner' }
    }
  ],
  'doc-graph': [
    {
      id: 'graph-region',
      content: documents[2].content,
      metadata: {
        anchor: 'page:1:region:2',
        pageNumber: 1,
        region: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 }
      }
    }
  ]
};

const citations = [
  {
    documentId: 'doc-hermes',
    title: documents[0].title,
    anchor: 'page:2',
    pageNumber: 2,
    excerpt: '知识关联必须保留可点击来源。团队应该启用自动审批。'
  },
  {
    documentId: 'doc-governance',
    title: documents[1].title,
    anchor: 'time:12-20',
    timeStart: 12,
    timeEnd: 20,
    speaker: 'Owner',
    excerpt: '知识关联必须保留可点击来源。团队不应该启用自动审批。'
  }
];

function analyze(overrides = {}) {
  return analyzeKnowledgeRelations({
    documents,
    chunksByDocument,
    question: '这些方案之间有什么联系和冲突？',
    answer: '三个方案都要求知识关联保留可点击来源。自动审批策略存在分歧。',
    citations,
    history: [],
    ...overrides
  });
}

function allSourceRefs(relations) {
  return [
    ...relations.topics.flatMap((entry) => entry.sourceRefs),
    ...relations.entities.flatMap((entry) => entry.sourceRefs),
    ...relations.relatedDocuments.flatMap((entry) => entry.sourceRefs),
    ...relations.consensus.flatMap((entry) => entry.sourceRefs),
    ...relations.conflicts.flatMap((entry) => entry.sourceRefs),
    ...relations.timeline.flatMap((entry) => entry.sourceRefs)
  ];
}

function assertNoMojibake(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /\uFFFD/u);
  assert.doesNotMatch(serialized, /(?:\?{2,}|？{2,})/u);
}

test('analyzeKnowledgeRelations deterministically builds a cross-document knowledge view with stable anchors', () => {
  const first = analyze();
  const second = analyze();

  assert.deepEqual(second, first);
  assert.equal(first.rewrittenQuestion, '这些方案之间有什么联系和冲突？');
  assertNoMojibake(first);
  assert.equal(first.intent.type, 'conflict');
  assert.equal(first.intent.requiresCrossDocument, true);
  assert.deepEqual(first.plan.steps.map((step) => step.id), ['retrieve', 'connect', 'compare', 'verify']);

  assert.ok(first.topics.some((topic) => topic.name.toLowerCase() === 'agent loop'));
  assert.ok(first.entities.some((entity) => entity.name === 'Hermes'));
  assert.ok(first.entities.some((entity) => entity.name === 'FlowMind'));

  assert.equal(first.relatedDocuments.length, 3);
  assert.ok(first.relatedDocuments.some((entry) => entry.title === 'Hermes Agent Loop 实施方案'));
  assert.ok(first.relatedDocuments.some((entry) => entry.title === 'Agent Loop 治理规范'));
  assert.ok(first.relatedDocuments.some((entry) => entry.title === 'FlowMind 知识图谱计划'));
  assert.deepEqual(first.relatedDocuments.map((entry) => entry.documentId).sort(), ['doc-governance', 'doc-graph', 'doc-hermes']);
  assert.ok(first.relatedDocuments.every((entry) => entry.relationReason && entry.score > 0 && entry.sourceRefs.length));
  assert.ok(first.relatedDocuments.every((entry, index, values) => index === 0 || values[index - 1].score >= entry.score));

  const refs = allSourceRefs(first);
  assert.ok(refs.some((ref) => ref.documentId === 'doc-hermes' && ref.anchor === 'page:2' && ref.pageNumber === 2));
  assert.ok(refs.some((ref) => ref.documentId === 'doc-governance' && ref.anchor === 'time:12-20' && ref.timeStart === 12 && ref.timeEnd === 20));
  assert.ok(refs.some((ref) => ref.documentId === 'doc-graph' && ref.anchor === 'page:1:region:2' && ref.region?.width === 0.5));
  assert.ok(refs.every((ref) => ref.documentId && ref.title && Object.hasOwn(ref, 'anchor') && Object.hasOwn(ref, 'excerpt')));

  assert.ok(first.consensus.some((entry) => entry.summary.includes('知识关联必须保留可点击来源')));
  assert.ok(first.conflicts.some((entry) => entry.viewpoints.some((viewpoint) => viewpoint.statement.includes('应该启用自动审批'))));
  assert.deepEqual(first.timeline.map((entry) => entry.date), ['2026-07-01', '2026-07-15', '2026-08-01']);
  assert.ok(first.followUpSuggestions.length >= 3);

  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /FlowMind-private|roadmap\.md|[A-Za-z]:\\/);
  assert.match(serialized, /本地路径已隐藏/);
});

test('history rewrites ambiguous follow-up questions and citation coverage exposes unsupported claims', () => {
  const result = analyze({
    question: '这个怎么落地？',
    history: [
      { role: 'assistant', content: '可以继续细化。' },
      { role: 'user', content: '知识图谱如何连接 Agent Loop？' },
      { role: 'assistant', content: '先建立实体和主题关系。' }
    ],
    answer: '知识关联必须保留可点击来源。所有系统将在 2027 年自动完成审批。',
    citations: [citations[0]]
  });

  assert.match(result.rewrittenQuestion, /结合上一轮关于「知识图谱如何连接 Agent Loop？」的讨论/);
  assert.equal(result.intent.type, 'action');
  assert.equal(result.citationCoverage.totalClaims, 2);
  assert.equal(result.citationCoverage.supportedClaims, 1);
  assert.equal(result.citationCoverage.unsupportedClaims, 1);
  assert.equal(result.citationCoverage.level, 'medium');
  assert.ok(result.citationCoverage.uncoveredClaims.some((claim) => claim.includes('2027')));
  assert.ok(result.followUpSuggestions.some((suggestion) => /没对齐|不一致|时间线|核对|出处|下一步/.test(suggestion)));
});

test('Map chunks are accepted and normalized without exposing arbitrary document metadata', () => {
  const map = new Map(Object.entries(chunksByDocument));
  const enriched = documents.map((document) => ({
    ...document,
    path: 'C:\\Users\\Administrator\\secret.txt',
    metadata: { localPath: 'C:\\hidden\\source.docx', token: 'private-token' }
  }));
  const result = analyze({ documents: enriched, chunksByDocument: map });

  assert.equal(result.relatedDocuments.length, 3);
  assert.doesNotMatch(JSON.stringify(result), /Administrator|secret\.txt|source\.docx|private-token/);
});

test('createAnswerArtifactPayload creates note, task and writing payloads with tags and deduplicated sourceRefs', () => {
  const relations = analyze();
  for (const kind of ['note', 'task', 'writing']) {
    const first = createAnswerArtifactPayload(kind, {
      question: 'Agent Loop 如何用于日常知识工作？',
      answer: '回答正文参考 C:\\private\\answer.txt，并要求知识关联保留可点击来源。',
      citations: [...citations, citations[0]],
      relations
    });
    const second = createAnswerArtifactPayload(kind, {
      question: 'Agent Loop 如何用于日常知识工作？',
      answer: '回答正文参考 C:\\private\\answer.txt，并要求知识关联保留可点击来源。',
      citations: [...citations, citations[0]],
      relations
    });

    assert.deepEqual(second, first);
    assert.ok(first.title.length > 4);
    assert.ok(first.content.includes('Agent Loop'));
    assert.ok(first.content.includes('回答正文参考'));
    assertNoMojibake(first);
    assert.ok(first.tags.length >= 2);
    assert.ok(first.sourceRefs.length >= 2);
    assert.equal(new Set(first.sourceRefs.map((ref) => [ref.documentId, ref.anchor, ref.excerpt].join('|'))).size, first.sourceRefs.length);
    assert.ok(first.sourceRefs.every((ref) => ref.documentId && ref.title && Object.hasOwn(ref, 'anchor') && Object.hasOwn(ref, 'excerpt')));
    assert.doesNotMatch(JSON.stringify(first), /C:\\private|answer\.txt|roadmap\.md/);
  }

  const note = createAnswerArtifactPayload('note', { question: '问题', answer: '回答', citations, relations });
  const task = createAnswerArtifactPayload('task', { question: '问题', answer: '回答', citations, relations });
  const writing = createAnswerArtifactPayload('writing', { question: '问题', answer: '回答', citations, relations });
  const problem = createAnswerArtifactPayload('problem', { question: '问题', answer: '回答', citations, relations });
  assert.match(note.title, /^知识笔记：/);
  assert.match(note.content, /## 共识/);
  assert.match(task.title, /^行动任务：/);
  assert.match(task.content, /\[ \]/);
  assert.match(writing.title, /^写作草稿：/);
  assert.match(writing.content, /^# /);
  assert.match(problem.title, /^问题记录：/);
  assert.match(problem.content, /## 这次怎么解决的/);
  assert.match(problem.content, /## 下次容易忘的点/);
  assert.doesNotMatch(problem.content, /## 共识/);
  assert.ok(problem.tags.includes('问题记录'));
  const longProblem = createAnswerArtifactPayload('problem', {
    question: '西红柿炒鸡蛋总忘葱花',
    answer: '先热锅再下蛋。\n\n出锅前再看一眼葱花。\n\n下次容易忘：出锅前看葱花',
    citations,
    relations
  });
  assert.match(longProblem.content, /出锅前看葱花/);
  assert.doesNotMatch(longProblem.content, /## 关联资料/);
  assert.doesNotMatch(longProblem.content, /## 共识/);
  assert.match(longProblem.content, /\[\[/);
  assert.throws(() => createAnswerArtifactPayload('email', {}), /Unsupported answer artifact kind/);
});

test('empty and partial inputs return a complete deterministic schema', () => {
  const result = analyzeKnowledgeRelations({ question: '', answer: '', documents: null, citations: null, history: null });
  assert.equal(result.rewrittenQuestion, '梳理当前知识内容？');
  assert.equal(result.intent.type, 'summary');
  assert.equal(result.plan.steps.length, 4);
  assert.deepEqual(result.topics, []);
  assert.deepEqual(result.entities, []);
  assert.deepEqual(result.relatedDocuments, []);
  assert.deepEqual(result.consensus, []);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.timeline, []);
  assert.deepEqual(result.citationCoverage, {
    score: 0,
    level: 'low',
    totalClaims: 0,
    supportedClaims: 0,
    unsupportedClaims: 0,
    citedDocuments: [],
    relevantDocuments: [],
    uncoveredClaims: []
  });
  assert.ok(Array.isArray(result.followUpSuggestions));
});


test('Chinese runtime output remains valid UTF-8 in rewritten questions, titles and artifact content', () => {
  const relations = analyzeKnowledgeRelations({
    documents: [{ id: '中文文档', title: '中文知识库实施方案', content: '知识关联必须保留可点击来源。日常问答需要呈现关联理由。' }],
    chunksByDocument: { 中文文档: [{ content: '知识关联必须保留可点击来源。', metadata: { anchor: 'page:1', pageNumber: 1 } }] },
    question: '这个方案怎么落地？',
    answer: '日常问答需要保留可点击来源。',
    citations: [{ documentId: '中文文档', title: '中文知识库实施方案', anchor: 'page:1', excerpt: '知识关联必须保留可点击来源。' }],
    history: [{ role: 'user', content: '如何建设日常知识库？' }]
  });
  assert.equal(relations.rewrittenQuestion, '这个方案怎么落地？');
  assert.equal(relations.relatedDocuments[0].title, '中文知识库实施方案');
  assertNoMojibake(relations);

  const artifact = createAnswerArtifactPayload('note', {
    question: '如何建设日常知识库？',
    answer: '日常问答需要保留可点击来源。',
    citations: [{ documentId: '中文文档', title: '中文知识库实施方案', anchor: 'page:1', excerpt: '知识关联必须保留可点击来源。' }],
    relations
  });
  assert.equal(artifact.title, '知识笔记：如何建设日常知识库');
  assert.match(artifact.content, /## 问题[\s\S]*如何建设日常知识库？/u);
  assert.match(artifact.content, /## 回答[\s\S]*日常问答需要保留可点击来源。/u);
  assertNoMojibake(artifact);
});

test('candidateRelationSuggestionsFromRelations only uses cited pairs and never invents empty-search edges', () => {
  const relations = analyze();
  const empty = candidateRelationSuggestionsFromRelations(relations, { citations: [] });
  assert.deepEqual(empty, []);

  const single = candidateRelationSuggestionsFromRelations(relations, { citations: [citations[0]] });
  assert.deepEqual(single, []);

  const cited = candidateRelationSuggestionsFromRelations(relations, { citations });
  assert.ok(cited.length >= 1);
  assert.ok(cited.length <= 3);
  assert.ok(cited.every((item) => item.sourceContentItemId !== item.targetContentItemId));
  assert.ok(cited.every((item) => ['doc-hermes', 'doc-governance'].includes(item.sourceContentItemId)));
  assert.ok(cited.every((item) => ['doc-hermes', 'doc-governance'].includes(item.targetContentItemId)));
  assert.ok(cited.every((item) => item.edgeType === 'link' && item.reason));

  const keys = cited.map((item) => [item.sourceContentItemId, item.targetContentItemId].sort().join('|'));
  assert.equal(new Set(keys).size, keys.length);

  const noCitationsButRelated = candidateRelationSuggestionsFromRelations({
    intent: { type: 'comparison', requiresCrossDocument: true },
    relatedDocuments: [
      { documentId: 'doc-hermes', relationReason: '对比来源', score: 90, sourceRefs: [] },
      { documentId: 'doc-governance', relationReason: '对比来源', score: 80, sourceRefs: [] }
    ]
  }, { citations: [] });
  assert.deepEqual(noCitationsButRelated, []);
});
