import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { ContentBackupService, ContentIngestionService, ContentRepository, LATEST_SCHEMA_VERSION, splitContentIntoChunks } from '../server/content/index.mjs';

function tickingClock(start = '2026-08-03T00:00:00.000Z') {
  let tick = Date.parse(start);
  return () => new Date(tick++);
}

function repository(options = {}) {
  return new ContentRepository({ clock: tickingClock(), ...options });
}

function seed(repo) {
  const source = repo.upsertSourceConnection({ sourceType: 'feishu', externalId: 'tenant-a', name: 'Feishu Tenant A' });
  const space = repo.upsertSpace({ sourceConnectionId: source.id, externalId: 'wiki-a', name: 'Engineering Wiki' });
  return { source, space };
}

test('schema migrations support latest migration, FTS capability status, rollback, and remigration', () => {
  const repo = repository({ autoMigrate: false });
  try {
    assert.equal(repo.currentSchemaVersion(), 0);
    const migrated = repo.migrate();
    assert.equal(migrated.version, LATEST_SCHEMA_VERSION);
    assert.ok(['fts5', 'fallback'].includes(migrated.searchBackend));
    assert.equal(repo.tableExists('content_items'), true);

    const rolledToCore = repo.rollback(1);
    assert.equal(rolledToCore.version, 1);
    assert.equal(rolledToCore.searchBackend, 'fallback');
    assert.equal(repo.tableExists('content_fts'), false);
    assert.equal(repo.tableExists('content_items'), true);

    const rolledToZero = repo.rollback(0);
    assert.equal(rolledToZero.version, 0);
    assert.equal(repo.tableExists('content_items'), false);
    assert.equal(repo.tableExists('schema_migrations'), false);

    assert.equal(repo.migrate().version, LATEST_SCHEMA_VERSION);
    assert.equal(repo.tableExists('content_items'), true);
  } finally { repo.close(); }
});

test('SourceConnection and Space upsert are stable and source+externalId content upsert creates revision/hash versions', () => {
  const repo = repository({ forceSearchFallback: true });
  try {
    const { source, space } = seed(repo);
    const sameSource = repo.upsertSourceConnection({ sourceType: 'feishu', externalId: 'tenant-a', name: 'Renamed tenant' });
    const sameSpace = repo.upsertSpace({ sourceConnectionId: source.id, externalId: 'wiki-a', name: 'Renamed wiki' });
    assert.equal(sameSource.id, source.id);
    assert.equal(sameSpace.id, space.id);

    const first = repo.upsertContentItem({
      sourceConnectionId: source.id, spaceId: space.id, externalId: 'doc-1', contentType: 'docx',
      title: 'Architecture', content: 'Version one describes the content domain.', revision: '1',
      sourceModifiedAt: '2026-08-01T00:00:00Z', tags: ['architecture', { name: 'Core', color: '#3366ff' }]
    });
    assert.equal(first.action, 'created');
    assert.equal(first.versionCreated, true);

    const unchanged = repo.upsertContentItem({
      sourceConnectionId: source.id, spaceId: space.id, externalId: 'doc-1', contentType: 'docx',
      title: 'Architecture', content: 'Version one describes the content domain.', revision: '1'
    });
    assert.equal(unchanged.action, 'unchanged');
    assert.equal(unchanged.versionCreated, false);
    assert.equal(unchanged.item.id, first.item.id);

    const revised = repo.upsertContentItem({
      sourceConnectionId: source.id, spaceId: space.id, externalId: 'doc-1', contentType: 'docx',
      title: 'Architecture', content: 'Version two adds FTS and notes.', revision: '2', tags: ['architecture', 'search']
    });
    assert.equal(revised.action, 'versioned');
    assert.equal(revised.versionCreated, true);
    assert.notEqual(revised.item.contentHash, first.item.contentHash);
    assert.deepEqual(repo.getContentVersions(first.item.id).map((v) => v.revision), ['2', '1']);
    assert.deepEqual(revised.item.tags.map((tag) => tag.name), ['architecture', 'search']);
    assert.equal(repo.getCounts().content_items, 1);
    assert.equal(repo.getCounts().content_versions, 2);
  } finally { repo.close(); }
});

