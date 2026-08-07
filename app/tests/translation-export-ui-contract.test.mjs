import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const analysisSource = await readFile(new URL('../src/components/DocumentAnalysisWorkspace.jsx', import.meta.url), 'utf8');
const notesSource = await readFile(new URL('../src/components/NotesWorkspace.jsx', import.meta.url), 'utf8');
const sharedSource = await readFile(new URL('../src/components/WorkspaceModuleShared.jsx', import.meta.url), 'utf8');
const workspaceSource = [analysisSource, notesSource, sharedSource].join('\n');
const translationSource = await readFile(new URL('../src/components/TranslationWorkbench.jsx', import.meta.url), 'utf8');
const workspaceCss = await readFile(new URL('../src/components/WorkspaceModules.css', import.meta.url), 'utf8');

const copy = {
  autoDetect: '\u81ea\u52a8\u68c0\u6d4b',
  simplifiedChinese: '\u7b80\u4f53\u4e2d\u6587',
  sourceLanguage: '\u6e90\u8bed\u8a00',
  targetLanguage: '\u76ee\u6807\u8bed\u8a00',
  translationEngine: '\u7ffb\u8bd1\u5f15\u64ce',
  glossary: '\u672f\u8bed\u8868',
  currentModelProvider: '\u5f53\u524d\u6a21\u578b Provider',
  offlineDraft: '\u79bb\u7ebf\u53ef\u7f16\u8f91\u8349\u7a3f',
  backToReading: '\u8fd4\u56de\u9605\u8bfb',
  sideBySideTranslation: '\u5bf9\u7167\u7ffb\u8bd1',
  continueImport: '\u7ee7\u7eed\u5bfc\u5165',
  exportAnswer: '\u5bfc\u51fa\u56de\u7b54',
  backToSource: '\u8fd4\u56de\u539f\u6587',
  generateTranslation: '\u751f\u6210\u5bf9\u7167\u7ffb\u8bd1',
  saveChanges: '\u4fdd\u5b58\u4fee\u6539',
  copyTranslation: '\u590d\u5236\u8bd1\u6587'
};

function assertIncludesAll(source, values, contract) {
  for (const value of values) {
    assert.ok(source.includes(value), `${contract}: missing ${value}`);
  }
}

