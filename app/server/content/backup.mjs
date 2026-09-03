import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const FORMAT = 'flowmind-content-backup';
const VERSION = 2;
const SECRET_KEY = /(secret|api.?key|access.?token|refresh.?token|tenant.?token|password|authorization)/i;
const LOCAL_PATH_KEY = /(^|_)(local)?path(s)?$/i;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function stringify(value) { return JSON.stringify(canonical(value)); }
function checksum(value) { return createHash('sha256').update(stringify(value), 'utf8').digest('hex'); }
function scrub(value, { includeLocalPaths = false } = {}) {
  if (Array.isArray(value)) return value.map((entry) => scrub(entry, { includeLocalPaths }));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEY.test(key) && (includeLocalPaths || !LOCAL_PATH_KEY.test(key))).map(([key, entry]) => [key, scrub(entry, { includeLocalPaths })]));
}
function pages(load) {
  const output = []; let offset = 0;
  while (true) {
    const batch = load(offset); output.push(...batch);
    if (batch.length < 1000) break;
    offset += batch.length;
  }
  return output;
}
function withoutRuntimeFields(value) {
  if (!value) return value;
  const { createdAt, updatedAt, ingestedAt, currentVersionId, contentHash, rank, ...rest } = value;
  return rest;
}

export class ContentBackupService {
  constructor({ repository, clock = () => new Date() } = {}) {
    if (!repository) throw new TypeError('repository is required');
    this.repository = repository;
    this.clock = clock;
  }

  createArchive({ includeDeleted = true, includeJobs = false, includeLocalPaths = false, includeAttachmentData = true } = {}) {
    const sources = this.repository.listSourceConnections({ includeDeleted }).map((source) => scrub(source, { includeLocalPaths }));
    const spaces = sources.flatMap((source) => this.repository.listSpaces({ sourceConnectionId: source.id, includeDeleted })).map((space) => scrub(space, { includeLocalPaths }));
    const items = pages((offset) => this.repository.listContentItems({ includeDeleted, includeTags: true, limit: 1000, offset, sortBy: 'createdAt', sortDirection: 'asc' })).map((item) => ({
      item: scrub(item, { includeLocalPaths }),
      versions: this.repository.getContentVersions(item.id, { limit: 1000 }).slice().reverse().map((version) => scrub(version, { includeLocalPaths })),
      attachments: this.repository.listAttachments(item.id, { includeDeleted }).map((attachment) => {
        const safe = scrub(attachment, { includeLocalPaths });
        const data = includeAttachmentData ? this.repository.getAttachmentData(attachment.id) : null;
        return data ? { ...safe, blobBase64: data.toString('base64') } : safe;
      }),
      annotations: this.repository.listAnnotations(item.id, { includeDeleted }).map((annotation) => scrub(annotation, { includeLocalPaths })),
      chunks: this.repository.listIndexChunks(item.id).map((chunk) => scrub(chunk, { includeLocalPaths }))
    }));
    const payload = scrub({
      schemaVersion: this.repository.currentSchemaVersion(), exportedAt: this.clock().toISOString(),
      sources, spaces, items,
      jobs: includeJobs ? this.repository.listIngestionJobs({ limit: 1000 }) : []
    }, { includeLocalPaths });
    return { format: FORMAT, version: VERSION, checksum: checksum(payload), payload };
  }

  verifyArchive(archive) {
    if (!archive || archive.format !== FORMAT || archive.version !== VERSION || !archive.payload) throw Object.assign(new Error('备份文件格式不受支持'), { code: 'BACKUP_FORMAT_INVALID' });
    const actual = checksum(archive.payload);
    if (actual !== archive.checksum) throw Object.assign(new Error('备份校验和不匹配，文件可能已损坏或被修改'), { code: 'BACKUP_CHECKSUM_INVALID', expected: archive.checksum, actual });
    return { ok: true, checksum: actual, counts: { sources: archive.payload.sources?.length || 0, spaces: archive.payload.spaces?.length || 0, items: archive.payload.items?.length || 0 } };
  }

