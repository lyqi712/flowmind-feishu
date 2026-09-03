import { createHash } from 'node:crypto';

export const EVIDENCE_SCHEMA_VERSION = 1;
export const EVIDENCE_MAX_EXCERPT = 240;

function clean(value) {
  return String(value ?? '').trim();
}

function nullableText(value) {
  const text = clean(value);
  return text || null;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasCanonicalEvidenceFields(value = {}) {
  return ['evidenceSchemaVersion', 'evidenceId', 'excerptHash', 'contentVersionId', 'revision', 'contentHash', 'provenance']
    .some(key => value?.[key] !== undefined && value?.[key] !== null);
}

export function isLegacyUnobservedRef(ref = {}, document = null) {
  return !document && !hasCanonicalEvidenceFields(ref);
}

export function evidenceDigest(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

export function evidenceDocumentId(value) {
  return clean(value?.documentId || value?.contentItemId || value?.id);
}

export function evidenceVersion(value = {}) {
  return {
    contentVersionId: value?.contentVersionId ?? value?.currentVersionId ?? value?.versionId ?? value?.sourceVersionId ?? null,
    revision: nullableText(value?.revision ?? value?.sourceRevision),
    contentHash: nullableText(value?.contentHash ?? value?.sourceContentHash)
  };
}

function hasVersion(version = {}) {
  return (version.contentVersionId !== null && version.contentVersionId !== undefined)
    || Boolean(version.revision)
    || Boolean(version.contentHash);
}

function sameVersionField(left, right, field) {
  if (left[field] === null || left[field] === undefined) return true;
  if (right[field] === null || right[field] === undefined) return false;
  if (field === 'contentVersionId') {
    const leftNumber = Number(left[field]);
    const rightNumber = Number(right[field]);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber === rightNumber;
  }
  return String(left[field]) === String(right[field]);
}

export function classifyEvidence(ref = {}, document = null) {
  const documentId = evidenceDocumentId(ref);
  if (!document || !documentId || String(document.id) !== documentId) {
    return { status: 'unavailable', reason: 'document_not_found', currentVersion: null };
  }
  if (document.deletedAt) {
    return { status: 'unavailable', reason: 'document_deleted', currentVersion: evidenceVersion(document) };
  }
  const sourceVersion = evidenceVersion(ref);
  const currentVersion = evidenceVersion(document);
  if (!hasVersion(sourceVersion)) {
    return { status: 'unverified', reason: 'source_version_missing', currentVersion };
  }
  if (!sameVersionField(sourceVersion, currentVersion, 'contentVersionId')
    || !sameVersionField(sourceVersion, currentVersion, 'revision')
    || !sameVersionField(sourceVersion, currentVersion, 'contentHash')) {
    return { status: 'stale', reason: 'content_version_changed', currentVersion };
  }
  return { status: 'current', reason: null, currentVersion };
}

function safeUrl(value) {
  const url = clean(value);
  return /^https?:\/\//iu.test(url) ? url : null;
}

function safeRegion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const region = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    const number = nullableNumber(value[key]);
    if (number !== null) region[key] = number;
  }
  return Object.keys(region).length ? region : null;
}

function stableEvidenceId({ documentId, sourceVersion, anchor, chunkId, excerptHash }) {
  const key = [documentId, sourceVersion.contentVersionId ?? '', sourceVersion.revision || '', sourceVersion.contentHash || '', anchor || '', chunkId || '', excerptHash || ''].join('\u001f');
  return `evidence_${evidenceDigest(key).slice(0, 32)}`;
}

function sourceProvenance(ref, sourceVersion, excerptHash, evidenceId) {
  const existing = ref?.provenance && typeof ref.provenance === 'object' ? ref.provenance : {};
  return {
    ...existing,
    kind: existing.kind || 'content-evidence',
    evidenceId: existing.evidenceId || evidenceId,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    sourceVersionId: sourceVersion.contentVersionId,
    sourceRevision: sourceVersion.revision,
    sourceContentHash: sourceVersion.contentHash,
    excerptHash
  };
}