test('soft deletion hides content from lists/search and an idempotent upsert restores it', () => {
  const repo = repository({ forceSearchFallback: true });
  try {
    const { source, space } = seed(repo);
    const created = repo.upsertContentItem({ sourceConnectionId: source.id, spaceId: space.id,
      externalId: 'delete-me', title: 'Deleted guide', content: 'recoverable searchable phrase', revision: '1' });
    assert.equal(repo.searchContent('recoverable').length, 1);
    assert.equal(repo.softDeleteContentItem(created.item.id), true);
    assert.equal(repo.getContentItem(created.item.id), null);
    assert.ok(repo.getContentItem(created.item.id, { includeDeleted: true }).deletedAt);
    assert.equal(repo.listContentItems().length, 0);
    assert.equal(repo.searchContent('recoverable').length, 0);

    const restored = repo.upsertContentItem({ sourceConnectionId: source.id, spaceId: space.id,
      externalId: 'delete-me', title: 'Deleted guide', content: 'recoverable searchable phrase', revision: '1' });
    assert.equal(restored.action, 'restored');
    assert.equal(restored.versionCreated, false);
    assert.equal(repo.searchContent('recoverable').length, 1);
  } finally { repo.close(); }
});

test('query filters, tags, FTS5 when available, and deterministic fallback search return scoped results', () => {
  const repo = repository();
  try {
    const { source, space } = seed(repo);
    const otherSpace = repo.upsertSpace({ sourceConnectionId: source.id, externalId: 'wiki-b', name: 'Product Wiki' });
    repo.upsertContentItem({ sourceConnectionId: source.id, spaceId: space.id, externalId: 'a', contentType: 'docx',
      title: 'Vector Retrieval', content: 'semantic retrieval reranking pipeline', revision: '1', tags: ['ai', 'search'] });
    repo.upsertContentItem({ sourceConnectionId: source.id, spaceId: otherSpace.id, externalId: 'b', contentType: 'sheet',
      title: 'Budget', content: 'quarterly finance plan', revision: '1', tags: ['finance'] });
    repo.createNote({ title: 'Retrieval note', content: 'semantic chunking checklist', tags: ['ai'] });

    assert.equal(repo.listContentItems({ spaceId: space.id }).length, 1);
    assert.equal(repo.listContentItems({ contentType: 'sheet' }).length, 1);
    assert.equal(repo.listContentItems({ tags: ['finance'] })[0].title, 'Budget');
    assert.equal(repo.listContentItems({ contentTypes: ['docx', 'note'] }).length, 2);
    const catalog = repo.listContentItems({ includeContent: false, contentType: 'docx' });
    assert.equal(catalog.length, 1);
    assert.ok(!catalog[0].content);
    assert.match(repo.getContentItem(catalog[0].id).content, /semantic retrieval/);
    assert.equal(repo.searchContent('semantic').length, 2);
    assert.equal(repo.searchContent('semantic', { spaceId: space.id }).length, 1);
    assert.equal(repo.searchContent('semantic', { forceFallback: true }).length, 2);
    assert.ok(['fts5', 'fallback'].includes(repo.getSchemaStatus().searchBackend));
  } finally { repo.close(); }

  const fallback = repository({ forceSearchFallback: true });
  try {
    const { source, space } = seed(fallback);
    fallback.upsertContentItem({ sourceConnectionId: source.id, spaceId: space.id, externalId: 'fallback',
      title: 'Fallback Search', content: 'works without SQLite FTS5', revision: '1' });
    assert.equal(fallback.getSchemaStatus().searchBackend, 'fallback');
    assert.equal(fallback.searchContent('without SQLite')[0].externalId, 'fallback');
  } finally { fallback.close(); }
});

