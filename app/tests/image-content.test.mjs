import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';
import { parseImage } from '../server/content/image-parser.mjs';

function pngFixture(width = 200, height = 100) {
  const bytes = Buffer.alloc(32);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8); Buffer.from('IHDR').copy(bytes, 12);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}
const recognizeFixture = async () => ({ data: { confidence: 96, regions: [
  { text: 'ORBIT IMAGE release gate', confidence: 97, bbox: { x0: 20, y0: 10, x1: 180, y1: 35 } },
  { text: 'Rollback owner: FlowMind', confidence: 95, bbox: { x0: 20, y0: 50, x1: 170, y1: 75 } }
] } });
async function harness(recognizeImpl = recognizeFixture) {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-image-api-'));
  const parser = (input) => parseImage(input, { recognizeImpl, languages: 'eng' });
  const app = await createInitializedApp({ stateFile: join(root, 'state.json'), env: {}, contentOptions: { ingestion: { parsers: { '.png': parser, '.jpg': parser, '.jpeg': parser, '.webp': parser } } }, modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') }, feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') } });
  const server = await new Promise((resolve) => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  return { base: 'http://127.0.0.1:' + server.address().port, async close() { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); } };
}
async function upload(base, name, bytes, type = 'image/png') { const response = await fetch(base + '/api/content/import/file', { method: 'POST', headers: { 'content-type': type, 'x-file-name': encodeURIComponent(name) }, body: bytes }); return { status: response.status, body: await response.json() }; }
function ndjson(text) { return text.trim().split('\n').filter(Boolean).map(JSON.parse); }

test('image parser normalizes OCR regions into stable anchors and dimensions', async () => {
  const parsed = await parseImage({ bytes: pngFixture(), path: 'release.png', extension: '.png' }, { recognizeImpl: recognizeFixture, languages: 'eng' });
  assert.equal(parsed.contentType, 'image');
  assert.equal(parsed.metadata.width, 200); assert.equal(parsed.metadata.height, 100);
  assert.equal(parsed.metadata.ocrRegions[0].anchor, 'page:1:region:1');
  assert.deepEqual(parsed.metadata.ocrRegions[0].region, { x: 0.1, y: 0.1, width: 0.8, height: 0.25 });
  assert.match(parsed.content, /ORBIT IMAGE/);
});

test('image upload persists original, indexes region-aware chunks and returns region citation', async () => {
  const h = await harness();
  try {
    const bytes = pngFixture(); const uploaded = await upload(h.base, 'release.png', bytes);
    assert.equal(uploaded.status, 201); const itemId = uploaded.body.items[0].item.id;
    const detail = await (await fetch(h.base + '/api/content/items/' + itemId)).json();
    assert.equal(detail.item.contentType, 'image'); assert.equal(detail.attachments.length, 1);
    assert.equal(detail.chunks[0].metadata.pageAnchor, 'page:1:region:1'); assert.deepEqual(detail.chunks[0].metadata.region, { x: 0.1, y: 0.1, width: 0.8, height: 0.25 });
    const original = await fetch(h.base + '/api/content/items/' + itemId + '/original'); assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
    const chat = await fetch(h.base + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'ORBIT IMAGE', documentIds: [itemId] }) });
    const done = ndjson(await chat.text()).find((event) => event.type === 'done');
    assert.equal(done.citations[0].anchor, 'page:1:region:1'); assert.equal(done.citations[0].pageNumber, 1);
    assert.deepEqual(done.citations[0].region, { x: 0.1, y: 0.1, width: 0.8, height: 0.25 });
  } finally { await h.close(); }
});

test('empty OCR is isolated as IMAGE_TEXT_EMPTY without creating content', async () => {
  const h = await harness(async () => ({ data: { text: '', regions: [] } }));
  try { const uploaded = await upload(h.base, 'empty.png', pngFixture()); assert.equal(uploaded.body.stats.failed, 1); assert.equal(uploaded.body.warnings[0].code, 'IMAGE_TEXT_EMPTY'); const status = await (await fetch(h.base + '/api/content/status')).json(); assert.equal(status.counts.content_items, 0); }
  finally { await h.close(); }
});
