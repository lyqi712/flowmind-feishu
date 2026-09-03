import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import { createInitializedApp } from '../server/app.mjs';
import { createFakeModelService } from './helpers/fake-model.mjs';
import { OcrService } from '../server/content/ocr-service.mjs';
import { parsePdf } from '../server/content/pdf-parser.mjs';
import { answerQuestion } from '../server/retrieval.mjs';

function fakePdf({ nativePages = [''], metadata = {} } = {}) {
  const pages = nativePages.map((text, index) => ({
    pageNumber: index + 1,
    async getTextContent() { return { items: text ? [{ str: text, transform: [1, 0, 0, 1, 0, 700], hasEOL: true }] : [] }; },
    cleanup() {}
  }));
  const document = {
    numPages: pages.length,
    async getPage(pageNumber) { return pages[pageNumber - 1]; },
    async getMetadata() { return { info: metadata, metadata: null }; },
    async destroy() {}
  };
  const loadingTask = { promise: Promise.resolve(document), onPassword: null, async destroy() {} };
  return { getDocumentImpl: () => loadingTask };
}

function scanOcr(overrides = {}) {
  return {
    engine: 'mock-ocr', languages: ['eng'], confidence: 93, width: 1200, height: 1600,
    text: 'SCANNED ORBIT DELTA rollback owner',
    regions: [{ pageNumber: 1, text: 'SCANNED ORBIT DELTA rollback owner', confidence: 94, region: { x: 0.08, y: 0.12, width: 0.7, height: 0.06 } }],
    ...overrides
  };
}

function ndjson(text) { return text.trim().split('\n').filter(Boolean).map(JSON.parse); }

test('scanned PDF OCR creates page-region anchors, searchable chunks and visual citations', async () => {
  const fixture = fakePdf({ nativePages: ['', 'NATIVE PAGE release checklist'], metadata: { Title: 'Scanned release' } });
  const ocrService = { async recognizePdfPage(_page, { pageNumber }) { return pageNumber === 1 ? scanOcr() : scanOcr({ text: '', regions: [] }); } };
  const parsed = await parsePdf({ bytes: Buffer.from('%PDF scan fixture'), path: 'scan.pdf' }, { ...fixture, ocrService });
  assert.equal(parsed.metadata.ocrPageCount, 1);
  assert.equal(parsed.metadata.nativeTextPageCount, 1);
  assert.equal(parsed.metadata.ocrRegions[0].anchor, 'page:1:region:1');
  assert.deepEqual(parsed.metadata.ocrRegions[0].region, { x: 0.08, y: 0.12, width: 0.7, height: 0.06 });
  assert.equal(parsed.pageSegments[0].anchor, 'page:1:region:1');
  assert.equal(parsed.pageSegments.at(-1).anchor, 'page:2');

  const answer = answerQuestion([{ id: 'scan-1', title: parsed.title, content: parsed.content, metadata: parsed.metadata }], 'ORBIT DELTA');
  assert.equal(answer.citations[0].anchor, 'page:1:region:1');
  assert.deepEqual(answer.citations[0].region, { x: 0.08, y: 0.12, width: 0.7, height: 0.06 });
});

test('scanned PDF upload persists original and returns region-aware API citations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-scan-api-'));
  const parser = (input) => parsePdf(input, { ...fakePdf({ nativePages: [''] }), ocrService: { recognizePdfPage: async () => scanOcr() } });
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'), env: {}, ocrService: false,
    modelService: createFakeModelService(),
    contentOptions: { ingestion: { parsers: { '.pdf': parser } } },
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bytes = Buffer.from('%PDF scanned original bytes');
    const uploaded = await fetch(`${base}/api/content/import/file`, { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-file-name': 'scan.pdf' }, body: bytes });
    const body = await uploaded.json();
    assert.equal(body.stats.created, 1);
    const itemId = body.items[0].item.id;
    const detail = await (await fetch(`${base}/api/content/items/${itemId}`)).json();
    assert.equal(detail.item.metadata.ocrRegions[0].anchor, 'page:1:region:1');
    assert.equal(detail.chunks[0].metadata.pageAnchor, 'page:1:region:1');
    assert.deepEqual(detail.chunks[0].metadata.region, { x: 0.08, y: 0.12, width: 0.7, height: 0.06 });
    assert.deepEqual(Buffer.from(await (await fetch(`${base}/api/content/items/${itemId}/original`)).arrayBuffer()), bytes);
    const response = await fetch(`${base}/api/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'ORBIT DELTA', documentIds: [itemId] }) });
    const done = ndjson(await response.text()).find(event => event.type === 'done');
    assert.match(done.citations[0].anchor, /^page:1:region:1:chars:\d+-\d+$/);
    assert.equal(done.citations[0].pageAnchor, 'page:1:region:1');
    assert.deepEqual(done.citations[0].region, { x: 0.08, y: 0.12, width: 0.7, height: 0.06 });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await app.locals.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('OCR failures remain page-local and an entirely empty scanned PDF is rejected', async () => {
  const partial = await parsePdf({ bytes: Buffer.from('%PDF partial'), path: 'partial.pdf' }, {
    ...fakePdf({ nativePages: ['', 'NATIVE SURVIVES'] }),
    ocrService: { async recognizePdfPage() { throw new Error('fixture OCR unavailable'); } }
  });
  assert.match(partial.content, /NATIVE SURVIVES/);
  assert.equal(partial.metadata.warnings[0].code, 'PDF_OCR_PAGE_FAILED');
  await assert.rejects(() => parsePdf({ bytes: Buffer.from('%PDF empty'), path: 'empty-scan.pdf' }, {
    ...fakePdf({ nativePages: [''] }),
    ocrService: { async recognizePdfPage() { return scanOcr({ text: '', regions: [] }); } }
  }), error => error.code === 'PDF_TEXT_EMPTY');
});

test('real Tesseract worker recognizes a generated image and keeps language data in the runtime directory', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-real-ocr-'));
  const dataDir = join(root, 'ocr-data');
  const canvas = createCanvas(900, 220);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, 900, 220);
  context.fillStyle = '#111'; context.font = 'bold 52px Arial'; context.fillText('ORBIT DELTA rollback', 35, 125);
  const service = new OcrService({ languages: ['eng'], dataDir });
  try {
    const result = await service.recognize(canvas.toBuffer('image/png'));
    assert.match(result.text, /ORBIT DELTA/i);
    assert.ok(result.regions.length >= 1);
    assert.equal(service.dataDir, dataDir);
    const files = await readdir(dataDir);
    assert.ok(files.some(name => name.startsWith('eng.traineddata')));
    await assert.rejects(access(join(process.cwd(), 'chi_sim.traineddata')));
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