export function bindEvidenceRef(ref = {}, document = null, { excerpt, anchor, chunkId, sourceId } = {}) {
  const raw = ref && typeof ref === 'object' ? ref : {};
  const documentId = evidenceDocumentId(raw) || clean(document?.id);
  const sourceVersionInput = evidenceVersion(raw);
  const documentVersion = evidenceVersion(document || {});
  const suppliedVersion = hasVersion(sourceVersionInput);
  const sourceVersion = suppliedVersion ? sourceVersionInput : documentVersion;
  const resolvedExcerpt = String(excerpt ?? raw.excerpt ?? raw.quote ?? raw.snippet ?? '').slice(0, EVIDENCE_MAX_EXCERPT);
  const excerptHash = evidenceDigest(resolvedExcerpt);
  const resolvedAnchor = nullableText(anchor ?? raw.anchor ?? raw.sourceAnchor ?? raw.location?.anchor);
  const resolvedChunkId = nullableText(chunkId ?? raw.chunkId);
  const status = suppliedVersion
    ? classifyEvidence({ ...raw, documentId }, document)
    : document
      ? document.deletedAt
        ? { status: 'unavailable', reason: 'document_deleted', currentVersion: documentVersion }
        : { status: 'current', reason: null, currentVersion: documentVersion }
      : { status: 'unavailable', reason: 'document_not_found', currentVersion: null };
  const evidenceId = clean(raw.evidenceId) || (documentId ? stableEvidenceId({ documentId, sourceVersion, anchor: resolvedAnchor, chunkId: resolvedChunkId, excerptHash }) : null);
  const currentVersion = status.currentVersion;
  const output = {
    evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    ...(evidenceId ? { evidenceId } : {}),
    ...(documentId ? { documentId, contentItemId: documentId } : {}),
    ...(raw.sourceId || sourceId ? { sourceId: clean(raw.sourceId || sourceId) } : {}),
    title: clean(raw.title || document?.title) || 'Untitled document',
    ...(safeUrl(raw.url || raw.sourceUrl || document?.sourceUrl || document?.url) ? { url: safeUrl(raw.url || raw.sourceUrl || document?.sourceUrl || document?.url) } : {}),
    anchor: resolvedAnchor,
    ...(resolvedChunkId ? { chunkId: resolvedChunkId } : {}),
    excerpt: resolvedExcerpt,
    excerptHash,
    contentVersionId: sourceVersion.contentVersionId,
    revision: sourceVersion.revision,
    contentHash: sourceVersion.contentHash,
    sourceVersion: { id: sourceVersion.contentVersionId, revision: sourceVersion.revision, contentHash: sourceVersion.contentHash },
    evidenceStatus: status.status,
    evidenceStatusReason: status.reason,
    ...(currentVersion && hasVersion(currentVersion) ? {
      currentVersionId: currentVersion.contentVersionId,
      currentRevision: currentVersion.revision,
      currentContentHash: currentVersion.contentHash,
      currentVersion: { id: currentVersion.contentVersionId, revision: currentVersion.revision, contentHash: currentVersion.contentHash }
    } : {}),
    provenance: sourceProvenance(raw, sourceVersion, excerptHash, evidenceId)
  };
  for (const key of ['index', 'score', 'pageNumber', 'pageAnchor', 'confidence', 'timeStart', 'timeEnd', 'speaker', 'selection', 'annotationId', 'startChar', 'endChar', 'startOffset', 'endOffset', 'kind', 'type', 'source']) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') output[key] = raw[key];
  }
  if (raw.quote !== undefined) output.quote = String(raw.quote).slice(0, EVIDENCE_MAX_EXCERPT);
  if (raw.snippet !== undefined) output.snippet = String(raw.snippet).slice(0, EVIDENCE_MAX_EXCERPT);
  const region = safeRegion(raw.region);
  if (region) output.region = region;
  return output;
}

export function bindEvidenceRefs(refs = [], getDocument = () => null) {
  const values = Array.isArray(refs) ? refs : refs == null ? [] : [refs];
  return values.map(ref => bindEvidenceRef(ref, getDocument(evidenceDocumentId(ref)))).filter(ref => ref.documentId || ref.evidenceStatus !== 'unavailable');
}

export function publicEvidenceRef(ref = {}) {
  return bindEvidenceRef(ref, {
    id: evidenceDocumentId(ref),
    title: ref.title,
    currentVersionId: ref.currentVersionId ?? ref.current?.id ?? null,
    revision: ref.currentRevision ?? ref.current?.revision ?? null,
    contentHash: ref.currentContentHash ?? ref.current?.contentHash ?? null
  });
}

export function sameEvidenceVersion(entry, document) {
  const result = classifyEvidence(entry, document);
  return result.status === 'current' || result.status === 'unverified';
}
