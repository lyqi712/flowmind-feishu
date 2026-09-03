import assert from 'node:assert/strict';
import test from 'node:test';
import {
  annotationHighlightQuery,
  findTextMatches,
  readerAnnotationPayload
} from '../src/workspace/reader-text-layer.js';

test('in-document search finds overlapping-safe case-insensitive matches', () => {
  assert.deepEqual(findTextMatches('飞书知识库与飞书文档', '飞书'), [
    { start: 0, end: 2, text: '飞书' },
    { start: 6, end: 8, text: '飞书' }
  ]);
  assert.equal(findTextMatches('Alpha BETA alpha', 'alpha').length, 2);
  assert.deepEqual(findTextMatches('没有命中', '图谱'), []);
  assert.deepEqual(findTextMatches('abc', ''), []);
});

test('reader annotations persist quote, page and selector without writing the source document', () => {
  assert.equal(readerAnnotationPayload({ quote: '   ' }), null);
  assert.deepEqual(readerAnnotationPayload({
    quote: '关键结论',
    anchor: 'block:42',
    startOffset: 2,
    endOffset: 8
  }), {
    pageNumber: 1,
    quote: '关键结论',
    comment: '',
    color: 'yellow',
    anchor: 'block:42',
    selector: { kind: 'text-quote', quote: '关键结论', startOffset: 2, endOffset: 8 }
  });
  assert.equal(annotationHighlightQuery({ quote: '  关键结论  ' }), '关键结论');
});
