import { createHash } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function now(clock) {
  return clock().toISOString();
}

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : structuredClone(fallback); } catch { return structuredClone(fallback); }
}

export function normalizeMirrorPath(value) {
  const path = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim();
  if (!path || path.includes('\u0000') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw Object.assign(new Error('mirror path must be a safe relative path'), { code: 'MIRROR_PATH_INVALID' });
  }
  if (!/\.md$/iu.test(path)) throw Object.assign(new Error('mirror path must target a Markdown file'), { code: 'MIRROR_PATH_NOT_MARKDOWN' });
  return path;
}

function mirrorRootFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    rootToken: row.root_token,
    status: row.status,
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function entryFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    rootId: row.root_id,
    contentItemId: row.content_item_id,
    relativePath: row.relative_path,
    baseHash: row.base_hash,
    lastSyncedVersionId: row.last_synced_version_id ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function conflictFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    entryId: row.entry_id,
    diskHash: row.disk_hash,
    databaseHash: row.database_hash,
    baseHash: row.base_hash,
    diskContent: row.disk_content,
    databaseContent: row.database_content,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at
  };
}

function stableId(prefix, ...parts) {
  return `${prefix}_${digest(parts.join('\u001f')).slice(0, 24)}`;
}

function sourceForRoot(repository, root) {
  return repository.upsertSourceConnection({
    id: `mirror-source:${root.id}`,
    sourceType: 'markdown-mirror',
    externalId: root.id,
    name: `Markdown mirror: ${root.displayName}`,
    status: 'active',
    config: { rootToken: root.rootToken, mirrorManaged: true }
  });
}

function spaceForRoot(repository, source, root) {
  return repository.upsertSpace({
    id: `mirror-space:${root.id}`,
    sourceConnectionId: source.id,
    externalId: root.id,
    name: root.displayName,
    spaceType: 'markdown-mirror',
    metadata: { rootId: root.id, mirrorManaged: true }
  });
}

function itemMetadata(item, rootId, relativePath, contentHash) {
  return {
    ...(item?.metadata || {}),
    markdownMirror: {
      rootId,
      relativePath,
      baseHash: contentHash,
      managed: true
    }
  };
}

export class MarkdownMirrorService {
  constructor({ repository, graphIndex, clock = () => new Date() } = {}) {
    if (!repository?.db) throw new TypeError('repository with a SQLite database is required');
    this.repository = repository;
    this.db = repository.db;
    this.graphIndex = graphIndex || null;
    this.clock = clock;
  }

  registerRoot({ rootToken, displayName = 'Markdown vault', metadata = {} } = {}) {
    const token = String(rootToken || '').trim();
    if (!token) throw Object.assign(new Error('rootToken is required'), { code: 'MIRROR_ROOT_TOKEN_REQUIRED' });
    const existing = this.db.prepare('SELECT * FROM markdown_mirror_roots WHERE root_token = ?').get(token);
    const timestamp = now(this.clock);
    const id = existing?.id || stableId('mirror', token);
    this.db.prepare(`INSERT INTO markdown_mirror_roots(id, display_name, root_token, status, metadata_json, created_at, updated_at)
      VALUES(?, ?, ?, 'active', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, status='active', metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`)
      .run(id, String(displayName || existing?.display_name || 'Markdown vault').trim() || 'Markdown vault', token, JSON.stringify(metadata || {}), existing?.created_at || timestamp, timestamp);
    return this.getRoot(id);
  }

  getRoot(id) {
    return mirrorRootFromRow(this.db.prepare('SELECT * FROM markdown_mirror_roots WHERE id = ?').get(String(id)));
  }

  listRoots() {
    return this.db.prepare('SELECT * FROM markdown_mirror_roots ORDER BY updated_at DESC, id').all().map(mirrorRootFromRow);
  }

  listEntries(rootId) {
    return this.db.prepare('SELECT * FROM markdown_mirror_entries WHERE root_id = ? ORDER BY relative_path').all(String(rootId)).map(entryFromRow);
  }

  listConflicts({ rootId, status = 'open' } = {}) {
    const rows = rootId
      ? this.db.prepare(`SELECT c.* FROM markdown_mirror_conflicts c JOIN markdown_mirror_entries e ON e.id = c.entry_id
          WHERE e.root_id = ?${status ? ' AND c.status = ?' : ''} ORDER BY c.created_at DESC`).all(...(status ? [String(rootId), status] : [String(rootId)]))
      : this.db.prepare(`SELECT * FROM markdown_mirror_conflicts${status ? ' WHERE status = ?' : ''} ORDER BY created_at DESC`).all(...(status ? [status] : []));
    return rows.map(conflictFromRow);
  }

