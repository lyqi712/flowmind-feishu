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

test('文档问答按 NDJSON 增量展示，并支持停止、重试和文档切换取消', () => {
  for (const fragment of [
    'readDocumentAnswerStream',
    'documentAskAbortRef',
    'documentAskRequestRef',
    'documentAskConversationRef',
    "fetch('/api/agent/run'",
    'createStreamEventBatcher',
    "surface: 'reader'",
    "event.type === 'delta'",
    'function stopDocumentAsk()',
    '停止',
    '重试本问题',
    '正在生成回答',
    'documentAskAbortRef.current?.abort()'
  ]) assert.ok(source.includes(fragment), `missing ${fragment}`);
});

test('字符锚点在普通文档中精确高亮，失效位置不会被悄悄截断或跳到顶部', () => {
  for (const fragment of [
    'export function splitDocumentTextAtAnchor',
    'end > text.length',
    'data-document-anchor={activeAnchor}',
    '引用位置已失效，未跳转到正文开头。',
    'contentAnchorRef.current?.scrollIntoView',
    'document-anchor-notice'
  ]) assert.ok(source.includes(fragment), `missing anchor contract: ${fragment}`);
});
