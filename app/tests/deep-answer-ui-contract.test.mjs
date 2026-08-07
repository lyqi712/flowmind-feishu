import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const componentPath = resolve(here, '../src/components/DeepAnswerPanel.jsx');
const cssPath = resolve(here, '../src/components/DeepAnswerPanel.css');
const component = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

function includesAll(source, expected, label) {
  for (const fragment of expected) {
    assert.ok(source.includes(fragment), `${label}: missing ${fragment}`);
  }
}

test('DeepAnswerPanel keeps the standalone public component contract', () => {
  includesAll(component, [
    "import './DeepAnswerPanel.css'",
    'export function DeepAnswerPanel({ message = {}, busy = false, onFollowUp, onOpenDocument, onCreateArtifact })',
    'aria-label="深度回答分析"',
    'aria-busy={isBusy}'
  ], 'public component contract');
});

test('question understanding exposes intent, rewrite, plan and citation coverage', () => {
  includesAll(component, [
    '识别意图',
    '改写后的问题',
    '回答计划',
    '引用覆盖率',
    'role="progressbar"',
    'aria-valuenow={Math.round(coverage.percent)}',
    'message.rewrittenQuestion',
    'message.plan',
    'message?.citationCoverage'
  ], 'answer analysis');
});

test('knowledge discovery shows topics, entities and scored related document cards', () => {
  includesAll(component, [
    '知识线索',
    '相关主题',
    '相关实体',
    '相关文档',
    'document.reason',
    'document.score',
    'aria-label={`打开相关文档：${document.title}`}',
    'onClick={() => onOpenDocument?.(document, message)}'
  ], 'knowledge discovery');
});

test('synthesis includes consensus, conflicts and timeline', () => {
  includesAll(component, [
    'message.consensus',
    'message.conflicts',
    'message.timeline',
    'title="共识"',
    'title="冲突观点"',
    'title="时间线"',
    '<time>{item.date}</time>'
  ], 'synthesis sections');
});

test('follow-ups and artifact actions call the requested callbacks with accessible buttons', () => {
  includesAll(component, [
    '继续追问',
    'aria-label={`继续追问：${text}`}',
    'onClick={() => onFollowUp?.(text, message)}',
    'aria-label="将回答转为笔记"',
    'aria-label="将回答转为任务"',
    'aria-label="将回答转为写作草稿"',
    "onCreateArtifact?.(type, message)",
    "createArtifact('note')",
    "createArtifact('task')",
    "createArtifact('writing')",
    'disabled={isBusy}'
  ], 'actions');
});

test('desktop layout is compact, bounded and uses shrink-safe grids', () => {
  includesAll(css, [
    '.deep-answer-panel',
    'max-width: 100%',
    'min-width: 0',
    'overflow-x: clip',
    'grid-template-columns: minmax(0, 1.55fr) minmax(240px, .8fr)',
    'grid-template-columns: repeat(2, minmax(0, 1fr))',
    'grid-template-columns: repeat(3, minmax(0, 1fr))',
    'overflow-wrap: anywhere'
  ], 'desktop layout');
});

test('390px contract collapses every major area to one column without horizontal overflow', () => {
  const mobileStart = css.indexOf('@media (max-width: 390px)');
  assert.notEqual(mobileStart, -1, 'missing exact 390px breakpoint');
  const mobile = css.slice(mobileStart);
  includesAll(mobile, [
    'overflow-x: hidden',
    'width: 100%',
    'max-width: 100%',
    'grid-template-columns: minmax(0, 1fr)',
    '.deep-answer-plan ol',
    '.deep-answer-taxonomy',
    '.deep-answer-document-grid',
    '.deep-answer-insight-grid',
    '.deep-answer-follow-ups > div:last-child'
  ], '390px layout');
});
