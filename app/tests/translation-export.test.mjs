import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';

async function harness({ root, modelService } = {}) {
  const directory = root || await mkdtemp(join(tmpdir(), 'flowmind-translation-'));
  const app = await createInitializedApp({
    stateFile: join(directory, 'state.json'), ocrService: false, transcriptionService: false,
    ...(modelService ? { modelService } : { modelOptions: { secretFile: join(directory, 'model.enc'), masterKeyFile: join(directory, 'model.key') } }),
    feishuOptions: { secretFile: join(directory, 'feishu.enc'), masterKeyFile: join(directory, 'feishu.key') }
  });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  return { directory, base: `http://127.0.0.1:${server.address().port}`, async close({ keep = false } = {}) { await new Promise(resolve => server.close(resolve)); await app.locals.close(); if (!keep) await rm(directory, { recursive: true, force: true }); } };
}
async function json(base, path, method = 'GET', body) {
  const response = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const payload = await response.json(); return { response, payload };
}
async function seed(base) {
  const imported = await json(base, '/api/content/import', 'POST', { items: [{ fileName: 'guide.md', content: '# Release\n\nOwner is Alice.\n\nDeadline is Friday.' }] });
  return imported.payload.items[0].item.id;
}
const fixtureModel = {
  ready: Promise.resolve(), logger: null,
  async publicSettings() { return { provider: 'openai-chat', model: 'fixture', configured: true }; },
  async generate() { return { provider: 'openai-chat', model: 'fixture', text: JSON.stringify({ segments: [{ index: 0, translatedText: '发布' }, { index: 1, translatedText: '负责人是 Alice。' }, { index: 2, translatedText: '截止日期是星期五。' }] }) }; }
};

test('translation generation persists model output, glossary and stable anchors across restart', async () => {
  const first = await harness({ modelService: fixtureModel }); let documentId; let translationId;
  try {
    documentId = await seed(first.base);
    const generated = await json(first.base, '/api/translations/generate', 'POST', { documentId, sourceLanguage: 'English', targetLanguage: '简体中文', glossary: 'Owner=负责人' });
    assert.equal(generated.response.status, 201); assert.equal(generated.payload.fallbackUsed, false); translationId = generated.payload.translation.id;
    assert.equal(generated.payload.translation.provider, 'openai-chat'); assert.equal(generated.payload.translation.segments.length, 3);
    assert.match(generated.payload.translation.segments[1].translatedText, /Alice/);
    assert.ok(generated.payload.translation.segments.every(row => row.anchor));
    const patchedSegments = generated.payload.translation.segments.map((row, index) => index === 1 ? { ...row, translatedText: '负责人：Alice。' } : row);
    const patched = await json(first.base, `/api/translations/${translationId}`, 'PATCH', { glossary: 'Owner=负责人\nDeadline=截止日期', segments: patchedSegments });
    assert.equal(patched.payload.translation.segments[1].translatedText, '负责人：Alice。');
    await first.close({ keep: true });
    const second = await harness({ root: first.directory, modelService: fixtureModel });
    try { const restored = await json(second.base, `/api/translations/${translationId}`); assert.equal(restored.payload.translation.glossary.includes('Deadline'), true); assert.equal(restored.payload.translation.documentId, documentId); }
    finally { await second.close(); }
  } catch (error) { await first.close().catch(() => {}); throw error; }
});

test('local translation fallback is explicit and remains editable', async () => {
  const h = await harness();
  try { const documentId = await seed(h.base); const generated = await json(h.base, '/api/translations/generate', 'POST', { documentId, targetLanguage: '日本語' }); assert.equal(generated.response.status, 201); assert.equal(generated.payload.fallbackUsed, true); assert.equal(generated.payload.translation.fallbackUsed, true); assert.match(generated.payload.translation.segments[0].translatedText, /待模型翻译/); }
  finally { await h.close(); }
});

test('Markdown and HTML exports cover document, note, answer and translation with safe escaping', async () => {
  const h = await harness({ modelService: fixtureModel });
  try {
    const documentId = await seed(h.base);
    const note = await json(h.base, '/api/notes', 'POST', { title: 'Release note', content: '<script>alert(1)</script>', tags: ['release'], sourceRefs: [{ documentId, anchor: 'page:1' }] });
    const translation = await json(h.base, '/api/translations/generate', 'POST', { documentId, targetLanguage: '简体中文' });
    for (const request of [
      { entityType: 'document', entityId: documentId, format: 'markdown' },
      { entityType: 'note', entityId: note.payload.note.id, format: 'html' },
      { entityType: 'translation', entityId: translation.payload.translation.id, format: 'markdown' },
      { entityType: 'answer', format: 'html', title: 'Answer export', content: '<b>unsafe</b>', citations: [{ title: 'Guide', documentId, anchor: 'page:1' }] }
    ]) {
      const response = await fetch(h.base + '/api/exports/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition') || '', /attachment; filename\*=UTF-8''/);
      const body = await response.text();
      if (request.format === 'html') { assert.match(response.headers.get('content-type'), /text\/html/); assert.doesNotMatch(body, /<script>|<b>unsafe<\/b>/); assert.match(body, /&lt;(script|b)&gt;/); }
      else { assert.match(response.headers.get('content-type'), /text\/markdown/); assert.match(body, /^#/); }
    }
  } finally { await h.close(); }
});