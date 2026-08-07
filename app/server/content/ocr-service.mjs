import { copyFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createWorker, OEM } from 'tesseract.js';

const require = createRequire(import.meta.url);
const LANGUAGE_PACKS = Object.freeze({
  eng: require('@tesseract.js-data/eng'),
  chi_sim: require('@tesseract.js-data/chi_sim')
});

function normalizeLanguages(value) {
  const values = Array.isArray(value) ? value : String(value || 'eng,chi_sim').split(/[,+\s]+/);
  return [...new Set(values.map((entry) => String(entry || '').trim()).filter((entry) => LANGUAGE_PACKS[entry]))];
}
function normalizedRect(bbox, width, height) {
  const x0 = Math.max(0, Number(bbox?.x0 || 0));
  const y0 = Math.max(0, Number(bbox?.y0 || 0));
  const x1 = Math.min(width, Number(bbox?.x1 || x0));
  const y1 = Math.min(height, Number(bbox?.y1 || y0));
  return { x: x0 / width, y: y0 / height, width: Math.max(0, x1 - x0) / width, height: Math.max(0, y1 - y0) / height };
}
function extractLines(blocks = [], width, height, pageNumber) {
  const lines = [];
  for (const block of blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) {
    const text = String(line.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    lines.push({ pageNumber, text, confidence: Number(line.confidence ?? block.confidence ?? 0), region: normalizedRect(line.bbox || block.bbox, width, height) });
  }
  return lines;
}
async function exists(path) { try { await stat(path); return true; } catch { return false; } }

export class OcrService {
  constructor({ languages = process.env.FLOWMIND_OCR_LANGUAGES || ['eng', 'chi_sim'], dataDir = join(tmpdir(), 'flowmind-ocr-data-v1'), logger } = {}) {
    this.languages = normalizeLanguages(languages);
    if (!this.languages.length) this.languages = ['eng'];
    this.dataDir = dataDir;
    this.logger = logger;
    this.workerPromise = null;
    this.queue = Promise.resolve();
  }
  async prepareLanguageData() {
    await mkdir(this.dataDir, { recursive: true });
    for (const language of this.languages) {
      const pack = LANGUAGE_PACKS[language];
      const source = join(pack.langPath, `${pack.code}.traineddata.gz`);
      const target = join(this.dataDir, `${pack.code}.traineddata.gz`);
      if (!await exists(target)) await copyFile(source, target);
    }
  }
  async getWorker() {
    if (!this.workerPromise) this.workerPromise = (async () => {
      await this.prepareLanguageData();
      return createWorker(this.languages, OEM.LSTM_ONLY, {
        langPath: this.dataDir,
        cachePath: this.dataDir,
        cacheMethod: 'write',
        gzip: true,
        logger: (message) => this.logger?.(message)
      });
    })();
    return this.workerPromise;
  }
  recognize(bytes, { pageNumber = 1, signal } = {}) {
    const task = this.queue.then(async () => {
      if (signal?.aborted) throw Object.assign(new Error('OCR cancelled'), { code: 'INGESTION_CANCELLED' });
      const image = await loadImage(bytes);
      const worker = await this.getWorker();
      const result = await worker.recognize(bytes, {}, { blocks: true });
      const text = String(result.data.text || '').trim();
      const regions = extractLines(result.data.blocks || [], image.width, image.height, pageNumber);
      return { text, confidence: Number(result.data.confidence || 0), width: image.width, height: image.height, regions, languages: [...this.languages], engine: 'tesseract.js' };
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async recognizePdfPage(page, { pageNumber = 1, scale = 2, signal } = {}) {
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    return this.recognize(canvas.toBuffer('image/png'), { pageNumber, signal });
  }
  async close() {
    const promise = this.workerPromise;
    this.workerPromise = null;
    if (promise) { try { const worker = await promise; await worker.terminate(); } catch {} }
  }
}

export function createOcrService(options) { return new OcrService(options); }
