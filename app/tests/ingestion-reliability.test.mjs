import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ContentIngestionService, ContentRepository } from '../server/content/index.mjs';
import { defaultUploadExternalId, resolveIngestionJobStatus } from '../server/content/ingestion-policy.mjs';

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function tickingClock(start = '2026-08-03T00:00:00.000Z') {
  let tick = Date.parse(start);
  return () => new Date(tick++);
}
function repository(options = {}) { return new ContentRepository({ databasePath: ':memory:', ...options }); }
function originals(repo, itemId) {
  return repo.listAttachments(itemId).filter((attachment) => attachment.externalId === 'original' || String(attachment.externalId || '').startsWith('original:') || attachment.metadata?.kind === 'original');
}

test('upload identity is independent of basename; same bytes retry is unchanged', async () => {
  const repo = repository();
  try {
    const service = new ContentIngestionService({ repository: repo });
    const first = await service.ingest({ items: [{ fileName: 'report.txt', bytes: Buffer.from('PROJECT_ALPHA_UNIQUE_CONTENT') }] });
    const second = await service.ingest({ items: [{ fileName: 'report.txt', bytes: Buffer.from('PROJECT_BETA_DIFFERENT_CONTENT') }] });
    assert.notEqual(first.results[0].item.id, second.results[0].item.id);
    assert.equal(repo.listContentItems().length, 2);
    assert.equal(second.results[0].action, 'created');
    assert.notEqual(first.results[0].item.externalId, `upload:${sha256('report.txt').slice(0, 32)}`);
    const retry = await service.ingest({ items: [{ fileName: 'report.txt', bytes: Buffer.from('PROJECT_ALPHA_UNIQUE_CONTENT') }] });
    assert.equal(retry.results[0].action, 'unchanged');
    assert.equal(retry.results[0].item.id, first.results[0].item.id);
    assert.equal(repo.listContentItems().length, 2);
  } finally { repo.close(); }
});

test('same content under a different upload name is deduped without a new identity', async () => {
  const repo = repository();
  try {
    const service = new ContentIngestionService({ repository: repo });
    const bytes = Buffer.from('SHARED_UPLOAD_BODY_FOR_ALIAS');
    const first = await service.ingest({ items: [{ fileName: 'alpha.txt', bytes }] });
    const second = await service.ingest({ items: [{ fileName: 'beta.txt', bytes }] });
    assert.equal(second.results[0].action, 'duplicate');
    assert.equal(second.results[0].item.id, first.results[0].item.id);
    assert.equal(repo.listContentItems().length, 1);
    assert.deepEqual(second.results[0].item.metadata.aliasFileNames, ['beta.txt']);
    assert.equal(second.results[0].item.metadata.fileName, 'alpha.txt');
  } finally { repo.close(); }
});

test('explicit externalId versions an existing file; omitted id does not rewrite a legacy basename identity', async () => {
  const repo = repository();
  try {
    const service = new ContentIngestionService({ repository: repo });
    const fileName = 'report.txt';
    const legacyId = `upload:${sha256(fileName.toLowerCase()).slice(0, 32)}`;
    const originalBytes = Buffer.from('LEGACY_REPORT_BODY');
    const seeded = await service.ingest({ items: [{ fileName, bytes: originalBytes, externalId: legacyId }] });
    assert.equal(seeded.results[0].item.externalId, legacyId);
    const aliased = await service.ingest({ items: [{ fileName: 'report-copy.txt', bytes: originalBytes }] });
    assert.equal(aliased.results[0].action, 'duplicate');
    assert.equal(aliased.results[0].item.id, seeded.results[0].item.id);
    const renamed = await service.ingest({ items: [{ fileName, bytes: Buffer.from('NEW_REPORT_BODY_NOT_LEGACY') }] });
    assert.equal(renamed.results[0].action, 'created');
    assert.notEqual(renamed.results[0].item.id, seeded.results[0].item.id);
    assert.equal(repo.getContentItem(seeded.results[0].item.id).content.includes('LEGACY_REPORT_BODY'), true);
    const versioned = await service.ingest({ items: [{ fileName, bytes: Buffer.from('EXPLICIT_VERSION_BODY'), externalId: legacyId }] });
    assert.equal(versioned.results[0].action, 'versioned');
    assert.equal(versioned.results[0].item.id, seeded.results[0].item.id);
    assert.equal(repo.getContentVersions(seeded.results[0].item.id).length, 2);
    assert.match(repo.getContentItem(seeded.results[0].item.id).content, /EXPLICIT_VERSION_BODY/);
  } finally { repo.close(); }
});

