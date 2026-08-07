import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';

async function startApp(root) {
  const stateFile = join(root, 'state.json');
  const app = await createInitializedApp({
    stateFile,
    env: {},
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise((resolve, reject) => {
    const current = app.listen(0, '127.0.0.1', () => resolve(current));
    current.once('error', reject);
  });
  return {
    app,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

async function json(base, path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, body: await response.json() };
}

const tinyPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082', 'hex');

test('笔记图片与文件使用真实 blob 持久化，光标 Markdown、来源和重开状态保持完整', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-note-attachments-'));
  let first;
  let second;
  try {
    first = await startApp(root);
    const sourceRefs = [{ documentId: 'doc-source-1', title: '飞书来源', quote: '关键引用', anchor: 'paragraph:3', startOffset: 14, endOffset: 22 }];
    const created = await json(first.base, '/api/notes', 'POST', { title: '带附件笔记', content: '正文第一段', tags: ['资料'], sourceRefs });
    assert.equal(created.response.status, 201);
    const note = created.body.note;
    assert.deepEqual(note.attachments, []);
    assert.equal(first.app.locals.contentRepository.getContentItem(note.id).contentType, 'note');
    const publicContent = await json(first.base, '/api/content/items');
    assert.equal(publicContent.body.total, publicContent.body.items.length);
    assert.equal(publicContent.body.items.some(item => item.id === note.id), false);

    const imageResponse = await fetch(`${first.base}/api/notes/${note.id}/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'x-file-name': encodeURIComponent('产品截图.png'), 'x-file-last-modified': '1785920000000' },
      body: tinyPng
    });
    const image = await imageResponse.json();
    assert.equal(imageResponse.status, 201);
    assert.equal(image.attachment.fileName, '产品截图.png');
    assert.equal(image.attachment.isImage, true);
    assert.equal(image.attachment.byteSize, tinyPng.length);
    assert.equal(image.markdown, `![产品截图.png](${image.attachment.url})`);

    const fileBytes = Buffer.from('FlowMind note attachment\n', 'utf8');
    const fileResponse = await fetch(`${first.base}/api/notes/${note.id}/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-file-name': encodeURIComponent('会议资料.txt') },
      body: fileBytes
    });
    const file = await fileResponse.json();
    assert.equal(fileResponse.status, 201);
    assert.equal(file.attachment.isImage, false);
    assert.equal(file.markdown, `[📎 会议资料.txt](${file.attachment.downloadUrl})`);

    const savedContent = `正文第一段\n\n${image.markdown}\n\n${file.markdown}`;
    const patched = await json(first.base, `/api/notes/${note.id}`, 'PATCH', { content: savedContent, sourceRefs });
    assert.equal(patched.response.status, 200);
    assert.equal(patched.body.note.attachments.length, 2);
    assert.deepEqual(patched.body.note.sourceRefs, sourceRefs);

    const inline = await fetch(first.base + image.attachment.url);
    assert.equal(inline.status, 200);
    assert.equal(inline.headers.get('content-type'), 'image/png');
    assert.match(inline.headers.get('content-disposition'), /^inline;/);
    assert.deepEqual(Buffer.from(await inline.arrayBuffer()), tinyPng);

    const download = await fetch(first.base + file.attachment.downloadUrl);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'text/plain');
    assert.match(download.headers.get('content-disposition'), /^attachment;/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), fileBytes);

    await first.close();
    first = null;
    second = await startApp(root);
    const reopened = await json(second.base, '/api/notes?archived=true');
    const restored = reopened.body.notes.find(item => item.id === note.id);
    assert.ok(restored);
    assert.equal(restored.content, savedContent);
    assert.deepEqual(restored.sourceRefs, sourceRefs);
    assert.equal(restored.attachments.length, 2);
    assert.equal(restored.attachments.find(item => item.id === image.attachment.id).fileName, '产品截图.png');
    assert.equal(restored.attachments.find(item => item.id === file.attachment.id).downloadUrl, file.attachment.downloadUrl);
    const reopenedImage = await fetch(second.base + image.attachment.url);
    assert.equal(reopenedImage.status, 200);
    assert.deepEqual(Buffer.from(await reopenedImage.arrayBuffer()), tinyPng);
  } finally {
    if (first) await first.close();
    if (second) await second.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('笔记附件接口拒绝空文件、跨笔记读取和已删除笔记读取', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-note-attachment-guards-'));
  let harness;
  try {
    harness = await startApp(root);
    const first = (await json(harness.base, '/api/notes', 'POST', { title: '第一篇' })).body.note;
    const second = (await json(harness.base, '/api/notes', 'POST', { title: '第二篇' })).body.note;
    const empty = await fetch(`${harness.base}/api/notes/${first.id}/attachments`, { method: 'POST', headers: { 'content-type': 'image/png', 'x-file-name': 'empty.png' }, body: Buffer.alloc(0) });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error.code, 'ATTACHMENT_EMPTY');

    const uploadedResponse = await fetch(`${harness.base}/api/notes/${first.id}/attachments`, { method: 'POST', headers: { 'content-type': 'image/png', 'x-file-name': 'pixel.png' }, body: tinyPng });
    const uploaded = await uploadedResponse.json();
    const crossNote = await fetch(`${harness.base}/api/notes/${second.id}/attachments/${uploaded.attachment.id}`);
    assert.equal(crossNote.status, 404);

    const removed = await json(harness.base, `/api/notes/${first.id}`, 'DELETE');
    assert.equal(removed.response.status, 200);
    const deletedRead = await fetch(harness.base + uploaded.attachment.url);
    assert.equal(deletedRead.status, 404);
  } finally {
    if (harness) await harness.close();
    await rm(root, { recursive: true, force: true });
  }
});