import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';

function eventsFrom(text) { return text.trim().split('\n').filter(Boolean).map(JSON.parse); }

async function harness({ modelService, ocrService = false, chatAttachments } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-chat-attachments-'));
  const stateFile = join(root, 'state.json');
  const app = await createInitializedApp({
    stateFile, env: {}, modelService, ocrService, transcriptionService: false,
    contentOptions: { databasePath: join(root, 'content.sqlite'), chatAttachments },
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise((resolve) => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  return {
    app, stateFile, base: `http://127.0.0.1:${server.address().port}`,
    async close() { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
  };
}

async function uploadContent(h, fileName, text, mimeType = 'text/plain') {
  const response = await fetch(`${h.base}/api/content/import/file`, { method: 'POST', headers: { 'content-type': mimeType, 'x-file-name': encodeURIComponent(fileName) }, body: Buffer.from(text) });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.items[0].item;
}

async function chat(h, body) {
  const response = await fetch(`${h.base}/api/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await response.text();
  return { response, text, events: response.headers.get('content-type')?.includes('ndjson') ? eventsFrom(text) : [] };
}

test('chat accepts imported contentItemId/documentId and forces generic attachment questions into citations', async () => {
  const h = await harness();
  try {
    const item = await uploadContent(h, 'launch-plan.md', '# Launch plan\n\nOwner: Mira. Deadline: Friday. Publish the release checklist.');
    const byContentItem = await chat(h, { question: '请总结我添加的附件', attachments: [{ contentItemId: item.id }] });
    assert.equal(byContentItem.response.status, 200);
    const start = byContentItem.events.find((event) => event.type === 'start');
    const done = byContentItem.events.find((event) => event.type === 'done');
    assert.equal(start.attachmentCount, 1);
    assert.equal(start.attachments[0].source, 'content-item');
    assert.equal(start.attachments[0].contentItemId, item.id);
    assert.ok(done.citations.some((citation) => citation.documentId === item.id));
    assert.equal(done.attachments[0].searchable, true);

    const byDocument = await chat(h, { question: '请解读这个文档', documentIds: [item.id] });
    assert.equal(byDocument.response.status, 200);
    assert.ok(byDocument.events.find((event) => event.type === 'done').citations.some((citation) => citation.documentId === item.id));
  } finally { await h.close(); }
});

test('inline data-url/base64 files reuse unified parsing and enter model context without persisting payloads', async () => {
  const seen = [];
  const modelService = {
    ready: Promise.resolve(),
    async publicSettings() { return { provider: 'test-provider', model: 'attachment-model', fallbackToLocal: false }; },
    async *answer(options) { seen.push(options); yield 'Model saw the attachment [1]'; }
  };
  const h = await harness({ modelService });
  try {
    const sourceText = 'Quarterly brief: revenue grew 23 percent and the owner is Lin.';
    const encoded = Buffer.from(sourceText).toString('base64');
    const result = await chat(h, { question: '分析这个文件', attachments: [{ fileName: 'quarterly.txt', mimeType: 'text/plain', dataUrl: `data:text/plain;base64,${encoded}` }] });
    assert.equal(result.response.status, 200);
    assert.equal(seen.length, 1);
    assert.match(seen[0].matches[0].excerpt, /revenue grew 23 percent/);
    const done = result.events.find((event) => event.type === 'done');
    assert.equal(done.answer, 'Model saw the attachment [1]');
    assert.equal(done.attachments[0].source, 'inline');
    assert.ok(done.citations.some((citation) => citation.documentId === done.attachments[0].citationDocumentId));
    assert.equal(result.text.includes(encoded), false);

    const stateText = await readFile(h.stateFile, 'utf8');
    assert.equal(stateText.includes(encoded), false);
    const stored = JSON.parse(stateText);
    const lastConversation = stored.conversations.at(-1);
    assert.equal(lastConversation.messages[0].attachments[0].source, 'inline');
    assert.equal('dataUrl' in lastConversation.messages[0].attachments[0], false);
    assert.equal('base64' in lastConversation.messages[0].attachments[0], false);
  } finally { await h.close(); }
});

test('temporary screenshot upload runs OCR once, is reusable by id, and preserves region citations', async () => {
  let ocrCalls = 0;
  const ocrService = {
    languages: ['eng', 'chi_sim'],
    async recognize() {
      ocrCalls += 1;
      return { text: 'Screenshot says approval code ALPHA-42', width: 800, height: 600, confidence: 96, engine: 'test-ocr', languages: ['eng'], regions: [{ text: 'Screenshot says approval code ALPHA-42', confidence: 96, region: { x: 0.1, y: 0.2, width: 0.7, height: 0.1 } }] };
    },
    async close() {}
  };
  const h = await harness({ ocrService });
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const uploadedResponse = await fetch(`${h.base}/api/chat/attachments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName: 'screenshot.png', mimeType: 'image/png', base64: png.toString('base64') }) });
    const uploaded = await uploadedResponse.json();
    assert.equal(uploadedResponse.status, 201, JSON.stringify(uploaded));
    assert.match(uploaded.temporaryId, /^tmp_/);
    assert.equal(uploaded.attachment.contentType, 'image');
    assert.equal(ocrCalls, 1);

    const first = await chat(h, { question: '截图里写了什么？', attachments: [{ temporaryId: uploaded.temporaryId }] });
    const firstDone = first.events.find((event) => event.type === 'done');
    assert.equal(first.response.status, 200);
    assert.equal(firstDone.attachments[0].source, 'temporary');
    const citation = firstDone.citations.find((entry) => entry.documentId === uploaded.attachment.citationDocumentId);
    assert.equal(citation.anchor, 'page:1:region:1');
    assert.deepEqual(citation.region, { x: 0.1, y: 0.2, width: 0.7, height: 0.1 });

    const second = await chat(h, { question: '再确认一次截图内容', temporaryAttachmentIds: [uploaded.temporaryId] });
    assert.equal(second.response.status, 200);
    assert.equal(ocrCalls, 1);
    const removed = await fetch(`${h.base}/api/chat/attachments/${uploaded.temporaryId}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    const missing = await chat(h, { question: '还能读取吗', attachments: [{ temporaryId: uploaded.temporaryId }] });
    assert.equal(missing.response.status, 404);
    assert.equal(JSON.parse(missing.text).error.code, 'ATTACHMENT_NOT_FOUND');
  } finally { await h.close(); }
});

test('raw temporary uploads and capabilities expose a frontend-ready contract', async () => {
  const h = await harness();
  try {
    const capabilitiesResponse = await fetch(`${h.base}/api/chat/attachments/capabilities`);
    const capabilities = await capabilitiesResponse.json();
    assert.equal(capabilitiesResponse.status, 200);
    assert.deepEqual(capabilities.inputs, ['contentItemId', 'documentId', 'temporaryId', 'dataUrl', 'base64']);
    assert.ok(capabilities.acceptedExtensions.includes('.pdf'));
    assert.ok(capabilities.acceptedExtensions.includes('.docx'));
    assert.ok(capabilities.acceptedExtensions.includes('.png'));

    const rawResponse = await fetch(`${h.base}/api/chat/attachments`, { method: 'POST', headers: { 'content-type': 'text/markdown', 'x-file-name': encodeURIComponent('raw-note.md') }, body: Buffer.from('# Raw note\n\nThis came from a binary upload.') });
    const raw = await rawResponse.json();
    assert.equal(rawResponse.status, 201, JSON.stringify(raw));
    const result = await chat(h, { question: '总结刚上传的内容', attachments: [raw.temporaryId] });
    assert.equal(result.response.status, 200);
    assert.match(result.events.find((event) => event.type === 'done').citations[0].excerpt, /binary upload/);
  } finally { await h.close(); }
});

test('attachment-only scope excludes unrelated knowledge-base documents', async () => {
  const h = await harness();
  try {
    const libraryItem = await uploadContent(h, 'library-project.md', '# Project library\n\nProject library background should only appear when whole-library search is enabled.');
    const rawResponse = await fetch(`${h.base}/api/chat/attachments`, { method: 'POST', headers: { 'content-type': 'text/markdown', 'x-file-name': 'attached-project.md' }, body: Buffer.from('# Project attachment\n\nProject owner is Aurora and priority is high.') });
    const uploaded = await rawResponse.json();
    assert.equal(rawResponse.status, 201, JSON.stringify(uploaded));

    const attachmentOnly = await chat(h, { question: 'project owner and priority', attachments: [uploaded.temporaryId], includeKnowledgeBase: false });
    assert.equal(attachmentOnly.response.status, 200);
    const done = attachmentOnly.events.find((event) => event.type === 'done');
    assert.ok(done.citations.length >= 1);
    assert.ok(done.citations.every((citation) => citation.documentId === uploaded.attachment.citationDocumentId));
    assert.ok(!done.citations.some((citation) => citation.documentId === libraryItem.id));
  } finally { await h.close(); }
});

test('validation returns explicit 400/413/415 errors before NDJSON streaming', async () => {
  const h = await harness({ chatAttachments: { maxFileBytes: 64, maxTotalBytes: 80, maxCount: 2 } });
  try {
    const invalidDataUrl = await chat(h, { question: '读取', attachments: [{ fileName: 'bad.txt', dataUrl: 'data:text/plain,not-base64' }] });
    assert.equal(invalidDataUrl.response.status, 400);
    assert.equal(JSON.parse(invalidDataUrl.text).error.code, 'ATTACHMENT_DATA_URL_INVALID');

    const mismatch = await chat(h, { question: '读取', attachments: [{ fileName: 'image.png', mimeType: 'text/plain', base64: Buffer.from('x').toString('base64') }] });
    assert.equal(mismatch.response.status, 415);
    assert.equal(JSON.parse(mismatch.text).error.code, 'ATTACHMENT_TYPE_MISMATCH');

    const unsupported = await chat(h, { question: '读取', attachments: [{ fileName: 'payload.exe', mimeType: 'application/octet-stream', base64: Buffer.from('MZ').toString('base64') }] });
    assert.equal(unsupported.response.status, 415);
    assert.equal(JSON.parse(unsupported.text).error.code, 'ATTACHMENT_TYPE_UNSUPPORTED');

    const oversized = await chat(h, { question: '读取', attachments: [{ fileName: 'large.txt', mimeType: 'text/plain', base64: Buffer.alloc(65, 65).toString('base64') }] });
    assert.equal(oversized.response.status, 413);
    assert.equal(JSON.parse(oversized.text).error.code, 'ATTACHMENT_TOO_LARGE');

    const totalTooLarge = await chat(h, { question: 'read', attachments: [
      { fileName: 'one.txt', mimeType: 'text/plain', base64: Buffer.alloc(50, 65).toString('base64') },
      { fileName: 'two.txt', mimeType: 'text/plain', base64: Buffer.alloc(50, 66).toString('base64') }
    ] });
    assert.equal(totalTooLarge.response.status, 413);
    assert.equal(JSON.parse(totalTooLarge.text).error.code, 'ATTACHMENT_TOTAL_TOO_LARGE');

    const rawTooLargeResponse = await fetch(`${h.base}/api/chat/attachments`, {
      method: 'POST', headers: { 'content-type': 'text/plain', 'x-file-name': 'raw.txt' }, body: Buffer.alloc(65, 67)
    });
    assert.equal(rawTooLargeResponse.status, 413);
    assert.equal((await rawTooLargeResponse.json()).error.code, 'ATTACHMENT_TOO_LARGE');

    const tooMany = await chat(h, { question: '读取', attachments: [{ temporaryId: 'a' }, { temporaryId: 'b' }, { temporaryId: 'c' }] });
    assert.equal(tooMany.response.status, 400);
    assert.equal(JSON.parse(tooMany.text).error.code, 'ATTACHMENT_COUNT_EXCEEDED');
    assert.doesNotMatch(tooMany.response.headers.get('content-type') || '', /ndjson/);
  } finally { await h.close(); }
});
