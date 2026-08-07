import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';
import { parsePdf } from '../server/content/pdf-parser.mjs';

function escapePdfText(value) { return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function createPdf(pages) {
  const objects = new Map();
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((text, index) => {
    const pageId = pageIds[index], streamId = pageId + 1;
    const lines = String(text).split('\n');
    const commands = lines.map((line, lineIndex) => `${lineIndex ? 'T*\n' : ''}(${escapePdfText(line)}) Tj`).join('\n');
    const stream = `BT\n/F1 14 Tf\n16 TL\n72 720 Td\n${commands}\nET`;
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    objects.set(streamId, `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });
  const maxId = Math.max(...objects.keys());
  let output = '%PDF-1.4\n'; const offsets = [0];
  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = Buffer.byteLength(output, 'latin1');
    output += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-pdf-api-'));
  const app = await createInitializedApp({ stateFile: join(root, 'state.json'), env: {}, modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') }, feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') } });
  const server = await new Promise((resolve) => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  return { base: `http://127.0.0.1:${server.address().port}`, async close() { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); } };
}
async function upload(base, name, bytes) {
  const response = await fetch(`${base}/api/content/import/file`, { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent(name) }, body: bytes });
  return { status: response.status, body: await response.json() };
}
function ndjson(text) { return text.trim().split('\n').filter(Boolean).map(JSON.parse); }

test('PDF parser extracts pages and page metadata while password callbacks become actionable errors', async () => {
  const parsed = await parsePdf({ bytes: createPdf(['PAGE ONE overview', 'PAGE TWO ORBIT-DELTA launch risk']), path: 'release.pdf' });
  assert.equal(parsed.contentType, 'pdf');
  assert.equal(parsed.metadata.pageCount, 2);
  assert.match(parsed.pageSegments[0].text, /PAGE ONE/);
  assert.match(parsed.pageSegments[1].text, /ORBIT-DELTA/);
  assert.ok(parsed.pageSegments[1].startChar > parsed.pageSegments[0].endChar);

  const loadingTask = { promise: new Promise(() => {}), onPassword: null, async destroy() {} };
  const getDocumentImpl = () => { queueMicrotask(() => loadingTask.onPassword?.(() => {}, 1)); return loadingTask; };
  await assert.rejects(() => parsePdf({ bytes: Buffer.from('fixture'), path: 'locked.pdf' }, { getDocumentImpl }), (error) => error.code === 'PDF_PASSWORD_REQUIRED');
});

test('PDF upload creates page-aware chunks and document-scoped citations point to the matching page', async () => {
  const h = await harness();
  try {
    const uploaded = await upload(h.base, 'release-check.pdf', createPdf(['PAGE ONE architecture baseline', 'PAGE TWO ORBIT-DELTA launch risk and rollback']));
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.stats.created, 1);
    const itemId = uploaded.body.items[0].item.id;
    const detail = await (await fetch(`${h.base}/api/content/items/${itemId}`)).json();
    assert.equal(detail.item.contentType, 'pdf');
    assert.equal(detail.item.metadata.pageCount, 2);
    assert.deepEqual([...new Set(detail.chunks.map((chunk) => chunk.metadata.pageNumber))], [1, 2]);
    assert.ok(detail.chunks.every((chunk) => /^page:\d+:chars:/.test(chunk.metadata.anchor)));

    const chat = await fetch(`${h.base}/api/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'ORBIT-DELTA risk', documentIds: [itemId] }) });
    const done = ndjson(await chat.text()).find((event) => event.type === 'done');
    assert.equal(done.citations[0].documentId, itemId);
    assert.equal(done.citations[0].pageNumber, 2);
    assert.equal(done.citations[0].anchor, 'page:2');
  } finally { await h.close(); }
});

test('image-only and corrupted PDFs fail per item without polluting imported content', async () => {
  const h = await harness();
  try {
    const good = await upload(h.base, 'good.pdf', createPdf(['Searchable PDF baseline']));
    const scan = await upload(h.base, 'scan.pdf', createPdf(['']));
    const broken = await upload(h.base, 'broken.pdf', Buffer.from('%PDF-1.4\nnot-a-valid-document'));
    assert.equal(good.body.stats.created, 1);
    assert.equal(scan.body.stats.failed, 1);
    assert.equal(scan.body.warnings[0].code, 'PDF_TEXT_EMPTY');
    assert.equal(broken.body.stats.failed, 1);
    assert.ok(['PDF_INVALID', 'PDF_PARSE_FAILED'].includes(broken.body.warnings[0].code));
    const status = await (await fetch(`${h.base}/api/content/status`)).json();
    assert.equal(status.counts.content_items, 1);
  } finally { await h.close(); }
});

test('PDF original bytes persist privately and annotations round-trip, locate and convert to a note', async () => {
  const h = await harness();
  try {
    const pdf = createPdf(['PAGE ONE annotated source', 'PAGE TWO action item']);
    const uploaded = await upload(h.base, 'annotated.pdf', pdf);
    const itemId = uploaded.body.items[0].item.id;
    const detail = await (await fetch(`${h.base}/api/content/items/${itemId}`)).json();
    assert.equal(detail.attachments.length, 1);
    assert.match(detail.attachments[0].externalId, /^original(?::|$)/);
    assert.equal('localPath' in detail.attachments[0], false);

    const original = await fetch(`${h.base}/api/content/items/${itemId}/original`);
    assert.equal(original.status, 200);
    assert.equal(original.headers.get('content-type'), 'application/pdf');
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), pdf);
    const download = await fetch(`${h.base}/api/content/items/${itemId}/original/download`);
    assert.match(download.headers.get('content-disposition'), /^attachment;/);

    const created = await fetch(`${h.base}/api/content/items/${itemId}/annotations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageNumber: 2, anchor: 'page:2:chars:0-28', quote: 'PAGE TWO action item', comment: '记录回滚要求', color: 'blue', selector: { rects: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.05 }] } }) });
    assert.equal(created.status, 201);
    const annotation = (await created.json()).annotation;
    assert.equal(annotation.pageNumber, 2);
    assert.equal(annotation.color, 'blue');

    const listed = await (await fetch(`${h.base}/api/content/items/${itemId}/annotations?pageNumber=2`)).json();
    assert.equal(listed.total, 1);
    assert.equal(listed.annotations[0].quote, 'PAGE TWO action item');
    const patched = await fetch(`${h.base}/api/content/items/${itemId}/annotations/${annotation.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comment: '记录回滚要求', color: 'green' }) });
    assert.equal((await patched.json()).annotation.comment, '记录回滚要求');

    const note = await fetch(`${h.base}/api/content/items/${itemId}/annotations/${annotation.id}/to-note`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'PDF行动项' }) });
    assert.equal(note.status, 201);
    assert.equal((await note.json()).note.title, 'PDF行动项');

    const deleted = await fetch(`${h.base}/api/content/items/${itemId}/annotations/${annotation.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.equal((await (await fetch(`${h.base}/api/content/items/${itemId}/annotations`)).json()).total, 0);
  } finally { await h.close(); }
});
