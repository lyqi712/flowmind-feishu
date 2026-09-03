import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from './migrations.mjs';
import { splitContentIntoChunks } from './ingestion.mjs';

function required(value, name) {
  if (value === undefined || value === null || value === '') throw new TypeError(`${name} is required`);
  return value;
}
function iso(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
function json(value, fallback = {}) { return JSON.stringify(value ?? fallback); }
function parseJson(value, fallback = {}) {
  if (value === null || value === undefined || value === '') return structuredClone(fallback);
  try { return JSON.parse(value); } catch { return structuredClone(fallback); }
}
function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
  }
  return value;
}
function stableStringify(value) { return JSON.stringify(stableObject(value)); }
function digest(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function stableId(prefix, ...parts) { return `${prefix}_${digest(parts.join('\u001f')).slice(0, 24)}`; }
function placeholders(count) { return Array.from({ length: count }, () => '?').join(','); }

function sourceFromRow(row) {
  if (!row) return null;
  return { id: row.id, sourceType: row.source_type, name: row.name, externalId: row.external_id,
    config: parseJson(row.config_json), status: row.status, syncCursor: row.sync_cursor,
    lastSyncedAt: row.last_synced_at, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at };
}
function spaceFromRow(row) {
  if (!row) return null;
  return { id: row.id, sourceConnectionId: row.source_connection_id, externalId: row.external_id,
    parentId: row.parent_id, spaceType: row.space_type, name: row.name, description: row.description,
    sourceUrl: row.source_url, metadata: parseJson(row.metadata_json), createdAt: row.created_at,
    updatedAt: row.updated_at, deletedAt: row.deleted_at };
}
function versionFromRow(row) {
  if (!row) return null;
  return { id: row.id, contentItemId: row.content_item_id, revision: row.revision,
    contentHash: row.content_hash, title: row.title, content: row.content, metadata: parseJson(row.metadata_json),
    sourceModifiedAt: row.source_modified_at, createdAt: row.created_at };
}
function itemFromRow(row) {
  if (!row) return null;
  return { id: row.id, sourceConnectionId: row.source_connection_id, spaceId: row.space_id,
    externalId: row.external_id, parentExternalId: row.parent_external_id, contentType: row.content_type,
    title: row.title, content: row.current_content, currentContentLength: row.current_content_length ?? undefined, revision: row.revision, contentHash: row.content_hash,
    currentVersionId: row.current_version_id, mimeType: row.mime_type, sourceUrl: row.source_url,
    author: parseJson(row.author_json, null), sourceCreatedAt: row.source_created_at,
    sourceModifiedAt: row.source_modified_at, metadata: parseJson(row.metadata_json), createdAt: row.created_at,
    updatedAt: row.updated_at, ingestedAt: row.ingested_at, deletedAt: row.deleted_at,
    rank: row.search_rank ?? undefined };
}
function attachmentFromRow(row) {
  if (!row) return null;
  return { id: row.id, contentItemId: row.content_item_id, externalId: row.external_id,
    fileName: row.file_name, mimeType: row.mime_type, byteSize: row.byte_size, contentHash: row.content_hash,
    sourceUrl: row.source_url, localPath: row.local_path, metadata: parseJson(row.metadata_json),
    createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at };
}
function annotationFromRow(row) {
  if (!row) return null;
  return { id: row.id, contentItemId: row.content_item_id, attachmentId: row.attachment_id,
    pageNumber: row.page_number, anchor: row.anchor, quote: row.quote, comment: row.comment, color: row.color,
    selector: parseJson(row.selector_json), metadata: parseJson(row.metadata_json), createdAt: row.created_at,
    updatedAt: row.updated_at, deletedAt: row.deleted_at };
}
function chunkFromRow(row) {
  if (!row) return null;
  return { id: row.id, contentItemId: row.content_item_id, contentVersionId: row.content_version_id,
    ordinal: row.ordinal, text: row.text, tokenCount: row.token_count, contentHash: row.content_hash,
    embeddingModel: row.embedding_model, embedding: parseJson(row.embedding_json, null),
    metadata: parseJson(row.metadata_json), createdAt: row.created_at, updatedAt: row.updated_at };
}
function jobFromRow(row) {
  if (!row) return null;
  return { id: row.id, sourceConnectionId: row.source_connection_id, spaceId: row.space_id,
    jobType: row.job_type, status: row.status, dedupeKey: row.dedupe_key, cursor: row.cursor,
    stats: parseJson(row.stats_json), error: parseJson(row.error_json, null), metadata: parseJson(row.metadata_json),
    startedAt: row.started_at, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

export class ContentRepository {
  constructor({ databasePath = ':memory:', clock = () => new Date(), idFactory = () => randomUUID(),
    forceSearchFallback = false, autoMigrate = true } = {}) {
    this.databasePath = databasePath;
    this.clock = clock;
    this.idFactory = idFactory;
    this.forceSearchFallback = forceSearchFallback;
    this.db = new DatabaseSync(databasePath);
    this.closed = false;
    this.transactionDepth = 0;
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (databasePath !== ':memory:') try { this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;'); } catch {}
    if (autoMigrate) this.migrate();
  }
  now() { return this.clock().toISOString(); }
  close() { if (!this.closed) { this.db.close(); this.closed = true; } }
  transaction(fn) {
    if (this.transactionDepth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE;'); this.transactionDepth += 1;
    try { const result = fn(); this.db.exec('COMMIT;'); return result; }
    catch (error) { try { this.db.exec('ROLLBACK;'); } catch {} throw error; }
    finally { this.transactionDepth -= 1; }
  }
  tableExists(name) { return Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE name = ? LIMIT 1").get(name)); }
  ensureMigrationTable() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    );`);
  }
  setMeta(key, value) {
    if (!this.tableExists('repository_meta')) return;
    this.db.prepare(`INSERT INTO repository_meta(key, value, updated_at) VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(key, String(value), this.now());
  }
  getMeta(key) {
    if (!this.tableExists('repository_meta')) return null;
    return this.db.prepare('SELECT value FROM repository_meta WHERE key = ?').get(key)?.value ?? null;
  }
  currentSchemaVersion() {
    if (!this.tableExists('schema_migrations')) return 0;
    return Number(this.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version);
  }
  migrate(targetVersion = LATEST_SCHEMA_VERSION) {
    if (!Number.isInteger(targetVersion) || targetVersion < 0 || targetVersion > LATEST_SCHEMA_VERSION) throw new RangeError('invalid targetVersion');
    this.ensureMigrationTable();
    const applied = new Set(this.db.prepare('SELECT version FROM schema_migrations').all().map((row) => Number(row.version)));
    for (const migration of MIGRATIONS) {
      if (migration.version > targetVersion || applied.has(migration.version)) continue;
      this.transaction(() => {
        migration.up(this.db, this);
        this.db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)')
          .run(migration.version, migration.name, this.now());
      });
    }
    return this.getSchemaStatus();
  }
  rollback(targetVersion = 0) {
    if (!Number.isInteger(targetVersion) || targetVersion < 0 || targetVersion > LATEST_SCHEMA_VERSION) throw new RangeError('invalid targetVersion');
    if (!this.tableExists('schema_migrations')) return this.getSchemaStatus();
    const applied = this.db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC').all().map((row) => Number(row.version));
    for (const version of applied) {
      if (version <= targetVersion) continue;
      const migration = MIGRATIONS.find((item) => item.version === version);
      if (!migration) throw new Error(`Missing down migration for version ${version}`);
      this.transaction(() => {
        this.db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(version);
        migration.down(this.db, this);
      });
    }
    return this.getSchemaStatus();
  }
  getSchemaStatus() {
    const version = this.currentSchemaVersion();
    return { version, latestVersion: LATEST_SCHEMA_VERSION, searchBackend: this.getMeta('search_backend') || 'unavailable',
      fts5Error: this.getMeta('fts5_error'), migrated: version === LATEST_SCHEMA_VERSION };
  }
  upsertSourceConnection(input) {
    required(input, 'input');
    const sourceType = String(required(input.sourceType, 'sourceType'));
    const externalId = input.externalId == null ? null : String(input.externalId);
    const existing = (externalId !== null
      ? this.db.prepare('SELECT * FROM source_connections WHERE source_type = ? AND external_id = ?').get(sourceType, externalId)
      : null) || (input.id ? this.db.prepare('SELECT * FROM source_connections WHERE id = ?').get(String(input.id)) : null);
    const id = existing?.id || input.id || stableId('src', sourceType, externalId || input.name || this.idFactory());
    const now = this.now();
    this.db.prepare(`INSERT INTO source_connections(
      id, source_type, name, external_id, config_json, status, sync_cursor, last_synced_at, created_at, updated_at, deleted_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET source_type=excluded.source_type, name=excluded.name, external_id=excluded.external_id,
      config_json=excluded.config_json, status=excluded.status, sync_cursor=excluded.sync_cursor,
      last_synced_at=excluded.last_synced_at, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`).run(
      id, sourceType, String(input.name || existing?.name || sourceType), externalId,
      json(input.config ?? parseJson(existing?.config_json)), input.status || existing?.status || 'active',
      input.syncCursor ?? existing?.sync_cursor ?? null, iso(input.lastSyncedAt) ?? existing?.last_synced_at ?? null,
      existing?.created_at || now, now, input.deletedAt === undefined ? existing?.deleted_at ?? null : iso(input.deletedAt));
    return this.getSourceConnection(id);
  }
  getSourceConnection(id) { return sourceFromRow(this.db.prepare('SELECT * FROM source_connections WHERE id = ?').get(id)); }
  listSourceConnections({ includeDeleted = false, sourceType, status } = {}) {
    const where = [], params = [];
    if (!includeDeleted) where.push('deleted_at IS NULL');
    if (sourceType) { where.push('source_type = ?'); params.push(sourceType); }
    if (status) { where.push('status = ?'); params.push(status); }
    return this.db.prepare(`SELECT * FROM source_connections${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY name, id`).all(...params).map(sourceFromRow);
  }
  upsertSpace(input) {
    const sourceConnectionId = String(required(input?.sourceConnectionId, 'sourceConnectionId'));
    const externalId = String(required(input.externalId, 'externalId'));
    if (!this.getSourceConnection(sourceConnectionId)) throw new Error(`SourceConnection not found: ${sourceConnectionId}`);
    const existing = this.db.prepare('SELECT * FROM spaces WHERE source_connection_id = ? AND external_id = ?').get(sourceConnectionId, externalId)
      || (input.id ? this.db.prepare('SELECT * FROM spaces WHERE id = ?').get(String(input.id)) : null);
    const id = existing?.id || input.id || stableId('space', sourceConnectionId, externalId), now = this.now();
    this.db.prepare(`INSERT INTO spaces(id, source_connection_id, external_id, parent_id, space_type, name, description,
      source_url, metadata_json, created_at, updated_at, deleted_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET source_connection_id=excluded.source_connection_id, external_id=excluded.external_id,
      parent_id=excluded.parent_id, space_type=excluded.space_type, name=excluded.name, description=excluded.description,
      source_url=excluded.source_url, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`).run(
      id, sourceConnectionId, externalId, input.parentId ?? existing?.parent_id ?? null, input.spaceType || existing?.space_type || 'knowledge-base',
      String(input.name || existing?.name || externalId), String(input.description ?? existing?.description ?? ''),
      input.sourceUrl ?? existing?.source_url ?? null, json(input.metadata ?? parseJson(existing?.metadata_json)),
      existing?.created_at || now, now, input.deletedAt === undefined ? existing?.deleted_at ?? null : iso(input.deletedAt));
    return this.getSpace(id);
  }
  getSpace(id) { return spaceFromRow(this.db.prepare('SELECT * FROM spaces WHERE id = ?').get(id)); }
  listSpaces({ sourceConnectionId, includeDeleted = false, parentId } = {}) {
    const where = [], params = [];
    if (!includeDeleted) where.push('deleted_at IS NULL');
    if (sourceConnectionId) { where.push('source_connection_id = ?'); params.push(sourceConnectionId); }
    if (parentId !== undefined) { if (parentId === null) where.push('parent_id IS NULL'); else { where.push('parent_id = ?'); params.push(parentId); } }
    return this.db.prepare(`SELECT * FROM spaces${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY name, id`).all(...params).map(spaceFromRow);
  }
  contentHash({ title = '', content = '' }) { return digest(stableStringify({ title: String(title), content: String(content) })); }
  upsertContentItem(input) {
    const sourceConnectionId = String(required(input?.sourceConnectionId, 'sourceConnectionId'));
    const externalId = String(required(input.externalId, 'externalId'));
    if (!this.getSourceConnection(sourceConnectionId)) throw new Error(`SourceConnection not found: ${sourceConnectionId}`);
    if (input.spaceId && !this.getSpace(input.spaceId)) throw new Error(`Space not found: ${input.spaceId}`);
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM content_items WHERE source_connection_id = ? AND external_id = ?').get(sourceConnectionId, externalId)
        || (input.id ? this.db.prepare('SELECT * FROM content_items WHERE id = ?').get(String(input.id)) : null);
      const id = existing?.id || input.id || stableId('item', sourceConnectionId, externalId);
      const title = String(input.title ?? existing?.title ?? ''), content = String(input.content ?? existing?.current_content ?? '');
      const contentHash = String(input.contentHash || this.contentHash({ title, content }));
      const sourceModifiedAt = iso(input.sourceModifiedAt) ?? existing?.source_modified_at ?? null;
      const revision = String(input.revision ?? sourceModifiedAt ?? contentHash.slice(0, 16));
      const now = this.now(), sameVersion = existing && existing.revision === revision && existing.content_hash === contentHash;
      const restored = Boolean(existing?.deleted_at);
      let versionId = existing?.current_version_id ?? null, versionCreated = false;
      if (!existing) {
        this.db.prepare(`INSERT INTO content_items(
          id, source_connection_id, space_id, external_id, parent_external_id, content_type, title, current_content,
          revision, content_hash, current_version_id, mime_type, source_url, author_json, source_created_at,
          source_modified_at, metadata_json, created_at, updated_at, ingested_at, deleted_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
          id, sourceConnectionId, input.spaceId ?? null, externalId, input.parentExternalId ?? null,
          input.contentType || 'document', title, content, revision, contentHash, input.mimeType ?? null,
          input.sourceUrl ?? null, input.author == null ? null : json(input.author), iso(input.sourceCreatedAt),
          sourceModifiedAt, json(input.metadata), now, now, now);
      } else {
        this.db.prepare(`UPDATE content_items SET source_connection_id=?, space_id=?, external_id=?, parent_external_id=?,
          content_type=?, title=?, current_content=?, revision=?, content_hash=?, mime_type=?, source_url=?, author_json=?,
          source_created_at=?, source_modified_at=?, metadata_json=?, updated_at=?, ingested_at=?, deleted_at=NULL WHERE id=?`).run(
          sourceConnectionId, input.spaceId ?? existing.space_id, externalId, input.parentExternalId ?? existing.parent_external_id,
          input.contentType || existing.content_type, title, content, revision, contentHash, input.mimeType ?? existing.mime_type,
          input.sourceUrl ?? existing.source_url, input.author === undefined ? existing.author_json : input.author == null ? null : json(input.author),
          iso(input.sourceCreatedAt) ?? existing.source_created_at, sourceModifiedAt,
          json(input.metadata ?? parseJson(existing.metadata_json)), now, now, id);
      }
      if (!sameVersion) {
        const prior = this.db.prepare('SELECT * FROM content_versions WHERE content_item_id = ? AND revision = ? AND content_hash = ?')
          .get(id, revision, contentHash);
        if (prior) versionId = prior.id;
        else {
          const inserted = this.db.prepare(`INSERT INTO content_versions(
            content_item_id, revision, content_hash, title, content, metadata_json, source_modified_at, created_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`).run(id, revision, contentHash, title, content, json(input.metadata), sourceModifiedAt, now);
          versionId = Number(inserted.lastInsertRowid); versionCreated = true;
        }
        this.db.prepare('UPDATE content_items SET current_version_id = ? WHERE id = ?').run(versionId, id);
        this.db.prepare('DELETE FROM index_chunks WHERE content_item_id = ? AND content_version_id IS NOT ?').run(id, versionId);
      }
      this.syncSearchIndex(id, title, content);
      if (Array.isArray(input.tags)) this.setContentTags(id, input.tags);
      return { action: !existing ? 'created' : sameVersion ? (restored ? 'restored' : 'unchanged') : 'versioned',
        versionCreated, restored, item: this.getContentItem(id, { includeDeleted: true }),
        version: versionId ? versionFromRow(this.db.prepare('SELECT * FROM content_versions WHERE id = ?').get(versionId)) : null };
    });
  }
  syncSearchIndex(contentItemId, title, content) {
    this.db.prepare(`INSERT INTO content_search_fallback(content_item_id, title, content) VALUES(?, ?, ?)
      ON CONFLICT(content_item_id) DO UPDATE SET title=excluded.title, content=excluded.content`).run(contentItemId, title, content);
    if (this.getSchemaStatus().searchBackend === 'fts5' && this.tableExists('content_fts')) {
      this.db.prepare('DELETE FROM content_fts WHERE content_item_id = ?').run(contentItemId);
      this.db.prepare('INSERT INTO content_fts(content_item_id, title, content) VALUES(?, ?, ?)').run(contentItemId, title, content);
    }
  }
  removeSearchIndex(contentItemId) {
    this.db.prepare('DELETE FROM content_search_fallback WHERE content_item_id = ?').run(contentItemId);
    if (this.tableExists('content_fts')) this.db.prepare('DELETE FROM content_fts WHERE content_item_id = ?').run(contentItemId);
  }
  getContentItem(id, { includeDeleted = false, includeTags = true } = {}) {
    const item = itemFromRow(this.db.prepare(`SELECT * FROM content_items WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`).get(id));
    if (item && includeTags) item.tags = this.getContentTags(id);
    return item;
  }
  getContentItemByExternal(sourceConnectionId, externalId, options = {}) {
    const row = this.db.prepare('SELECT id FROM content_items WHERE source_connection_id = ? AND external_id = ?').get(sourceConnectionId, externalId);
    return row ? this.getContentItem(row.id, options) : null;
  }
  listContentItems(filters = {}) {
    if (filters.search) return this.searchContent(filters.search, filters);
    const where = [], params = [];
    if (!filters.includeDeleted) where.push('c.deleted_at IS NULL');
    if (filters.sourceConnectionId) { where.push('c.source_connection_id = ?'); params.push(filters.sourceConnectionId); }
    if (filters.spaceId) { where.push('c.space_id = ?'); params.push(filters.spaceId); }
    if (filters.externalId) { where.push('c.external_id = ?'); params.push(filters.externalId); }
    if (filters.contentType) { where.push('c.content_type = ?'); params.push(filters.contentType); }
    if (Array.isArray(filters.contentTypes) && filters.contentTypes.length) { where.push(`c.content_type IN (${placeholders(filters.contentTypes.length)})`); params.push(...filters.contentTypes); }
    if (Array.isArray(filters.excludeContentTypes) && filters.excludeContentTypes.length) { where.push(`c.content_type NOT IN (${placeholders(filters.excludeContentTypes.length)})`); params.push(...filters.excludeContentTypes); }
    if (filters.modifiedAfter) { where.push('COALESCE(c.source_modified_at, c.updated_at) >= ?'); params.push(iso(filters.modifiedAfter)); }
    if (Array.isArray(filters.tags) && filters.tags.length) {
      where.push(`EXISTS (SELECT 1 FROM content_item_tags cit JOIN tags t ON t.id = cit.tag_id
        WHERE cit.content_item_id = c.id AND t.name IN (${placeholders(filters.tags.length)}))`); params.push(...filters.tags);
    }
    const sortColumns = { updatedAt: 'c.updated_at', title: 'c.title', sourceModifiedAt: 'c.source_modified_at', createdAt: 'c.created_at' };
    const sort = sortColumns[filters.sortBy] || 'c.updated_at', direction = String(filters.sortDirection).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const maxLimit = filters.includeContent === false ? 2000 : 1000;
    const limit = Math.max(1, Math.min(Number(filters.limit) || 100, maxLimit)), offset = Math.max(0, Number(filters.offset) || 0);
    const columns = filters.includeContent === false
      ? 'c.id, c.source_connection_id, c.space_id, c.external_id, c.parent_external_id, c.content_type, c.title, c.revision, c.content_hash, c.current_version_id, c.mime_type, c.source_url, c.author_json, c.source_created_at, c.source_modified_at, c.metadata_json, c.created_at, c.updated_at, c.ingested_at, c.deleted_at, NULL AS current_content, length(c.current_content) AS current_content_length'
      : 'c.*';
    return this.db.prepare(`SELECT ${columns} FROM content_items c ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${sort} ${direction}, c.id ASC LIMIT ? OFFSET ?`).all(...params, limit, offset).map((row) => {
        const item = itemFromRow(row); if (filters.includeTags !== false) item.tags = this.getContentTags(item.id); return item;
      });
  }
  getContentVersions(contentItemId, { limit = 100 } = {}) {
    return this.db.prepare('SELECT * FROM content_versions WHERE content_item_id = ? ORDER BY id DESC LIMIT ?')
      .all(contentItemId, Math.max(1, Math.min(Number(limit) || 100, 1000))).map(versionFromRow);
  }
  getContentVersion(contentItemId, versionId) {
    const row = this.db.prepare('SELECT * FROM content_versions WHERE content_item_id = ? AND id = ?').get(String(contentItemId), Number(versionId));
    return versionFromRow(row);
  }
  softDeleteContentItem(id, deletedAt = this.now()) {
    return this.transaction(() => {
      const result = this.db.prepare('UPDATE content_items SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(iso(deletedAt), this.now(), id);
      if (Number(result.changes)) this.removeSearchIndex(id);
      return Number(result.changes) > 0;
    });
  }
  upsertTag(input) {
    const data = typeof input === 'string' ? { name: input } : input, name = String(required(data?.name, 'tag.name')).trim();
    const existing = this.db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE').get(name);
    const id = existing?.id || data.id || stableId('tag', name.toLowerCase()), now = this.now();
    this.db.prepare(`INSERT INTO tags(id, name, color, metadata_json, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`).run(
      id, name, data.color ?? existing?.color ?? null, json(data.metadata ?? parseJson(existing?.metadata_json)), existing?.created_at || now, now);
    return { id, name, color: data.color ?? existing?.color ?? null, metadata: data.metadata ?? parseJson(existing?.metadata_json), createdAt: existing?.created_at || now, updatedAt: now };
  }
  setContentTags(contentItemId, tags) {
    if (!this.getContentItem(contentItemId, { includeDeleted: true, includeTags: false })) throw new Error(`ContentItem not found: ${contentItemId}`);
    return this.transaction(() => {
      this.db.prepare('DELETE FROM content_item_tags WHERE content_item_id = ?').run(contentItemId);
      const now = this.now();
      for (const input of tags || []) { const tag = this.upsertTag(input); this.db.prepare('INSERT OR IGNORE INTO content_item_tags(content_item_id, tag_id, created_at) VALUES(?, ?, ?)').run(contentItemId, tag.id, now); }
      return this.getContentTags(contentItemId);
    });
  }
  getContentTags(contentItemId) {
    return this.db.prepare(`SELECT t.id, t.name, t.color, t.metadata_json, t.created_at, t.updated_at FROM tags t
      JOIN content_item_tags cit ON cit.tag_id = t.id WHERE cit.content_item_id = ? ORDER BY t.name COLLATE NOCASE`).all(contentItemId)
      .map((row) => ({ id: row.id, name: row.name, color: row.color, metadata: parseJson(row.metadata_json), createdAt: row.created_at, updatedAt: row.updated_at }));
  }
  listTags() {
    return this.db.prepare(`SELECT t.*, COUNT(cit.content_item_id) AS item_count FROM tags t LEFT JOIN content_item_tags cit ON cit.tag_id = t.id
      GROUP BY t.id ORDER BY t.name COLLATE NOCASE`).all().map((row) => ({ id: row.id, name: row.name, color: row.color,
      metadata: parseJson(row.metadata_json), itemCount: Number(row.item_count), createdAt: row.created_at, updatedAt: row.updated_at }));
  }
  normalizeSearchQuery(query) {
    const tokens = String(query).match(/[\p{L}\p{N}_-]+/gu) || [];
    return tokens.slice(0, 20).map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ');
  }
  searchContent(query, filters = {}) {
    const raw = String(required(query, 'query')).trim(), backend = filters.forceFallback ? 'fallback' : this.getSchemaStatus().searchBackend;
    const where = filters.includeDeleted ? [] : ['c.deleted_at IS NULL'], params = [];
    if (filters.sourceConnectionId) { where.push('c.source_connection_id = ?'); params.push(filters.sourceConnectionId); }
    if (filters.sourceType) { where.push('EXISTS (SELECT 1 FROM source_connections sc WHERE sc.id = c.source_connection_id AND sc.source_type = ?)'); params.push(String(filters.sourceType)); }
    if (filters.spaceId) { where.push('c.space_id = ?'); params.push(filters.spaceId); }
    if (filters.contentType) { where.push('c.content_type = ?'); params.push(filters.contentType); }
    if (Array.isArray(filters.contentTypes) && filters.contentTypes.length) { where.push(`c.content_type IN (${placeholders(filters.contentTypes.length)})`); params.push(...filters.contentTypes); }
    if (Array.isArray(filters.excludeContentTypes) && filters.excludeContentTypes.length) { where.push(`c.content_type NOT IN (${placeholders(filters.excludeContentTypes.length)})`); params.push(...filters.excludeContentTypes); }
    if (Array.isArray(filters.tags) && filters.tags.length) { where.push(`EXISTS (SELECT 1 FROM content_item_tags cit JOIN tags t ON t.id = cit.tag_id
      WHERE cit.content_item_id = c.id AND LOWER(t.name) IN (${placeholders(filters.tags.length)}))`); params.push(...filters.tags.map((tag) => String(tag).toLocaleLowerCase())); }
    const limit = Math.max(1, Math.min(Number(filters.limit) || 50, 500));
    let rows;
    if (backend === 'fts5' && this.tableExists('content_fts')) {
      const ftsQuery = this.normalizeSearchQuery(raw); if (!ftsQuery) return [];
      rows = this.db.prepare(`SELECT c.*, bm25(content_fts) AS search_rank FROM content_fts JOIN content_items c ON c.id = content_fts.content_item_id
        WHERE content_fts MATCH ?${where.length ? ` AND ${where.join(' AND ')}` : ''} ORDER BY search_rank ASC, c.updated_at DESC LIMIT ?`).all(ftsQuery, ...params, limit);
    } else {
      const like = `%${raw.toLocaleLowerCase()}%`;
      rows = this.db.prepare(`SELECT c.*, 0 AS search_rank FROM content_search_fallback s JOIN content_items c ON c.id = s.content_item_id
        WHERE (LOWER(s.title) LIKE ? OR LOWER(s.content) LIKE ?) ${where.length ? `AND ${where.join(' AND ')}` : ''}
        ORDER BY CASE WHEN LOWER(s.title) LIKE ? THEN 0 ELSE 1 END, c.updated_at DESC LIMIT ?`).all(like, like, ...params, like, limit);
    }
    return rows.map((row) => { const item = itemFromRow(row); if (filters.includeTags !== false) item.tags = this.getContentTags(item.id); return item; });
  }
  countSearchContent(query, filters = {}) {
    const raw = String(required(query, 'query')).trim(), backend = filters.forceFallback ? 'fallback' : this.getSchemaStatus().searchBackend;
    const where = filters.includeDeleted ? [] : ['c.deleted_at IS NULL'], params = [];
    if (filters.sourceConnectionId) { where.push('c.source_connection_id = ?'); params.push(filters.sourceConnectionId); }
    if (filters.sourceType) { where.push('EXISTS (SELECT 1 FROM source_connections sc WHERE sc.id = c.source_connection_id AND sc.source_type = ?)'); params.push(String(filters.sourceType)); }
    if (filters.spaceId) { where.push('c.space_id = ?'); params.push(filters.spaceId); }
    if (filters.contentType) { where.push('c.content_type = ?'); params.push(filters.contentType); }
    if (Array.isArray(filters.contentTypes) && filters.contentTypes.length) { where.push(`c.content_type IN (${placeholders(filters.contentTypes.length)})`); params.push(...filters.contentTypes); }
    if (Array.isArray(filters.excludeContentTypes) && filters.excludeContentTypes.length) { where.push(`c.content_type NOT IN (${placeholders(filters.excludeContentTypes.length)})`); params.push(...filters.excludeContentTypes); }
    if (Array.isArray(filters.tags) && filters.tags.length) { where.push(`EXISTS (SELECT 1 FROM content_item_tags cit JOIN tags t ON t.id = cit.tag_id
      WHERE cit.content_item_id = c.id AND LOWER(t.name) IN (${placeholders(filters.tags.length)}))`); params.push(...filters.tags.map((tag) => String(tag).toLocaleLowerCase())); }
    if (backend === 'fts5' && this.tableExists('content_fts')) {
      const ftsQuery = this.normalizeSearchQuery(raw); if (!ftsQuery) return 0;
      return Number(this.db.prepare(`SELECT COUNT(*) AS total FROM content_fts JOIN content_items c ON c.id = content_fts.content_item_id
        WHERE content_fts MATCH ?${where.length ? ` AND ${where.join(' AND ')}` : ''}`).get(ftsQuery, ...params)?.total || 0);
    }
    const like = `%${raw.toLocaleLowerCase()}%`;
    return Number(this.db.prepare(`SELECT COUNT(*) AS total FROM content_search_fallback s JOIN content_items c ON c.id = s.content_item_id
      WHERE (LOWER(s.title) LIKE ? OR LOWER(s.content) LIKE ?) ${where.length ? `AND ${where.join(' AND ')}` : ''}`).get(like, like, ...params)?.total || 0);
  }
  upsertAttachment(input) {
    const contentItemId = String(required(input?.contentItemId, 'contentItemId'));
    if (!this.getContentItem(contentItemId, { includeDeleted: true, includeTags: false })) throw new Error(`ContentItem not found: ${contentItemId}`);
    const externalId = input.externalId == null ? null : String(input.externalId);
    const existing = input.id ? this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(input.id)
      : externalId !== null ? this.db.prepare('SELECT * FROM attachments WHERE content_item_id = ? AND external_id = ?').get(contentItemId, externalId) : null;
    const id = existing?.id || input.id || stableId('attachment', contentItemId, externalId || input.fileName || this.idFactory()), now = this.now();
    this.db.prepare(`INSERT INTO attachments(id, content_item_id, external_id, file_name, mime_type, byte_size, content_hash,
      source_url, local_path, metadata_json, created_at, updated_at, deleted_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET content_item_id=excluded.content_item_id, external_id=excluded.external_id,
      file_name=excluded.file_name, mime_type=excluded.mime_type, byte_size=excluded.byte_size, content_hash=excluded.content_hash,
      source_url=excluded.source_url, local_path=excluded.local_path, metadata_json=excluded.metadata_json,
      updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`).run(
      id, contentItemId, externalId, String(required(input.fileName ?? existing?.file_name, 'fileName')),
      input.mimeType ?? existing?.mime_type ?? null, input.byteSize ?? existing?.byte_size ?? null,
      input.contentHash ?? existing?.content_hash ?? null, input.sourceUrl ?? existing?.source_url ?? null,
      input.localPath ?? existing?.local_path ?? null, json(input.metadata ?? parseJson(existing?.metadata_json)),
      existing?.created_at || now, now, input.deletedAt === undefined ? existing?.deleted_at ?? null : iso(input.deletedAt));
    const binary = input.data ?? input.bytes ?? input.blob;
    if (binary !== undefined && binary !== null) {
      const data = Buffer.isBuffer(binary) ? binary : binary instanceof Uint8Array ? Buffer.from(binary) : Buffer.from(String(binary), input.encoding === 'base64' ? 'base64' : 'utf8');
      this.db.prepare(`INSERT INTO attachment_blobs(attachment_id, data, created_at, updated_at) VALUES(?, ?, ?, ?)
        ON CONFLICT(attachment_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`)
        .run(id, data, existing?.created_at || now, now);
    }
    return attachmentFromRow(this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id));
  }
  getAttachment(id, { includeDeleted = false } = {}) {
    const row = this.db.prepare(`SELECT * FROM attachments WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`).get(String(id));
    return attachmentFromRow(row);
  }
  listAttachments(contentItemId, { includeDeleted = false } = {}) {
    return this.db.prepare(`SELECT * FROM attachments WHERE content_item_id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'} ORDER BY file_name, id`)
      .all(contentItemId).map(attachmentFromRow);
  }
  getAttachmentData(id) {
    const row = this.db.prepare('SELECT data FROM attachment_blobs WHERE attachment_id = ?').get(String(id));
    return row?.data == null ? null : Buffer.from(row.data);
  }
  getOriginalAttachment(contentItemId, { contentVersionId } = {}) {
    const item = this.getContentItem(contentItemId, { includeDeleted: true, includeTags: false });
    const targetVersionId = contentVersionId || item?.currentVersionId;
    const originals = this.listAttachments(contentItemId).filter((attachment) => attachment.externalId === 'original' || attachment.externalId?.startsWith('original:') || attachment.metadata?.kind === 'original');
    return originals.find((attachment) => targetVersionId && attachment.metadata?.contentVersionId === targetVersionId)
      || originals.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0]
      || null;
  }
  upsertAnnotation(input) {
    const contentItemId = String(required(input?.contentItemId, 'contentItemId'));
    if (!this.getContentItem(contentItemId, { includeDeleted: true, includeTags: false })) throw new Error(`ContentItem not found: ${contentItemId}`);
    const pageNumber = Math.trunc(Number(required(input.pageNumber, 'pageNumber')));
    if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new RangeError('pageNumber must be a positive integer');
    const existing = input.id ? this.db.prepare('SELECT * FROM annotations WHERE id = ?').get(String(input.id)) : null;
    const attachmentId = input.attachmentId ?? existing?.attachment_id ?? null;
    if (attachmentId) {
      const attachment = this.getAttachment(attachmentId, { includeDeleted: true });
      if (!attachment || attachment.contentItemId !== contentItemId) throw Object.assign(new Error('attachmentId must belong to the same content item'), { code: 'ANNOTATION_ATTACHMENT_INVALID' });
    }
    const id = existing?.id || input.id || stableId('annotation', contentItemId, pageNumber, input.anchor || '', this.idFactory());
    const now = this.now();
    this.db.prepare(`INSERT INTO annotations(id, content_item_id, attachment_id, page_number, anchor, quote, comment, color,
      selector_json, metadata_json, created_at, updated_at, deleted_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET attachment_id=excluded.attachment_id, page_number=excluded.page_number, anchor=excluded.anchor,
      quote=excluded.quote, comment=excluded.comment, color=excluded.color, selector_json=excluded.selector_json,
      metadata_json=excluded.metadata_json, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`).run(
      id, contentItemId, attachmentId, pageNumber,
      String(input.anchor || existing?.anchor || `page:${pageNumber}`), String(input.quote ?? existing?.quote ?? ''),
      String(input.comment ?? existing?.comment ?? ''), String(input.color || existing?.color || 'yellow'),
      json(input.selector ?? parseJson(existing?.selector_json)), json(input.metadata ?? parseJson(existing?.metadata_json)),
      existing?.created_at || now, now, input.deletedAt === undefined ? existing?.deleted_at ?? null : iso(input.deletedAt));
    return annotationFromRow(this.db.prepare('SELECT * FROM annotations WHERE id = ?').get(id));
  }
  getAnnotation(id, { includeDeleted = false } = {}) {
    return annotationFromRow(this.db.prepare(`SELECT * FROM annotations WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`).get(String(id)));
  }
  listAnnotations(contentItemId, { includeDeleted = false, pageNumber } = {}) {
    const where = ['content_item_id = ?'], params = [String(contentItemId)];
    if (!includeDeleted) where.push('deleted_at IS NULL');
    if (pageNumber !== undefined && pageNumber !== null && pageNumber !== '') { where.push('page_number = ?'); params.push(Math.trunc(Number(pageNumber))); }
    return this.db.prepare(`SELECT * FROM annotations WHERE ${where.join(' AND ')} ORDER BY page_number, created_at, id`).all(...params).map(annotationFromRow);
  }
  softDeleteAnnotation(id, deletedAt = this.now()) {
    const result = this.db.prepare('UPDATE annotations SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(iso(deletedAt), this.now(), String(id));
    return result.changes > 0;
  }
  replaceIndexChunks(contentItemId, chunks, { contentVersionId } = {}) {
    const item = this.getContentItem(contentItemId, { includeDeleted: true, includeTags: false });
    if (!item) throw new Error(`ContentItem not found: ${contentItemId}`);
    const versionId = contentVersionId ?? item.currentVersionId;
    return this.transaction(() => {
      this.db.prepare('DELETE FROM index_chunks WHERE content_item_id = ?').run(contentItemId);
      const now = this.now(), output = [];
      for (let ordinal = 0; ordinal < (chunks || []).length; ordinal += 1) {
        const input = typeof chunks[ordinal] === 'string' ? { text: chunks[ordinal] } : chunks[ordinal];
        const text = String(required(input.text, `chunks[${ordinal}].text`)), hash = input.contentHash || digest(text);
        const id = input.id || stableId('chunk', contentItemId, ordinal, hash);
        this.db.prepare(`INSERT INTO index_chunks(id, content_item_id, content_version_id, ordinal, text, token_count,
          content_hash, embedding_model, embedding_json, metadata_json, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id, contentItemId, versionId, ordinal, text, input.tokenCount ?? null, hash, input.embeddingModel ?? null,
          input.embedding == null ? null : json(input.embedding), json(input.metadata), now, now);
        output.push(chunkFromRow(this.db.prepare('SELECT * FROM index_chunks WHERE id = ?').get(id)));
      }
      return output;
    });
  }
  listIndexChunks(contentItemId) {
    return this.db.prepare('SELECT * FROM index_chunks WHERE content_item_id = ? ORDER BY ordinal').all(contentItemId).map(chunkFromRow);
  }
  searchIndexChunks(query, { contentItemId, limit = 20 } = {}) {
    const like = `%${String(required(query, 'query')).toLocaleLowerCase()}%`, where = ['LOWER(text) LIKE ?'], params = [like];
    if (contentItemId) { where.push('content_item_id = ?'); params.push(contentItemId); }
    return this.db.prepare(`SELECT * FROM index_chunks WHERE ${where.join(' AND ')} ORDER BY content_item_id, ordinal LIMIT ?`)
      .all(...params, Math.max(1, Math.min(Number(limit) || 20, 500))).map(chunkFromRow);
  }
  createIngestionJob(input = {}) {
    if (input.dedupeKey) { const existing = this.db.prepare('SELECT * FROM ingestion_jobs WHERE dedupe_key = ?').get(String(input.dedupeKey)); if (existing) return jobFromRow(existing); }
    const now = this.now(), id = input.id || `job_${this.idFactory()}`;
    this.db.prepare(`INSERT INTO ingestion_jobs(id, source_connection_id, space_id, job_type, status, dedupe_key,
      cursor, stats_json, error_json, metadata_json, started_at, completed_at, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.sourceConnectionId ?? null, input.spaceId ?? null, input.jobType || 'sync', input.status || 'pending',
      input.dedupeKey ?? null, input.cursor ?? null, json(input.stats), input.error == null ? null : json(input.error),
      json(input.metadata), iso(input.startedAt), iso(input.completedAt), now, now);
    return this.getIngestionJob(id);
  }
  updateIngestionJob(id, patch = {}) {
    const existing = this.db.prepare('SELECT * FROM ingestion_jobs WHERE id = ?').get(id);
    if (!existing) throw new Error(`IngestionJob not found: ${id}`);
    const status = patch.status || existing.status, now = this.now();
    const startedAt = patch.startedAt !== undefined ? iso(patch.startedAt) : existing.started_at || (status === 'running' ? now : null);
    const completedAt = patch.completedAt !== undefined ? iso(patch.completedAt)
      : existing.completed_at || (['completed', 'failed', 'cancelled'].includes(status) ? now : null);
    this.db.prepare(`UPDATE ingestion_jobs SET source_connection_id=?, space_id=?, job_type=?, status=?, dedupe_key=?,
      cursor=?, stats_json=?, error_json=?, metadata_json=?, started_at=?, completed_at=?, updated_at=? WHERE id=?`).run(
      patch.sourceConnectionId ?? existing.source_connection_id, patch.spaceId ?? existing.space_id,
      patch.jobType || existing.job_type, status, patch.dedupeKey ?? existing.dedupe_key, patch.cursor ?? existing.cursor,
      json(patch.stats ?? parseJson(existing.stats_json)), patch.error === undefined ? existing.error_json : patch.error == null ? null : json(patch.error),
      json(patch.metadata ?? parseJson(existing.metadata_json)), startedAt, completedAt, now, id);
    return this.getIngestionJob(id);
  }
  getIngestionJob(id) { return jobFromRow(this.db.prepare('SELECT * FROM ingestion_jobs WHERE id = ?').get(id)); }
  listIngestionJobs({ status, sourceConnectionId, limit = 100 } = {}) {
    const where = [], params = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (sourceConnectionId) { where.push('source_connection_id = ?'); params.push(sourceConnectionId); }
    return this.db.prepare(`SELECT * FROM ingestion_jobs${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, Math.max(1, Math.min(Number(limit) || 100, 1000))).map(jobFromRow);
  }
  ensureLocalNotesSpace() {
    const source = this.upsertSourceConnection({ sourceType: 'local', externalId: 'local-notes', name: 'Local Notes', status: 'active' });
    const space = this.upsertSpace({ sourceConnectionId: source.id, externalId: 'notes', name: 'Notes', spaceType: 'notes' });
    return { source, space };
  }
  createNote({ title = '', content = '', tags = [], metadata = {}, externalId, ...rest } = {}) {
    const { source, space } = this.ensureLocalNotesSpace(), noteExternalId = externalId || `note:${this.idFactory()}`;
    return this.upsertContentItem({ ...rest, sourceConnectionId: source.id, spaceId: rest.spaceId || space.id,
      externalId: noteExternalId, contentType: 'note', title, content,
      revision: rest.revision || `note-${this.now()}-${digest(`${title}\n${content}`).slice(0, 8)}`, metadata, tags });
  }
  updateNote(id, patch = {}) {
    const existing = this.getContentItem(id, { includeDeleted: true });
    if (!existing) throw new Error(`ContentItem not found: ${id}`);
    if (existing.contentType !== 'note') throw new Error(`ContentItem is not a note: ${id}`);
    return this.upsertContentItem({ sourceConnectionId: existing.sourceConnectionId, spaceId: patch.spaceId ?? existing.spaceId,
      externalId: existing.externalId, parentExternalId: patch.parentExternalId ?? existing.parentExternalId,
      contentType: 'note', title: patch.title ?? existing.title, content: patch.content ?? existing.content,
      revision: patch.revision || `note-${this.now()}-${digest(`${patch.title ?? existing.title}\n${patch.content ?? existing.content}`).slice(0, 8)}`,
      mimeType: patch.mimeType ?? existing.mimeType, sourceUrl: patch.sourceUrl ?? existing.sourceUrl,
      metadata: patch.metadata ?? existing.metadata, tags: patch.tags ?? existing.tags });
  }
  async migrateStateJson(statePath) {
    const raw = await readFile(statePath, 'utf8');
    return this.migrateLegacyState(JSON.parse(raw), { sourcePath: String(statePath), sourceHash: digest(raw) });
  }
  migrateLegacyState(state, { sourcePath = '[object]', sourceHash } = {}) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('state must be an object');
    const hash = sourceHash || digest(stableStringify(state));
    return this.transaction(() => {
      const stats = { sourceConnections: 0, spaces: 0, documents: { created: 0, versioned: 0, unchanged: 0, restored: 0 },
        chunks: { indexed: 0, reused: 0 }, totalDocuments: Array.isArray(state.documents) ? state.documents.length : 0 };
      const sourceByType = new Map(), spaceByKnowledgeBase = new Map(), knowledgeBaseById = new Map();
      const knowledgeBases = Array.isArray(state.knowledgeBases) ? state.knowledgeBases : [], documents = Array.isArray(state.documents) ? state.documents : [];
      for (const knowledgeBase of knowledgeBases) {
        for (const identifier of [knowledgeBase?.id, knowledgeBase?.externalId]) {
          const normalized = String(identifier || '').trim();
          if (normalized) knowledgeBaseById.set(normalized, knowledgeBase);
        }
      }
      const activeKnowledgeBaseId = String(state.settings?.activeKnowledgeBaseId || '').trim();
      const activeKnowledgeBase = knowledgeBaseById.get(activeKnowledgeBaseId) || (knowledgeBases.length === 1 ? knowledgeBases[0] : null);
      const documentKnowledgeBase = (document) => {
        const requested = String(document?.knowledgeBaseId || document?.metadata?.knowledgeBaseId || document?.metadata?.spaceId || '').trim();
        if (requested) return knowledgeBaseById.get(requested) || null;
        // Older state files did not record a source per document. Keep those documents in the active legacy workspace.
        return document?.source ? null : activeKnowledgeBase;
      };
      const documentSourceType = (document) => String(document?.source || documentKnowledgeBase(document)?.source || 'legacy');
      const sourceTypes = new Set([...knowledgeBases.map((kb) => String(kb.source || 'legacy')), ...documents.map(documentSourceType)]);
      if (!sourceTypes.size) sourceTypes.add('legacy');
      for (const sourceType of sourceTypes) {
        const source = this.upsertSourceConnection({ sourceType, externalId: `legacy:${sourceType}`,
          name: sourceType === 'feishu' ? 'Feishu' : `Legacy ${sourceType}`, lastSyncedAt: state.sync?.lastCompletedAt,
          syncCursor: state.sync?.cursor, config: { migratedFromState: true } });
        sourceByType.set(sourceType, source); stats.sourceConnections += 1;
      }
      for (const kb of knowledgeBases) {
        const sourceType = String(kb.source || 'legacy'), source = sourceByType.get(sourceType) || sourceByType.values().next().value;
        const externalId = String(kb.externalId || kb.id || kb.name || 'default');
        const space = this.upsertSpace({ sourceConnectionId: source.id, externalId, name: String(kb.name || externalId),
          spaceType: 'knowledge-base', metadata: { legacyKnowledgeBaseId: kb.id, documentCount: kb.documentCount, lastSyncedAt: kb.lastSyncedAt } });
        spaceByKnowledgeBase.set(String(kb.id || externalId), space); spaceByKnowledgeBase.set(`${sourceType}:default`, space); stats.spaces += 1;
      }
      for (const sourceType of sourceTypes) if (!spaceByKnowledgeBase.has(`${sourceType}:default`)) {
        const source = sourceByType.get(sourceType), space = this.upsertSpace({ sourceConnectionId: source.id,
          externalId: `legacy-space:${sourceType}`, name: `${sourceType} content`, spaceType: 'knowledge-base', metadata: { migratedFromState: true } });
        spaceByKnowledgeBase.set(`${sourceType}:default`, space); stats.spaces += 1;
      }
      for (const doc of documents) {
        const knowledgeBase = documentKnowledgeBase(doc);
        const sourceType = documentSourceType(doc), source = sourceByType.get(sourceType) || sourceByType.values().next().value;
        const requestedKb = doc.knowledgeBaseId || doc.metadata?.knowledgeBaseId || doc.metadata?.spaceId || knowledgeBase?.id || knowledgeBase?.externalId;
        const space = (requestedKb && spaceByKnowledgeBase.get(String(requestedKb))) || spaceByKnowledgeBase.get(`${sourceType}:default`);
        const externalId = String(doc.externalId || doc.id || stableId('legacy-doc', doc.title || '', doc.url || '', doc.content || ''));
        const result = this.upsertContentItem({ sourceConnectionId: source.id, spaceId: space?.id, externalId,
          parentExternalId: doc.parentExternalId || doc.parentToken || null, contentType: doc.sourceType || doc.type || 'document',
          title: doc.title || '', content: doc.content || doc.text || '', revision: doc.revision || doc.metadata?.revision || doc.updatedAt || undefined,
          mimeType: doc.mimeType || doc.metadata?.mimeType, sourceUrl: doc.url || doc.sourceUrl, sourceCreatedAt: doc.createdAt,
          sourceModifiedAt: doc.updatedAt, metadata: { ...(doc.metadata || {}), legacyId: doc.id,
            nodeToken: doc.nodeToken ?? doc.metadata?.nodeToken ?? null, migratedFromState: true },
          tags: Array.isArray(doc.tags) ? doc.tags : Array.isArray(doc.metadata?.tags) ? doc.metadata.tags : undefined });
        stats.documents[result.action] = (stats.documents[result.action] || 0) + 1;
        const existingChunks = this.listIndexChunks(result.item.id);
        if (result.versionCreated || !existingChunks.length) {
          const chunks = splitContentIntoChunks(result.item.content || '');
          this.replaceIndexChunks(result.item.id, chunks, { contentVersionId: result.item.currentVersionId });
          stats.chunks.indexed += chunks.length;
        } else {
          stats.chunks.reused += existingChunks.length;
        }
      }
      this.db.prepare(`INSERT INTO legacy_imports(id, source_path, source_hash, stats_json, imported_at) VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(source_path, source_hash) DO UPDATE SET stats_json=excluded.stats_json, imported_at=excluded.imported_at`)
        .run(stableId('import', sourcePath, hash), sourcePath, hash, json(stats), this.now());
      return { ...stats, sourcePath, sourceHash: hash, searchBackend: this.getSchemaStatus().searchBackend };
    });
  }
  getCounts() {
    const tables = ['source_connections', 'spaces', 'content_items', 'content_versions', 'tags', 'attachments', 'index_chunks', 'ingestion_jobs'];
    return Object.fromEntries(tables.map((table) => [table, Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));
  }
}

export function createContentRepository(options) { return new ContentRepository(options); }
export { LATEST_SCHEMA_VERSION } from './migrations.mjs';
