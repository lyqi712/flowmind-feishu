import assert from 'node:assert/strict';
import path from 'node:path';
import { ContentRepository } from '../../app/server/content/repository.mjs';
import { startDesktopHost } from '../../app/desktop/runtime.mjs';

const PAGE_ONE = 'PDF HOST PAGE ONE';
const PAGE_TWO = 'PDF HOST PAGE TWO citation target';
const PDF_BYTES = Buffer.from('%PDF-1.7\n% FlowMind desktop PDF fixture\n%%EOF\n', 'latin1');

export async function createPdfSurfaceFixture(root) {
  const databasePath = path.join(root, 'content.sqlite');
  const leakedPath = path.join(root, 'private', 'original.pdf');
  const repository = new ContentRepository({ databasePath });
  try {
    const source = repository.upsertSourceConnection({
      sourceType: 'local',
      externalId: 'desktop-pdf-surface',
      name: 'Desktop PDF surface fixture'
    });
    const result = repository.upsertContentItem({
      sourceConnectionId: source.id,
      externalId: 'pdf-surface-item',
      contentType: 'pdf',
      title: 'Desktop PDF surface fixture',
      content: `${PAGE_ONE}\n\n${PAGE_TWO}`,
      mimeType: 'application/pdf',
      sourceUrl: `file://${leakedPath}`,
      metadata: {
        fileName: 'original.pdf',
        pageCount: 2,
        pages: [
          { pageNumber: 1, startChar: 0, endChar: PAGE_ONE.length, charCount: PAGE_ONE.length, anchor: 'page:1' },
          { pageNumber: 2, startChar: PAGE_ONE.length + 2, endChar: PAGE_ONE.length + 2 + PAGE_TWO.length, charCount: PAGE_TWO.length, anchor: 'page:2' }
        ]
      }
    });
    const item = result.item;
    repository.upsertAttachment({
      contentItemId: item.id,
      externalId: 'original',
      fileName: 'original.pdf',
      mimeType: 'application/pdf',
      byteSize: PDF_BYTES.length,
      sourceUrl: `file://${leakedPath}`,
      localPath: leakedPath,
      metadata: { kind: 'original' },
      data: PDF_BYTES
    });
    repository.replaceIndexChunks(item.id, [{
      text: PAGE_TWO,
      metadata: { pageNumber: 2, anchor: 'page:2:chars:0-34' }
    }]);
    const annotation = repository.upsertAnnotation({
      contentItemId: item.id,
      pageNumber: 2,
      anchor: 'page:2:chars:0-34',
      quote: PAGE_TWO,
      comment: 'desktop annotation',
      color: 'yellow'
    });
    return Object.freeze({ databasePath, itemId: item.id, annotationId: annotation.id, leakedPath, bytes: PDF_BYTES });
  } finally {
    repository.close();
  }
}

function assertNoPrivatePath(value, leakedPath) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(leakedPath), false, 'API payload leaked a private filesystem path');
  assert.equal(/"localPath"/i.test(serialized), false, 'API payload exposed localPath');
  assert.equal(/"aliasPaths"/i.test(serialized), false, 'API payload exposed aliasPaths');
}

export async function assertPdfSurface(base, fixture, fetchImpl = globalThis.fetch) {
  const detailResponse = await fetchImpl(`${base}/api/content/items/${fixture.itemId}`);
  assert.equal(detailResponse.status, 200, 'desktop host PDF detail API must be reachable');
  const detail = await detailResponse.json();
  assert.equal(detail.item.contentType, 'pdf');
  assert.equal(detail.item.metadata.pages.length, 2);
  assert.equal(detail.chunks[0].metadata.pageNumber, 2);
  assert.equal(detail.chunks[0].metadata.anchor, 'page:2:chars:0-34');
  assert.equal(detail.attachments.length, 1);
  assert.equal(detail.attachments[0].externalId, 'original');
  assert.equal(detail.attachments[0].sourceUrl, null);
  assert.equal('localPath' in detail.attachments[0], false);
  assert.equal(detail.item.sourceUrl, null);
  assert.equal('localPath' in detail.item.metadata, false);
  assertNoPrivatePath(detail, fixture.leakedPath);

  const original = await fetchImpl(`${base}/api/content/items/${fixture.itemId}/original`);
  assert.equal(original.status, 200, 'desktop host PDF original API must be reachable');
  assert.equal(original.headers.get('content-type'), 'application/pdf');
  assert.equal(original.headers.get('content-length'), String(fixture.bytes.length));
  assert.match(original.headers.get('content-disposition') || '', /^inline; filename\*=UTF-8''original\.pdf$/);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), fixture.bytes);
  assert.equal((original.headers.get('content-disposition') || '').includes(fixture.leakedPath), false);

  const download = await fetchImpl(`${base}/api/content/items/${fixture.itemId}/original/download`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition') || '', /^attachment; filename\*=UTF-8''original\.pdf$/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), fixture.bytes);

  const annotations = await fetchImpl(`${base}/api/content/items/${fixture.itemId}/annotations?pageNumber=2`);
  assert.equal(annotations.status, 200, 'desktop host annotation API must be reachable');
  const annotationPayload = await annotations.json();
  assert.equal(annotationPayload.total, 1);
  assert.equal(annotationPayload.annotations[0].id, fixture.annotationId);
  assert.equal(annotationPayload.annotations[0].pageNumber, 2);
  assert.equal(annotationPayload.annotations[0].anchor, 'page:2:chars:0-34');
  assertNoPrivatePath(annotationPayload, fixture.leakedPath);

  return { detail, annotationPayload };
}

export async function startPdfFixtureHost({ projectRoot, root, fixture }) {
  return startDesktopHost({
    appRoot: path.join(projectRoot, 'app'),
    distDir: path.join(projectRoot, 'app', 'dist'),
    stateFile: path.join(root, 'state.json'),
    port: 0,
    env: {},
    feishuOptions: { secretFile: path.join(root, 'feishu.enc'), masterKeyFile: path.join(root, 'feishu.key') },
    modelOptions: { secretFile: path.join(root, 'model.enc'), masterKeyFile: path.join(root, 'model.key') },
    contentOptions: { databasePath: fixture.databasePath }
  });
}

export function getPdfFixtureSummary(fixture) {
  return { itemId: fixture.itemId, annotationId: fixture.annotationId, bytes: fixture.bytes.length };
}
