export const WORKSPACE_SYNC_FORMAT = 'flowmind-workspace-sync';
export const WORKSPACE_SYNC_BUNDLE_FORMAT = 'flowmind-workspace-bundle';
export const WORKSPACE_SYNC_SCHEMA_VERSION = 1;
export const WORKSPACE_SYNC_SESSION_VERSION = 4;

const COLLECTIONS = Object.freeze(['tabs', 'recentWork', 'readingPositions', 'contextRefs', 'tasks', 'draftMarkers']);
const CHAT_MODES = new Set(['chat', 'quick', 'research', 'write']);
const TASK_STATUSES = new Set(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled']);
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const MAX_ITEMS = 240;
const MAX_STRING = 320;
const MAX_TITLE = 180;
const MAX_DETAIL = 240;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, maximum = MAX_STRING) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, maximum);
}

function optionalText(value, maximum = MAX_STRING) {
  const result = text(value, maximum);
  return result || null;
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 64);
  return null;
}

function versionValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return optionalText(value, 160);
}

function uniqueStrings(value, maximum = 200) {
  return [...new Set(asArray(value).map(item => text(item, 180)).filter(Boolean))].slice(0, maximum);
}

function copyVersionFields(source, target) {
  for (const key of ['contentVersionId', 'revision', 'contentHash', 'currentVersionId', 'currentRevision', 'currentContentHash', 'evidenceId', 'evidenceStatus', 'evidenceStatusReason']) {
    const value = key.toLowerCase().includes('version') ? versionValue(source?.[key]) : optionalText(source?.[key], 220);
    if (value !== null && value !== '') target[key] = value;
  }
  return target;
}

function safeSelection(value) {
  if (!isRecord(value)) return null;
  const documentId = optionalText(value.documentId ?? value.sourceId ?? value.resourceId, 180);
  const anchor = optionalText(value.anchor ?? value.sourceAnchor, 220);
  const startOffset = finite(value.startOffset);
  const endOffset = finite(value.endOffset);
  if (!documentId && !anchor && startOffset === null && endOffset === null) return null;
  return {
    ...(documentId ? { documentId } : {}),
    ...(anchor ? { anchor } : {}),
    ...(startOffset !== null ? { startOffset } : {}),
    ...(endOffset !== null ? { endOffset } : {})
  };
}

function safeChatScene(tab) {
  const source = isRecord(tab?.chat) ? tab.chat : isRecord(tab?.chatScene) ? tab.chatScene : tab || {};
  const agentMode = CHAT_MODES.has(text(source.agentMode, 32)) ? text(source.agentMode, 32) : 'chat';
  const skill = isRecord(source.skillRun) ? source.skillRun : null;
  const skillRun = skill && optionalText(skill.id, 180) ? {
    id: optionalText(skill.id, 180),
    ...(optionalText(skill.skillId, 120) ? { skillId: optionalText(skill.skillId, 120) } : {}),
    ...(optionalText(skill.title, MAX_TITLE) ? { title: optionalText(skill.title, MAX_TITLE) } : {}),
    status: TERMINAL_TASK_STATUSES.has(text(skill.status, 32)) ? text(skill.status, 32) : 'recoverable',
    ...(timestamp(skill.startedAt) !== null ? { startedAt: timestamp(skill.startedAt) } : {}),
    ...(timestamp(skill.completedAt) !== null ? { completedAt: timestamp(skill.completedAt) } : {}),
    ...(optionalText(skill.error, MAX_DETAIL) ? { error: optionalText(skill.error, MAX_DETAIL) } : {})
  } : null;
  return {
    version: 1,
    ...(optionalText(source.conversationId, 180) ? { conversationId: optionalText(source.conversationId, 180) } : {}),
    documentIds: uniqueStrings(source.documentIds ?? source.scopeDocumentIds),
    ...(safeSelection(source.selection) ? { selection: safeSelection(source.selection) } : {}),
    agentMode,
    ...(skillRun ? { skillRun } : {})
  };
}

