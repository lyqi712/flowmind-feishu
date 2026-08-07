import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/components/DocumentAnalysisWorkspace.jsx', import.meta.url), 'utf8');

test('DocumentAnalysisModule accepts a knowledge-library deep link and opens it on first load', () => {
  assert.match(source, /DocumentAnalysisModule\(\{ onToast, initialDocumentId = '' \}\)/);
  assert.match(source, /loadItems\(initialDocumentId\)/);
});

test('DocumentAnalysisModule reacts when the library opens another document without remounting', () => {
  assert.match(source, /if \(initialDocumentId && initialDocumentId !== selectedId\) openItem\(initialDocumentId\)/);
  assert.match(source, /\[initialDocumentId\]\);/);
});
