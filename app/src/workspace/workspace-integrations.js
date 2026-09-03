import { plainPreview } from './note-capture.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function itemId(item) {
  return cleanText(item?.documentId || item?.resourceId || item?.sourceId || item?.id);
}

function parseTime(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function itemTime(item) {
  const raw = item?.lastUsedAt ?? item?.lastOpenedAt ?? item?.updatedAt ?? item?.modifiedAt ?? item?.lastModifiedAt ?? item?.createdAt ?? item?.syncedAt ?? 0;
  return parseTime(raw) ?? 0;
}

const UNFINISHED_TASK_STATUSES = new Set(['queued', 'running', 'paused', 'failed', 'pending', 'waiting', 'processing', 'error']);
const TASK_STATUS_ALIASES = new Map([
  ['waiting', 'queued'], ['pending', 'queued'], ['queue', 'queued'], ['queued', 'queued'],
  ['processing', 'running'], ['loading', 'running'], ['active', 'running'], ['running', 'running'],
  ['success', 'completed'], ['complete', 'completed'], ['completed', 'completed'], ['done', 'completed'], ['succeeded', 'completed'],
  ['cancelled', 'cancelled'], ['canceled', 'cancelled'], ['aborted', 'cancelled'],
  ['error', 'failed'], ['failure', 'failed'], ['failed', 'failed'], ['paused', 'paused']
]);

function normalizeTaskStatus(value) {
  const raw = cleanText(value).toLowerCase();
  return TASK_STATUS_ALIASES.get(raw) || (raw || 'queued');
}

function taskIsUnfinished(task) {
  const raw = cleanText(task?.status).toLowerCase();
  return UNFINISHED_TASK_STATUSES.has(raw) || ['queued', 'running', 'paused', 'failed'].includes(normalizeTaskStatus(raw));
}

function addKeys(target, values) {
  const list = Array.isArray(values) ? values : [values];
  for (const value of list) {
    const key = cleanText(value);
    if (key) target.add(key);
  }
  return target;
}

function libraryAliases(item) {
  return [...addKeys(new Set(), [item?.id, item?.libraryId, item?.knowledgeBaseId, item?.spaceId, item?.externalId])];
}

function documentResourceKeys(item) {
  const keys = new Set();
  addKeys(keys, [item?.documentId, item?.resourceId, item?.noteId, item?.draftId, item?.sourceId]);
  addKeys(keys, item?.documentIds);
  for (const ref of asArray(item?.sourceRefs)) addKeys(keys, [ref?.documentId, ref?.sourceId, ref?.resourceId]);
  if (['document', 'note', 'writing'].includes(cleanText(item?.kind || item?.type))) addKeys(keys, [item?.id]);
  return keys;
}

function taskResourceKeys(task) {
  const keys = new Set();
  addKeys(keys, [task?.documentId, task?.resourceId, task?.noteId, task?.draftId, task?.resultId]);
  addKeys(keys, task?.documentIds);
  return keys;
}

function itemLibraryKeys(item, documentsById) {
  const keys = new Set();
  addKeys(keys, [item?.libraryId, item?.knowledgeBaseId, item?.knowledgeLibraryId, item?.spaceId]);
  for (const resourceId of documentResourceKeys(item)) {
    const document = documentsById.get(resourceId);
    if (document) addKeys(keys, [document.knowledgeBaseId, document.libraryId, document.spaceId, document.knowledgeLibraryId]);
  }
  return keys;
}

function followedLibraryInfo(libraries, followedLibraryIds) {
  const followed = new Set(asArray(followedLibraryIds).map(value => cleanText(value)).filter(Boolean));
  const names = new Map();
  for (const library of asArray(libraries)) {
    const aliases = libraryAliases(library);
    if (library?.followed === true) aliases.forEach(alias => followed.add(alias));
    aliases.forEach(alias => names.set(alias, cleanText(library.name)));
  }
  return { followed, names };
}

export function workspaceTaskRoute(taskOrType) {
  const type = cleanText(typeof taskOrType === 'string'
    ? taskOrType
    : taskOrType?.taskType || taskOrType?.type).toLowerCase();
  if (type === 'skill') return 'skills';
  if (type === 'recording') return 'recording';
  if (['sync', 'feishu-sync'].includes(type)) return 'sync';
  if (['import', 'file-import', 'upload'].includes(type)) return 'collect';
  return 'knowledge';
}

function taskCandidate(task, index) {
  if (!taskIsUnfinished(task)) return null;
  const taskId = cleanText(task?.id);
  if (!taskId) return null;
  const taskType = cleanText(task?.type) || 'task';
  const status = normalizeTaskStatus(task.status);
  const updatedAt = task.updatedAt ?? task.createdAt ?? null;
  return {
    id: `workspace-task-${taskId}`,
    kind: 'task',
    type: 'task',
    taskId,
    taskType,
    taskStatus: status,
    skillId: cleanText(task.skillId) || null,
    source: cleanText(task.source) || null,
    documentIds: [...new Set(asArray(task.documentIds).map(value => cleanText(value)).filter(Boolean))],
    resultId: cleanText(task.resultId) || null,
    route: workspaceTaskRoute(taskType),
    title: cleanText(task.title) || '未完成任务',
    summary: cleanText(task.detail || task.message || task.step) || '继续处理这项工作',
    updatedAt,
    createdAt: task.createdAt || null,
    __source: 'task',
    __time: parseTime(updatedAt) ?? 0,
    __priority: 4,
    __task: task
  };
}

function collectRecentCandidates({ recentWork = [], documents = [], tasks = [], includeTasks = false } = {}) {
  const candidates = [
    ...asArray(recentWork).map((item, index) => ({ ...item, __source: 'recent', __index: index, __time: itemTime(item), __priority: 3 })),
    ...asArray(documents).map(documentRecentItem).filter(Boolean).map((item, index) => ({ ...item, __source: 'document', __index: index, __time: itemTime(item), __priority: 1 }))
  ];
  if (includeTasks) candidates.push(...asArray(tasks).map(taskCandidate).filter(Boolean));
  candidates.sort((left, right) => right.__time - left.__time || right.__priority - left.__priority || (left.__index || 0) - (right.__index || 0));

  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    const identity = candidate.__source === 'task'
      ? `task:${candidate.taskId}`
      : itemId(candidate) || cleanText(candidate.title).toLowerCase();
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    result.push(candidate);
  }
  return result;
}

