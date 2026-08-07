import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const analysisSource = await readFile(new URL('../src/components/DocumentAnalysisWorkspace.jsx', import.meta.url), 'utf8');
const notesSource = await readFile(new URL('../src/components/NotesWorkspace.jsx', import.meta.url), 'utf8');
const workspaceSource = [analysisSource, notesSource].join('\n');
const viewerSource = await readFile(new URL('../src/components/AudioTranscriptViewer.jsx', import.meta.url), 'utf8');
const workspaceCss = await readFile(new URL('../src/components/WorkspaceModules.css', import.meta.url), 'utf8');

function acceptedExtensions() {
  const match = workspaceSource.match(/accept="([^"]+)"/);
  assert.ok(match, 'document import input must expose an accept contract');
  return new Set(match[1].split(',').map(value => value.trim().toLowerCase()));
}

test('audio import accepts MP3, M4A, WAV and AAC', () => {
  const accepted = acceptedExtensions();
  for (const extension of ['.mp3', '.m4a', '.wav', '.aac']) {
    assert.ok(accepted.has(extension), `missing audio accept extension: ${extension}`);
  }
});

test('document analysis mounts AudioTranscriptViewer with source, segments and active anchor', () => {
  assert.ok(workspaceSource.includes("lazy(() => import('./AudioTranscriptViewer.jsx')"));
  assert.ok(workspaceSource.includes("const isAudio = detail?.item?.contentType === 'audio'"));
  assert.ok(workspaceSource.includes('className="audio-reader-shell"'));
  assert.match(workspaceSource, /<AudioTranscriptViewer[\s\S]{0,700}segments=\{audioSegments\}/);
  assert.match(workspaceSource, /<AudioTranscriptViewer[\s\S]{0,700}activeAnchor=\{activeAnchor\}/);
  assert.match(workspaceSource, /<AudioTranscriptViewer[\s\S]{0,700}onAnchorChange=\{anchor => setActiveAnchor\(anchor\)\}/);
});

test('segment, chunk and citation time anchors drive player seek', () => {
  assert.ok(viewerSource.includes('function secondsFromAnchor(anchor)'));
  assert.ok(viewerSource.includes('audioRef.current.currentTime = seconds'));
  assert.ok(viewerSource.includes('audioRef.current.play().catch'));
  assert.ok(viewerSource.includes('audioRef.current.currentTime - target.timeStart'));
  assert.ok(viewerSource.includes('onClick={() => seek(entry.anchor)}'));

  assert.ok(workspaceSource.includes(String.raw`time:[\d.]+-[\d.]+`), 'workspace locator must recognize time:start-end anchors');
  assert.ok(workspaceSource.includes('if (normalizedAnchor) setActiveAnchor(normalizedAnchor)'));
  assert.ok(workspaceSource.includes('if ((isImage || isAudio) && region) return'));
  assert.ok(workspaceSource.includes('if (pageNumber || anchorPage) goToPdfPage(pageNumber || anchorPage)'));
  assert.match(workspaceSource, /answer\.citations\?\.length[\s\S]{0,1000}goToContentLocation\(citation\.anchor, citation\.pageNumber\)/);
  assert.match(workspaceSource, /className="chunk-list"[\s\S]{0,1600}onClick=\{\(\) => goToContentLocation\(anchor, chunk\.metadata\?\.pageNumber\)\}/);
});

test('confidence values in the 0-1 range are rendered as percentages', () => {
  assert.ok(viewerSource.includes('numeric <= 1 ? numeric * 100 : numeric'));
  assert.ok(viewerSource.includes('Math.round(numeric <= 1 ? numeric * 100 : numeric)}%'));
  assert.ok(viewerSource.includes('className="audio-segment-confidence"'));
});

test('audio minutes and action-item entry points connect to the existing note save channel', () => {
  assert.ok(workspaceSource.includes('className="audio-quick-actions"'));
  assert.ok(workspaceSource.includes('>生成本地纪要</button>'));
  assert.ok(workspaceSource.includes('function generateAudioMinutes()'));
  assert.ok(workspaceSource.includes('className="audio-minutes-panel"'));
  assert.ok(workspaceSource.includes('>AI 深度整理</button>'));
  assert.ok(workspaceSource.includes('placeholder="记录负责人、截止时间和对应时间戳…"'));
  assert.ok(workspaceSource.includes("request('/api/notes', jsonOptions('POST'"));
  assert.ok(workspaceSource.includes('async function saveNote('));
  assert.ok(workspaceSource.includes('}保存</button>'));
});

test('audio reader CSS covers desktop, 390px mobile, focus and minutes editing states', () => {
  const selectors = [
    '.audio-document-reader',
    '.audio-reader-shell',
    '.audio-page-stage',
    '.audio-transcript-viewer',
    '.audio-transcript-meta',
    '.audio-segment-list',
    '.audio-segment-time',
    '.audio-segment-body',
    '.audio-segment-confidence',
    '.audio-quick-actions',
    '.audio-minutes-panel',
    '.audio-minutes-head',
    '.audio-minutes-editor',
    '.audio-minutes-field',
    '.audio-action-items',
    '.audio-minutes-actions',
    '.audio-minutes-save'
  ];
  for (const selector of selectors) assert.ok(workspaceCss.includes(selector), `missing CSS selector: ${selector}`);
  assert.ok(workspaceCss.includes('.audio-segment-list>button:focus-visible'));
  assert.ok(workspaceCss.includes('.audio-segment-list>button.active'));
  assert.ok(workspaceCss.includes('@media(max-width:680px)'));
  assert.ok(workspaceCss.includes('@media(max-width:420px)'));
  assert.ok(workspaceCss.includes('.audio-page-stage{overflow-x:hidden'));
  assert.ok(workspaceCss.includes('.audio-minutes-save{width:100%'));
});