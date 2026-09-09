export const NOTE_SAVE_DEBOUNCE_MS = 650;
export const WRITING_SAVE_DEBOUNCE_MS = 800;
export const SWITCH_BLOCKED_MESSAGE = '保存失败，已阻止切换以免丢失未保存内容';
export const NOTE_VERSION_CONFLICT = 'NOTE_VERSION_CONFLICT';

function documentId(value) {
  return String(value || '').trim();
}

function errorMessage(error, fallback = '保存失败') {
  return error?.message || String(error || fallback);
}

export function readDocumentVersion(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? text : null;
  }
  if (typeof value === 'object') {
    return readDocumentVersion(
      value.contentVersionId
      ?? value.currentVersionId
      ?? value.baseVersion
      ?? value.note?.contentVersionId
      ?? value.draft?.contentVersionId
      ?? value.result?.note?.contentVersionId
      ?? value.result?.draft?.contentVersionId
    );
  }
  return null;
}

export function snapshotWithBaseVersion(snapshot, version) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const nextVersion = readDocumentVersion(version);
  if (nextVersion == null) return snapshot;
  return { ...snapshot, baseVersion: nextVersion };
}

export function jsonBodyWithBaseVersion(body, snapshot) {
  const version = readDocumentVersion(snapshot?.baseVersion ?? snapshot);
  if (version == null) return body;
  return { ...body, baseVersion: version };
}

export const SAVE_RESPONSE_INCOMPLETE = 'SAVE_RESPONSE_INCOMPLETE';

export function requireSavedRecord(data, key, message) {
  const record = data?.[key];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new DocumentSaveError(message || '保存响应不完整，已保留未保存编辑', {
      code: SAVE_RESPONSE_INCOMPLETE,
      status: 200,
      details: data ?? null
    });
  }
  return record;
}

export class DocumentSaveError extends Error {
  constructor(message, { code = '', status = 0, details = null } = {}) {
    super(message);
    this.name = 'DocumentSaveError';
    this.code = code || '';
    this.status = Number(status) || 0;
    this.details = details;
  }
}

export async function sendJsonDocument(url, body, { keepalive = false, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: Boolean(keepalive)
  });
  const text = await response.text().catch(() => '');
  let data = {};
  if (text) try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!response.ok) {
    throw new DocumentSaveError(data?.error?.message || data?.message || `HTTP ${response.status}`, {
      code: data?.error?.code || '',
      status: response.status,
      details: data
    });
  }
  return data;
}