function safeContextDocument(value) {
  if (!isRecord(value)) return null;
  const id = optionalText(value.id ?? value.documentId ?? value.resourceId, 180);
  if (!id) return null;
  const output = {
    id,
    ...(optionalText(value.documentId, 180) ? { documentId: optionalText(value.documentId, 180) } : {}),
    ...(optionalText(value.resourceId, 180) ? { resourceId: optionalText(value.resourceId, 180) } : {}),
    ...(optionalText(value.title, MAX_TITLE) ? { title: optionalText(value.title, MAX_TITLE) } : {}),
    ...(optionalText(value.source ?? value.sourceType, 120) ? { source: optionalText(value.source ?? value.sourceType, 120) } : {}),
    ...(optionalText(value.type, 64) ? { type: optionalText(value.type, 64) } : {})
  };
  return copyVersionFields(value, output);
}

function safeTab(value, index) {
  if (!isRecord(value)) return null;
  const kind = optionalText(value.kind ?? value.type, 64) || 'workspace';
  const id = optionalText(value.id, 180) || `sync-tab-${index}`;
  const resourceId = optionalText(value.resourceId ?? value.documentId ?? value.noteId ?? value.draftId, 180);
  const output = {
    id,
    kind,
    type: optionalText(value.type, 64) || kind,
    title: optionalText(value.title, MAX_TITLE) || '未命名',
    ...(resourceId ? { resourceId } : {}),
    ...(optionalText(value.documentId, 180) ? { documentId: optionalText(value.documentId, 180) } : {}),
    ...(optionalText(value.noteId, 180) ? { noteId: optionalText(value.noteId, 180) } : {}),
    ...(optionalText(value.draftId, 180) ? { draftId: optionalText(value.draftId, 180) } : {}),
    ...(optionalText(value.route, 64) ? { route: optionalText(value.route, 64) } : {}),
    ...(optionalText(value.source ?? value.sourceType, 120) ? { source: optionalText(value.source ?? value.sourceType, 120) } : {}),
    ...(optionalText(value.url, 1000) ? { url: optionalText(value.url, 1000) } : {}),
    pinned: value.pinned === true,
    dirty: value.dirty === true,
    ...(timestamp(value.openedAt) !== null ? { openedAt: timestamp(value.openedAt) } : {}),
    ...(timestamp(value.lastActiveAt) !== null ? { lastActiveAt: timestamp(value.lastActiveAt) } : {})
  };
  copyVersionFields(value, output);
  if (Array.isArray(value.documentIds)) output.documentIds = uniqueStrings(value.documentIds);
  if (optionalText(value.question, 500)) output.question = optionalText(value.question, 500);
  if (isRecord(value.contextDocument)) {
    const contextDocument = safeContextDocument(value.contextDocument);
    if (contextDocument) output.contextDocument = contextDocument;
  }
  if (kind === 'chat' || value.route === 'knowledge') output.chat = safeChatScene(value);
  return output;
}

function safeRecent(value, index) {
  if (!isRecord(value)) return null;
  const kind = optionalText(value.kind ?? value.type, 64) || 'item';
  const resourceId = optionalText(value.resourceId ?? value.documentId ?? value.noteId ?? value.draftId, 180);
  const output = {
    id: optionalText(value.id, 180) || `sync-recent-${index}`,
    kind,
    type: optionalText(value.type, 64) || kind,
    ...(resourceId ? { resourceId } : {}),
    ...(optionalText(value.documentId, 180) ? { documentId: optionalText(value.documentId, 180) } : {}),
    ...(optionalText(value.noteId, 180) ? { noteId: optionalText(value.noteId, 180) } : {}),
    ...(optionalText(value.draftId, 180) ? { draftId: optionalText(value.draftId, 180) } : {}),
    ...(optionalText(value.route, 64) ? { route: optionalText(value.route, 64) } : {}),
    ...(optionalText(value.title, MAX_TITLE) ? { title: optionalText(value.title, MAX_TITLE) } : {}),
    ...(optionalText(value.source ?? value.sourceType, 120) ? { source: optionalText(value.source ?? value.sourceType, 120) } : {}),
    ...(timestamp(value.updatedAt) !== null ? { updatedAt: timestamp(value.updatedAt) } : {}),
    ...(timestamp(value.lastUsedAt) !== null ? { lastUsedAt: timestamp(value.lastUsedAt) } : {}),
    useCount: Math.max(0, Math.min(1000000, Math.trunc(finite(value.useCount ?? value.openCount, 0))))
  };
  copyVersionFields(value, output);
  return output;
}

