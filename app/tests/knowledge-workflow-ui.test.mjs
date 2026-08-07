import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithEsbuild } from 'vite';
const source = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');

test('main JSX compiles after unified knowledge workflow integration', async () => {
  const result = await transformWithEsbuild(source, 'main.jsx', { loader: 'jsx', jsx: 'automatic' });
  assert.ok(result.code.length > 1000);
});

test('startup and sync use the unified ContentItem projection', () => {
  assert.match(source, /fetch\('\/api\/content\/items\?limit=500'\)/);
  assert.ok(source.includes('const documents = contentItems || next.documents || [];'));
  assert.ok(source.includes('setState({ ...next, documents,'));
  assert.match(source, /await refreshContentItems\(\)/);
  assert.match(source, /refreshContentItems\(\)\.catch\(error => notify/);
});

test('document title opens the reader while a separate control changes question scope', () => {
  assert.match(source, /className="doc-open" onClick=\{\(\) => onOpenDocument\?\.\(doc\)\}/);
  assert.match(source, /className="doc-scope-toggle"/);
  assert.match(source, /<ContentReader item=\{readerDetail\.item\}/);
});

test('reader source notes preserve sourceRefs and notes can return to the source', () => {
  assert.match(source, /const sourceRef = \{ documentId: item\?\.id, title: item\?\.title, url: sourceUrl/);
  assert.match(source, /sourceRefs: \[sourceRef\]/);
  assert.match(source, /quote, selection: true, startOffset: selection\?\.startOffset, endOffset: selection\?\.endOffset/);
  assert.match(source, /<NotesModule onToast=\{notify\} onOpenDocument=\{openContentReader\}/);
});
