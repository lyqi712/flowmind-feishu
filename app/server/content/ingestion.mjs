import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { OFFICE_LOCAL_PARSERS } from './office-parsers.mjs';
import { PDF_LOCAL_PARSERS } from './pdf-parser.mjs';
import { IMAGE_LOCAL_PARSERS } from './image-parser.mjs';
import { AUDIO_LOCAL_PARSERS } from './audio-parser.mjs';

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function abortError() { return Object.assign(new Error('导入任务已取消'), { name: 'AbortError', code: 'INGESTION_CANCELLED' }); }
function assertNotAborted(signal) { if (signal?.aborted) throw abortError(); }
function normalizeWhitespace(value) { return String(value || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[\t ]+\n/g, '\n').trim(); }
function decodeEntities(value) {
  return value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
}
function htmlToText(value) {
  return normalizeWhitespace(decodeEntities(String(value || '')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, ' ').replace(/[^\S\n]+/g, ' ')));
}
function csvRows(value, delimiter = ',') {
  const rows = []; let row = [], cell = '', quoted = false;
  const text = String(value || '').replace(/\r\n?/g, '\n');
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if (char === '\n' && !quoted) { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((current) => current.some((entry) => String(entry).trim()));
}
function rowsToMarkdown(rows) {
  if (!rows.length) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const clean = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => clean(row[index])));
  const header = normalized[0], separator = header.map(() => '---');
  return [header, separator, ...normalized.slice(1)].map((row) => `| ${row.join(' | ')} |`).join('\n');
}
function inferTitle(path, content) {
  const firstHeading = normalizeWhitespace(content).split(/\r?\n/).find((line) => line.trim())?.replace(/^#+\s*/, '').trim();
  return firstHeading?.slice(0, 160) || basename(path, extname(path)) || '未命名内容';
}
function normalizeOptionalDate(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const raw = String(value).trim();
  const numeric = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export const DEFAULT_LOCAL_PARSERS = Object.freeze({
  ...OFFICE_LOCAL_PARSERS,
  ...PDF_LOCAL_PARSERS,
  ...IMAGE_LOCAL_PARSERS,
  ...AUDIO_LOCAL_PARSERS,
  '.txt': async ({ text, path }) => ({ title: inferTitle(path, text), content: normalizeWhitespace(text), contentType: 'text', mimeType: 'text/plain' }),
  '.md': async ({ text, path }) => ({ title: inferTitle(path, text), content: normalizeWhitespace(text), contentType: 'markdown', mimeType: 'text/markdown' }),
  '.markdown': async ({ text, path }) => ({ title: inferTitle(path, text), content: normalizeWhitespace(text), contentType: 'markdown', mimeType: 'text/markdown' }),
  '.html': async ({ text, path }) => ({ title: inferTitle(path, htmlToText(text)), content: htmlToText(text), contentType: 'html', mimeType: 'text/html' }),
  '.htm': async ({ text, path }) => ({ title: inferTitle(path, htmlToText(text)), content: htmlToText(text), contentType: 'html', mimeType: 'text/html' }),
  '.csv': async ({ text, path }) => ({ title: basename(path, extname(path)), content: rowsToMarkdown(csvRows(text, ',')), contentType: 'table', mimeType: 'text/csv' }),
  '.tsv': async ({ text, path }) => ({ title: basename(path, extname(path)), content: rowsToMarkdown(csvRows(text, '\t')), contentType: 'table', mimeType: 'text/tab-separated-values' }),
  '.json': async ({ text, path }) => {
    const parsed = JSON.parse(text); return { title: basename(path, extname(path)), content: JSON.stringify(parsed, null, 2), contentType: 'json', mimeType: 'application/json' };
  }
});

export function splitContentIntoChunks(content, { maxChars = 1400, overlapChars = 160 } = {}) {
  const text = normalizeWhitespace(content); if (!text) return [];
  const safeMax = Math.max(240, Number(maxChars) || 1400), safeOverlap = Math.max(0, Math.min(Number(overlapChars) || 0, safeMax - 80));
  const chunks = []; let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + safeMax);
    if (end < text.length) {
      const candidates = [text.lastIndexOf('\n\n', end), text.lastIndexOf('\n', end), text.lastIndexOf('。', end), text.lastIndexOf(' ', end)];
      const boundary = candidates.find((value) => value > start + Math.floor(safeMax * 0.55));
      if (boundary) end = boundary + 1;
    }
    const value = text.slice(start, end).trim();
    if (value) chunks.push({ text: value, tokenCount: Math.ceil(value.length / 2.5), metadata: { anchor: `chars:${start}-${end}`, startChar: start, endChar: end } });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - safeOverlap);
  }
  return chunks;
}

