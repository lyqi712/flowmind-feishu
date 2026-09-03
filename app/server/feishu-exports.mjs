export const FEISHU_EXPORT_LIMIT = 20;

export function defaultExportTitle(content = '', fallback = '') {
  const text = String(content || '').replace(/\r/g, '');
  const heading = text.match(/^#{1,3}\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim().slice(0, 80);
  const line = text.split('\n').map((item) => item.trim()).find(Boolean);
  if (line) return line.replace(/^#+\s*/, '').slice(0, 80);
  return String(fallback || '').trim().slice(0, 80);
}

export function createExportRecord(input = {}, now = () => new Date().toISOString()) {
  return {
    id: String(input.id || `export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    title: String(input.title || '').trim() || '未命名导出',
    url: String(input.url || '').trim(),
    documentId: String(input.documentId || '').trim(),
    folderId: String(input.folderId || '').trim(),
    folderName: String(input.folderName || '').trim(),
    contentItemId: String(input.contentItemId || '').trim(),
    createdAt: input.createdAt || now()
  };
}

export function exportedContentPayload(record = {}, markdown = '') {
  const documentId = String(record.documentId || record.id || '').trim();
  return {
    externalId: `feishu-export:${documentId || record.title || 'untitled'}`,
    title: String(record.title || '').trim() || '未命名导出',
    content: String(markdown || ''),
    contentType: 'document',
    mimeType: 'text/markdown',
    sourceUrl: String(record.url || '').trim() || null,
    sourceModifiedAt: record.createdAt || undefined,
    metadata: {
      origin: 'feishu-export',
      feishuDocumentId: String(record.documentId || '').trim(),
      folderId: String(record.folderId || '').trim(),
      folderName: String(record.folderName || '').trim()
    },
    tags: ['飞书导出']
  };
}

export function exportHomeAction(record = {}) {
  const documentId = String(record.contentItemId || '').trim();
  if (documentId) return { action: 'open-document', documentId, url: String(record.url || '').trim() };
  return { action: 'open-export', documentId: '', url: String(record.url || '').trim() };
}

export function rememberExport(exports = [], record, limit = FEISHU_EXPORT_LIMIT) {
  if (!record?.id) return Array.isArray(exports) ? exports.slice(0, limit) : [];
  const current = Array.isArray(exports) ? exports : [];
  return [
    record,
    ...current.filter((item) => item?.id !== record.id && item?.documentId !== record.documentId)
  ].slice(0, limit);
}