function safeReadingPosition(value) {
  if (!isRecord(value)) return null;
  const output = {
    scrollTop: Math.max(0, finite(value.scrollTop, 0)),
    progress: Math.max(0, Math.min(1, finite(value.progress, 0))),
    page: Math.max(0, Math.trunc(finite(value.page, 0))),
    ...(optionalText(value.anchor, 220) ? { anchor: optionalText(value.anchor, 220) } : {}),
    ...(timestamp(value.updatedAt) !== null ? { updatedAt: timestamp(value.updatedAt) } : {})
  };
  return output;
}

function safeContext(value, index) {
  if (!isRecord(value)) return null;
  const kind = optionalText(value.kind ?? value.type, 64) || 'resource';
  const sourceId = optionalText(value.sourceId ?? value.documentId ?? value.resourceId ?? value.noteId, 180);
  const output = {
    id: optionalText(value.id, 180) || `sync-context-${index}`,
    kind,
    type: optionalText(value.type, 64) || kind,
    ...(sourceId ? { sourceId } : {}),
    ...(optionalText(value.documentId, 180) ? { documentId: optionalText(value.documentId, 180) } : {}),
    ...(optionalText(value.resourceId, 180) ? { resourceId: optionalText(value.resourceId, 180) } : {}),
    ...(optionalText(value.title, MAX_TITLE) ? { title: optionalText(value.title, MAX_TITLE) } : {}),
    ...(optionalText(value.source ?? value.sourceType, 120) ? { source: optionalText(value.source ?? value.sourceType, 120) } : {}),
    ...(optionalText(value.anchor, 220) ? { anchor: optionalText(value.anchor, 220) } : {}),
    ...(finite(value.startOffset) !== null ? { startOffset: finite(value.startOffset) } : {}),
    ...(finite(value.endOffset) !== null ? { endOffset: finite(value.endOffset) } : {}),
    ...(finite(value.pageNumber ?? value.page) !== null ? { pageNumber: finite(value.pageNumber ?? value.page) } : {}),
    ...(finite(value.timeStart) !== null ? { timeStart: finite(value.timeStart) } : {}),
    ...(finite(value.timeEnd) !== null ? { timeEnd: finite(value.timeEnd) } : {}),
    selection: value.selection === true
  };
  return copyVersionFields(value, output);
}

function safeTask(value, index) {
  if (!isRecord(value)) return null;
  const requested = text(value.status, 32);
  const status = TASK_STATUSES.has(requested) ? requested : 'queued';
  const output = {
    id: optionalText(value.id, 180) || `sync-task-${index}`,
    type: optionalText(value.type ?? value.taskType, 80) || 'task',
    status: TERMINAL_TASK_STATUSES.has(status) ? status : 'paused',
    recoverable: !TERMINAL_TASK_STATUSES.has(status),
    progress: Math.max(0, Math.min(1, finite(value.progress, 0))),
    ...(optionalText(value.skillId, 120) ? { skillId: optionalText(value.skillId, 120) } : {}),
    ...(optionalText(value.title, MAX_TITLE) ? { title: optionalText(value.title, MAX_TITLE) } : {}),
    ...(optionalText(value.detail ?? value.step, MAX_DETAIL) ? { detail: optionalText(value.detail ?? value.step, MAX_DETAIL) } : {}),
    documentIds: uniqueStrings(value.documentIds),
    ...(optionalText(value.resultId, 180) ? { resultId: optionalText(value.resultId, 180) } : {}),
    ...(timestamp(value.createdAt) !== null ? { createdAt: timestamp(value.createdAt) } : {}),
    ...(timestamp(value.updatedAt) !== null ? { updatedAt: timestamp(value.updatedAt) } : {})
  };
  return output;
}

function safeDraftMarker(value) {
  if (!isRecord(value)) return { dirty: value === true, updatedAt: null };
  return {
    dirty: value.dirty !== false,
    ...(timestamp(value.updatedAt) !== null ? { updatedAt: timestamp(value.updatedAt) } : { updatedAt: null })
  };
}

