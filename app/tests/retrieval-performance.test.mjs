import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { answerQuestion, searchDocuments, tokenize } from '../server/retrieval.mjs';

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