test('legacy state.json documents migrate idempotently and changed content adds exactly one version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ima-content-state-'));
  const statePath = join(directory, 'state.json');
  const dbPath = join(directory, 'content.sqlite');
  const state = {
    version: 1,
    knowledgeBases: [{ id: 'feishu-space', externalId: 'space-1', name: 'Feishu KB', source: 'feishu', documentCount: 2 }],
    sync: { cursor: 'cursor-1', lastCompletedAt: '2026-08-02T00:00:00Z' },
    documents: [
      { id: 'docx:one', externalId: 'one', title: 'One', content: 'first body', source: 'feishu', sourceType: 'docx',
        url: 'https://example.test/docx/one', updatedAt: '2026-08-01T00:00:00Z', metadata: { revision: 'r1', tags: ['one'] } },
      { id: 'docx:two', externalId: 'two', title: 'Two', content: 'second body', source: 'feishu', sourceType: 'docx',
        updatedAt: '2026-08-01T00:00:00Z', metadata: { revision: 'r1' } }
    ]
  };
  await writeFile(statePath, JSON.stringify(state), 'utf8');
  const repo = repository({ databasePath: dbPath, forceSearchFallback: true });
  try {
    const first = await repo.migrateStateJson(statePath);
    assert.equal(first.documents.created, 2);
    assert.deepEqual(repo.getCounts(), { source_connections: 1, spaces: 1, content_items: 2,
      content_versions: 2, tags: 1, attachments: 0, index_chunks: 2, ingestion_jobs: 0 });
    assert.equal(repo.searchIndexChunks('first body').length, 1);

    const second = await repo.migrateStateJson(statePath);
    assert.equal(second.documents.unchanged, 2);
    assert.equal(repo.getCounts().content_versions, 2);

    state.documents[0].content = 'first body changed';
    await writeFile(statePath, JSON.stringify(state), 'utf8');
    const third = await repo.migrateStateJson(statePath);
    assert.equal(third.documents.versioned, 1);
    assert.equal(third.documents.unchanged, 1);
    assert.equal(repo.getCounts().content_versions, 3);
    assert.equal(repo.getCounts().index_chunks, 2);
    assert.equal(repo.searchIndexChunks('changed').length, 1);
    assert.equal(repo.searchContent('changed')[0].externalId, 'one');
  } finally { repo.close(); await rm(directory, { recursive: true, force: true }); }
});

test('legacy documents without source metadata stay in the active knowledge base', () => {
  const repo = repository({ forceSearchFallback: true });
  try {
    repo.migrateLegacyState({
      settings: { activeKnowledgeBaseId: 'feishu-space' },
      knowledgeBases: [{ id: 'feishu-space', externalId: 'space-1', name: 'Feishu KB', source: 'feishu' }],
      documents: [{ id: 'legacy-doc', title: 'Release plan', content: 'Alice owns the release review.' }]
    });

    const item = repo.listContentItems()[0];
    const space = repo.listSpaces().find(candidate => candidate.id === item.spaceId);
    const source = repo.listSourceConnections().find(candidate => candidate.id === item.sourceConnectionId);
    assert.equal(space.externalId, 'space-1');
    assert.equal(source.sourceType, 'feishu');
    assert.equal(repo.listContentItems().length, 1);
  } finally { repo.close(); }
});

