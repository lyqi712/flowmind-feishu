function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function itemId(item) {
  return cleanText(item?.documentId || item?.resourceId || item?.sourceId || item?.id);
}

function itemTime(item) {
  const raw = item?.updatedAt || item?.modifiedAt || item?.lastModifiedAt || item?.createdAt || item?.syncedAt || 0;
  const parsed = typeof raw === 'number' ? raw : Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function documentRecentItem(document) {
  const id = itemId(document);
  if (!id) return null;
  return {
    id: `document-${id}`,
    kind: 'document',
    type: 'document',
    documentId: id,
    resourceId: id,
    title: cleanText(document.title) || '未命名文档',
    summary: cleanText(document.summary || document.excerpt || document.content).slice(0, 120),
    source: cleanText(document.source || document.sourceType) || '知识库',
    updatedAt: document.updatedAt || document.modifiedAt || document.lastModifiedAt || document.syncedAt || document.createdAt || null
  };
}

function resourceFromDocument(document) {
  const id = itemId(document);
  if (!id) return null;
  return {
    id: `context-document-${id}`,
    kind: 'document',
    type: 'document',
    documentId: id,
    sourceId: id,
    title: cleanText(document.title) || '未命名文档',
    source: cleanText(document.source || document.sourceType) || '知识库'
  };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function contextSourceRef(item, { selection = false } = {}) {
  if (!item || typeof item !== 'object') return null;
  const kind = cleanText(item.kind || item.type);
  const documentId = cleanText(item.documentId || ((kind === 'document' || item.type === 'document') ? itemId(item) : ''));
  const sourceId = cleanText(item.sourceId || item.resourceId || (!documentId ? item.id : ''));
  const title = cleanText(item.title || item.name);
  const source = cleanText(item.source || item.sourceType);
  const url = cleanText(item.url || item.sourceUrl);
  const anchor = cleanText(item.anchor || item.sourceAnchor || item.location?.anchor);
  const quote = selection ? cleanText(item.quote || item.text || item.snippet) : cleanText(item.quote || item.snippet);
  const type = cleanText(item.type);
  const ref = {};
  if (documentId) ref.documentId = documentId;
  if (sourceId && sourceId !== documentId) ref.sourceId = sourceId;
  if (title) ref.title = title;
  if (source) ref.source = source;
  if (kind) ref.kind = kind;
  if (type && type !== kind) ref.type = type;
  if (url) ref.url = url;
  if (anchor) ref.anchor = anchor;
  if (quote) ref.quote = quote;
  if (selection) ref.selection = true;
  const startOffset = finiteNumber(item.startOffset);
  const endOffset = finiteNumber(item.endOffset);
  const pageNumber = finiteNumber(item.pageNumber || item.page);
  const timeStart = finiteNumber(item.timeStart);
  const timeEnd = finiteNumber(item.timeEnd);
  if (startOffset !== null) ref.startOffset = startOffset;
  if (endOffset !== null) ref.endOffset = endOffset;
  if (pageNumber !== null) ref.pageNumber = pageNumber;
  if (timeStart !== null) ref.timeStart = timeStart;
  if (timeEnd !== null) ref.timeEnd = timeEnd;
  if (item.region && typeof item.region === 'object') ref.region = item.region;
  return Object.keys(ref).length ? ref : null;
}

function sourceRefIdentity(ref) {
  if (ref?.documentId) return `document:${ref.documentId}`;
  if (ref?.sourceId) return `source:${ref.sourceId}`;
  if (ref?.url) return `url:${ref.url}`;
  return ref?.title ? `title:${cleanText(ref.title).toLowerCase()}` : '';
}

export function normalizeWorkspaceSourceRefs(context = {}) {
  const refs = [];
  const indexByIdentity = new Map();
  function add(item, options) {
    const ref = contextSourceRef(item, options);
    const identity = sourceRefIdentity(ref);
    if (!ref || !identity) return;
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex !== undefined) {
      const existing = refs[existingIndex];
      refs[existingIndex] = options?.selection ? {
        ...existing,
        ...ref,
        ...(existing.title ? { title: existing.title } : {}),
        ...(existing.source ? { source: existing.source } : {}),
        ...(existing.kind ? { kind: existing.kind } : {}),
        ...(existing.type ? { type: existing.type } : {}),
        ...(existing.url ? { url: existing.url } : {})
      } : { ...ref, ...existing };
      return;
    }
    indexByIdentity.set(identity, refs.length);
    refs.push(ref);
  }
  add(context.currentDocument);
  add(context.selection, { selection: true });
  for (const resource of asArray(context.resources)) add(resource);
  return refs;
}

export function buildWorkspaceContextNote(context = {}) {
  const sourceRefs = normalizeWorkspaceSourceRefs(context);
  const selectionText = cleanText(context.selection?.quote || context.selection?.text || context.selection?.snippet);
  const primary = context.currentDocument || asArray(context.resources).find(item => cleanText(item?.title)) || sourceRefs[0] || null;
  const rawSubject = cleanText(primary?.title) || '飞书知识';
  const subject = rawSubject.length > 56 ? `${rawSubject.slice(0, 56)}…` : rawSubject;
  const title = `${subject} · 工作笔记`;
  const content = [
    `# ${title}`,
    '',
    '## 摘要',
    '',
    ...(selectionText ? ['## 当前选区', '', ...selectionText.split(/\r?\n/).map(line => `> ${line}`), ''] : []),
    '## 关键观点',
    '',
    '- ',
    '',
    '## 行动项',
    '',
    '- [ ] ',
    ''
  ].join('\n');
  return {
    title,
    content,
    tags: [...new Set(['来源笔记', selectionText ? '选区笔记' : '飞书知识'])],
    sourceRefs
  };
}

export function buildWorkspaceContextWritingDraft(context = {}) {
  const sourceRefs = normalizeWorkspaceSourceRefs(context);
  const selectionText = cleanText(context.selection?.quote || context.selection?.text || context.selection?.snippet);
  const primary = context.currentDocument || asArray(context.resources).find(item => cleanText(item?.title)) || sourceRefs[0] || null;
  const rawSubject = cleanText(primary?.title) || '飞书知识';
  const subject = rawSubject.length > 48 ? `${rawSubject.slice(0, 48)}\u2026` : rawSubject;
  return {
    title: `${subject} \u00b7 \u5199\u4f5c\u8349\u7a3f`,
    content: selectionText ? `# ${subject}

> ${selectionText.split(/\r?\n/).join("\n> ")}

## 正文

` : `# ${subject}

## 正文

`,
    template: 'freeform',
    audience: '',
    tone: '专业',
    sourceRefs
  };
}

export function deriveWorkspaceRecentItems({ recentWork = [], documents = [], limit = 8 } = {}) {
  const normalizedLimit = Math.max(1, Number(limit) || 8);
  const candidates = [
    ...asArray(recentWork).map(item => ({ ...item, __time: itemTime(item), __priority: 2 })),
    ...asArray(documents).map(documentRecentItem).filter(Boolean).map(item => ({ ...item, __time: itemTime(item), __priority: 1 }))
  ].sort((left, right) => right.__time - left.__time || right.__priority - left.__priority);

  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    const identity = itemId(candidate) || cleanText(candidate.title).toLowerCase();
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    const { __time, __priority, ...item } = candidate;
    result.push(item);
    if (result.length >= normalizedLimit) break;
  }
  return result;
}

