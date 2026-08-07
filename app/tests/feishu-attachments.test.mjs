import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';
import { FeishuConnector, FeishuConnectorError } from '../server/feishu.mjs';

const attachmentBytes = Buffer.from('FLOWMIND-FEISHU-ATTACHMENT-BLOB-ONLY', 'utf8');

function textRun(content) {
  return { text_run: { content, text_element_style: {} } };
}

function richDocumentBlocks() {
  return [
    { block_id: 'page', block_type: 1, children: ['heading', 'body', 'image', 'file'] },
    { block_id: 'heading', parent_id: 'page', block_type: 3, heading1: { elements: [textRun('块级标题')] } },
    { block_id: 'body', parent_id: 'page', block_type: 2, text: { elements: [textRun('块级正文必须保留')] } },
    { block_id: 'image', parent_id: 'page', block_type: 27, image: { token: 'image-ok', name: 'diagram.png', mime_type: 'image/png' } },
    { block_id: 'file', parent_id: 'page', block_type: 23, file: { token: 'file-fails', name: 'appendix.pdf', mime_type: 'application/pdf' } }
  ];
}

class ImportFixtureConnector extends FeishuConnector {
  constructor() {
    super({ env: {}, fetchImpl: async () => { throw new Error('fixture fetch should not be called'); }, minDocRequestIntervalMs: 0 });
  }

  async getRawContent() { return 'RAW_CONTENT_MUST_NOT_WIN'; }
  async getDocxMeta() { return { title: '块级文档', revision_id: 7 }; }
  async listDocxBlocks() { return richDocumentBlocks(); }
  async downloadDocAsset(asset) {
    if (asset.token === 'file-fails') {
      throw new FeishuConnectorError('fixture resource download failed', {
        code: 'FEISHU_MEDIA_DOWNLOAD_FAILED', stage: 'docx-file-download', status: 502, retriable: true
      });
    }
    return {
      externalId: `feishu:${asset.kind}:${asset.token}`,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      byteSize: attachmentBytes.length,
      contentHash: 'fixture-content-hash',
      data: attachmentBytes,
      metadata: { kind: asset.kind, feishuToken: asset.token, blockId: asset.blockId, anchor: asset.anchor }
    };
  }
}

async function appHarness(syncResult) {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-feishu-attachments-'));
  const stateFile = join(root, 'state.json');
  const databasePath = join(root, 'content.sqlite');
  const connector = {
    ready: Promise.resolve(),
    isConfigured: () => true,
    sync: async () => structuredClone(syncResult)
  };
  const app = await createInitializedApp({
    stateFile,
    connector,
    ocrService: false,
    transcriptionService: false,
    contentOptions: { databasePath },
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') }
  });
  const server = await new Promise(resolve => {
    const current = app.listen(0, '127.0.0.1', () => resolve(current));
  });
  return {
    app,
    stateFile,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise(resolve => server.close(resolve));
      await app.locals.close();
      await rm(root, { recursive: true, force: true });
    }
  };
}