export function createDocumentSaveController({
  debounceMs = 0,
  send,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = id => clearTimeout(id),
  onChange
} = {}) {
  if (typeof send !== 'function') throw new TypeError('send is required');
  const docs = new Map();
  const delay = Math.max(0, Number(debounceMs) || 0);

  function ensure(id) {
    const key = documentId(id);
    if (!key) return null;
    if (!docs.has(key)) {
      docs.set(key, {
        id: key,
        pending: null,
        revision: 0,
        savedRevision: 0,
        timer: null,
        sending: false,
        sendingPromise: null,
        error: '',
        status: 'idle',
        acknowledgedVersion: null
      });
    }
    return docs.get(key);
  }

  function inspect(id) {
    const doc = docs.get(documentId(id));
    if (!doc) return null;
    return {
      id: doc.id,
      status: doc.status,
      error: doc.error,
      revision: doc.revision,
      savedRevision: doc.savedRevision,
      pending: doc.pending,
      sending: doc.sending,
      hasTimer: doc.timer != null,
      acknowledgedVersion: doc.acknowledgedVersion
    };
  }

  function emit(doc, extra = {}) {
    onChange?.({
      id: doc.id,
      status: doc.status,
      error: doc.error,
      revision: doc.revision,
      savedRevision: doc.savedRevision,
      pending: Boolean(doc.pending),
      sending: doc.sending,
      acknowledgedVersion: doc.acknowledgedVersion,
      ...extra
    });
  }

  function clearTimer(doc) {
    if (doc?.timer != null) {
      cancel(doc.timer);
      doc.timer = null;
    }
  }

  function hasUnsaved(id) {
    const doc = docs.get(documentId(id));
    if (!doc) return false;
    return doc.sending || (doc.pending != null && doc.revision !== doc.savedRevision);
  }

  function rememberSuccessfulVersion(doc, result) {
    const version = readDocumentVersion(result);
    if (version == null) return;
    doc.acknowledgedVersion = version;
    if (doc.pending) doc.pending = snapshotWithBaseVersion(doc.pending, version);
  }

  function acceptBaseline(id, version) {
    const doc = ensure(id);
    if (!doc) return { ok: false, error: 'missing-id' };
    if (hasUnsaved(doc.id)) return { ok: false, blocked: true, error: 'has-pending' };
    doc.acknowledgedVersion = readDocumentVersion(version);
    doc.status = 'idle';
    doc.error = '';
    emit(doc, { acknowledgedVersion: doc.acknowledgedVersion });
    return { ok: true, id: doc.id, acknowledgedVersion: doc.acknowledgedVersion };
  }

  async function runSend(doc, { keepalive = false } = {}) {
    if (!doc.pending) return { ok: true, skipped: true, id: doc.id };
    const snapshot = doc.pending;
    const revision = doc.revision;
    doc.sending = true;
    doc.status = 'saving';
    doc.error = '';
    emit(doc, { snapshot, revision });
    let outcome;
    try {
      const result = await send(snapshot, { keepalive, revision, id: doc.id });
      rememberSuccessfulVersion(doc, result);
      if (revision !== doc.revision) {
        outcome = { ok: true, stale: true, id: doc.id, revision, result };
      } else {
        doc.pending = null;
        doc.savedRevision = revision;
        doc.status = 'saved';
        doc.error = '';
        outcome = { ok: true, stale: false, id: doc.id, revision, result };
        emit(doc, { result, revision });
      }
    } catch (error) {
      const message = errorMessage(error);
      const conflict = error?.code === NOTE_VERSION_CONFLICT || Number(error?.status) === 409;
      if (revision !== doc.revision) {
        outcome = { ok: false, stale: true, id: doc.id, revision, error: message, conflict, code: error?.code || '' };
      } else {
        doc.status = 'error';
        doc.error = message;
        outcome = { ok: false, stale: false, id: doc.id, revision, error: message, conflict, code: error?.code || '' };
        emit(doc, { error: message, revision, conflict, code: error?.code || '' });
      }
    } finally {
      doc.sending = false;
    }
    if (outcome.conflict) return outcome;
    if (doc.timer) return outcome;
    if (outcome.stale && outcome.ok && doc.pending && doc.revision !== doc.savedRevision) {
      return runSend(doc, { keepalive });
    }
    return outcome;
  }

  function kick(id, options = {}) {
    const doc = ensure(id);
    if (!doc) return Promise.resolve({ ok: true, skipped: true });
    if (doc.sendingPromise) return doc.sendingPromise;
    const promise = runSend(doc, options).finally(() => {
      if (doc.sendingPromise === promise) doc.sendingPromise = null;
    });
    doc.sendingPromise = promise;
    return promise;
  }

  function scheduleSave(snapshot) {
    const doc = ensure(snapshot?.id);
    if (!doc) return { ok: false, error: 'missing-id' };
    const snapshotVersion = readDocumentVersion(snapshot);
    const baseline = doc.acknowledgedVersion ?? snapshotVersion;
    doc.pending = snapshotWithBaseVersion(snapshot, baseline);
    doc.revision += 1;
    doc.status = 'pending';
    doc.error = '';
    clearTimer(doc);
    emit(doc, { snapshot: doc.pending, revision: doc.revision });
    doc.timer = schedule(() => {
      doc.timer = null;
      void kick(doc.id);
    }, delay);
    return { ok: true, id: doc.id, revision: doc.revision };
  }

  async function flush(id, { keepalive = false } = {}) {
    const doc = docs.get(documentId(id));
    if (!doc) return { ok: true, skipped: true };
    let outcome = { ok: true, skipped: true, id: doc.id };
    while (hasUnsaved(doc.id) || doc.timer) {
      clearTimer(doc);
      if (!hasUnsaved(doc.id)) break;
      outcome = await kick(doc.id, { keepalive });
      if (outcome?.conflict) return outcome;
      if (outcome && outcome.ok === false && !outcome.stale) return outcome;
      if (outcome?.ok && !outcome.stale && !hasUnsaved(doc.id)) return outcome;
      if (doc.status === 'error' && outcome && outcome.ok === false) return outcome;
      if (outcome?.ok && outcome.stale && hasUnsaved(doc.id)) continue;
      if (!hasUnsaved(doc.id)) return outcome;
      if (outcome && outcome.ok === false) return outcome;
    }
    if (hasUnsaved(doc.id) || doc.status === 'error') {
      return outcome?.ok === false
        ? outcome
        : { ok: false, id: doc.id, error: doc.error || SWITCH_BLOCKED_MESSAGE };
    }
    return outcome;
  }

  async function flushAll({ keepalive = false } = {}) {
    const ids = [...docs.keys()].filter(id => hasUnsaved(id) || docs.get(id)?.timer);
    const results = await Promise.all(ids.map(id => flush(id, { keepalive })));
    const failed = results.find(item => item && item.ok === false);
    return failed || { ok: true, results };
  }

  async function retry(id) {
    const doc = docs.get(documentId(id));
    if (!doc?.pending) return { ok: false, error: '没有可重试的保存' };
    clearTimer(doc);
    doc.status = 'pending';
    doc.error = '';
    emit(doc, { snapshot: doc.pending, revision: doc.revision });
    return kick(doc.id, { keepalive: false });
  }

  function attachLifecycle(target) {
    if (!target?.addEventListener) return () => {};
    const hidden = () => target.document?.visibilityState === 'hidden' || target.visibilityState === 'hidden';
    const onHide = () => { void flushAll({ keepalive: true }); };
    const onVisibility = () => { if (hidden()) onHide(); };
    const onUnload = event => {
      if (![...docs.keys()].some(hasUnsaved)) return;
      event.preventDefault();
      event.returnValue = '';
      void flushAll({ keepalive: true });
    };
    target.addEventListener('pagehide', onHide);
    target.addEventListener('visibilitychange', onVisibility);
    target.addEventListener('beforeunload', onUnload);
    return () => {
      target.removeEventListener('pagehide', onHide);
      target.removeEventListener('visibilitychange', onVisibility);
      target.removeEventListener('beforeunload', onUnload);
    };
  }

  function detach({ keepalive = true } = {}) {
    for (const doc of docs.values()) clearTimer(doc);
    return flushAll({ keepalive });
  }

  return {
    schedule: scheduleSave,
    flush,
    flushAll,
    retry,
    hasUnsaved,
    inspect,
    acceptBaseline,
    attachLifecycle,
    detach
  };
}

export async function prepareDocumentSwitch(controller, fromId) {
  const id = documentId(fromId);
  if (!id || typeof controller?.hasUnsaved !== 'function') {
    return { ok: true, blocked: false };
  }
  if (!controller.hasUnsaved(id) && typeof controller.inspect === 'function' && !controller.inspect(id)?.hasTimer) {
    return { ok: true, blocked: false };
  }
  const result = await controller.flush(id);
  if (result?.ok && (typeof controller.hasUnsaved !== 'function' || !controller.hasUnsaved(id))) {
    return { ok: true, blocked: false, result };
  }
  return { ok: false, blocked: true, error: result?.error || SWITCH_BLOCKED_MESSAGE, result };
}
