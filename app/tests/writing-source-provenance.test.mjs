import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithEsbuild } from 'vite';

const writingSource = await readFile(new URL('../src/components/WritingWorkspace.jsx', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../src/components/WorkspaceModules.css', import.meta.url), 'utf8');
const imaCssSource = await readFile(new URL('../src/components/UnifiedWorkspaceIma.css', import.meta.url), 'utf8');

test('WritingWorkspace JSX compiles with source provenance controls', async () => {
  const result = await transformWithEsbuild(writingSource, 'WritingWorkspace.jsx', { loader: 'jsx', jsx: 'automatic' });
  assert.ok(result.code.length > 5000);
});

test('writing editor renders persisted sourceRefs and opens the exact document anchor', () => {
  for (const fragment of [
    "export function WritingModule({ onToast, initialDraftId = '', onOpenDocument })",
    "const sourceRefs = Array.isArray(draft?.sourceRefs) ? draft.sourceRefs : []",
    'className="writing-sources"',
    '{sourceRefs.length}',
    "disabled={!ref.documentId || typeof onOpenDocument !== 'function'}",
    'onOpenDocument?.({ ...ref, id: ref.documentId, documentId: ref.documentId',
    'ref.quote || ref.source || ref.kind || ref.type'
  ]) assert.ok(writingSource.includes(fragment), `missing ${fragment}`);
});

test('main wires writing provenance to the shared content reader', () => {
  assert.ok(mainSource.includes('initialDraftId={tab?.draftId || writingDeepLinkId} onOpenDocument={openContentReader}'));
  assert.ok(mainSource.includes("setReaderAnchor(String(hint?.anchor || hint?.sourceAnchor"));
});

test('writing autosave updates editable fields without erasing persisted sourceRefs', () => {
  assert.match(writingSource, /jsonOptions\('PATCH', \{ title: draft\.title, content: draft\.content, template: draft\.template, audience: draft\.audience, tone: draft\.tone \}\)/);
  assert.doesNotMatch(writingSource, /sourceRefs:\s*undefined/);
});

test('writing provenance remains a compact horizontal-workspace side panel', () => {
  assert.match(imaCssSource, /\.writing-layout\{grid-template-columns:minmax\(0,1fr\) minmax\(220px,240px\)/);
  assert.match(cssSource, /\.writing-sources button\{width:100%;display:flex;align-items:center/);
  assert.match(cssSource, /@media\(max-width:900px\)\{\.writing-layout,\.copilot-canvas\{grid-template-columns:1fr/);
});