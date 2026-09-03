import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindAnswerCitations,
  claimsWithInvalidCitations,
  downgradeInvalidCitations,
  extractCitationMarkers,
  invalidCitationMarkers,
  partitionCitationMarkers,
  stripInvalidCitationMarkers
} from '../server/citation-integrity.mjs';

test('invalid citation markers are partitioned without voiding valid ones', () => {
  const answer = '库内结论见 [1]。库外数字是 [99]。补充见 [2] 和 [0]。';
  assert.deepEqual(extractCitationMarkers(answer), [1, 99, 2, 0]);
  assert.deepEqual(invalidCitationMarkers(answer, 2), [99, 0]);
  assert.deepEqual(partitionCitationMarkers(answer, 2), { valid: [1, 2], invalid: [99, 0] });
});

test('downgrade keeps the answer and strips only impossible markers', () => {
  const citations = [{ index: 1, documentId: 'doc-1' }];
  const result = downgradeInvalidCitations('库内结论见 [1]。库外数字是 [99]。', citations);
  assert.equal(result.citationIntegrity.status, 'downgraded');
  assert.deepEqual(result.citationIntegrity.invalidMarkers, [99]);
  assert.deepEqual(result.citationIntegrity.validMarkers, [1]);
  assert.match(result.answer, /\[1\]/);
  assert.doesNotMatch(result.answer, /\[99\]/);
  assert.equal(result.citations, citations);
});

test('valid-only answers stay intact', () => {
  const result = downgradeInvalidCitations('结论来自 [1] 和 [2]。', [{}, {}]);
  assert.equal(result.citationIntegrity.status, 'ok');
  assert.equal(result.answer, '结论来自 [1] 和 [2]。');
  assert.equal(stripInvalidCitationMarkers('结论来自 [1] 和 [2]。', 2), '结论来自 [1] 和 [2]。');
});

test('bindAnswerCitations keeps only used sources and renumbers [n]', () => {
  const bound = bindAnswerCitations('结论见 [3]，补充见 [1]。库外 [99]。', [
    { documentId: 'doc-1', title: '一' },
    { documentId: 'doc-2', title: '二' },
    { documentId: 'doc-3', title: '三' }
  ]);
  assert.deepEqual(bound.citations.map(item => item.documentId), ['doc-3', 'doc-1']);
  assert.equal(bound.answer, '结论见 [1]，补充见 [2]。库外。');
  assert.equal(bound.citationIntegrity.usedCount, 2);
  const unused = bindAnswerCitations('这段没有标号。', [{ documentId: 'doc-1' }, { documentId: 'doc-2' }]);
  assert.deepEqual(unused.citations, []);
  const kept = bindAnswerCitations('这段没有标号。', [{ documentId: 'doc-1' }], { keepUncited: true });
  assert.equal(kept.citations.length, 1);
});

test('sentences that used invalid markers become uncovered claims', () => {
  const answer = '库内结论见 [1]。库外数字是 [99]。';
  assert.deepEqual(claimsWithInvalidCitations(answer, [99]), ['库外数字是 [99]。']);
});