test('连接器优先采用 Blocks，单个资源下载失败仍保留正文和资源引用', async () => {
  const connector = new ImportFixtureConnector();
  const result = await connector.importDocx(
    { type: 'docx', token: 'doc-rich', url: 'https://tenant.example/docx/doc-rich' },
    'fixture-tenant-token'
  );

  assert.doesNotMatch(result.document.content, /RAW_CONTENT_MUST_NOT_WIN/);
  assert.match(result.document.content, /^# 块级标题$/m);
  assert.match(result.document.content, /块级正文必须保留/);
  assert.match(result.document.content, /feishu-asset:\/\/image-ok/);
  assert.match(result.document.content, /feishu-asset:\/\/file-fails/);
  assert.equal(result.document.metadata.documentFormat, 'feishu-docx-blocks-v1');
  assert.equal(result.document.metadata.assetCount, 2);
  assert.equal(result.document.metadata.importedAssetCount, 1);
  assert.equal(result.document.attachments.length, 1);
  assert.deepEqual(result.document.attachments[0].data, attachmentBytes);
  assert.equal(result.document.metadata.assetWarnings.length, 1);
  assert.equal(result.document.metadata.assetWarnings[0].kind, 'file');
  assert.equal(result.document.metadata.assetWarnings[0].code, 'FEISHU_MEDIA_DOWNLOAD_FAILED');
});

test('同步 API/State 不暴露 Buffer，附件二进制写入 SQLite 并可经 API 读取', async () => {
  const syncResult = {
    source: 'feishu',
    space: { id: 'space-fixture', name: '附件测试空间' },
    documents: [{
      id: 'docx:doc-attachment',
      externalId: 'doc-attachment',
      title: '附件持久化文档',
      content: '# 正文\n\n![diagram](feishu-asset://image-ok)',
      source: 'feishu',
      sourceType: 'docx',
      mimeType: 'text/markdown',
      url: 'https://tenant.example/docx/doc-attachment',
      updatedAt: '2026-08-04T00:00:00.000Z',
      metadata: { documentFormat: 'feishu-docx-blocks-v1', richText: true },
      attachments: [{
        externalId: 'feishu:image:image-ok',
        fileName: 'diagram.png',
        mimeType: 'image/png',
        byteSize: attachmentBytes.length,
        contentHash: 'fixture-content-hash',
        data: attachmentBytes,
        metadata: { kind: 'image', feishuToken: 'image-ok', blockId: 'image', anchor: 'block:image' }
      }]
    }],
    warnings: [],
    stats: { documents: 1, byType: { docx: 1 }, skipped: 0 },
    cursor: null
  };
  const h = await appHarness(syncResult);

  try {
    const response = await fetch(`${h.base}/api/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'feishu' })
    });
    const rawResponse = await response.text();
    const body = JSON.parse(rawResponse);

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.attachmentImport.imported, 1);
    assert.deepEqual(body.attachmentImport.warnings, []);
    assert.equal(body.documents[0].attachments, undefined);
    assert.equal(body.state.documents[0].attachments, undefined);
    assert.equal(body.documents[0].metadata.attachmentManifest.length, 1);
    assert.equal(body.documents[0].metadata.attachmentManifest[0].data, undefined);
    assert.doesNotMatch(rawResponse, /"type"\s*:\s*"Buffer"/);
    assert.doesNotMatch(rawResponse, /FLOWMIND-FEISHU-ATTACHMENT-BLOB-ONLY/);

    const stateText = await readFile(h.stateFile, 'utf8');
    const state = JSON.parse(stateText);
    assert.equal(state.documents[0].attachments, undefined);
    assert.equal(state.documents[0].metadata.attachmentManifest[0].data, undefined);
    assert.doesNotMatch(stateText, /"type"\s*:\s*"Buffer"/);
    assert.doesNotMatch(stateText, /FLOWMIND-FEISHU-ATTACHMENT-BLOB-ONLY/);

    const item = h.app.locals.contentRepository.listContentItems({ limit: 50 })
      .find(candidate => candidate.externalId === 'doc-attachment');
    assert.ok(item, '同步文档应迁移到 SQLite 内容库');
    const attachments = h.app.locals.contentRepository.listAttachments(item.id);
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0].externalId, 'feishu:image:image-ok');
    assert.deepEqual(h.app.locals.contentRepository.getAttachmentData(attachments[0].id), attachmentBytes);

    const detailResponse = await fetch(`${h.base}/api/content/items/${item.id}`);
    const detail = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detail.attachments.length, 1);
    assert.equal(detail.attachments[0].data, undefined);

    const assetResponse = await fetch(`${h.base}/api/content/attachments/${attachments[0].id}`);
    assert.equal(assetResponse.status, 200);
    assert.equal(assetResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await assetResponse.arrayBuffer()), attachmentBytes);
  } finally {
    await h.close();
  }
});
