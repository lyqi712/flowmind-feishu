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
  assert.match(source, /onOpenDocument\?\.\(ref\.documentId\)/);
  assert.match(source, /sourceRefs: draft\.sourceRefs \|\| \[\]/);
});

test('note relation layout adapts to narrow workspaces', () => {
  assert.match(css, /\.note-workspace-grid/);
  assert.match(css, /\.note-relations-panel/);
  assert.match(css, /@media \(max-width:900px\)/);
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