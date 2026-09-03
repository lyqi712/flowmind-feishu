import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithEsbuild } from 'vite';

const source = await readFile(new URL('../src/components/NotesWorkspace.jsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/components/WorkspaceModules.css', import.meta.url), 'utf8');

test('NotesWorkspace JSX compiles with Markdown note reader', async () => {
  const result = await transformWithEsbuild(source, 'NotesWorkspace.jsx', { loader: 'jsx', jsx: 'automatic' });
  assert.ok(result.code.length > 1000);
});

test('notes expose distinct edit and read modes with sanitized GFM rendering', () => {
  assert.match(source, /const \[mode, setMode\] = useState\('edit'\)/);
  assert.match(source, /<ReactMarkdown remarkPlugins=\{\[remarkGfm\]\} rehypePlugins=\{\[rehypeSanitize\]\}/);
  assert.match(source, />编辑<\/button>/);
  assert.match(source, />阅读<\/button>/);
});

test('notes support markdown tools, wiki links, backlinks and source return', () => {
  assert.match(source, /applyMarkdown\('\[\[', '\]\]'/);
  assert.match(source, /const backlinks = useMemo/);
  assert.match(source, /onOpenDocument\?\.\(\{ \.\.\.ref, id: ref\.documentId, documentId: ref\.documentId \}\)/);
  assert.match(source, /sourceRefs: snapshot\.sourceRefs/);
});

test('note relation layout adapts to narrow workspaces', () => {
  assert.match(css, /\.note-workspace-grid/);
  assert.match(css, /\.note-workspace-grid\.is-writing-only/);
  assert.match(css, /\.note-relations-panel/);
  assert.match(css, /@media \(max-width:900px\)/);
});

test('empty relation rail stays hidden until there is something to show', () => {
  assert.match(source, /noteHasVisibleRelations/);
  assert.match(source, /showRelations \? <aside className="note-relations-panel">/);
  assert.match(source, /noteListPreview\(note.content\)|noteListAnswerPreview\(note\)/);
});

test('note workspace can open a Friday-style assistant rail beside the editor', () => {
  assert.match(source, /const \[assistantOpen, setAssistantOpen\] = useState\(false\)/);
  assert.match(source, /FlowMind 助手/);
  assert.match(source, /note-assistant-panel/);
  assert.match(source, /note-assistant-composer/);
  assert.match(source, /\/api\/agent\/run/);
  assert.match(source, /readNoteAssistantStream/);
  assert.match(source, /createStreamEventBatcher/);
  assert.match(source, /在这篇里问/);
  assert.match(source, /到对话里继续/);
  assert.match(source, /runAssistantAction/);
  assert.match(css, /\.note-workspace-grid\.is-with-assistant/);
  assert.match(css, /\.note-assistant-panel/);
  assert.match(css, /\.note-assistant-composer/);
  assert.match(css, /\.note-problem-hint/);
  assert.match(source, /note-kind-tabs/);
  assert.doesNotMatch(source, />当前<\/button>/);
  assert.match(source, />已归档<\/button>/);
  assert.match(source, /note-side/);
  assert.match(source, /note-editor-toolbar/);
  assert.match(source, /title=\{noteListAnswerPreview\(note\)\}/);
  assert.match(source, /note-qa-editor/);
  assert.match(source, /serializeQaNote/);
  assert.match(source, /新建问题记录/);
  assert.match(source, /note-selection-bubble/);
  assert.match(source, /note-qa-card/);
  assert.match(css, /\.note-selection-bubble/);
  assert.match(css, /\.note-qa-card/);
});

test('note editor keeps a live preview, heading outline and wiki title completion next to the source', () => {
  assert.match(source, /function noteHeadingOutline/);
  assert.match(source, /function notePreviewHeadingComponents/);
  assert.match(source, /const \[previewOpen, setPreviewOpen\] = useState\(false\)/);
  assert.match(source, /const \[relationsOpen, setRelationsOpen\] = useState\(false\)/);
  assert.match(source, /对照预览/);
  assert.match(source, /previewOpen \? 'note-split-editor' : 'note-source-only'/);
  assert.match(source, /relationsAvailable && relationsOpen/);
  assert.match(source, /复制双链/);
  assert.match(source, /document\.execCommand\('copy'\)/);
  assert.match(source, /note-more/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /wikiSuggestIndex/);
  assert.match(source, /className="note-wiki-suggest"/);
  assert.match(source, /aria-label="双向链接补全"/);
  assert.match(source, /aria-label="笔记预览"/);
  assert.match(source, /syncWikiSuggest/);
  assert.match(source, /insertWikiTitle/);
  assert.match(source, /jumpToNoteHeading/);
  assert.match(source, /linkCandidates/);
  assert.match(css, /\.note-split-editor/);
  assert.match(css, /\.note-source-only/);
  assert.match(css, /\.note-wiki-suggest/);
  assert.match(css, /\.note-live-preview/);
  assert.match(css, /\.note-outline-link/);
});

test('notes integrate real local image and file insertion without creating a separate media workspace', () => {
  assert.match(source, /\/api\/notes\/\$\{encodeURIComponent\(draft\.id\)\}\/attachments/);
  assert.match(source, /accept="image\/\*"/);
  assert.match(source, /\}图片<\/button>/);
  assert.match(source, /\}文件<\/button>/);
  assert.match(source, /className="note-inline-image"/);
  assert.match(source, /className="note-attachments-section"/);
  assert.doesNotMatch(source, /AI 生图|图片生成|媒体工作台|PPT|博客/);
  assert.match(css, /\.markdown-toolbar\{display:flex;flex-flow:row nowrap/);
  assert.match(css, /\.note-inline-image/);
  assert.match(css, /\.note-attachment-row/);
});