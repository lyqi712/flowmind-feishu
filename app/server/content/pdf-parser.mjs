import { getDocument, InvalidPDFException, PasswordException, PasswordResponses, ResponseException } from 'pdfjs-dist/legacy/build/pdf.mjs';

function pdfError(message, code, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function normalizePageText(items = []) {
  const lines = [];
  let current = '';
  let previousY = null;
  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue;
    const value = item.str.replace(/\u0000/g, '').trim();
    const y = Number(item.transform?.[5]);
    const changedLine = previousY !== null && Number.isFinite(y) && Math.abs(y - previousY) > 2.5;
    if (changedLine && current.trim()) { lines.push(current.trim()); current = ''; }
    if (value) current += `${current && !current.endsWith(' ') ? ' ' : ''}${value}`;
    if (item.hasEOL && current.trim()) { lines.push(current.trim()); current = ''; }
    if (Number.isFinite(y)) previousY = y;
  }
  if (current.trim()) lines.push(current.trim());
  return lines.join('\n').replace(/[ \t]+\n/g, '\n').trim();
}

function mapPdfError(error, fileName) {
  if (error?.code?.startsWith?.('PDF_') || error?.code === 'INGESTION_CANCELLED') return error;
  if (error instanceof PasswordException || error?.name === 'PasswordException') {
    return pdfError(`PDF 已加密，需要先解除密码保护后再导入: ${fileName}`, 'PDF_PASSWORD_REQUIRED', { fileName });
  }
  if (error instanceof InvalidPDFException || error instanceof ResponseException || ['InvalidPDFException', 'MissingPDFException', 'UnexpectedResponseException', 'ResponseException'].includes(error?.name)) {
    return pdfError(`PDF 文件损坏或格式无效: ${fileName}`, 'PDF_INVALID', { fileName });
  }
  return pdfError(`PDF 解析失败: ${fileName} (${error?.message || '未知错误'})`, 'PDF_PARSE_FAILED', { fileName, cause: error });
}

