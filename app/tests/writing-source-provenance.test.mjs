import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithEsbuild } from 'vite';

const writingSource = await readFile(new URL('../src/components/WritingWorkspace.jsx', import.meta.url), 'utf8');
const writingAiSupportSource = await readFile(new URL('../src/components/WritingAiSupport.jsx', import.meta.url), 'utf8');
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
    '选 1–3 篇再生成',
    'attachWritingSource',
    "disabled={!ref.documentId || typeof onOpenDocument !== 'function'}",
    'onOpenDocument?.({ ...ref, id: ref.documentId, documentId: ref.documentId',
    'ref.quote || ref.source || ref.kind || ref.type'
  ]) assert.ok(writingSource.includes(fragment), `missing ${fragment}`);
});

test('main wires writing provenance to the shared content reader', () => {
  assert.ok(mainSource.includes('initialDraftId={tab?.draftId || writingDeepLinkId} onOpenDocument={openContentReader}'));
  assert.ok(mainSource.includes("setReaderAnchor(String(hint?.anchor || hint?.sourceAnchor"));
});

test('writing autosave persists a complete immutable snapshot', () => {
  assert.match(writingSource, /writingSaveSnapshot\(draft\)/);
  assert.match(writingSource, /jsonOptions\('PATCH', \{\s*title: snapshot\.title,\s*content: snapshot\.content,\s*template: snapshot\.template,\s*audience: snapshot\.audience,\s*tone: snapshot\.tone,\s*sourceRefs: snapshot\.sourceRefs/);
  assert.match(writingSource, /editRevisionRef/);
  assert.match(writingSource, /saveRequestRef/);
  assert.match(writingSource, /requestId !== saveRequestRef\.current \|\| editRevisionRef\.current !== revision/);
  assert.doesNotMatch(writingSource, /sourceRefs:\s*undefined/);
});

test('writing provenance remains a compact horizontal-workspace side panel', () => {
  assert.match(imaCssSource, /\.writing-layout\{grid-template-columns:minmax\(0,1fr\) minmax\(220px,240px\)/);
  assert.match(cssSource, /\.writing-sources button\{width:100%;display:flex;align-items:center/);
  assert.match(cssSource, /\.writing-ai-toolbar\{display:flex/);
  assert.match(cssSource, /@media\(max-width:900px\)\{\.writing-layout,\.copilot-canvas\{grid-template-columns:1fr/);
});

test('writing workspace keeps AI generation transactional and exposes save recovery', () => {
  const workflowSource = `${writingSource}\n${writingAiSupportSource}`;
  for (const fragment of [
    "from './WritingAiSupport.jsx'",
    'buildWritingAiPrompt',
    'readWritingAiStream',
    'WritingAiPanel',
    'currentWritingSnapshot',
    '生成期间草稿已经变化',
    'mergeWritingSourceRefs',
    'writingSaveSnapshot',
    'editRevisionRef',
    'saveRequestRef',
    'requestId !== saveRequestRef.current || editRevisionRef.current !== revision',
    'sourceRefs: snapshot.sourceRefs',
    '保存失败，草稿仍保留在当前页面',
    '重试保存',
    '只有你点击应用后才会修改草稿',
    'onOpenSource={ref =>',
    '<Link2 size={13}/>{label}'
  ]) assert.ok(workflowSource.includes(fragment), `missing writing workflow contract: ${fragment}`);
});