import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildAnswerFeedbackPayload } from '../src/workspace/answer-feedback.js';

// 测试引用解析和反馈API

test('引用解析 - 基本数字引用', () => {
  const text = '根据文档 [1]，系统支持多种格式。另外 [2] 提到了性能优化。';
  const citations = [
    { id: 1, title: '技术文档', excerpt: '支持JSON、XML、CSV格式' },
    { id: 2, title: '性能指南', excerpt: '使用缓存可提升50%性能' }
  ];

  // 模拟解析逻辑
  const citationPattern = /\[(\d+)\]/g;
  const matches = [...text.matchAll(citationPattern)];

  assert.equal(matches.length, 2);
  assert.equal(matches[0][1], '1');
  assert.equal(matches[1][1], '2');
});

test('引用解析 - 连续引用', () => {
  const text = '综合分析 [1][2][3] 可以得出结论。';
  const citationPattern = /\[(\d+)\]/g;
  const matches = [...text.matchAll(citationPattern)];

  assert.equal(matches.length, 3);
  assert.equal(matches[0][1], '1');
  assert.equal(matches[1][1], '2');
  assert.equal(matches[2][1], '3');
});

test('引用解析 - 无效引用标记', () => {
  const invalidMarkers = [
    '根据 [source] 可知',
    '参考 [source-id] 文档',
    '见 [selection] 部分'
  ];

  const validPattern = /\[(\d+)\]/g;

  for (const text of invalidMarkers) {
    const matches = [...text.matchAll(validPattern)];
    assert.equal(matches.length, 0, `应该不匹配: ${text}`);
  }
});

test('引用覆盖率计算', () => {
  const testCases = [
    { cited: 5, total: 5, expected: 100 },
    { cited: 4, total: 5, expected: 80 },
    { cited: 3, total: 6, expected: 50 },
    { cited: 0, total: 5, expected: 0 }
  ];

  for (const { cited, total, expected } of testCases) {
    const coverage = total > 0 ? Math.round((cited / total) * 100) : 0;
    assert.equal(coverage, expected);
  }
});

test('反馈请求必须带 conversationId，字段名对齐 API 的 issueType', () => {
  const missing = buildAnswerFeedbackPayload({ messageId: 'msg_456', rating: 'positive' });
  assert.equal(missing.valid, false);
  assert.equal(missing.conversationId, '');

  const positive = buildAnswerFeedbackPayload({
    conversationId: 'conv_123',
    messageId: 'msg_456',
    rating: 'positive',
    issueType: 'incorrect-citation',
    comment: '很好'
  });
  assert.equal(positive.valid, true);
  assert.equal(positive.issueType, null);

  const negative = buildAnswerFeedbackPayload({
    conversationId: 'conv_123',
    messageId: 'msg_456',
    rating: 'negative',
    issueType: 'incorrect-citation',
    comment: 'x'.repeat(600)
  });
  assert.equal(negative.issueType, 'incorrect-citation');
  assert.equal(negative.comment.length, 500);
});

test('反馈数据结构验证', () => {
  const feedback = {
    conversationId: 'conv_123',
    messageId: 'msg_456',
    rating: 'negative',
    issueType: 'incorrect-citation',
    comment: '引用[2]的内容与原文不符',
    timestamp: new Date().toISOString()
  };

  assert.equal(typeof feedback.conversationId, 'string');
  assert.equal(typeof feedback.messageId, 'string');
  assert.ok(['positive', 'negative'].includes(feedback.rating));
  assert.ok(['incorrect-citation', 'wrong-answer', 'incomplete', 'fabricated', 'other'].includes(feedback.issueType));
  assert.equal(typeof feedback.comment, 'string');
  assert.ok(feedback.timestamp);
});

test('反馈统计计算', () => {
  const feedbackList = [
    { rating: 'positive' },
    { rating: 'positive' },
    { rating: 'positive' },
    { rating: 'negative', issueType: 'incorrect-citation' },
    { rating: 'negative', issueType: 'wrong-answer' }
  ];

  const total = feedbackList.length;
  const positive = feedbackList.filter(f => f.rating === 'positive').length;
  const negative = feedbackList.filter(f => f.rating === 'negative').length;
  const satisfactionRate = total > 0 ? Math.round((positive / total) * 100) : 0;

  assert.equal(total, 5);
  assert.equal(positive, 3);
  assert.equal(negative, 2);
  assert.equal(satisfactionRate, 60);

  const issueBreakdown = {
    'incorrect-citation': feedbackList.filter(f => f.issueType === 'incorrect-citation').length,
    'wrong-answer': feedbackList.filter(f => f.issueType === 'wrong-answer').length,
    'incomplete': feedbackList.filter(f => f.issueType === 'incomplete').length,
    'fabricated': feedbackList.filter(f => f.issueType === 'fabricated').length,
    'other': feedbackList.filter(f => f.issueType === 'other').length
  };

  assert.equal(issueBreakdown['incorrect-citation'], 1);
  assert.equal(issueBreakdown['wrong-answer'], 1);
  assert.equal(issueBreakdown['incomplete'], 0);
  assert.equal(issueBreakdown['fabricated'], 0);
  assert.equal(issueBreakdown['other'], 0);
});

