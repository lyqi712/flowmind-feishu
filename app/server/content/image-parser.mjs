import { basename, extname } from 'node:path';
import { createOcrService } from './ocr-service.mjs';

const MIME_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
});
const defaultServices = new Map();

function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function webpSize(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (kind === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

export function imageSize(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  return jpegSize(bytes) || webpSize(bytes) || { width: 0, height: 0 };
}

function clamp(value, minimum = 0, maximum = 1) { return Math.min(maximum, Math.max(minimum, Number(value) || 0)); }
function normalizedRegion(region, width, height) {
  const existing = region?.region;
  if (existing && Number.isFinite(Number(existing.x))) {
    const x = clamp(existing.x), y = clamp(existing.y);
    return { x, y, width: clamp(existing.width, 0, 1 - x), height: clamp(existing.height, 0, 1 - y) };
  }
  const bbox = region?.bbox || region?.box || {};
  const x0 = Number(bbox.x0 ?? bbox.left ?? bbox.x ?? 0);
  const y0 = Number(bbox.y0 ?? bbox.top ?? bbox.y ?? 0);
  const x1 = Number(bbox.x1 ?? bbox.right ?? (x0 + Number(bbox.width || 0)));
  const y1 = Number(bbox.y1 ?? bbox.bottom ?? (y0 + Number(bbox.height || 0)));
  const safeWidth = Math.max(1, Number(width || 1));
  const safeHeight = Math.max(1, Number(height || 1));
  const x = clamp(x0 / safeWidth), y = clamp(y0 / safeHeight);
  return { x, y, width: clamp((x1 - x0) / safeWidth, 0, 1 - x), height: clamp((y1 - y0) / safeHeight, 0, 1 - y) };
}

function flattenTesseractRegions(data) {
  if (Array.isArray(data?.regions)) return data.regions;
  if (Array.isArray(data?.lines)) return data.lines;
  if (Array.isArray(data?.words)) return data.words;
  const regions = [];
  for (const block of data?.blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) regions.push(line);
  return regions;
}

function serviceFor(languages) {
  const key = Array.isArray(languages) ? languages.join(',') : String(languages || process.env.FLOWMIND_OCR_LANGUAGES || 'eng,chi_sim');
  if (!defaultServices.has(key)) defaultServices.set(key, createOcrService({ languages: key }));
  return defaultServices.get(key);
}

export async function parseImage({ bytes, path = 'image.png', extension, signal } = {}, { recognizeImpl, languages = process.env.FLOWMIND_OCR_LANGUAGES || 'eng,chi_sim' } = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const fileName = basename(String(path || 'image.png'));
  const fileExtension = String(extension || extname(fileName)).toLowerCase();
  const measured = imageSize(buffer);
  try {
    const raw = recognizeImpl
      ? await recognizeImpl(buffer, { languages, signal })
      : await serviceFor(languages).recognize(buffer, { pageNumber: 1, signal });
    const data = raw?.data || raw || {};
    const width = Number(data.width || raw?.width || measured.width || 0);
    const height = Number(data.height || raw?.height || measured.height || 0);
    const sourceRegions = flattenTesseractRegions(data);
    const fallbackText = String(data.text || raw?.text || '').replace(/\r\n?/g, '\n').trim();
    const normalized = sourceRegions.map((region) => ({
      text: String(region?.text || '').replace(/\s+/g, ' ').trim(),
      confidence: Number(region?.confidence ?? data.confidence ?? raw?.confidence ?? 0),
      region: normalizedRegion(region, width, height)
    })).filter((region) => region.text);
    if (!normalized.length && fallbackText) normalized.push({ text: fallbackText, confidence: Number(data.confidence ?? raw?.confidence ?? 0), region: { x: 0, y: 0, width: 1, height: 1 } });
    if (!normalized.length) throw Object.assign(new Error(`图片中未识别到可检索文字: ${fileName}`), { code: 'IMAGE_TEXT_EMPTY', fileName });

    let content = '';
    const ocrRegions = normalized.map((entry, index) => {
      if (content) content += '\n';
      const startChar = content.length;
      content += entry.text;
      const endChar = content.length;
      return { pageNumber: 1, anchor: `page:1:region:${index + 1}`, startChar, endChar, charCount: entry.text.length, text: entry.text, region: entry.region, confidence: entry.confidence };
    });
    const confidence = Number(data.confidence ?? raw?.confidence ?? (ocrRegions.reduce((sum, entry) => sum + entry.confidence, 0) / ocrRegions.length));
    const languageList = Array.isArray(data.languages || raw?.languages) ? [...(data.languages || raw.languages)] : String(languages || 'eng').split(/[,+\s]+/).filter(Boolean);
    return {
      title: fileName.replace(extname(fileName), '') || 'OCR 图片',
      content,
      contentType: 'image',
      mimeType: MIME_BY_EXTENSION[fileExtension] || 'application/octet-stream',
      persistOriginal: true,
      pageSegments: ocrRegions,
      metadata: {
        pageCount: 1,
        textPageCount: 1,
        pages: [{ pageNumber: 1, anchor: 'page:1', startChar: 0, endChar: content.length, charCount: content.length }],
        ocrRegions,
        width,
        height,
        ocr: { engine: String(data.engine || raw?.engine || (recognizeImpl ? 'custom' : 'tesseract.js')), languages: languageList, confidence }
      }
    };
  } catch (error) {
    if (error?.code === 'IMAGE_TEXT_EMPTY' || error?.code === 'INGESTION_CANCELLED' || error?.name === 'AbortError') throw error;
    throw Object.assign(new Error(`图片 OCR 失败: ${fileName}: ${error?.message || error}`), { code: 'IMAGE_OCR_FAILED', cause: error, fileName });
  }
}

export function createImageParsers(ocrService) {
  const parse = (input) => parseImage(input, ocrService ? { recognizeImpl: (bytes, options) => ocrService.recognize(bytes, { pageNumber: 1, signal: options.signal }), languages: ocrService.languages } : {});
  return Object.freeze({ '.png': parse, '.jpg': parse, '.jpeg': parse, '.webp': parse });
}

export const IMAGE_LOCAL_PARSERS = createImageParsers();