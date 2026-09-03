import { parseImage } from './content/image-parser.mjs';

const IMAGE_MIME = /^image\/(png|jpe?g|webp)$/u;

function extensionOf(fileName = '') {
  const match = String(fileName).match(/\.(png|jpe?g|webp)$/iu);
  return match ? `.${match[1].toLowerCase()}` : '.png';
}

function chunkInput(chunk) {
  return { text: chunk.text, tokenCount: chunk.tokenCount ?? null, metadata: chunk.metadata || {} };
}

/**
 * 飞书同步的图片附件在落库后执行 OCR：把识别文本追加到对应内容项，
 * 保留原正文 chunks 并追加带 anchor 的 OCR chunk；重复同步按附件 externalId 去重。
 */
export async function ocrSyncAttachments({ content, ocr, documents = [] } = {}) {
  const stats = { processed: 0, imported: 0, empty: 0, failed: 0, warnings: [] };
  if (!ocr || !content || !Array.isArray(documents) || !documents.length) return stats;
  const items = new Map(content.listContentItems({ includeDeleted: false, includeTags: true, limit: 5000 }).map(item => [String(item.externalId), item]));
  for (const document of documents) {
    const item = items.get(String(document.externalId || ''));
    if (!item) continue;
    const imageAttachments = (document.attachments || []).filter(attachment => IMAGE_MIME.test(String(attachment.mimeType || '')));
    for (const attachment of imageAttachments) {
      stats.processed += 1;
      const bytes = attachment.data ? Buffer.from(attachment.data) : null;
      if (!bytes?.length) {
        stats.empty += 1;
        continue;
      }
      try {
        const parsed = await parseImage(
          { bytes, path: attachment.fileName || 'image.png', extension: extensionOf(attachment.fileName) },
          { recognizeImpl: (buffer, options) => ocr.recognize(buffer, { pageNumber: 1, signal: options.signal }), languages: ocr.languages }
        );
        const ocrText = String(parsed.content || '').trim();
        if (!ocrText) {
          stats.empty += 1;
          continue;
        }
        const existing = content.getContentItem(item.id, { includeDeleted: false, includeTags: true });
        const baseContent = String(existing?.content || '');
        const prefix = baseContent.trim() ? `\n\n[图片 OCR 提取 · ${attachment.fileName || '图片'}]\n` : '';
        const nextContent = baseContent + prefix + ocrText;
        const anchor = parsed.metadata?.ocrRegions?.[0]?.anchor || 'page:1:region:1';
        const updated = content.upsertContentItem({
          ...existing,
          id: item.id,
          content: nextContent,
          metadata: {
            ...(existing?.metadata || {}),
            ocrAttachments: [
              ...(existing?.metadata?.ocrAttachments || []).filter(entry => entry.externalId !== attachment.externalId),
              { externalId: attachment.externalId, fileName: attachment.fileName, anchor }
            ]
          },
          tags: existing?.tags || []
        });
        const currentChunks = content.listIndexChunks(item.id);
        const ocrChunk = { text: ocrText, tokenCount: Math.ceil(ocrText.length / 2.5), metadata: { anchor, source: 'sync-ocr', fileName: attachment.fileName } };
        content.replaceIndexChunks(updated.item.id, [...currentChunks.map(chunkInput), ocrChunk], { contentVersionId: updated.item.currentVersionId });
        stats.imported += 1;
      } catch (error) {
        stats.failed += 1;
        stats.warnings.push({ externalId: attachment.externalId, fileName: attachment.fileName, code: error?.code || 'SYNC_OCR_FAILED', message: error?.message });
      }
    }
  }
  return stats;
}