function exposeCandidate(candidate) {
  const { __source, __index, __time, __priority, __task, ...item } = candidate;
  const summary = plainPreview(item.summary || item.description || '', 80);
  return summary ? { ...item, summary } : { ...item, summary: item.kind === 'task' || item.type === 'task' ? '继续处理这项工作' : '' };
}

function decay(value, now, halfLifeDays) {
  const time = parseTime(value);
  if (time === null) return 0;
  const ageDays = Math.max(0, now - time) / 86400000;
  return Math.exp(-ageDays / Math.max(0.5, halfLifeDays));
}

function usageScore(item, now) {
  const count = Math.max(0, Number(item?.useCount ?? item?.openCount ?? item?.visitCount ?? 0) || 0);
  const countSignal = count > 0 ? Math.min(1, Math.log1p(count) / Math.log1p(8)) : 0;
  return countSignal * 32 + decay(item?.lastUsedAt || item?.lastOpenedAt, now, 10) * 18;
}

function taskPriority(status) {
  return { failed: 112, paused: 104, queued: 92, running: 78 }[status] || 70;
}

function draftIsDirty(markers, resourceKeys) {
  for (const key of resourceKeys) {
    const marker = markers?.[key];
    if (marker === true || marker?.dirty === true) return true;
  }
  return false;
}