test('all-failed import is failed not completed; partial stays partial; resume retries unsuccessful items', async () => {
  const repo = repository();
  try {
    const service = new ContentIngestionService({ repository: repo });
    const failed = await service.ingest({ items: [
      { fileName: 'one.flowmind', bytes: Buffer.from('bad-1') },
      { fileName: 'two.flowmind', bytes: Buffer.from('bad-2') }
    ] });
    assert.equal(failed.job.status, 'failed');
    assert.equal(failed.stats.failed, 2);
    assert.equal(failed.stats.created, 0);
    assert.equal(failed.results.length, 0);
    assert.equal(failed.warnings.length, 2);
    assert.equal(resolveIngestionJobStatus({ stats: failed.stats }), 'failed');

    const mixed = await service.ingest({ items: [
      { fileName: 'skip.flowmind', bytes: Buffer.from('bad') },
      { fileName: 'ok.txt', bytes: Buffer.from('PARTIAL_OK_BODY') }
    ] });
    assert.equal(mixed.job.status, 'partial');
    assert.equal(mixed.stats.failed, 1);
    assert.equal(mixed.stats.created, 1);
    assert.equal(mixed.warnings[0].code, 'CONTENT_PARSER_UNSUPPORTED');

    const resumedSame = await service.ingest({ items: [
      { fileName: 'skip.flowmind', bytes: Buffer.from('bad') },
      { fileName: 'ok.txt', bytes: Buffer.from('PARTIAL_OK_BODY') }
    ], jobId: mixed.job.id });
    assert.equal(resumedSame.job.status, 'partial');
    assert.equal(resumedSame.stats.failed, 1);
    assert.equal(resumedSame.stats.created, 1);
    assert.equal(resumedSame.stats.unchanged, 0);
    assert.equal(repo.listContentItems().length, 1);

    const recovered = await service.ingest({ items: [
      { fileName: 'recovered.txt', bytes: Buffer.from('RECOVERED_FAILED_SLOT') },
      { fileName: 'ok.txt', bytes: Buffer.from('PARTIAL_OK_BODY') }
    ], jobId: mixed.job.id });
    assert.equal(recovered.job.status, 'completed');
    assert.equal(recovered.stats.failed, 0);
    assert.equal(recovered.stats.created, 2);
    assert.equal(recovered.warnings.length, 0);
    assert.equal(repo.listContentItems().length, 2);
    assert.ok(repo.searchContent('RECOVERED_FAILED_SLOT')[0]);
  } finally { repo.close(); }
});

test('supported uploads keep original bytes once per version and do not bloat on unchanged retry', async () => {
  const repo = repository();
  try {
    const service = new ContentIngestionService({ repository: repo });
    const textBytes = Buffer.from('# 原件保留\n正文用于确认非 PDF 也存附件。');
    const first = await service.ingest({ items: [{ fileName: 'notes.md', bytes: textBytes }] });
    const itemId = first.results[0].item.id;
    assert.equal(originals(repo, itemId).length, 1);
    assert.deepEqual(repo.getAttachmentData(repo.getOriginalAttachment(itemId).id), textBytes);
    const retry = await service.ingest({ items: [{ fileName: 'notes.md', bytes: textBytes }] });
    assert.equal(retry.results[0].action, 'unchanged');
    assert.equal(originals(repo, itemId).length, 1);
    const jsonBytes = Buffer.from('{"keep":"original-json"}');
    const jsonItem = await service.ingest({ items: [{ fileName: 'data.json', bytes: jsonBytes }] });
    assert.equal(originals(repo, jsonItem.results[0].item.id).length, 1);
    assert.deepEqual(repo.getAttachmentData(repo.getOriginalAttachment(jsonItem.results[0].item.id).id), jsonBytes);
    const versioned = await service.ingest({ items: [{ fileName: 'notes.md', bytes: Buffer.from('# 原件保留\n第二版'), externalId: first.results[0].item.externalId }] });
    assert.equal(versioned.results[0].action, 'versioned');
    assert.equal(originals(repo, itemId).length, 2);
    const current = repo.getOriginalAttachment(itemId);
    assert.equal(current.metadata.contentVersionId, repo.getContentItem(itemId).currentVersionId);
  } finally { repo.close(); }
});

test('parseUploadedFile uses content identity unless externalId is explicit', async () => {
  const repo = repository();
  try {
    const service = new ContentIngestionService({ repository: repo });
    const bytes = Buffer.from('PARSER_IDENTITY_BODY');
    const parsed = await service.parseUploadedFile({ fileName: 'same.txt', bytes });
    assert.equal(parsed.externalId, defaultUploadExternalId(sha256(bytes), 'same.txt'));
    assert.equal(parsed.explicitExternalId, false);
    assert.equal(parsed.attachments[0].metadata.kind, 'original');
    const explicit = await service.parseUploadedFile({ fileName: 'same.txt', bytes, externalId: 'keep-this-id' });
    assert.equal(explicit.externalId, 'keep-this-id');
    assert.equal(explicit.explicitExternalId, true);
  } finally { repo.close(); }
});

