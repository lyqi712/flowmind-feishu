import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';

export const DEFAULT_CHAT_ATTACHMENT_LIMITS = Object.freeze({
  maxCount: 8,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 12 * 1024 * 1024,
  maxTemporaryItems: 64,
  maxTemporaryBytes: 64 * 1024 * 1024,
  temporaryTtlMs: 30 * 60 * 1000
});

const MIME_BY_EXTENSION = Object.freeze({
  '.txt': ['text/plain'],
  '.md': ['text/markdown', 'text/plain'],
  '.markdown': ['text/markdown', 'text/plain'],
  '.html': ['text/html'],
  '.htm': ['text/html'],
  '.csv': ['text/csv', 'text/plain'],
  '.tsv': ['text/tab-separated-values', 'text/plain'],
  '.json': ['application/json', 'text/json', 'text/plain'],
  '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.epub': ['application/epub+zip'],
  '.xmind': ['application/vnd.xmind.workbook', 'application/zip'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
  '.mp3': ['audio/mpeg', 'audio/mp3'],
  '.m4a': ['audio/mp4', 'audio/x-m4a'],
  '.wav': ['audio/wav', 'audio/x-wav'],
  '.aac': ['audio/aac']
});

const EXTENSION_BY_MIME = Object.freeze(Object.entries(MIME_BY_EXTENSION).reduce((output, [extension, types]) => {
  for (const type of types) output[type] ||= extension;
  return output;
}, {}));

function attachmentError(code, message, status = 400, details = {}) {
  return Object.assign(new Error(message), { code, status, details });
}

function cleanMimeType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function safeMetadata(metadata = {}) {
  const { localPath, aliasPaths, ...safe } = metadata || {};
  return safe;
}

function decodeBase64(value) {
  const normalized = String(value || '').replace(/\s+/g, '');
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    throw attachmentError('ATTACHMENT_DATA_INVALID', '附件 base64 数据格式无效。');
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (!bytes.length) throw attachmentError('ATTACHMENT_EMPTY', '附件内容为空。');
  return bytes;
}

function decodeDataUrl(value) {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(String(value || ''));
  if (!match) throw attachmentError('ATTACHMENT_DATA_URL_INVALID', '附件 data URL 必须使用 data:<mime>;base64,<data> 格式。');
  return { mimeType: cleanMimeType(match[1]), bytes: decodeBase64(match[2]) };
}

function normalizedFileName(value, mimeType, fallback = 'attachment') {
  const supplied = basename(String(value || '').trim());
  if (supplied && supplied !== '.' && supplied !== '..') return supplied.slice(0, 240);
  const extension = EXTENSION_BY_MIME[mimeType] || '';
  return `${fallback}${extension}`;
}

function assertSupportedFile({ fileName, mimeType, bytes, ingestion, limits }) {
  if (!bytes?.length) throw attachmentError('ATTACHMENT_EMPTY', '附件内容为空。');
  if (bytes.length > limits.maxFileBytes) {
    throw attachmentError('ATTACHMENT_TOO_LARGE', `单个附件不能超过 ${Math.floor(limits.maxFileBytes / 1024 / 1024)} MB。`, 413, { maxFileBytes: limits.maxFileBytes, actualBytes: bytes.length });
  }
  const extension = extname(fileName).toLowerCase();
  if (!extension || !ingestion.parsers?.has(extension) || !MIME_BY_EXTENSION[extension]) {
    throw attachmentError('ATTACHMENT_TYPE_UNSUPPORTED', `暂不支持附件类型 ${extension || '[无扩展名]'}。`, 415, { extension, acceptedExtensions: Object.keys(MIME_BY_EXTENSION) });
  }
  const normalizedMime = cleanMimeType(mimeType) || MIME_BY_EXTENSION[extension][0];
  const generic = !normalizedMime || normalizedMime === 'application/octet-stream';
  if (!generic && !MIME_BY_EXTENSION[extension].includes(normalizedMime)) {
    throw attachmentError('ATTACHMENT_TYPE_MISMATCH', `附件扩展名 ${extension} 与 MIME 类型 ${normalizedMime} 不匹配。`, 415, { extension, mimeType: normalizedMime });
  }
  return { extension, mimeType: generic ? MIME_BY_EXTENSION[extension][0] : normalizedMime };
}

function contentItemToDocument(item) {
  return {
    id: String(item.id),
    title: item.title,
    content: String(item.content || ''),
    type: item.contentType || 'document',
    contentType: item.contentType || 'document',
    mimeType: item.mimeType || null,
    knowledgeBaseId: item.spaceId || 'local-imports',
    source: item.sourceType || 'content-item',
    url: String(item.sourceUrl || '').startsWith('file://') ? null : item.sourceUrl || null,
    revision: item.revision || null,
    tags: item.tags || [],
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || item.sourceModifiedAt || null,
    metadata: safeMetadata(item.metadata)
  };
}

function parsedToDocument(parsed, id, source, temporaryId = null) {
  return {
    id,
    title: parsed.title,
    content: String(parsed.content || ''),
    type: parsed.contentType || 'document',
    contentType: parsed.contentType || 'document',
    mimeType: parsed.mimeType || null,
    knowledgeBaseId: 'chat-attachments',
    source: 'chat-attachment',
    url: null,
    revision: parsed.revision || null,
    tags: parsed.tags || [],
    metadata: {
      ...safeMetadata(parsed.metadata),
      temporary: true,
      attachmentSource: source,
      temporaryId
    }
  };
}

function publicManifest(document, source, extra = {}) {
  return {
    id: document.id,
    source,
    title: document.title,
    fileName: document.metadata?.fileName || null,
    contentType: document.contentType || document.type || 'document',
    mimeType: document.mimeType || null,
    byteSize: document.metadata?.byteSize ?? null,
    searchable: Boolean(String(document.content || '').trim()),
    citationDocumentId: document.id,
    ...extra
  };
}

export class ChatAttachmentService {
  constructor({ ingestion, repository, getDocuments = () => [], now = () => Date.now(), createId = () => `tmp_${randomUUID()}`, limits = {} } = {}) {
    if (!ingestion) throw new TypeError('ingestion is required');
    if (!repository) throw new TypeError('repository is required');
    this.ingestion = ingestion;
    this.repository = repository;
    this.getDocuments = getDocuments;
    this.now = now;
    this.createId = createId;
    this.limits = Object.freeze({ ...DEFAULT_CHAT_ATTACHMENT_LIMITS, ...limits });
    this.temporary = new Map();
  }

  temporaryBytes() {
    let total = 0;
    for (const record of this.temporary.values()) total += record.bytes.length;
    return total;
  }

  cleanup() {
    const current = this.now();
    for (const [id, record] of this.temporary) if (record.expiresAtMs <= current) this.temporary.delete(id);
    while (this.temporary.size > this.limits.maxTemporaryItems || this.temporaryBytes() > this.limits.maxTemporaryBytes) {
      this.temporary.delete(this.temporary.keys().next().value);
    }
  }

  binaryInput(input = {}) {
    if (Buffer.isBuffer(input)) return { bytes: input, fileName: 'attachment', mimeType: 'application/octet-stream' };
    if (Buffer.isBuffer(input?.bytes) || input?.bytes instanceof Uint8Array) {
      return { bytes: Buffer.from(input.bytes), fileName: input.fileName || input.name, mimeType: cleanMimeType(input.mimeType) };
    }
    if (typeof input?.dataUrl === 'string') {
      const decoded = decodeDataUrl(input.dataUrl);
      const suppliedMimeType = cleanMimeType(input.mimeType);
      if (suppliedMimeType && suppliedMimeType !== decoded.mimeType) {
        throw attachmentError('ATTACHMENT_TYPE_MISMATCH', `\u9644\u4ef6\u58f0\u660e\u7684 MIME \u7c7b\u578b ${suppliedMimeType} \u4e0e data URL \u7c7b\u578b ${decoded.mimeType} \u4e0d\u5339\u914d\u3002`, 415, { mimeType: suppliedMimeType, dataUrlMimeType: decoded.mimeType });
      }
      return { bytes: decoded.bytes, mimeType: suppliedMimeType || decoded.mimeType, fileName: input.fileName || input.name };
    }
    const encoded = input?.base64 ?? (input?.encoding === 'base64' ? input?.data : undefined);
    if (typeof encoded !== 'string') throw attachmentError('ATTACHMENT_DATA_REQUIRED', '附件必须提供 dataUrl 或 base64 数据。');
    return { bytes: decodeBase64(encoded), mimeType: cleanMimeType(input.mimeType), fileName: input.fileName || input.name };
  }

  async parseBinary(input, { signal, source = 'inline', documentId, temporaryId = null } = {}) {
    const binary = this.binaryInput(input);
    const mimeType = cleanMimeType(binary.mimeType);
    const fileName = normalizedFileName(binary.fileName, mimeType, source === 'temporary' ? 'temporary-attachment' : 'inline-attachment');
    const validated = assertSupportedFile({ fileName, mimeType, bytes: binary.bytes, ingestion: this.ingestion, limits: this.limits });
    let parsed;
    try {
      parsed = await this.ingestion.parseUploadedFile({ fileName, mimeType: validated.mimeType, bytes: binary.bytes, externalId: documentId }, { signal });
    } catch (error) {
      if (error?.code) {
        error.status ||= ['CONTENT_PARSER_UNSUPPORTED'].includes(error.code) ? 415 : 422;
        throw error;
      }
      throw attachmentError('ATTACHMENT_PARSE_FAILED', `附件解析失败：${fileName}。`, 422);
    }
    const id = documentId || `chat-attachment:${randomUUID()}`;
    const document = parsedToDocument(parsed, id, source, temporaryId);
    if (!document.content.trim()) throw attachmentError('ATTACHMENT_CONTENT_EMPTY', `附件 ${fileName} 解析后没有可用于问答的正文。`, 422);
    return { bytes: binary.bytes, fileName, mimeType: validated.mimeType, document };
  }

  async createTemporary(input, { signal } = {}) {
    this.cleanup();
    if (this.temporary.size >= this.limits.maxTemporaryItems) {
      this.temporary.delete(this.temporary.keys().next().value);
    }
    const temporaryId = this.createId();
    const parsed = await this.parseBinary(input, { signal, source: 'temporary', documentId: `chat-attachment:${temporaryId}`, temporaryId });
    if (parsed.bytes.length > this.limits.maxTemporaryBytes) {
      throw attachmentError('ATTACHMENT_TOO_LARGE', '\u9644\u4ef6\u8d85\u8fc7\u4e34\u65f6\u9644\u4ef6\u5b58\u50a8\u5bb9\u91cf\u3002', 413, { maxTemporaryBytes: this.limits.maxTemporaryBytes, actualBytes: parsed.bytes.length });
    }
    const createdAtMs = this.now();
    const record = { ...parsed, temporaryId, createdAtMs, expiresAtMs: createdAtMs + this.limits.temporaryTtlMs };
    this.temporary.set(temporaryId, record);
    this.cleanup();
    if (!this.temporary.has(temporaryId)) throw attachmentError('ATTACHMENT_STORAGE_FULL', '\u4e34\u65f6\u9644\u4ef6\u7a7a\u95f4\u5df2\u6ee1\uff0c\u8bf7\u79fb\u9664\u65e7\u9644\u4ef6\u540e\u91cd\u8bd5\u3002', 507);
    return {
      temporaryId,
      expiresAt: new Date(record.expiresAtMs).toISOString(),
      attachment: publicManifest(record.document, 'temporary', { temporaryId })
    };
  }

  getTemporary(id) {
    this.cleanup();
    const record = this.temporary.get(String(id || ''));
    if (!record) throw attachmentError('ATTACHMENT_NOT_FOUND', '临时附件不存在或已过期，请重新添加。', 404, { temporaryId: String(id || '') });
    return record;
  }

  removeTemporary(id) {
    this.cleanup();
    return this.temporary.delete(String(id || ''));
  }

  resolveContentItem(contentItemId) {
    const item = this.repository.getContentItem(String(contentItemId || ''));
    if (!item) throw attachmentError('CONTENT_ITEM_NOT_FOUND', '指定的知识库内容不存在。', 404, { contentItemId: String(contentItemId || '') });
    const document = contentItemToDocument(item);
    if (!document.content.trim()) throw attachmentError('ATTACHMENT_CONTENT_EMPTY', `内容 ${document.title} 没有可用于问答的正文。`, 422, { contentItemId: document.id });
    return { document, manifest: publicManifest(document, 'content-item', { contentItemId: document.id }) };
  }

  resolveDocument(documentId) {
    const document = this.getDocuments().find((item) => String(item.id) === String(documentId || ''));
    if (!document) throw attachmentError('DOCUMENT_NOT_FOUND', '指定的文档不存在。', 404, { documentId: String(documentId || '') });
    if (!String(document.content || '').trim()) throw attachmentError('ATTACHMENT_CONTENT_EMPTY', `文档 ${document.title || document.id} 没有可用于问答的正文。`, 422, { documentId: String(document.id) });
    return { document, manifest: publicManifest(document, 'document', { documentId: String(document.id) }) };
  }

  async resolveRequest(body = {}, { signal } = {}) {
    if (body.attachments !== undefined && !Array.isArray(body.attachments)) throw attachmentError('ATTACHMENT_INPUT_INVALID', 'attachments \u5fc5\u987b\u662f\u6570\u7ec4\u3002');
    const inputs = Array.isArray(body.attachments) ? [...body.attachments] : [];
    if (body.attachment !== undefined) inputs.push(body.attachment);
    for (const contentItemId of Array.isArray(body.contentItemIds) ? body.contentItemIds : []) inputs.push({ contentItemId });
    for (const temporaryId of Array.isArray(body.temporaryAttachmentIds) ? body.temporaryAttachmentIds : []) inputs.push({ temporaryId });
    if (inputs.length > this.limits.maxCount) {
      throw attachmentError('ATTACHMENT_COUNT_EXCEEDED', `一次最多添加 ${this.limits.maxCount} 个附件。`, 400, { maxCount: this.limits.maxCount, actualCount: inputs.length });
    }

    const documents = [];
    const attachments = [];
    const requiredDocumentIds = new Set();
    const seen = new Set();
    let totalBytes = 0;

    for (const raw of inputs) {
      const input = typeof raw === 'string' ? { temporaryId: raw } : raw;
      if (!input || typeof input !== 'object') throw attachmentError('ATTACHMENT_INPUT_INVALID', '附件输入必须是对象或临时附件 ID。');
      let resolved;
      if (input.contentItemId || input.contentItem?.id) {
        resolved = this.resolveContentItem(input.contentItemId || input.contentItem.id);
      } else if (input.documentId || input.document?.id) {
        resolved = this.resolveDocument(input.documentId || input.document.id);
      } else if (input.temporaryId || input.tempId || input.fileId || input.attachmentId) {
        const temporaryId = input.temporaryId || input.tempId || input.fileId || input.attachmentId;
        const record = this.getTemporary(temporaryId);
        resolved = { byteSize: record.bytes.length, document: record.document, manifest: publicManifest(record.document, 'temporary', { temporaryId: record.temporaryId, expiresAt: new Date(record.expiresAtMs).toISOString() }) };
      } else if (input.dataUrl || input.base64 || (input.encoding === 'base64' && input.data)) {
        const parsed = await this.parseBinary(input, { signal, source: 'inline' });
        resolved = { byteSize: parsed.bytes.length, document: parsed.document, manifest: publicManifest(parsed.document, 'inline') };
      } else {
        throw attachmentError('ATTACHMENT_REFERENCE_INVALID', '附件必须提供 contentItemId、documentId、temporaryId、dataUrl 或 base64。');
      }

      const key = String(resolved.document.id);
      if (seen.has(key)) continue;
      seen.add(key);
      totalBytes += Number(resolved.byteSize || 0);
      if (totalBytes > this.limits.maxTotalBytes) {
        throw attachmentError('ATTACHMENT_TOTAL_TOO_LARGE', `附件总大小不能超过 ${Math.floor(this.limits.maxTotalBytes / 1024 / 1024)} MB。`, 413, { maxTotalBytes: this.limits.maxTotalBytes, actualBytes: totalBytes });
      }
      documents.push(resolved.document);
      attachments.push(resolved.manifest);
      requiredDocumentIds.add(key);
    }

    return { documents, attachments, requiredDocumentIds: [...requiredDocumentIds], totalBytes };
  }

  close() {
    this.temporary.clear();
  }
}

export function createChatAttachmentService(options) {
  return new ChatAttachmentService(options);
}

export function attachmentHttpError(error) {
  return {
    status: Number(error?.status) || 500,
    body: {
      ok: false,
      error: {
        code: typeof error?.code === 'string' ? error.code : 'ATTACHMENT_FAILED',
        message: typeof error?.message === 'string' ? error.message : '附件处理失败。',
        ...(error?.details && Object.keys(error.details).length ? { details: error.details } : {})
      }
    }
  };
}
