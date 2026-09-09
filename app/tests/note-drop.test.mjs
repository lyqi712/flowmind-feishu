import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectNoteDropPayload,
  collectNotePastePayload,
  dropLooksLikeFiles,
  isHttpUrl,
  isImageFile,
  noteAttachmentKind,
  summarizeNoteIngest
} from '../src/workspace/note-drop.js';

function fakeFile(name, type, size = 12) {
  return { name, type, size };
}

test('drop and paste collect files and public URLs without a new page or prompt', () => {
  assert.equal(isHttpUrl('https://example.com/a'), true);
  assert.equal(isHttpUrl('not a url'), false);
  assert.equal(isImageFile(fakeFile('shot.png', '')), true);
  assert.equal(isImageFile(fakeFile('notes.pdf', 'application/pdf')), false);
  assert.equal(noteAttachmentKind(fakeFile('shot.webp', 'image/webp')), 'image');
  assert.equal(noteAttachmentKind(fakeFile('deck.pdf', 'application/pdf')), 'file');

  const drop = collectNoteDropPayload({
    files: [fakeFile('shot.png', 'image/png'), fakeFile('spec.pdf', 'application/pdf')],
    getData: type => type === 'text/uri-list' ? 'https://example.com/doc' : ''
  });
  assert.equal(drop.files.length, 2);
  assert.deepEqual(drop.urls, ['https://example.com/doc']);
  assert.equal(drop.hasPayload, true);
  assert.equal(dropLooksLikeFiles({ types: ['Files'] }), true);
  assert.equal(dropLooksLikeFiles({ types: ['text/plain'] }), false);

  const pasteImage = collectNotePastePayload({
    files: [fakeFile('clipboard.png', 'image/png')],
    items: [],
    getData: () => ''
  });
  assert.equal(pasteImage.intercept, true);
  assert.equal(pasteImage.files.length, 1);

  const pasteUrl = collectNotePastePayload({
    files: [],
    items: [],
    getData: () => 'https://example.com/clip'
  });
  assert.equal(pasteUrl.intercept, true);
  assert.deepEqual(pasteUrl.urls, ['https://example.com/clip']);

  const pasteSentence = collectNotePastePayload({
    files: [],
    items: [],
    getData: () => '看这个 https://example.com/clip 再写'
  });
  assert.equal(pasteSentence.intercept, false);

  assert.equal(summarizeNoteIngest({ files: [fakeFile('a.png', 'image/png')] }), '图片已放入这篇笔记');
  assert.equal(summarizeNoteIngest({ files: [fakeFile('a.pdf', 'application/pdf'), fakeFile('b.txt', 'text/plain')] }), '已放入 2 个文件');
});