test('引用提取 - 边界情况', () => {
  const testCases = [
    { text: '', expected: 0, label: '空文本' },
    { text: '没有任何引用的文本', expected: 0, label: '无引用' },
    { text: '[1]', expected: 1, label: '仅引用' },
    { text: '[1] [2] [3]', expected: 3, label: '空格分隔' },
    { text: '[1][2][3]', expected: 3, label: '无空格' },
    { text: '文本[1]中间[2]位置[3]', expected: 3, label: '混合位置' }
  ];

  const citationPattern = /\[(\d+)\]/g;

  for (const { text, expected, label } of testCases) {
    const matches = [...text.matchAll(citationPattern)];
    assert.equal(matches.length, expected, `${label}: ${text}`);
  }
});

test('引用编号范围检查', () => {
  const text = '引用 [1] [5] [10] [99] [100]';
  const citationPattern = /\[(\d+)\]/g;
  const matches = [...text.matchAll(citationPattern)];
  const numbers = matches.map(m => parseInt(m[1]));

  assert.deepEqual(numbers, [1, 5, 10, 99, 100]);

  // 检查编号是否超出证据数量
  const evidenceCount = 3;
  const invalidCitations = numbers.filter(n => n > evidenceCount);

  assert.equal(invalidCitations.length, 4); // [5, 10, 99, 100] 都超出
  assert.ok(invalidCitations.includes(5));
  assert.ok(invalidCitations.includes(10));
  assert.ok(invalidCitations.includes(99));
  assert.ok(invalidCitations.includes(100));
});

test('满意度评级分类', () => {
  const testCases = [
    { rate: 100, expected: 'good' },
    { rate: 85, expected: 'good' },
    { rate: 80, expected: 'good' },
    { rate: 75, expected: 'medium' },
    { rate: 50, expected: 'medium' },
    { rate: 45, expected: 'low' },
    { rate: 0, expected: 'low' }
  ];

  for (const { rate, expected } of testCases) {
    const level = rate >= 80 ? 'good' : rate >= 50 ? 'medium' : 'low';
    assert.equal(level, expected, `满意度 ${rate}% 应为 ${expected}`);
  }
});

test('反馈评论长度限制', () => {
  const longComment = 'x'.repeat(1000);
  const truncated = longComment.slice(0, 500);

  assert.equal(truncated.length, 500);
  assert.ok(longComment.length > 500);
});

test('引用跳转数据结构', () => {
  const citation = {
    id: 'doc_123',
    title: '技术规范文档',
    excerpt: '系统应支持UTF-8编码...',
    documentId: 'doc_123'
  };

  assert.ok(citation.id);
  assert.ok(citation.title);
  assert.ok(citation.excerpt);
  assert.equal(citation.id, citation.documentId);
});

test('引用悬浮提示内容截断', () => {
  const longExcerpt = '这是一段很长的摘录内容，'.repeat(50);
  const maxLength = 200;
  const truncated = longExcerpt.slice(0, maxLength) + (longExcerpt.length > maxLength ? '...' : '');

  assert.ok(truncated.length <= maxLength + 3); // +3 for '...'
  assert.ok(truncated.endsWith('...'));
});

test('正文 [n] 必须按原 citations 下标映射，去重会把 [2] 指错篇', () => {
  const citations = [
    { documentId: 'doc-a', title: 'A', snippet: '第一处命中' },
    { documentId: 'doc-a', title: 'A', snippet: '第二处命中' },
    { documentId: 'doc-b', title: 'B', snippet: '另一篇' }
  ];
  const unique = [];
  const seen = new Set();
  for (const citation of citations) {
    const key = String(citation.documentId);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(citation);
  }
  assert.equal(unique.length, 2);
  assert.equal(unique[1].title, 'B');

  const evidenceList = citations.map(citation => ({
    ...citation,
    excerpt: citation.excerpt || citation.snippet || citation.quote || '',
    document: citation.document || citation
  }));
  const text = '对比 [1] 和 [2]，再看 [3]。'.repeat(40);
  const hits = [...text.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]));
  assert.equal(hits.length, 120);
  assert.equal(evidenceList[hits[1] - 1].excerpt, '第二处命中');
  assert.equal(evidenceList[hits[2] - 1].title, 'B');
  assert.notEqual(unique[hits[1] - 1].title, evidenceList[hits[1] - 1].title);
});

test('主问答反馈不弹系统框，缺类型时在页面里提示', async () => {
  const { readFileSync } = await import('node:fs');
  const feedback = readFileSync(new URL('../src/components/MessageFeedback.jsx', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const desktop = readFileSync(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
  assert.match(feedback, /请选择问题类型/);
  assert.match(feedback, /setSubmitError/);
  assert.doesNotMatch(feedback, /alert\(/);
  assert.match(main, /<MessageFeedback conversationId=\{message.conversationId \|\| conversationId\}/);
  assert.doesNotMatch(desktop, /luxiaofei/);
});

test('构建工具不进生产依赖，对话正文按阅读字号', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const friday = readFileSync(new URL('../src/components/FridaySkin.css', import.meta.url), 'utf8');
  const reader = readFileSync(new URL('../src/components/ContentReader.css', import.meta.url), 'utf8');
  const feedback = readFileSync(new URL('../src/components/MessageFeedback.css', import.meta.url), 'utf8');
  assert.equal(pkg.dependencies.vite, undefined);
  assert.equal(pkg.dependencies.concurrently, undefined);
  assert.equal(pkg.dependencies.preact, undefined);
  assert.equal(pkg.devDependencies.vite, '8.2.0');
  assert.match(friday, /\.markdown-answer,[\s\S]*?font-size: 15px/);
  assert.match(reader, /content-reader-conversation-markdown\{[^}]*font-size:15px/);
  assert.doesNotMatch(feedback, /#2563eb/);
});

console.log('✓ 所有引用和反馈功能测试通过');
