import { isProblemNote } from './note-capture.js';

export const WORKSPACE_MODULES = Object.freeze({
  shell: {
    owns: Object.freeze(['rail', 'composer', 'tabs', 'context-overlay']),
    not: Object.freeze(['plaza', 'blog', 'calendar', 'whiteboard', 'ppt', 'image-gen'])
  },
  collect: { object: 'inbox', verb: 'ingest' },
  knowledge: { object: 'document', verb: 'read', ai: Object.freeze(['ask']) },
  notes: { object: 'page', verb: 'write', ai: Object.freeze(['ask', 'rewrite']) },
  writing: { object: 'draft', verb: 'compose', ai: Object.freeze(['ask', 'rewrite']) },
  copilot: { object: 'persona', verb: 'scope' },
  composer: { object: 'workspace', verb: 'ask' }
});

export const PAGE_AI_VERBS = Object.freeze({
  ask: 'ask',
  rewrite: 'rewrite'
});

export const PAGE_APPLY_MODES = Object.freeze({
  replace: 'replace',
  insert: 'insert',
  field: 'field'
});

export const PAPER_RHYTHM = Object.freeze({
  proseSize: '16px',
  proseLeading: '1.8',
  column: '720px',
  titleSize: '32px'
});

export function pageKind(note = {}) {
  return isProblemNote(note) ? 'problem' : 'note';
}

export function resolvePageSurface({
  kind = 'note',
  mode = 'edit',
  bodyFocused = false,
  content = '',
  slashOpen = false,
  wikiOpen = false,
  busy = false
} = {}) {
  const hasContent = Boolean(String(content || '').trim());
  if (kind === 'problem') {
    return {
      showSource: mode !== 'read',
      showPage: mode === 'read',
      reason: mode === 'read' ? 'problem-cards' : 'problem-fields'
    };
  }
  if (mode === 'read') return { showSource: false, showPage: hasContent, reason: 'read-page' };
  if (bodyFocused || slashOpen || wikiOpen || busy) {
    return { showSource: true, showPage: false, reason: hasContent ? 'type-on-paper' : 'typing' };
  }
  if (!hasContent) return { showSource: true, showPage: false, reason: 'blank-page' };
  return { showSource: false, showPage: true, reason: 'look-at-page' };
}

export function resolvePaperChrome({
  kind = 'note',
  mode = 'edit',
  bodyFocused = false,
  slashOpen = false,
  wikiOpen = false,
  webClipOpen = false,
  hasTags = false,
  tagsFocused = false
} = {}) {
  const paperEditing = kind === 'note' && mode !== 'read' && (bodyFocused || slashOpen || wikiOpen);
  return {
    paperEditing,
    showFormatToolbar: Boolean(webClipOpen),
    showTags: Boolean(hasTags || tagsFocused),
    lookAtPage: kind === 'note' && mode !== 'read' && !paperEditing
  };
}

export function resolvePageAiPlan({
  verb = PAGE_AI_VERBS.ask,
  kind = 'note',
  hasSelection = false,
  requestedMode = 'auto'
} = {}) {
  if (kind === 'problem' && verb === PAGE_AI_VERBS.ask) {
    return {
      verb,
      applyMode: PAGE_APPLY_MODES.field,
      field: requestedMode === 'resolution' ? 'resolution' : 'pitfall',
      autoWrite: requestedMode === 'auto'
    };
  }
  if (requestedMode === PAGE_APPLY_MODES.insert) {
    return { verb, applyMode: PAGE_APPLY_MODES.insert, field: 'note', autoWrite: false };
  }
  if (requestedMode === PAGE_APPLY_MODES.replace || (requestedMode === 'auto' && hasSelection)) {
    return { verb, applyMode: PAGE_APPLY_MODES.replace, field: 'note', autoWrite: false };
  }
  return { verb, applyMode: PAGE_APPLY_MODES.insert, field: 'note', autoWrite: false };
}

export function pageAiApplyLabel(plan = {}, { hasSelection = false, applied = false } = {}) {
  if (applied) {
    if (plan.field === 'pitfall') return '已写入容易忘的点';
    if (plan.field === 'resolution') return '已写入解决过程';
    return '已用上';
  }
  if (plan.applyMode === PAGE_APPLY_MODES.replace && hasSelection) return '替换选区';
  if (plan.field === 'pitfall') return '写入下次容易忘的点';
  if (plan.field === 'resolution') return '写入这次怎么解决的';
  return '用上';
}

export function normalizePageAiResult(value = '') {
  let text = String(value || '').trim();
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1].trim();
  const lines = text.split('\n');
  if (lines.length >= 3 && /^\s*---+\s*$/.test(lines[0]) && /^\s*---+\s*$/.test(lines.at(-1))) {
    text = lines.slice(1, -1).join('\n').trim();
  }
  return text;
}

export function applyPageAiResult({ content = '', result = '', range = {}, mode = 'replace' } = {}) {
  const source = String(content || '');
  const generated = normalizePageAiResult(result);
  if (!generated) throw new Error('AI 结果为空，暂时没有可写入的内容');
  const start = Math.max(0, Math.min(source.length, Number(range?.start) || 0));
  const end = Math.max(start, Math.min(source.length, Number(range?.end) || start));
  if (mode === PAGE_APPLY_MODES.replace || mode === 'replace') {
    return { content: `${source.slice(0, start)}${generated}${source.slice(end)}`, selection: { start, end: start + generated.length } };
  }
  if (mode !== PAGE_APPLY_MODES.insert && mode !== 'insert') throw new Error(`未知写入方式：${mode}`);
  const before = source.slice(0, end);
  const after = source.slice(end);
  const prefix = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = !after ? '' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  return {
    content: `${before}${prefix}${generated}${suffix}${after}`,
    selection: { start: end + prefix.length, end: end + prefix.length + generated.length }
  };
}

export function normalizePageAskSelection(page = {}, selection = null) {
  if (!selection || typeof selection !== 'object') return null;
  const quote = String(selection.quote || selection.text || '').trim();
  if (!quote && !selection.anchor) return null;
  const pageId = String(page.documentId || page.id || page.noteId || selection.documentId || selection.sourceId || '').trim();
  return {
    documentId: String(selection.documentId || selection.sourceId || pageId || ''),
    quote,
    text: quote,
    anchor: selection.anchor || null,
    startOffset: selection.startOffset ?? selection.start ?? null,
    endOffset: selection.endOffset ?? selection.end ?? null
  };
}

export function buildPageAskContext(page = {}, { selection = null, resources = [] } = {}) {
  const pageId = String(page.id || page.documentId || page.noteId || '').trim();
  const isNote = page.type === 'note' || Boolean(page.noteId) || pageKind(page) === 'problem';
  return {
    currentDocument: pageId ? {
      id: pageId,
      documentId: pageId,
      ...(isNote ? { noteId: page.noteId || pageId } : {}),
      title: page.title || (isNote ? '笔记' : '当前页'),
      type: isNote ? 'note' : (page.type || 'document'),
      source: page.source || (isNote ? '笔记' : '知识库')
    } : null,
    selection: normalizePageAskSelection(page, selection),
    resources: Array.isArray(resources) ? resources : []
  };
}