export function sanitizeWorkspaceSession(value = {}) {
  const source = isRecord(value) ? value : {};
  const tabs = asArray(source.tabs).map(safeTab).filter(Boolean).slice(0, MAX_ITEMS);
  const tabIds = new Set(tabs.map(tab => tab.id));
  const activeTabId = optionalText(source.activeTabId, 180);
  const readingPositions = {};
  for (const [key, position] of Object.entries(isRecord(source.readingPositions) ? source.readingPositions : {}).slice(0, MAX_ITEMS)) {
    const id = text(key, 180);
    const safe = safeReadingPosition(position);
    if (id && safe) readingPositions[id] = safe;
  }
  const draftMarkers = {};
  for (const [key, marker] of Object.entries(isRecord(source.draftMarkers) ? source.draftMarkers : {}).slice(0, MAX_ITEMS)) {
    const id = text(key, 180);
    if (id) draftMarkers[id] = safeDraftMarker(marker);
  }
  return {
    version: WORKSPACE_SYNC_SESSION_VERSION,
    tabs,
    activeTabId: activeTabId && tabIds.has(activeTabId) ? activeTabId : null,
    recentWork: asArray(source.recentWork).map(safeRecent).filter(Boolean).slice(-MAX_ITEMS),
    readingPositions,
    aiContextItems: asArray(source.aiContextItems).map(safeContext).filter(Boolean).slice(-MAX_ITEMS),
    tasks: asArray(source.tasks).map(safeTask).filter(Boolean).slice(-MAX_ITEMS),
    draftMarkers
  };
}

function resourceId(value) {
  return text(value?.resourceId ?? value?.documentId ?? value?.noteId ?? value?.draftId ?? value?.sourceId ?? value?.id, 180);
}

function entryKey(collection, value, index = 0) {
  if (collection === 'readingPositions') return `reading:${text(value?.resourceId ?? value?.documentId ?? value?.id, 180) || index}`;
  if (collection === 'draftMarkers') return `draft:${text(value?.resourceId ?? value?.documentId ?? value?.id, 180) || index}`;
  if (collection === 'tasks') return `task:${text(value?.id, 180) || index}`;
  if (collection === 'contextRefs') return `context:${text(value?.kind ?? value?.type, 64)}:${resourceId(value)}:${text(value?.anchor, 220) || text(value?.id, 180) || index}`;
  if (collection === 'tabs') return `tab:${text(value?.kind ?? value?.type, 64)}:${resourceId(value) || text(value?.id, 180) || index}`;
  return `recent:${text(value?.kind ?? value?.type, 64)}:${resourceId(value) || text(value?.id, 180) || index}`;
}

function emptyProjection(actorId = '') {
  return { schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION, actorId: text(actorId, 120), clock: 0, collections: Object.fromEntries(COLLECTIONS.map(name => [name, {}])) };
}

function normalizeStamp(value) {
  if (!isRecord(value)) return { counter: 0, actorId: '' };
  return { counter: Math.max(0, Math.trunc(finite(value.counter, 0))), actorId: text(value.actorId, 120) };
}

function stampCompare(left, right) {
  const a = normalizeStamp(left); const b = normalizeStamp(right);
  return a.counter - b.counter || a.actorId.localeCompare(b.actorId);
}

