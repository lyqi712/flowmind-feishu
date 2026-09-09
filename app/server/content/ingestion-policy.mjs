export const SUCCESS_INGEST_ACTIONS = Object.freeze(['created', 'versioned', 'unchanged', 'restored', 'duplicate']);

export function hasExplicitExternalId(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const value = input.externalId;
  if (value === undefined || value === null) return false;
  return String(value).trim() !== '';
}

export function defaultUploadExternalId(fileHash, fileName) {
  return `upload:${fileHash}:${String(fileName || 'upload').toLowerCase()}`;
}

export function isSuccessIngestAction(action) {
  return SUCCESS_INGEST_ACTIONS.includes(action);
}

export function countIngestSuccess(stats = {}) {
  return Number(stats.created || 0) + Number(stats.versioned || 0) + Number(stats.unchanged || 0)
    + Number(stats.restored || 0) + Number(stats.duplicates || 0);
}

export function resolveIngestionJobStatus({ cancelled = false, jobError = false, stats = {} } = {}) {
  if (cancelled) return 'cancelled';
  if (jobError) return 'failed';
  const failed = Number(stats.failed || 0);
  const succeeded = countIngestSuccess(stats);
  if (failed > 0 && succeeded > 0) return 'partial';
  if (failed > 0) return 'failed';
  return 'completed';
}

export function shouldSkipIngestIndex({ index, startIndex = 0, outcomes = {}, hasOutcomes = false } = {}) {
  const prior = outcomes[String(index)];
  if (prior && isSuccessIngestAction(prior.action)) return true;
  if (!hasOutcomes && index < startIndex) return true;
  return false;
}

export function isOriginalAttachment(attachment) {
  return attachment?.externalId === 'original'
    || String(attachment?.externalId || '').startsWith('original:')
    || attachment?.metadata?.kind === 'original';
}

export function buildOriginalAttachment({ fileName, mimeType, bytes, fileHash } = {}) {
  if (!bytes?.length) return [];
  return [{
    externalId: 'original',
    fileName,
    mimeType: mimeType || 'application/octet-stream',
    byteSize: bytes.length,
    contentHash: fileHash,
    data: bytes,
    metadata: { kind: 'original', persisted: true }
  }];
}

export function emptyIngestStats(total) {
  return { total, processed: 0, created: 0, versioned: 0, unchanged: 0, restored: 0, duplicates: 0, failed: 0 };
}

export function applyIngestActionToStats(stats, action) {
  if (action === 'duplicate') stats.duplicates += 1;
  else if (action && Object.prototype.hasOwnProperty.call(stats, action)) stats[action] += 1;
  return stats;
}

export function statsFromSuccessfulOutcomes(outcomes, total) {
  const stats = emptyIngestStats(total);
  for (const outcome of Object.values(outcomes || {})) {
    if (isSuccessIngestAction(outcome?.action)) applyIngestActionToStats(stats, outcome.action);
  }
  return stats;
}