export function deriveWorkspaceContext({
  currentDocument = null,
  aiContextItems = [],
  selectedDocumentIds = [],
  documents = [],
  activeRoute = 'home',
  knowledgeBase = null,
  excludedDocumentId = ''
} = {}) {
  const selection = asArray(aiContextItems).find(item => item?.kind === 'selection') || null;
  const explicitResources = asArray(aiContextItems).filter(item => item?.kind !== 'selection');
  const documentMap = new Map(asArray(documents).map(document => [itemId(document), document]));
  const selectedResources = asArray(selectedDocumentIds)
    .map(id => documentMap.get(cleanText(id)))
    .map(resourceFromDocument)
    .filter(Boolean);

  const resources = [];
  const seen = new Set();
  for (const resource of [...explicitResources, ...selectedResources]) {
    const identity = itemId(resource) || cleanText(resource?.title).toLowerCase();
    if (!identity || identity === itemId(currentDocument) || seen.has(identity)) continue;
    seen.add(identity);
    resources.push(resource);
  }

  const knowledgeRoutes = new Set(['home', 'knowledge', 'notes', 'copilots', 'skills', 'analysis', 'writing']);
  if (!currentDocument && resources.length === 0 && knowledgeRoutes.has(activeRoute) && knowledgeBase) {
    resources.push({
      id: `knowledge-base-${cleanText(knowledgeBase.id) || 'current'}`,
      kind: 'knowledge-base',
      type: `${Number(knowledgeBase.documentCount || documents.length || 0)} 篇文档`,
      title: cleanText(knowledgeBase.name) || '整个知识库',
      source: cleanText(knowledgeBase.source) === 'feishu' ? '飞书知识库' : '知识库',
      removable: false
    });
  }

  return {
    currentDocument: itemId(currentDocument) === cleanText(excludedDocumentId) ? null : currentDocument,
    selection,
    resources
  };
}