  scan(rootId, files = []) {
    const root = this.getRoot(rootId);
    if (!root || root.status !== 'active') throw Object.assign(new Error('markdown mirror root not found'), { code: 'MIRROR_ROOT_NOT_FOUND' });
    if (!Array.isArray(files)) throw new TypeError('files must be an array');
    const source = sourceForRoot(this.repository, root);
    const space = spaceForRoot(this.repository, source, root);
    const knownByPath = new Map(this.listEntries(root.id).map(entry => [entry.relativePath, entry]));
    const stats = { created: 0, imported: 0, unchanged: 0, conflicts: 0, pendingWrites: 0, rejected: 0 };
    const pendingWrites = [];
    const seen = new Set();
    for (const rawFile of files) {
      let relativePath;
      try { relativePath = normalizeMirrorPath(rawFile?.relativePath || rawFile?.path); }
      catch { stats.rejected += 1; continue; }
      if (seen.has(relativePath)) { stats.rejected += 1; continue; }
      seen.add(relativePath);
      const diskContent = String(rawFile?.content || '').replace(/\r\n?/g, '\n');
      const diskHash = digest(diskContent);
      const entry = knownByPath.get(relativePath);
      if (!entry) {
        const result = this.repository.upsertContentItem({
          sourceConnectionId: source.id,
          spaceId: space.id,
          externalId: `mirror:${root.id}:${relativePath}`,
          contentType: 'markdown',
          title: String(rawFile?.title || relativePath.replace(/\.md$/iu, '').split('/').at(-1) || 'Untitled note'),
          content: diskContent,
          revision: `mirror-${diskHash.slice(0, 16)}`,
          mimeType: 'text/markdown',
          metadata: itemMetadata(null, root.id, relativePath, diskHash),
          tags: Array.isArray(rawFile?.tags) ? rawFile.tags : []
        });
        const timestamp = now(this.clock);
        const entryId = stableId('mirror-entry', root.id, relativePath);
        this.db.prepare(`INSERT INTO markdown_mirror_entries(id, root_id, content_item_id, relative_path, base_hash, last_synced_version_id, status, created_at, updated_at)
          VALUES(?, ?, ?, ?, ?, ?, 'synced', ?, ?)`)
          .run(entryId, root.id, result.item.id, relativePath, diskHash, result.item.currentVersionId || null, timestamp, timestamp);
        stats.created += 1;
        continue;
      }
      const current = this.repository.getContentItem(entry.contentItemId, { includeDeleted: true });
      if (!current) {
        this.db.prepare('UPDATE markdown_mirror_entries SET status = ?, updated_at = ? WHERE id = ?').run('missing-content', now(this.clock), entry.id);
        stats.rejected += 1;
        continue;
      }
      const databaseHash = digest(current.content || '');
      const diskChanged = diskHash !== entry.baseHash;
      const databaseChanged = databaseHash !== entry.baseHash;
      if (diskChanged && databaseChanged && diskHash !== databaseHash) {
        const conflictId = stableId('mirror-conflict', entry.id, diskHash, databaseHash, entry.baseHash);
        const existingConflict = this.db.prepare('SELECT id FROM markdown_mirror_conflicts WHERE id = ?').get(conflictId);
        if (!existingConflict) this.db.prepare(`INSERT INTO markdown_mirror_conflicts(
          id, entry_id, disk_hash, database_hash, base_hash, disk_content, database_content, status, created_at, resolved_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL)`).run(conflictId, entry.id, diskHash, databaseHash, entry.baseHash, diskContent, current.content || '', now(this.clock));
        this.db.prepare('UPDATE markdown_mirror_entries SET status = ?, updated_at = ? WHERE id = ?').run('conflict', now(this.clock), entry.id);
        stats.conflicts += 1;
        continue;
      }
      if (diskChanged) {
        const result = this.repository.upsertContentItem({
          id: current.id,
          sourceConnectionId: current.sourceConnectionId,
          spaceId: current.spaceId || space.id,
          externalId: current.externalId,
          contentType: current.contentType,
          title: String(rawFile?.title || current.title),
          content: diskContent,
          revision: `mirror-${diskHash.slice(0, 16)}`,
          mimeType: current.mimeType || 'text/markdown',
          sourceUrl: current.sourceUrl,
          metadata: itemMetadata(current, root.id, relativePath, diskHash),
          tags: current.tags || []
        });
        this.db.prepare(`UPDATE markdown_mirror_entries SET base_hash = ?, last_synced_version_id = ?, status = 'synced', updated_at = ? WHERE id = ?`)
          .run(diskHash, result.item.currentVersionId || null, now(this.clock), entry.id);
        stats.imported += 1;
        continue;
      }
      if (databaseChanged) {
        pendingWrites.push({
          entryId: entry.id,
          rootId: root.id,
          relativePath,
          content: current.content || '',
          contentHash: databaseHash,
          baseHash: entry.baseHash,
          confirmationRequired: true,
          reason: 'The SQLite content changed while the mirrored file did not.'
        });
        this.db.prepare('UPDATE markdown_mirror_entries SET status = ?, updated_at = ? WHERE id = ?').run('pending-write-confirmation', now(this.clock), entry.id);
        stats.pendingWrites += 1;
        continue;
      }
      stats.unchanged += 1;
    }
    this.graphIndex?.rebuild();
    return { root: this.getRoot(root.id), stats, pendingWrites, conflicts: this.listConflicts({ rootId: root.id }) };
  }