test('index or original-attachment failure rolls back the item and does not count created plus failed', async () => {
  const repo = repository();
  const replace = repo.replaceIndexChunks.bind(repo);
  const upsertAttachment = repo.upsertAttachment.bind(repo);
  try {
    const service = new ContentIngestionService({ repository: repo });
    repo.replaceIndexChunks = () => { throw Object.assign(new Error('injected index failure'), { code: 'INDEX_INJECTED_FAIL' }); };
    const indexed = await service.ingest({ items: [{ fileName: 'rollback.txt', bytes: Buffer.from('ROLLBACK_INDEX_MARKER') }] });
    assert.equal(indexed.job.status, 'failed');
    assert.equal(indexed.stats.created, 0);
    assert.equal(indexed.stats.failed, 1);
    assert.equal(indexed.warnings[0].code, 'INDEX_INJECTED_FAIL');
    assert.equal(repo.listContentItems().length, 0);
    assert.equal(repo.searchContent('ROLLBACK_INDEX_MARKER').length, 0);

    repo.replaceIndexChunks = replace;
    repo.upsertAttachment = () => { throw Object.assign(new Error('injected attachment failure'), { code: 'ATTACH_INJECTED_FAIL' }); };
    const attached = await service.ingest({ items: [{ fileName: 'rollback.md', bytes: Buffer.from('# ROLLBACK_ATTACH_MARKER') }] });
    assert.equal(attached.job.status, 'failed');
    assert.equal(attached.stats.created, 0);
    assert.equal(attached.stats.failed, 1);
    assert.equal(attached.warnings[0].code, 'ATTACH_INJECTED_FAIL');
    assert.equal(repo.listContentItems().length, 0);
    assert.equal(repo.listContentItems({ includeDeleted: true }).length, 0);
  } finally {
    repo.replaceIndexChunks = replace;
    repo.upsertAttachment = upsertAttachment;
    repo.close();
  }
});

test('duplicate import backfills a missing original without writing a second blob', async () => {
  const repo = repository();
  try {
    const service = new ContentIngestionService({ repository: repo });
    const bytes = Buffer.from('LEGACY_MISSING_ORIGINAL_BODY');
    const fileHash = sha256(bytes);
    const target = service.ensureTarget();
    const seeded = repo.upsertContentItem({
      sourceConnectionId: target.source.id, spaceId: target.space.id, externalId: 'legacy-no-original',
      title: 'Legacy', content: 'LEGACY_MISSING_ORIGINAL_BODY', revision: fileHash,
      metadata: { fileHash, fileName: 'legacy.txt', uploaded: true }
    });
    assert.equal(originals(repo, seeded.item.id).length, 0);
    const backfill = await service.ingest({ items: [{ fileName: 'copy.txt', bytes }] });
    assert.equal(backfill.results[0].action, 'duplicate');
    assert.equal(backfill.results[0].item.id, seeded.item.id);
    assert.equal(originals(repo, seeded.item.id).length, 1);
    assert.deepEqual(repo.getAttachmentData(repo.getOriginalAttachment(seeded.item.id).id), bytes);
    const retry = await service.ingest({ items: [{ fileName: 'copy-2.txt', bytes }] });
    assert.equal(retry.results[0].action, 'duplicate');
    assert.equal(originals(repo, seeded.item.id).length, 1);
  } finally { repo.close(); }
});

test('hash duplicate lookup finds the 1001st item instead of stopping at the list window', async () => {
  const repo = repository({ forceSearchFallback: true, clock: tickingClock() });
  try {
    const service = new ContentIngestionService({ repository: repo });
    const target = service.ensureTarget();
    const bytes = Buffer.from('DEEP_HASH_TARGET_BODY');
    const fileHash = sha256(bytes);
    const deep = repo.upsertContentItem({
      sourceConnectionId: target.source.id, spaceId: target.space.id, externalId: 'deep-target',
      title: 'Deep', content: 'DEEP_HASH_TARGET_BODY', metadata: { fileHash, fileName: 'deep.txt' }
    });
    for (let index = 0; index < 1000; index += 1) {
      repo.upsertContentItem({
        sourceConnectionId: target.source.id, spaceId: target.space.id, externalId: `fill-${index}`,
        title: `Fill ${index}`, content: `fill body ${index}`, metadata: { fileHash: sha256(`fill-${index}`) }
      });
    }
    const window = repo.listContentItems({ sourceConnectionId: target.source.id, limit: 1000 });
    assert.equal(window.length, 1000);
    assert.equal(window.some((item) => item.id === deep.item.id), false);
    const found = await service.ingest({ items: [{ fileName: 'alias.txt', bytes }] });
    assert.equal(found.results[0].action, 'duplicate');
    assert.equal(found.results[0].item.id, deep.item.id);
  } finally { repo.close(); }
});