  async writeArchive(filePath, options = {}) {
    const archive = this.createArchive(options);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(archive, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return { filePath, ...this.verifyArchive(archive) };
  }

  async readArchive(filePath) {
    const archive = JSON.parse(await readFile(filePath, 'utf8'));
    this.verifyArchive(archive);
    return archive;
  }

  restoreArchive(archive, { mode = 'merge' } = {}) {
    const verification = this.verifyArchive(archive);
    const payload = archive.payload;
    if (mode === 'replace-content') {
      for (const item of pages((offset) => this.repository.listContentItems({ includeDeleted: false, limit: 1000, offset }))) this.repository.softDeleteContentItem(item.id);
    } else if (mode !== 'merge') throw Object.assign(new Error(`不支持的恢复模式: ${mode}`), { code: 'BACKUP_RESTORE_MODE_INVALID' });

    const sourceMap = new Map();
    for (const source of payload.sources || []) {
      const restored = this.repository.upsertSourceConnection({ ...withoutRuntimeFields(source), config: scrub(source.config || {}) });
      sourceMap.set(source.id, restored.id);
    }
    const spaceMap = new Map();
    const pendingSpaces = [...(payload.spaces || [])]; let guard = 0;
    while (pendingSpaces.length && guard++ < pendingSpaces.length * 3 + 3) {
      const space = pendingSpaces.shift();
      if (space.parentId && !spaceMap.has(space.parentId)) { pendingSpaces.push(space); continue; }
      const restored = this.repository.upsertSpace({ ...withoutRuntimeFields(space), sourceConnectionId: sourceMap.get(space.sourceConnectionId) || space.sourceConnectionId, parentId: space.parentId ? spaceMap.get(space.parentId) || space.parentId : null, metadata: scrub(space.metadata || {}) });
      spaceMap.set(space.id, restored.id);
    }
    if (pendingSpaces.length) throw Object.assign(new Error('备份空间层级存在缺失的父节点'), { code: 'BACKUP_SPACE_PARENT_MISSING', spaces: pendingSpaces.map((space) => space.id) });

    const restoredItems = [];
    for (const record of payload.items || []) {
      const item = record.item;
      const sourceConnectionId = sourceMap.get(item.sourceConnectionId) || item.sourceConnectionId;
      const spaceId = item.spaceId ? spaceMap.get(item.spaceId) || item.spaceId : null;
      const versions = record.versions?.length ? record.versions : [{ revision: item.revision, title: item.title, content: item.content, metadata: item.metadata, sourceModifiedAt: item.sourceModifiedAt }];
      let result;
      for (let index = 0; index < versions.length; index += 1) {
        const version = versions[index];
        result = this.repository.upsertContentItem({ ...withoutRuntimeFields(item), ...(index === 0 ? { id: item.id } : {}), sourceConnectionId, spaceId, title: version.title, content: version.content, revision: version.revision, metadata: scrub(version.metadata ?? item.metadata ?? {}), sourceModifiedAt: version.sourceModifiedAt, tags: index === versions.length - 1 ? item.tags || [] : undefined, deletedAt: null });
      }
      const attachmentMap = new Map();
      for (const attachment of record.attachments || []) {
        const restoredAttachment = this.repository.upsertAttachment({ ...withoutRuntimeFields(attachment), contentItemId: result.item.id, metadata: scrub(attachment.metadata || {}), data: attachment.blobBase64, encoding: 'base64' });
        attachmentMap.set(attachment.id, restoredAttachment.id);
      }
      for (const annotation of record.annotations || []) this.repository.upsertAnnotation({ ...withoutRuntimeFields(annotation), contentItemId: result.item.id, attachmentId: annotation.attachmentId ? attachmentMap.get(annotation.attachmentId) || annotation.attachmentId : null, selector: scrub(annotation.selector || {}), metadata: scrub(annotation.metadata || {}) });
      if (record.chunks?.length) this.repository.replaceIndexChunks(result.item.id, record.chunks.map((chunk) => ({ text: chunk.text, tokenCount: chunk.tokenCount, contentHash: chunk.contentHash, embeddingModel: chunk.embeddingModel, embedding: chunk.embedding, metadata: scrub(chunk.metadata || {}) })), { contentVersionId: result.item.currentVersionId });
      if (item.deletedAt) this.repository.softDeleteContentItem(result.item.id, item.deletedAt);
      restoredItems.push(result.item.id);
    }
    return { ok: true, mode, verification, restored: { sources: sourceMap.size, spaces: spaceMap.size, items: restoredItems.length }, itemIds: restoredItems };
  }

  async restoreFile(filePath, options = {}) { return this.restoreArchive(await this.readArchive(filePath), options); }
}

export { FORMAT as CONTENT_BACKUP_FORMAT, VERSION as CONTENT_BACKUP_VERSION };