function buildIndexChunks(normalized, chunkOptions) {
  const pages = Array.isArray(normalized.pageSegments) ? normalized.pageSegments : [];
  if (!pages.length) return splitContentIntoChunks(normalized.content, chunkOptions);
  return pages.flatMap((page) => splitContentIntoChunks(page.text, chunkOptions).map((chunk) => {
    const localStart = Number(chunk.metadata?.startChar || 0);
    const localEnd = Number(chunk.metadata?.endChar || localStart + chunk.text.length);
    const pageNumber = Number(page.pageNumber);
    return {
      ...chunk,
      metadata: {
        ...(chunk.metadata || {}),
        pageNumber,
        pageAnchor: page.anchor || `page:${pageNumber}`,
        anchor: `${page.anchor || `page:${pageNumber}`}:chars:${localStart}-${localEnd}`,
        region: page.region || null,
        confidence: page.confidence ?? null,
        startChar: Number(page.startChar || 0) + localStart,
        endChar: Number(page.startChar || 0) + localEnd,
        timeStart: page.timeStart ?? null,
        timeEnd: page.timeEnd ?? null,
        speaker: page.speaker ?? null
      }
    };
  }));
}
export class ContentIngestionService {
  constructor({ repository, parsers = {}, chunkOptions = {}, readFileImpl = readFile, statImpl = stat } = {}) {
    if (!repository) throw new TypeError('repository is required');
    this.repository = repository;
    this.parsers = new Map(Object.entries({ ...DEFAULT_LOCAL_PARSERS, ...parsers }).map(([extension, parser]) => [extension.toLowerCase(), parser]));
    this.chunkOptions = chunkOptions;
    this.readFile = readFileImpl;
    this.stat = statImpl;
  }

  registerParser(extension, parser) {
    if (typeof parser !== 'function') throw new TypeError('parser must be a function');
    const key = String(extension || '').toLowerCase();
    this.parsers.set(key.startsWith('.') ? key : `.${key}`, parser);
    return this;
  }

  ensureTarget({ sourceConnection, space } = {}) {
    const source = this.repository.upsertSourceConnection(sourceConnection || { sourceType: 'local', externalId: 'local-files', name: '本地文件' });
    const targetSpace = this.repository.upsertSpace({ sourceConnectionId: source.id, externalId: 'local-imports', name: '本地导入', spaceType: 'collection', ...(space || {}) });
    return { source, space: targetSpace };
  }

  async parseLocalFile(path, { signal } = {}) {
    assertNotAborted(signal);
    const absolutePath = resolve(String(path));
    const extension = extname(absolutePath).toLowerCase();
    const parser = this.parsers.get(extension);
    if (!parser) throw Object.assign(new Error(`暂不支持本地文件类型: ${extension || '[无扩展名]'}`), { code: 'CONTENT_PARSER_UNSUPPORTED', extension, path: absolutePath });
    const [bytes, info] = await Promise.all([this.readFile(absolutePath), this.stat(absolutePath)]);
    assertNotAborted(signal);
    const fileHash = sha256(bytes), text = bytes.toString('utf8');
    const parsed = await parser({ text, bytes, path: absolutePath, extension, stat: info, signal });
    const content = normalizeWhitespace(parsed.content);
    if (!content) throw Object.assign(new Error(`文件解析后没有可索引正文: ${basename(absolutePath)}`), { code: 'CONTENT_EMPTY', path: absolutePath });
    return {
      externalId: `file:${sha256(absolutePath.toLowerCase()).slice(0, 32)}`,
      title: parsed.title || inferTitle(absolutePath, content), content, contentType: parsed.contentType || extension.slice(1) || 'document',
      mimeType: parsed.mimeType || 'text/plain', revision: `${Math.trunc(info.mtimeMs)}:${fileHash.slice(0, 16)}`,
      sourceUrl: `file://${absolutePath.replace(/\\/g, '/')}`, sourceCreatedAt: info.birthtime, sourceModifiedAt: info.mtime,
      metadata: { ...(parsed.metadata || {}), localPath: absolutePath, fileName: basename(absolutePath), byteSize: info.size, fileHash },
      pageSegments: parsed.pageSegments || [], tags: parsed.tags || [],
      attachments: ['pdf', 'image', 'audio'].includes(parsed.contentType) ? [{ externalId: 'original', fileName: basename(absolutePath), mimeType: parsed.mimeType || 'application/octet-stream', byteSize: bytes.length, contentHash: fileHash, data: bytes, metadata: { kind: 'original', persisted: true } }] : []
    };
  }