test('notes, attachments, chunks, and ingestion jobs share the content domain and remain updateable', () => {
  const repo = repository({ forceSearchFallback: true, idFactory: (() => { let id = 0; return () => `id-${++id}`; })() });
  try {
    const note = repo.createNote({ title: 'Meeting', content: 'Initial decisions', tags: ['meeting'] });
    assert.equal(note.item.contentType, 'note');
    const updated = repo.updateNote(note.item.id, { content: 'Updated decisions and actions', tags: ['meeting', 'action'] });
    assert.equal(updated.action, 'versioned');
    assert.equal(repo.getContentVersions(note.item.id).length, 2);

    const attachment = repo.upsertAttachment({ contentItemId: note.item.id, externalId: 'file-1', fileName: 'diagram.png',
      mimeType: 'image/png', byteSize: 1200, contentHash: 'abc' });
    const attachmentUpdated = repo.upsertAttachment({ contentItemId: note.item.id, externalId: 'file-1', fileName: 'diagram-v2.png', byteSize: 1300 });
    assert.equal(attachmentUpdated.id, attachment.id);
    assert.equal(repo.listAttachments(note.item.id).length, 1);

    const chunks = repo.replaceIndexChunks(note.item.id, [
      { text: 'Updated decisions', tokenCount: 2 },
      { text: 'Action owner and due date', tokenCount: 5, embeddingModel: 'test', embedding: [0.1, 0.2] }
    ]);
    assert.equal(chunks.length, 2);
    assert.equal(repo.searchIndexChunks('owner')[0].ordinal, 1);
    assert.equal(repo.replaceIndexChunks(note.item.id, ['replacement chunk']).length, 1);
    assert.equal(repo.listIndexChunks(note.item.id).length, 1);

    const { source, space } = repo.ensureLocalNotesSpace();
    const pending = repo.createIngestionJob({ sourceConnectionId: source.id, spaceId: space.id, dedupeKey: 'sync:notes', stats: { found: 1 } });
    assert.equal(repo.createIngestionJob({ dedupeKey: 'sync:notes' }).id, pending.id);
    const running = repo.updateIngestionJob(pending.id, { status: 'running', cursor: 'c1' });
    assert.ok(running.startedAt);
    const completed = repo.updateIngestionJob(pending.id, { status: 'completed', stats: { imported: 1 } });
    assert.ok(completed.completedAt);
    assert.deepEqual(completed.stats, { imported: 1 });
    assert.equal(repo.listIngestionJobs({ status: 'completed' }).length, 1);
  } finally { repo.close(); }
});

test('file-backed repository persists content and versions across close/reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ima-content-persist-'));
  const dbPath = join(directory, 'content.sqlite');
  let itemId;
  const first = repository({ databasePath: dbPath, forceSearchFallback: true });
  try {
    const { source, space } = seed(first);
    itemId = first.upsertContentItem({ sourceConnectionId: source.id, spaceId: space.id, externalId: 'persist',
      title: 'Persistent', content: 'survives restart', revision: '1' }).item.id;
  } finally { first.close(); }

  const reopened = repository({ databasePath: dbPath, forceSearchFallback: true });
  try {
    assert.equal(reopened.getContentItem(itemId).content, 'survives restart');
    assert.equal(reopened.getContentVersions(itemId).length, 1);
    assert.equal(reopened.searchContent('restart')[0].id, itemId);
  } finally { reopened.close(); await rm(directory, { recursive: true, force: true }); }
});


test('content ingestion parses local text formats, indexes chunks, isolates unsupported files, and deduplicates by hash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowmind-ingestion-'));
  const files = {
    txt: join(directory, 'guide.txt'), md: join(directory, 'notes.md'), html: join(directory, 'page.html'),
    csv: join(directory, 'table.csv'), json: join(directory, 'data.json'), duplicate: join(directory, 'guide-copy.txt'), binary: join(directory, 'archive.zip')
  };
  await Promise.all([
    writeFile(files.txt, 'FlowMind 导入指南\n支持断点恢复和内容去重。', 'utf8'),
    writeFile(files.md, '# 研究笔记\n\n这是 Markdown 正文。', 'utf8'),
    writeFile(files.html, '<html><style>.x{}</style><body><h1>网页资料</h1><p>正文 <b>内容</b></p></body></html>', 'utf8'),
    writeFile(files.csv, '任务,负责人\n联调,小飞\n测试,小明', 'utf8'),
    writeFile(files.json, JSON.stringify({ status: 'ok', count: 2 }), 'utf8'),
    writeFile(files.duplicate, 'FlowMind 导入指南\n支持断点恢复和内容去重。', 'utf8'),
    writeFile(files.binary, Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  ]);
  const repo = repository({ forceSearchFallback: true });
  try {
    const service = new ContentIngestionService({ repository: repo, chunkOptions: { maxChars: 280, overlapChars: 40 } });
    const result = await service.ingest({ items: Object.values(files), dedupeKey: 'local-fixtures' });
    assert.equal(result.job.status, 'completed');
    assert.equal(result.stats.processed, 7);
    assert.equal(result.stats.created, 5);
    assert.equal(result.stats.duplicates, 1);
    assert.equal(result.stats.failed, 1);
    assert.equal(result.warnings[0].code, 'CONTENT_PARSER_UNSUPPORTED');
    assert.equal(repo.listContentItems({ sourceConnectionId: result.source.id }).length, 5);
    assert.match(repo.searchContent('负责人')[0].content, /\| 任务 \| 负责人 \|/);
    assert.match(repo.searchContent('网页资料')[0].content, /正文 内容/);
    const guide = repo.searchContent('断点恢复')[0];
    assert.ok(repo.listIndexChunks(guide.id).length >= 1);
    assert.equal(guide.metadata.aliasPaths.length, 1);
  } finally { repo.close(); await rm(directory, { recursive: true, force: true }); }
});