function safeProjection(value) {
  const source = isRecord(value) ? value : {};
  const result = emptyProjection(source.actorId);
  result.clock = Math.max(0, Math.trunc(finite(source.clock, 0)));
  for (const collection of COLLECTIONS) {
    const entries = isRecord(source.collections?.[collection]) ? source.collections[collection] : {};
    for (const [key, entry] of Object.entries(entries).slice(0, MAX_ITEMS * 2)) {
      if (!isRecord(entry)) continue;
      const safeKey = text(key, 500);
      if (!safeKey) continue;
      const stamp = normalizeStamp(entry.stamp);
      const index = Number(safeKey.split(':').at(-1)) || 0;
      const safeValue = entry.deleted === true ? null : sanitizeProjectionValue(collection, entry.value, index);
      if (entry.deleted !== true && !safeValue) continue;
      result.collections[collection][safeKey] = {
        stamp,
        ...(entry.deleted === true ? { deleted: true } : { value: safeValue })
      };
      result.clock = Math.max(result.clock, stamp.counter);
    }
  }
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function canonicalStringify(value) {
  return JSON.stringify(canonical(value));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of canonicalStringify(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export async function digestValue(value) {
  const input = new TextEncoder().encode(canonicalStringify(value));
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return stableHash(value);
}

function valueEquivalent(left, right) {
  return canonicalStringify(left ?? null) === canonicalStringify(right ?? null);
}

function entryStateEquivalent(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  if (Boolean(left.deleted) !== Boolean(right.deleted)) return false;
  return left.deleted === true || valueEquivalent(left.value, right.value);
}

function collectionValues(session) {
  const safe = sanitizeWorkspaceSession(session);
  const values = {
    tabs: Object.fromEntries(safe.tabs.map((item, index) => [entryKey('tabs', item, index), item])),
    recentWork: Object.fromEntries(safe.recentWork.map((item, index) => [entryKey('recentWork', item, index), item])),
    readingPositions: Object.fromEntries(Object.entries(safe.readingPositions).map(([id, item]) => [`reading:${id}`, item])),
    contextRefs: Object.fromEntries(safe.aiContextItems.map((item, index) => [entryKey('contextRefs', item, index), item])),
    tasks: Object.fromEntries(safe.tasks.map((item, index) => [entryKey('tasks', item, index), item])),
    draftMarkers: Object.fromEntries(Object.entries(safe.draftMarkers).map(([id, item]) => [`draft:${id}`, item]))
  };
  return { safe, values };
}

function nextStamp(clock, actorId) {
  const next = Math.max(0, Math.trunc(finite(clock, 0))) + 1;
  return { counter: next, actorId: text(actorId, 120) || 'device' };
}

function projectEntry(value, stamp) {
  return value === undefined ? { stamp, deleted: true } : { stamp, value };
}

export function createLocalProjection(session, previousProjection = null, { actorId = 'device', counter = 0 } = {}) {
  const previous = safeProjection(previousProjection);
  const { safe, values } = collectionValues(session);
  let clock = Math.max(previous.clock, Math.trunc(finite(counter, 0)));
  const collections = {};
  for (const collection of COLLECTIONS) {
    const oldEntries = previous.collections[collection] || {};
    const currentValues = values[collection] || {};
    const entries = {};
    const keys = new Set([...Object.keys(oldEntries), ...Object.keys(currentValues)]);
    for (const key of keys) {
      const oldEntry = oldEntries[key];
      const currentValue = currentValues[key];
      if (currentValue !== undefined) {
        if (oldEntry && !oldEntry.deleted && valueEquivalent(oldEntry.value, currentValue)) {
          entries[key] = { ...oldEntry, value: currentValue };
        } else {
          const stamp = nextStamp(clock, actorId); clock = stamp.counter;
          entries[key] = projectEntry(currentValue, stamp);
        }
      } else if (oldEntry && !oldEntry.deleted) {
        const stamp = nextStamp(clock, actorId); clock = stamp.counter;
        entries[key] = projectEntry(undefined, stamp);
      } else if (oldEntry) {
        entries[key] = { ...oldEntry };
      }
    }
    collections[collection] = entries;
  }
  return { projection: { schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION, actorId: text(actorId, 120), clock, collections }, session: safe, counter: clock };
}

function entriesToSession(projection, localSession = {}) {
  const source = safeProjection(projection);
  const values = collection => Object.entries(source.collections[collection] || {})
    .filter(([, entry]) => entry && entry.deleted !== true && entry.value !== undefined)
    .sort((left, right) => stampCompare(right[1]?.stamp, left[1]?.stamp))
    .map(([, entry]) => entry.value);
  const tabs = values('tabs');
  const localActive = optionalText(localSession?.activeTabId, 180);
  return {
    version: WORKSPACE_SYNC_SESSION_VERSION,
    tabs,
    activeTabId: localActive && tabs.some(tab => tab.id === localActive) ? localActive : tabs[0]?.id || null,
    recentWork: values('recentWork'),
    readingPositions: Object.fromEntries(Object.entries(source.collections.readingPositions || {}).filter(([, entry]) => entry?.deleted !== true && entry?.value).map(([key, entry]) => [key.replace(/^reading:/u, ''), entry.value])),
    aiContextItems: values('contextRefs'),
    tasks: values('tasks').map(task => TERMINAL_TASK_STATUSES.has(task.status) ? task : { ...task, status: 'paused', recoverable: true }),
    draftMarkers: Object.fromEntries(Object.entries(source.collections.draftMarkers || {}).filter(([, entry]) => entry?.deleted !== true && entry?.value).map(([key, entry]) => [key.replace(/^draft:/u, ''), entry.value]))
  };
}

export function sessionFromProjection(projection, localSession = {}) {
  return entriesToSession(projection, localSession);
}

function sanitizeProjectionValue(collection, value, index = 0) {
  if (collection === 'tabs') return safeTab(value, index);
  if (collection === 'recentWork') return safeRecent(value, index);
  if (collection === 'readingPositions') return safeReadingPosition(value);
  if (collection === 'contextRefs') return safeContext(value, index);
  if (collection === 'tasks') return safeTask(value, index);
  if (collection === 'draftMarkers') return safeDraftMarker(value);
  return null;
}

function publicEntryValue(entry) {
  if (!entry) return null;
  return entry.deleted === true ? { deleted: true } : entry.value ?? null;
}

function changedFromBase(entry, base) {
  if (!base && !entry) return false;
  if (!base) return Boolean(entry);
  if (!entry) return false;
  return !entryStateEquivalent(entry, base);
}

function chooseEntry(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return stampCompare(left.stamp, right.stamp) >= 0 ? left : right;
}

export function mergeWorkspaceProjections({
  localProjection = null,
  remoteProjection = null,
  baseProjection = null,
  localSession = {},
  resolutions = {}
} = {}) {
  const local = safeProjection(localProjection);
  const remote = safeProjection(remoteProjection);
  const base = safeProjection(baseProjection);
  const merged = emptyProjection(local.actorId || remote.actorId);
  merged.clock = Math.max(local.clock, remote.clock, base.clock);
  const conflicts = [];

  for (const collection of COLLECTIONS) {
    const output = {};
    const keys = new Set([
      ...Object.keys(local.collections[collection] || {}),
      ...Object.keys(remote.collections[collection] || {}),
      ...Object.keys(base.collections[collection] || {})
    ]);
    for (const key of keys) {
      const left = local.collections[collection]?.[key] || null;
      const right = remote.collections[collection]?.[key] || null;
      const ancestor = base.collections[collection]?.[key] || null;
      const leftChanged = changedFromBase(left, ancestor);
      const rightChanged = changedFromBase(right, ancestor);
      const different = !entryStateEquivalent(left, right);
      const conflictId = `workspace-sync:${collection}:${key}`;
      let chosen = null;
      if (leftChanged && rightChanged && different) {
        const resolution = text(resolutions[conflictId] ?? resolutions[`${collection}:${key}`], 16);
        if (resolution === 'local') chosen = left;
        else if (resolution === 'remote') chosen = right;
        else {
          conflicts.push({
            id: conflictId,
            collection,
            key,
            label: collection === 'readingPositions' ? '阅读位置' : collection === 'tasks' ? '任务状态' : collection === 'draftMarkers' ? '草稿状态' : collection === 'tabs' ? '工作标签' : collection === 'contextRefs' ? 'AI 上下文' : '最近工作',
            local: publicEntryValue(left),
            remote: publicEntryValue(right),
            base: publicEntryValue(ancestor),
            choices: ['local', 'remote']
          });
          chosen = left || right;
        }
      } else if (leftChanged) chosen = left;
      else if (rightChanged) chosen = right;
      else chosen = chooseEntry(left, right) || ancestor;
      if (chosen) {
        output[key] = chosen;
        merged.clock = Math.max(merged.clock, normalizeStamp(chosen.stamp).counter);
      }
    }
    merged.collections[collection] = output;
  }

  const session = entriesToSession(merged, localSession);
  const unresolved = conflicts.filter(conflict => !['local', 'remote'].includes(text(resolutions[conflict.id], 16)));
  return {
    projection: merged,
    session,
    conflicts,
    unresolvedConflicts: unresolved,
    canApply: unresolved.length === 0,
    status: unresolved.length ? 'conflict' : 'merged',
    stats: {
      conflicts: conflicts.length,
      unresolved: unresolved.length,
      tabs: Object.keys(merged.collections.tabs).length,
      recentWork: Object.keys(merged.collections.recentWork).length,
      tasks: Object.keys(merged.collections.tasks).length
    }
  };
}

export async function createWorkspaceSyncEnvelope({ workspaceId, deviceId, projection, revision = null, createdAt = new Date().toISOString() } = {}) {
  const payload = {
    format: WORKSPACE_SYNC_FORMAT,
    schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
    workspaceId: text(workspaceId, 180),
    deviceId: text(deviceId, 120),
    revision: revision === null || revision === undefined ? null : Math.max(0, Math.trunc(finite(revision, 0))),
    createdAt: timestamp(createdAt) || new Date().toISOString(),
    projection: safeProjection(projection)
  };
  return { ...payload, digest: await digestValue(payload) };
}

export async function verifyWorkspaceSyncEnvelope(value, { workspaceId = '' } = {}) {
  if (!isRecord(value) || value.format !== WORKSPACE_SYNC_FORMAT || Number(value.schemaVersion) !== WORKSPACE_SYNC_SCHEMA_VERSION || !isRecord(value.projection)) {
    throw Object.assign(new Error('工作区同步数据格式不受支持'), { code: 'WORKSPACE_SYNC_FORMAT_INVALID', status: 400 });
  }
  const expectedWorkspace = text(workspaceId, 180);
  if (expectedWorkspace && text(value.workspaceId, 180) !== expectedWorkspace) {
    throw Object.assign(new Error('同步空间不匹配'), { code: 'WORKSPACE_SYNC_WORKSPACE_MISMATCH', status: 409 });
  }
  const payload = {
    format: WORKSPACE_SYNC_FORMAT,
    schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
    workspaceId: text(value.workspaceId, 180),
    deviceId: text(value.deviceId, 120),
    revision: value.revision === null || value.revision === undefined ? null : Math.max(0, Math.trunc(finite(value.revision, 0))),
    createdAt: timestamp(value.createdAt) || null,
    projection: safeProjection(value.projection)
  };
  if (!payload.workspaceId || !payload.deviceId || !payload.createdAt || !text(value.digest, 128)) {
    throw Object.assign(new Error('同步数据缺少必要字段'), { code: 'WORKSPACE_SYNC_FIELDS_INVALID', status: 400 });
  }
  const actual = await digestValue(payload);
  if (actual !== text(value.digest, 128)) {
    throw Object.assign(new Error('同步数据校验和不匹配'), { code: 'WORKSPACE_SYNC_DIGEST_INVALID', status: 400 });
  }
  return { ...payload, digest: actual };
}

export async function createWorkspaceBundle(session, { deviceId = '', createdAt = new Date().toISOString() } = {}) {
  const payload = {
    format: WORKSPACE_SYNC_BUNDLE_FORMAT,
    schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
    deviceId: text(deviceId, 120) || null,
    createdAt: timestamp(createdAt) || new Date().toISOString(),
    session: sanitizeWorkspaceSession(session)
  };
  return { ...payload, checksum: await digestValue(payload) };
}

export async function verifyWorkspaceBundle(value) {
  if (!isRecord(value) || value.format !== WORKSPACE_SYNC_BUNDLE_FORMAT || Number(value.schemaVersion) !== WORKSPACE_SYNC_SCHEMA_VERSION || !isRecord(value.session)) {
    throw Object.assign(new Error('工作现场包格式不受支持'), { code: 'WORKSPACE_BUNDLE_FORMAT_INVALID', status: 400 });
  }
  const payload = {
    format: WORKSPACE_SYNC_BUNDLE_FORMAT,
    schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
    deviceId: text(value.deviceId, 120) || null,
    createdAt: timestamp(value.createdAt) || null,
    session: sanitizeWorkspaceSession(value.session)
  };
  const actual = await digestValue(payload);
  if (!payload.createdAt || actual !== text(value.checksum, 128)) {
    throw Object.assign(new Error('工作现场包校验和不匹配'), { code: 'WORKSPACE_BUNDLE_CHECKSUM_INVALID', status: 400 });
  }
  return { ...payload, checksum: actual };
}

export function syncCollectionNames() {
  return [...COLLECTIONS];
}

export function sanitizeWorkspaceProjection(value) {
  return safeProjection(value);
}