  async parseUploadedFile(input, { signal } = {}) {
    assertNotAborted(signal);
    const fileName = basename(String(input?.fileName || input?.name || 'upload'));
    const extension = extname(fileName).toLowerCase();
    const parser = this.parsers.get(extension);
    if (!parser) throw Object.assign(new Error(`暂不支持上传文件类型: ${extension || '[无扩展名]'}`), { code: 'CONTENT_PARSER_UNSUPPORTED', extension, fileName });
    const bytes = Buffer.isBuffer(input?.bytes) ? input.bytes : input?.bytes instanceof Uint8Array ? Buffer.from(input.bytes) : typeof input?.base64 === 'string' ? Buffer.from(input.base64, 'base64') : null;
    if (!bytes?.length) throw Object.assign(new Error('上传文件为空'), { code: 'CONTENT_EMPTY', fileName });
    const fileHash = sha256(bytes);
    const text = bytes.toString('utf8');
    const parsed = await parser({ text, bytes, path: fileName, extension, stat: { size: bytes.length }, signal });
    const content = normalizeWhitespace(parsed.content);
    if (!content) throw Object.assign(new Error(`文件解析后没有可索引正文: ${fileName}`), { code: 'CONTENT_EMPTY', fileName });
    return {
      externalId: String(input.externalId || `upload:${sha256(fileName.toLowerCase()).slice(0, 32)}`),
      title: parsed.title || inferTitle(fileName, content), content, contentType: parsed.contentType || extension.slice(1) || 'document',
      mimeType: parsed.mimeType || input.mimeType || 'application/octet-stream', revision: fileHash, sourceUrl: null,
      sourceModifiedAt: normalizeOptionalDate(input.lastModified),
      metadata: { ...(parsed.metadata || {}), fileName, byteSize: bytes.length, fileHash, uploaded: true }, pageSegments: parsed.pageSegments || [], tags: parsed.tags || [],
      attachments: ['pdf', 'image', 'audio'].includes(parsed.contentType) ? [{ externalId: 'original', fileName, mimeType: parsed.mimeType || input.mimeType || 'application/octet-stream', byteSize: bytes.length, contentHash: fileHash, data: bytes, metadata: { kind: 'original', persisted: true } }] : []
    };
  }

  async normalizeInput(input, options = {}) {
    if (typeof input === 'string') return this.parseLocalFile(input, options);
    if (input?.path) return this.parseLocalFile(input.path, options);
    if (input?.bytes || input?.base64) return this.parseUploadedFile(input, options);
    if (!input || typeof input !== 'object') throw Object.assign(new TypeError('导入项必须是文件路径或内容对象'), { code: 'INGESTION_INPUT_INVALID' });
    const content = normalizeWhitespace(input.content);
    if (!content) throw Object.assign(new Error('导入内容为空'), { code: 'CONTENT_EMPTY' });
    return { ...input, content, title: String(input.title || input.fileName || input.name || '未命名内容'), externalId: String(input.externalId || `inline:${sha256(`${input.title || input.fileName || input.name || ''}\n${content}`)}`), contentType: input.contentType || 'document' };
  }

  findHashDuplicate(sourceConnectionId, fileHash) {
    if (!fileHash) return null;
    return this.repository.listContentItems({ sourceConnectionId, includeTags: true, limit: 1000 }).find((item) => item.metadata?.fileHash === fileHash) || null;
  }