  confirmWrite({ rootId, relativePath, contentHash } = {}) {
    const path = normalizeMirrorPath(relativePath);
    const entry = entryFromRow(this.db.prepare('SELECT * FROM markdown_mirror_entries WHERE root_id = ? AND relative_path = ?').get(String(rootId), path));
    if (!entry) throw Object.assign(new Error('mirror entry not found'), { code: 'MIRROR_ENTRY_NOT_FOUND' });
    const item = this.repository.getContentItem(entry.contentItemId);
    const databaseHash = digest(item?.content || '');
    if (!item || databaseHash !== String(contentHash || '')) throw Object.assign(new Error('mirror write is stale'), { code: 'MIRROR_WRITE_STALE' });
    const timestamp = now(this.clock);
    this.db.prepare(`UPDATE markdown_mirror_entries SET base_hash = ?, last_synced_version_id = ?, status = 'synced', updated_at = ? WHERE id = ?`)
      .run(databaseHash, item.currentVersionId || null, timestamp, entry.id);
    return this.listEntries(rootId).find(current => current.id === entry.id);
  }

  resolveConflict({ conflictId, resolution, diskContent } = {}) {
    const conflict = conflictFromRow(this.db.prepare('SELECT * FROM markdown_mirror_conflicts WHERE id = ? AND status = ?').get(String(conflictId), 'open'));
    if (!conflict) throw Object.assign(new Error('mirror conflict not found'), { code: 'MIRROR_CONFLICT_NOT_FOUND' });
    const entry = entryFromRow(this.db.prepare('SELECT * FROM markdown_mirror_entries WHERE id = ?').get(conflict.entryId));
    if (!entry) throw Object.assign(new Error('mirror entry not found'), { code: 'MIRROR_ENTRY_NOT_FOUND' });
    if (resolution === 'use-disk') {
      const content = String(diskContent ?? conflict.diskContent).replace(/\r\n?/g, '\n');
      const item = this.repository.getContentItem(entry.contentItemId, { includeDeleted: true });
      const hash = digest(content);
      const result = this.repository.upsertContentItem({
        id: item.id, sourceConnectionId: item.sourceConnectionId, spaceId: item.spaceId, externalId: item.externalId,
        contentType: item.contentType, title: item.title, content, revision: `mirror-${hash.slice(0, 16)}`,
        mimeType: item.mimeType, sourceUrl: item.sourceUrl, metadata: itemMetadata(item, entry.rootId, entry.relativePath, hash), tags: item.tags || []
      });
      this.db.prepare(`UPDATE markdown_mirror_entries SET base_hash = ?, last_synced_version_id = ?, status = 'synced', updated_at = ? WHERE id = ?`)
        .run(hash, result.item.currentVersionId || null, now(this.clock), entry.id);
    } else if (resolution === 'keep-database') {
      this.db.prepare('UPDATE markdown_mirror_entries SET status = ?, updated_at = ? WHERE id = ?').run('pending-write-confirmation', now(this.clock), entry.id);
    } else {
      throw Object.assign(new Error('unsupported mirror conflict resolution'), { code: 'MIRROR_RESOLUTION_INVALID' });
    }
    this.db.prepare('UPDATE markdown_mirror_conflicts SET status = ?, resolved_at = ? WHERE id = ?').run('resolved', now(this.clock), conflict.id);
    this.graphIndex?.rebuild();
    return { conflict: { ...conflict, status: 'resolved' }, entry: this.listEntries(entry.rootId).find(current => current.id === entry.id) };
  }
}

export function createMarkdownMirrorService(options) {
  return new MarkdownMirrorService(options);
}