test('content ingestion creates versions for changed files and does not create versions for unchanged retries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowmind-versioned-file-'));
  const file = join(directory, 'daily.md');
  await writeFile(file, '# 日报\n第一版', 'utf8');
  const repo = repository({ forceSearchFallback: true });
  try {
    const service = new ContentIngestionService({ repository: repo });
    const first = await service.ingest({ items: [file] });
    const itemId = first.results[0].item.id;
    const unchanged = await service.ingest({ items: [file] });
    assert.equal(unchanged.results[0].action, 'unchanged');
    assert.equal(repo.getContentVersions(itemId).length, 1);
    await writeFile(file, '# 日报\n第二版：增加验收结果', 'utf8');
    const revised = await service.ingest({ items: [file] });
    assert.equal(revised.results[0].action, 'versioned');
    assert.equal(repo.getContentVersions(itemId).length, 2);
    assert.match(repo.getContentItem(itemId).content, /第二版/);
  } finally { repo.close(); await rm(directory, { recursive: true, force: true }); }
});

test('cancelled ingestion persists cursor and resumes remaining items without duplicating completed work', async () => {
  const repo = repository({ forceSearchFallback: true });
  try {
    const service = new ContentIngestionService({ repository: repo });
    const items = [
      { externalId: 'inline-1', title: '一', content: '第一项正文' },
      { externalId: 'inline-2', title: '二', content: '第二项正文' },
      { externalId: 'inline-3', title: '三', content: '第三项正文' }
    ];
    const controller = new AbortController(); let cancelledJob;
    await assert.rejects(service.ingest({ items, signal: controller.signal, onProgress({ stats }) { if (stats.processed === 1) controller.abort(); } }), (error) => {
      cancelledJob = error.job; return error.code === 'INGESTION_CANCELLED' && error.job.status === 'cancelled';
    });
    assert.equal(cancelledJob.cursor, '1');
    assert.equal(repo.getCounts().content_items, 1);
    const resumed = await service.ingest({ items, jobId: cancelledJob.id });
    assert.equal(resumed.job.status, 'completed');
    assert.equal(resumed.job.cursor, '3');
    assert.equal(resumed.stats.created, 3);
    assert.equal(repo.getCounts().content_items, 3);
  } finally { repo.close(); }
});