  async ingest({ items = [], sourceConnection, space, dedupeKey, jobId, signal, onProgress } = {}) {
    if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('items 不能为空'), { code: 'INGESTION_ITEMS_REQUIRED' });
    const target = this.ensureTarget({ sourceConnection, space });
    let job = jobId ? this.repository.getIngestionJob(jobId) : null;
    if (!job) job = this.repository.createIngestionJob({ sourceConnectionId: target.source.id, spaceId: target.space.id, jobType: 'import', dedupeKey, status: 'pending', cursor: '0', stats: { total: items.length, processed: 0, created: 0, versioned: 0, unchanged: 0, restored: 0, duplicates: 0, failed: 0 }, metadata: { resumable: true } });
    const startIndex = Math.max(0, Math.min(items.length, Number(job.cursor || 0)));
    const stats = { total: items.length, processed: startIndex, created: 0, versioned: 0, unchanged: 0, restored: 0, duplicates: 0, failed: 0, ...(job.stats || {}) };
    const results = [], warnings = [];
    job = this.repository.updateIngestionJob(job.id, { status: 'running', cursor: String(startIndex), stats, error: null, metadata: { ...(job.metadata || {}), resumable: true, itemCount: items.length } });
    try {
      for (let index = startIndex; index < items.length; index += 1) {
        assertNotAborted(signal);
        try {
          const normalized = await this.normalizeInput(items[index], { signal });
          const duplicate = this.findHashDuplicate(target.source.id, normalized.metadata?.fileHash);
          let result;
          if (duplicate && duplicate.externalId !== normalized.externalId) {
            const aliasPaths = [...new Set([...(duplicate.metadata?.aliasPaths || []), normalized.metadata.localPath].filter(Boolean))];
            result = this.repository.upsertContentItem({ sourceConnectionId: duplicate.sourceConnectionId, spaceId: duplicate.spaceId || target.space.id, externalId: duplicate.externalId, contentType: duplicate.contentType, title: duplicate.title, content: duplicate.content, revision: duplicate.revision, mimeType: duplicate.mimeType, sourceUrl: duplicate.sourceUrl, sourceModifiedAt: duplicate.sourceModifiedAt, metadata: { ...duplicate.metadata, aliasPaths }, tags: duplicate.tags || [] });
            stats.duplicates += 1;
          } else {
            result = this.repository.upsertContentItem({ ...normalized, sourceConnectionId: target.source.id, spaceId: normalized.spaceId || target.space.id });
            stats[result.action] = (stats[result.action] || 0) + 1;
            this.repository.replaceIndexChunks(result.item.id, buildIndexChunks(normalized, this.chunkOptions), { contentVersionId: result.item.currentVersionId });
            for (const attachment of normalized.attachments || []) {
              const isOriginal = attachment.externalId === 'original' || attachment.metadata?.kind === 'original';
              this.repository.upsertAttachment({
                ...attachment,
                contentItemId: result.item.id,
                externalId: isOriginal ? `original:${result.item.currentVersionId}` : attachment.externalId,
                metadata: isOriginal ? { ...(attachment.metadata || {}), kind: 'original', contentVersionId: result.item.currentVersionId } : attachment.metadata
              });
            }
          }
          results.push({ index, action: duplicate && duplicate.externalId !== normalized.externalId ? 'duplicate' : result.action, item: result.item });
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          stats.failed += 1;
          warnings.push({ index, code: error.code || 'INGESTION_ITEM_FAILED', message: error.message, path: typeof items[index] === 'string' ? resolve(items[index]) : items[index]?.path ? resolve(items[index].path) : undefined });
        }
        stats.processed = index + 1;
        job = this.repository.updateIngestionJob(job.id, { status: 'running', cursor: String(index + 1), stats, metadata: { ...(job.metadata || {}), warningCount: warnings.length } });
        await onProgress?.({ job, index, stats: { ...stats }, result: results.at(-1), warning: warnings.at(-1) });
      }
      job = this.repository.updateIngestionJob(job.id, { status: 'completed', cursor: String(items.length), stats, error: null, metadata: { ...(job.metadata || {}), warningCount: warnings.length } });
      return { job, results, warnings, stats, source: target.source, space: target.space };
    } catch (error) {
      const cancelled = error?.name === 'AbortError' || error?.code === 'INGESTION_CANCELLED';
      job = this.repository.updateIngestionJob(job.id, { status: cancelled ? 'cancelled' : 'failed', cursor: String(stats.processed), stats, error: { code: error.code || 'INGESTION_FAILED', message: error.message }, metadata: { ...(job.metadata || {}), warningCount: warnings.length } });
      error.job = job; error.results = results; error.warnings = warnings;
      throw error;
    }
  }
}