function maxWidthBlocks(source) {
  const blocks = [];
  const marker = /@media\(max-width:(\d+)px\)\{/g;
  for (const match of source.matchAll(marker)) {
    let depth = 1;
    let cursor = match.index + match[0].length;
    const bodyStart = cursor;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '{') depth += 1;
      if (source[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    blocks.push({ maxWidth: Number(match[1]), body: source.slice(bodyStart, cursor - 1) });
  }
  return blocks;
}

test('DocumentAnalysis imports and mounts TranslationWorkbench with persistent translation state', () => {
  assert.ok(workspaceSource.includes("import { TranslationWorkbench } from './TranslationWorkbench.jsx';"));
  assertIncludesAll(workspaceSource, [
    "const [translationOpen, setTranslationOpen] = useState(false)",
    'const [translations, setTranslations] = useState([])',
    'const [translation, setTranslation] = useState(null)',
    "const [translationBusy, setTranslationBusy] = useState('')",
    'const [translationDirty, setTranslationDirty] = useState(false)',
    `const [translationSettings, setTranslationSettings] = useState({ sourceLanguage: '${copy.autoDetect}', targetLanguage: '${copy.simplifiedChinese}', provider: 'auto', glossary: '' })`,
    'translationOpen ? <TranslationWorkbench',
    'translation={translation}',
    'translations={translations}',
    'busy={translationBusy}',
    'dirty={translationDirty}'
  ], 'translation state and mount');
});

test('translation generate and save actions use the translation APIs and preserve settings', () => {
  assertIncludesAll(workspaceSource, [
    'async function generateDocumentTranslation()',
    "request('/api/translations/generate', jsonOptions('POST', { documentId: detail.item.id, ...translationSettings }))",
    'async function saveDocumentTranslation()',
    "request('/api/translations/' + translation.id, jsonOptions('PATCH', { ...translationSettings, provider: translationSettings.provider === 'local' ? 'local' : (translation.provider || 'auto'), segments: translation.segments }))",
    'onGenerate={generateDocumentTranslation}',
    'onSave={saveDocumentTranslation}'
  ], 'translation generate/save API');

  assertIncludesAll(translationSource, [
    `<span>${copy.sourceLanguage}</span>`,
    `<span>${copy.targetLanguage}</span>`,
    `<span>${copy.translationEngine}</span>`,
    `<span>${copy.glossary}</span>`,
    'onChangeSettings({ sourceLanguage: event.target.value })',
    'onChangeSettings({ targetLanguage: event.target.value })',
    'onChangeSettings({ provider: event.target.value })',
    'onChangeSettings({ glossary: event.target.value })',
    `<option value="auto">${copy.currentModelProvider}</option>`,
    `<option value="local">${copy.offlineDraft}</option>`
  ], 'translation language/provider/glossary controls');
});

test('translation rows retain page, region and time anchors and locate the source reader', () => {
  assert.ok(translationSource.includes('function sameAnchor(left, right)'));
  assert.ok(translationSource.includes(String.raw`/(?:page:\d+:)?region:\d+|time:[\d.]+-[\d.]+|page:\d+(?::chars:[\d-]+)?|chars:\d+/`));
  assertIncludesAll(translationSource, [
    "className={sameAnchor(activeAnchor, row.anchor) ? 'active' : ''}",
    'onClick={() => onLocate?.(row.anchor, row.pageNumber)}',
    'onFocus={() => onLocate?.(row.anchor, row.pageNumber)}',
    'onUpdateSegment?.(index, event.target.value)'
  ], 'translation anchor interaction');
  assertIncludesAll(workspaceSource, [
    'activeAnchor={activeAnchor}',
    'onLocate={goToContentLocation}',
    'onUpdateSegment={updateTranslationSegment}'
  ], 'reader anchor bridge');
});

test('document, note, answer and translation expose Markdown and HTML exports', () => {
  assertIncludesAll(workspaceSource, [
    "downloadExport({ entityType: 'note', entityId: draft.id, format }, onToast)",
    "exportNote('markdown')",
    "exportNote('html')",
    "exportDocumentEntity('document', detail.item.id, 'markdown')",
    "exportDocumentEntity('document', detail.item.id, 'html')",
    "exportDocumentEntity('answer', '', 'markdown'",
    "exportDocumentEntity('answer', '', 'html'",
    "onExport={format => exportDocumentEntity('translation', translation?.id, format)}"
  ], 'entity export wiring');
  assertIncludesAll(translationSource, [
    "onClick={() => onExport?.('markdown')}",
    "onClick={() => onExport?.('html')}"
  ], 'translation export formats');
});

test('downloadExport creates a Blob URL, downloads the response filename and revokes the URL', () => {
  assertIncludesAll(workspaceSource, [
    "fetch('/api/exports/render', jsonOptions('POST', payload))",
    "response.headers.get('content-disposition')",
    "disposition.match(/filename\\*=UTF-8''([^;]+)/i)",
    'URL.createObjectURL(await response.blob())',
    "document.createElement('a')",
    'link.download = fileName',
    'link.click()',
    'URL.revokeObjectURL(url)'
  ], 'Blob download flow');
});

test('translation CSS provides two-column desktop and responsive 680px/390px layouts', () => {
  assertIncludesAll(workspaceCss, [
    '.translation-workbench',
    '.translation-controls',
    '.translation-table-head,.translation-table article{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)',
    '.translation-source',
    '.translation-target',
    '.answer-export-actions',
    '@media(max-width:680px)'
  ], 'translation responsive CSS');

  const at680 = maxWidthBlocks(workspaceCss).filter(block => block.maxWidth === 680).map(block => block.body).join('\n');
  assert.ok(at680, 'missing max-width:680px translation breakpoint');
  assertIncludesAll(at680, [
    '.translation-controls{grid-template-columns:minmax(0,1fr)',
    '.translation-table-head{display:none}',
    '.translation-table article{grid-template-columns:minmax(0,1fr)',
    '.translation-table{padding:0 10px 12px;overflow-x:hidden'
  ], '680px translation layout');

  assert.ok(390 <= 680, '390px viewport must be covered by the 680px breakpoint');
  assert.ok(at680.includes('.translation-table article{grid-template-columns:minmax(0,1fr)'), '390px viewport must inherit the single-column translation rows');
  assert.ok(at680.includes('.translation-actions button{flex:1 1 calc(50% - 6px)'), '390px viewport must inherit wrapping translation actions');
});

test('translation and export entry points expose the expected button copy', () => {
  assertIncludesAll(workspaceSource, [
    `translationOpen ? '${copy.backToReading}' : '${copy.sideBySideTranslation}'`,
    `>${copy.continueImport}</button>`,
    `>${copy.exportAnswer} MD</button>`,
    `>${copy.exportAnswer} HTML</button>`,
    '<FileDown size={16}/>MD</button>',
    '<FileDown size={16}/>HTML</button>'
  ], 'workspace button copy');
  assertIncludesAll(translationSource, [
    `<b>${copy.sideBySideTranslation}</b>`,
    `title="${copy.backToSource}"`,
    `}${copy.generateTranslation}</button>`,
    `}${copy.saveChanges}</button>`,
    `/>${copy.copyTranslation}</button>`,
    '<Download size={15}/>Markdown</button>',
    '<Download size={15}/>HTML</button>'
  ], 'translation button copy');
});