test('chunk splitter produces bounded overlapping anchors for citation positioning', () => {
  const content = Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 段：用于验证引用定位和长文档懒加载。`).join('\n\n');
  const chunks = splitContentIntoChunks(content, { maxChars: 320, overlapChars: 48 });
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 320));
  assert.match(chunks[0].metadata.anchor, /^chars:\d+-\d+$/);
  assert.ok(chunks[1].metadata.startChar < chunks[0].metadata.endChar, '相邻块应有重叠，避免边界丢失上下文');
});


test('content backup round-trips sources, spaces, versions, tags, attachments and chunks without secrets or local paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowmind-backup-'));
  const backupPath = join(directory, 'backup', 'content.flowmind.json');
  const sourceRepo = repository({ forceSearchFallback: true });
  const targetRepo = repository({ forceSearchFallback: true });
  try {
    const source = sourceRepo.upsertSourceConnection({ sourceType: 'feishu', externalId: 'tenant-backup', name: '飞书备份', config: { appSecret: 'must-not-export', endpoint: 'https://example.test' } });
    const space = sourceRepo.upsertSpace({ sourceConnectionId: source.id, externalId: 'space-backup', name: '备份空间' });
    const first = sourceRepo.upsertContentItem({ sourceConnectionId: source.id, spaceId: space.id, externalId: 'doc-backup', contentType: 'docx', title: '备份文档', content: '第一版正文', revision: '1', metadata: { localPath: 'D:/private/source.txt', appSecret: 'nested-secret', category: 'research' }, tags: ['备份', '研究'] });
    const second = sourceRepo.upsertContentItem({ sourceConnectionId: source.id, spaceId: space.id, externalId: 'doc-backup', contentType: 'docx', title: '备份文档', content: '第二版正文和检索词 Hermes', revision: '2', metadata: { localPath: 'D:/private/source.txt', category: 'research' }, tags: ['备份', '研究'] });
    const attachment = sourceRepo.upsertAttachment({ contentItemId: second.item.id, externalId: 'attachment-1', fileName: '附件.txt', mimeType: 'text/plain', localPath: 'D:/private/attachment.txt', sourceUrl: 'https://example.test/file', data: Buffer.from('persisted-attachment-bytes') });
    sourceRepo.upsertAnnotation({ contentItemId: second.item.id, attachmentId: attachment.id, pageNumber: 2, anchor: 'page:2:text', quote: 'Hermes', comment: '备份标注', color: 'blue', selector: { rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }] } });
    sourceRepo.replaceIndexChunks(second.item.id, splitContentIntoChunks(second.item.content, { maxChars: 240 }), { contentVersionId: second.item.currentVersionId });
    assert.equal(sourceRepo.getContentVersions(first.item.id).length, 2);

    const backups = new ContentBackupService({ repository: sourceRepo, clock: () => new Date('2026-08-03T10:00:00.000Z') });
    const archive = backups.createArchive();
    assert.equal(backups.verifyArchive(archive).ok, true);
    const raw = JSON.stringify(archive);
    assert.doesNotMatch(raw, /must-not-export|nested-secret|D:\/private\/source|D:\/private\/attachment/);
    assert.match(raw, /Hermes/);
    const written = await backups.writeArchive(backupPath);
    assert.equal(written.ok, true);

    const restore = new ContentBackupService({ repository: targetRepo });
    const restored = await restore.restoreFile(backupPath);
    assert.equal(restored.ok, true);
    assert.deepEqual(restored.restored, { sources: 1, spaces: 1, items: 1 });
    const restoredItem = targetRepo.searchContent('Hermes')[0];
    assert.equal(targetRepo.getContentVersions(restoredItem.id).length, 2);
    assert.deepEqual(restoredItem.tags.map((tag) => tag.name).sort(), ['备份', '研究']);
    assert.equal(targetRepo.listAttachments(restoredItem.id).length, 1);
    assert.equal(targetRepo.listAttachments(restoredItem.id)[0].localPath, null);
    assert.deepEqual(targetRepo.getAttachmentData(targetRepo.listAttachments(restoredItem.id)[0].id), Buffer.from('persisted-attachment-bytes'));
    assert.equal(targetRepo.listAnnotations(restoredItem.id).length, 1);
    assert.equal(targetRepo.listAnnotations(restoredItem.id)[0].comment, '备份标注');
    assert.ok(targetRepo.listIndexChunks(restoredItem.id).length >= 1);
  } finally { sourceRepo.close(); targetRepo.close(); await rm(directory, { recursive: true, force: true }); }
});

test('content backup rejects checksum tampering and replace-content removes stale active items', () => {
  const sourceRepo = repository({ forceSearchFallback: true });
  const targetRepo = repository({ forceSearchFallback: true });
  try {
    const seeded = seed(sourceRepo);
    sourceRepo.upsertContentItem({ sourceConnectionId: seeded.source.id, spaceId: seeded.space.id, externalId: 'fresh', title: '新内容', content: '来自备份', revision: '1' });
    const archive = new ContentBackupService({ repository: sourceRepo }).createArchive();
    const tampered = structuredClone(archive); tampered.payload.items[0].item.title = '被篡改';
    assert.throws(() => new ContentBackupService({ repository: targetRepo }).restoreArchive(tampered), (error) => error.code === 'BACKUP_CHECKSUM_INVALID');

    const stale = seed(targetRepo);
    const staleItem = targetRepo.upsertContentItem({ sourceConnectionId: stale.source.id, spaceId: stale.space.id, externalId: 'stale', title: '旧内容', content: '应被软删除', revision: '1' }).item;
    const restored = new ContentBackupService({ repository: targetRepo }).restoreArchive(archive, { mode: 'replace-content' });
    assert.equal(restored.ok, true);
    assert.equal(targetRepo.getContentItem(staleItem.id), null);
    assert.equal(targetRepo.searchContent('来自备份').length, 1);
  } finally { sourceRepo.close(); targetRepo.close(); }
});


function zipFixture(entries, { method = 8 } = {}) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8'), data = Buffer.from(value, 'utf8'), compressed = method === 8 ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26); nameBytes.copy(local, 30);
    locals.push(local, compressed);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42); nameBytes.copy(central, 46);
    centrals.push(central); offset += local.length + compressed.length;
  }
  const centralData = Buffer.concat(centrals), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(centrals.length, 8); eocd.writeUInt16LE(centrals.length, 10); eocd.writeUInt32LE(centralData.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralData, eocd]);
}

test('built-in ZIP parsers ingest DOCX, PPTX, XLSX, EPUB and XMind without external runtime dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowmind-office-'));
  const files = {
    docx: join(directory, '方案.docx'), pptx: join(directory, '汇报.pptx'), xlsx: join(directory, '清单.xlsx'), epub: join(directory, '手册.epub'), xmind: join(directory, '脑图.xmind')
  };
  await Promise.all([
    writeFile(files.docx, zipFixture({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>项目方案</w:t></w:r></w:p><w:p><w:r><w:t>包含飞书同步与 MCP 接入。</w:t></w:r></w:p></w:body></w:document>' })),
    writeFile(files.pptx, zipFixture({ 'ppt/slides/slide1.xml': '<p:sld><a:t>第一页标题</a:t><a:t>市场背景</a:t></p:sld>', 'ppt/slides/slide2.xml': '<p:sld><a:t>第二页</a:t><a:t>行动计划</a:t></p:sld>' }, { method: 0 })),
    writeFile(files.xlsx, zipFixture({
      'xl/workbook.xml': '<workbook><sheets><sheet name="任务清单" sheetId="1"/></sheets></workbook>',
      'xl/sharedStrings.xml': '<sst><si><t>任务</t></si><si><t>负责人</t></si><si><t>联调</t></si><si><t>小飞</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>'
    })),
    writeFile(files.epub, zipFixture({ 'mimetype': 'application/epub+zip', 'OEBPS/chapter1.xhtml': '<html><body><h1>第一章</h1><p>知识工作流</p></body></html>', 'OEBPS/chapter2.xhtml': '<html><body><h1>第二章</h1><p>自动化验收</p></body></html>' })),
    writeFile(files.xmind, zipFixture({ 'content.json': JSON.stringify([{ rootTopic: { title: 'FlowMind', children: { attached: [{ title: '飞书' }, { title: 'MCP' }] } } }]) }))
  ]);
  const repo = repository({ forceSearchFallback: true });
  try {
    const result = await new ContentIngestionService({ repository: repo }).ingest({ items: Object.values(files) });
    assert.equal(result.stats.created, 5); assert.equal(result.stats.failed, 0);
    assert.match(repo.searchContent('飞书同步')[0].content, /MCP 接入/);
    assert.match(repo.searchContent('行动计划')[0].content, /第 2 页/);
    assert.match(repo.searchContent('负责人')[0].content, /\| 任务 \| 负责人 \|/);
    assert.match(repo.searchContent('自动化验收')[0].content, /章节 2/);
    assert.match(repo.searchContent('FlowMind')[0].content, /- 飞书/);
    assert.deepEqual(result.results.map((entry) => entry.item.contentType).sort(), ['docx', 'epub', 'pptx', 'xlsx', 'xmind']);
  } finally { repo.close(); await rm(directory, { recursive: true, force: true }); }
});