export function deriveWorkspaceHomeItems({
  recentWork = [], documents = [], tasks = [], libraries = [], followedLibraryIds = [], draftMarkers = {}, readingPositions = {}, starredIds = [], limit = 8, now = Date.now()
} = {}) {
  const normalizedLimit = Math.max(1, Number(limit) || 8);
  const referenceTime = parseTime(now) ?? Date.now();
  const candidates = collectRecentCandidates({ recentWork, documents, tasks, includeTasks: true });
  const documentsById = new Map(asArray(documents).map(document => [itemId(document), document]).filter(([id]) => id));
  const followedInfo = followedLibraryInfo(libraries, followedLibraryIds);
  const starred = new Set(asArray(starredIds).map(value => String(value).trim()).filter(Boolean));
  const unfinishedTasks = asArray(tasks).map(task => ({ task, status: normalizeTaskStatus(task?.status), keys: taskResourceKeys(task) })).filter(entry => taskIsUnfinished(entry.task));

  const ranked = candidates.map((candidate, index) => {
    const resourceKeys = documentResourceKeys(candidate);
    const candidateLibraries = itemLibraryKeys(candidate, documentsById);
    const followedLibrary = [...candidateLibraries].find(key => followedInfo.followed.has(key));
    const relatedTask = candidate.__source === 'task'
      ? { task: candidate.__task, status: candidate.taskStatus, keys: taskResourceKeys(candidate.__task) }
      : unfinishedTasks
        .filter(entry => [...entry.keys].some(key => resourceKeys.has(key)))
        .sort((left, right) => taskPriority(right.status) - taskPriority(left.status))[0] || null;
    const dirty = draftIsDirty(draftMarkers, resourceKeys);
    const readingPosition = [...resourceKeys].map(key => readingPositions?.[key]).find(Boolean) || null;
    const progress = Number(readingPosition?.progress);
    const unfinishedReading = Number.isFinite(progress) && progress > 0.02 && progress < 0.98;
    const used = Math.max(0, Number(candidate.useCount ?? candidate.openCount ?? candidate.visitCount ?? 0) || 0);
    const isStarred = [...resourceKeys].some(key => starred.has(key)) || (candidate.__source === 'recent' && starred.has(String(candidate.id)));
    let score = candidate.__source === 'task' ? 140 + taskPriority(candidate.taskStatus) : candidate.__source === 'recent' ? 14 : 0;
    score += usageScore(candidate, referenceTime);
    score += decay(candidate.updatedAt, referenceTime, 14) * 18;
    if (followedLibrary) score += 26;
    if (isStarred) score += 12;
    if (relatedTask && candidate.__source !== 'task') score += 48 + taskPriority(relatedTask.status) * 0.24;
    if (dirty) score += 24;
    if (unfinishedReading) score += 8;

    const signals = [];
    if (candidate.__source === 'task') {
      signals.push(candidate.taskStatus === 'failed' ? '需要处理' : candidate.taskStatus === 'paused' ? '继续任务' : candidate.taskStatus === 'running' ? '正在进行' : '等待处理');
    } else if (relatedTask) signals.push('有未完成任务');
    if (isStarred) signals.push('已收藏');
    if (dirty) signals.push('有未保存修改');
    if (followedLibrary) signals.push('已关注知识库');
    if (used >= 2) signals.push('经常使用');
    else if (candidate.lastUsedAt || candidate.lastOpenedAt) signals.push('最近使用');
    if (unfinishedReading) signals.push('上次读到这里');
    if (!signals.length) signals.push(candidate.__source === 'document' ? '最近更新' : '继续上次工作');

    return {
      ...exposeCandidate(candidate),
      priorityScore: Math.round(score * 100) / 100,
      priorityReason: signals[0],
      prioritySignals: signals,
      homeRank: 0,
      ...(followedLibrary ? { followedLibraryId: followedLibrary, followedLibraryName: followedInfo.names.get(followedLibrary) || null } : {}),
      ...(relatedTask && candidate.__source !== 'task' ? { relatedTaskId: cleanText(relatedTask.task?.id) || null, relatedTaskStatus: relatedTask.status } : {}),
      ...(candidate.__source === 'task' ? { taskStatus: candidate.taskStatus } : {}),
      __index: index
    };
  }).sort((left, right) => right.priorityScore - left.priorityScore || (parseTime(right.updatedAt) ?? 0) - (parseTime(left.updatedAt) ?? 0) || left.__index - right.__index || String(left.title).localeCompare(String(right.title), 'zh-CN'));

  return ranked.slice(0, normalizedLimit).map((item, index) => {
    const { __index, ...exposed } = item;
    return { ...exposed, homeRank: index + 1 };
  });
}

export function deriveWorkspaceRecentItems({ recentWork = [], documents = [], limit = 8 } = {}) {
  const normalizedLimit = Math.max(1, Number(limit) || 8);
  return collectRecentCandidates({ recentWork, documents }).slice(0, normalizedLimit).map(exposeCandidate);
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
    summary: plainPreview(document.summary || document.excerpt || document.content, 80),
    source: cleanText(document.source || document.sourceType) || '知识库',
    ...(cleanText(document.knowledgeBaseId || document.libraryId || document.spaceId) ? { knowledgeBaseId: cleanText(document.knowledgeBaseId || document.libraryId || document.spaceId) } : {}),
    ...(cleanText(document.spaceId) ? { spaceId: cleanText(document.spaceId) } : {}),
    updatedAt: document.updatedAt ?? document.modifiedAt ?? document.lastModifiedAt ?? document.syncedAt ?? document.createdAt ?? null
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
  const title = `${selectionText ? '选区' : '笔记'} · ${rawSubject.length > 16 ? `${[...rawSubject].slice(0, 16).join('')}…` : rawSubject}`;
  const content = selectionText ? `${selectionText.split(/\r?\n/).map(line => `> ${line}`).join('\n')}\n\n` : '';
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