async function openPdf(bytes, { getDocumentImpl = getDocument, signal, fileName }) {
  const loadingTask = getDocumentImpl({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false });
  let rejectPassword;
  const passwordRequest = new Promise((_, reject) => { rejectPassword = reject; });
  loadingTask.onPassword = (_updatePassword, reason) => {
    const kind = reason === PasswordResponses.INCORRECT_PASSWORD ? '密码不正确' : '需要密码';
    rejectPassword(pdfError(`PDF 已加密（${kind}），请先解除密码保护: ${fileName}`, 'PDF_PASSWORD_REQUIRED', { fileName, reason }));
  };
  const abortRequest = signal ? new Promise((_, reject) => {
    if (signal.aborted) reject(pdfError('PDF 导入任务已取消', 'INGESTION_CANCELLED'));
    else signal.addEventListener('abort', () => reject(pdfError('PDF 导入任务已取消', 'INGESTION_CANCELLED')), { once: true });
  }) : new Promise(() => {});
  try {
    const document = await Promise.race([loadingTask.promise, passwordRequest, abortRequest]);
    return { document, loadingTask };
  } catch (error) {
    try { await loadingTask.destroy(); } catch {}
    throw mapPdfError(error, fileName);
  }
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function normalizeRegion(region, width, height) {
  if (region?.region) return normalizeRegion(region.region, width, height);
  if (Number.isFinite(Number(region?.x))) {
    const x = clamp(region.x), y = clamp(region.y);
    return { x, y, width: clamp(region.width, 0, 1 - x), height: clamp(region.height, 0, 1 - y) };
  }
  const box = region?.bbox || region?.box || {};
  const x0 = Number(box.x0 ?? box.left ?? box.x ?? 0);
  const y0 = Number(box.y0 ?? box.top ?? box.y ?? 0);
  const x1 = Number(box.x1 ?? box.right ?? (x0 + Number(box.width || 0)));
  const y1 = Number(box.y1 ?? box.bottom ?? (y0 + Number(box.height || 0)));
  const safeWidth = Math.max(1, Number(width || 1));
  const safeHeight = Math.max(1, Number(height || 1));
  const x = clamp(x0 / safeWidth), y = clamp(y0 / safeHeight);
  return { x, y, width: clamp((x1 - x0) / safeWidth, 0, 1 - x), height: clamp((y1 - y0) / safeHeight, 0, 1 - y) };
}

function normalizeOcrRegions(result, pageNumber) {
  const source = Array.isArray(result?.regions) ? result.regions : [];
  const width = Number(result?.width || 1), height = Number(result?.height || 1);
  const regions = source.map((entry) => ({
    pageNumber,
    text: String(entry?.text || '').replace(/\s+/g, ' ').trim(),
    confidence: Number(entry?.confidence ?? result?.confidence ?? 0),
    region: normalizeRegion(entry, width, height)
  })).filter((entry) => entry.text);
  const fallback = String(result?.text || '').replace(/\r\n?/g, '\n').trim();
  if (!regions.length && fallback) regions.push({ pageNumber, text: fallback, confidence: Number(result?.confidence || 0), region: { x: 0, y: 0, width: 1, height: 1 } });
  return regions;
}

export async function parsePdf({ bytes, path = 'document.pdf', signal } = {}, options = {}) {
  const fileName = String(path || 'document.pdf').split(/[\\/]/).pop() || 'document.pdf';
  if (!bytes?.length) throw pdfError(`PDF 文件为空: ${fileName}`, 'CONTENT_EMPTY', { fileName });
  const { ocrService = null } = options;
  const { document, loadingTask } = await openPdf(bytes, { ...options, signal, fileName });
  try {
    const metadataResult = await document.getMetadata().catch(() => ({ info: {}, metadata: null }));
    const pageSegments = [];
    const pages = [];
    const ocrRegions = [];
    const ocrWarnings = [];
    const ocrEngines = new Set();
    const ocrLanguages = new Set();
    const ocrConfidences = [];
    let content = '';
    let textPageCount = 0;
    let nativeTextPageCount = 0;
    let ocrPageCount = 0;

    for (let index = 0; index < document.numPages; index += 1) {
      if (signal?.aborted) throw pdfError('PDF 导入任务已取消', 'INGESTION_CANCELLED');
      const pageNumber = index + 1;
      const page = await document.getPage(pageNumber);
      let nativeText = '';
      let localSegments = [];
      let pageOcr = null;
      try {
        const textContent = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
        nativeText = normalizePageText(textContent.items);
        if (nativeText) {
          nativeTextPageCount += 1;
          localSegments = [{ pageNumber, text: nativeText, anchor: `page:${pageNumber}`, confidence: null, region: null, ocr: false }];
        } else if (ocrService?.recognizePdfPage) {
          try {
            pageOcr = await ocrService.recognizePdfPage(page, { pageNumber, signal });
            const regions = normalizeOcrRegions(pageOcr, pageNumber);
            localSegments = regions.map((entry, regionIndex) => ({ ...entry, anchor: `page:${pageNumber}:region:${regionIndex + 1}`, ocr: true }));
            if (localSegments.length) {
              ocrPageCount += 1;
              if (pageOcr.engine) ocrEngines.add(String(pageOcr.engine));
              for (const language of pageOcr.languages || []) ocrLanguages.add(String(language));
              if (Number.isFinite(Number(pageOcr.confidence))) ocrConfidences.push(Number(pageOcr.confidence));
            }
          } catch (error) {
            if (error?.code === 'INGESTION_CANCELLED' || error?.name === 'AbortError') throw error;
            ocrWarnings.push({ code: 'PDF_OCR_PAGE_FAILED', pageNumber, message: error?.message || '扫描页 OCR 失败' });
          }
        }
      } finally {
        try { page.cleanup(); } catch {}
      }

      const pageStart = content.length + (content && localSegments.length ? 2 : 0);
      if (localSegments.length) {
        if (content) content += '\n\n';
        for (let segmentIndex = 0; segmentIndex < localSegments.length; segmentIndex += 1) {
          const segment = localSegments[segmentIndex];
          if (segmentIndex) content += '\n';
          const startChar = content.length;
          content += segment.text;
          const endChar = content.length;
          const stored = { pageNumber, text: segment.text, startChar, endChar, charCount: segment.text.length, anchor: segment.anchor, region: segment.region, confidence: segment.confidence };
          pageSegments.push(stored);
          if (segment.ocr) ocrRegions.push(stored);
        }
        textPageCount += 1;
      }
      const pageEnd = content.length;
      pages.push({ pageNumber, startChar: localSegments.length ? pageStart : pageEnd, endChar: pageEnd, charCount: localSegments.reduce((sum, entry) => sum + entry.text.length, 0), anchor: `page:${pageNumber}`, source: nativeText ? 'text-layer' : localSegments.length ? 'ocr' : 'empty' });
    }

    if (!content.trim()) {
      throw pdfError(`PDF 未检测到可检索文字，扫描页 OCR 也没有返回正文: ${fileName}`, 'PDF_TEXT_EMPTY', { fileName, pageCount: document.numPages, warnings: ocrWarnings });
    }
    const title = String(metadataResult?.info?.Title || '').trim() || fileName.replace(/\.pdf$/i, '') || 'PDF 文档';
    const averageConfidence = ocrConfidences.length ? Number((ocrConfidences.reduce((sum, value) => sum + value, 0) / ocrConfidences.length).toFixed(2)) : null;
    return {
      title,
      content,
      contentType: 'pdf',
      mimeType: 'application/pdf',
      persistOriginal: true,
      pageSegments,
      metadata: {
        pageCount: document.numPages,
        textPageCount,
        nativeTextPageCount,
        ocrPageCount,
        pages,
        ocrRegions,
        ocr: ocrRegions.length ? { engine: [...ocrEngines].join('+') || 'ocr', languages: [...ocrLanguages], confidence: averageConfidence, pageCount: ocrPageCount, regionCount: ocrRegions.length } : null,
        warnings: ocrWarnings,
        pdf: {
          version: metadataResult?.info?.PDFFormatVersion || null,
          producer: metadataResult?.info?.Producer || null,
          creator: metadataResult?.info?.Creator || null,
          title: metadataResult?.info?.Title || null
        }
      }
    };
  } catch (error) {
    throw mapPdfError(error, fileName);
  } finally {
    try { await document.destroy(); } catch {}
    try { await loadingTask.destroy(); } catch {}
  }
}

export const PDF_LOCAL_PARSERS = Object.freeze({ '.pdf': parsePdf });
