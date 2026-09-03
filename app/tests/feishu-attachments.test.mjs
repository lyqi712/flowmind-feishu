import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';
import { FeishuConnector, FeishuConnectorError, mediaDownloadPath } from '../server/feishu.mjs';
import { selectAssetsForResync } from '../server/feishu-media.mjs';

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

test('素材下载路径带上 drive_route_token extra，避免飞书 403', async () => {
  const path = mediaDownloadPath({ token: 'img-1' }, { documentToken: 'docx-token' });
  assert.match(path, /\/drive\/v1\/medias\/img-1\/download\?extra=/);
  assert.match(decodeURIComponent(path), /drive_route_token":"docx-token/);
  const calls = [];
  const connector = new FeishuConnector({
    env: {},
    fetchImpl: async (url) => {
      calls.push(String(url));
      return { ok: true, headers: { get: (name) => name === 'content-type' ? 'image/png' : '' }, arrayBuffer: async () => Buffer.from('PNG') };
    }
  });
  const attachment = await connector.downloadDocAsset({ kind: 'image', token: 'img-1', fileName: 'a.png', mimeType: 'image/png' }, 'tenant-token', { documentToken: 'docx-token' });
  assert.match(calls[0], /extra=/);
  assert.equal(attachment.metadata.feishuToken, 'img-1');
  assert.match(attachment.metadata.extra, /docx-token/);
});

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

test('重新拉取附件只补缺失素材并写回 SQLite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-feishu-resync-'));
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    connector: {
      ready: Promise.resolve(),
      isConfigured: () => true,
      sync: async () => ({ source: 'feishu', space: { id: 'space-resync', name: '补拉空间' }, documents: [], warnings: [], stats: { documents: 0, byType: {}, skipped: 0 }, cursor: null }),
      async resyncAssets({ assets }) {
        return {
          imported: assets.map(asset => ({
            externalId: `feishu:${asset.kind}:${asset.token}`,
            fileName: asset.fileName,
            mimeType: asset.mimeType || 'application/octet-stream',
            byteSize: attachmentBytes.length,
            contentHash: `resync-${asset.token}`,
            data: attachmentBytes,
            metadata: { kind: asset.kind, feishuToken: asset.token }
          })),
          warnings: []
        };
      }
    },
    ocrService: false,
    transcriptionService: false,
    contentOptions: { databasePath: join(root, 'content.sqlite') },
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') }
  });
  const server = await new Promise(resolve => {
    const current = app.listen(0, '127.0.0.1', () => resolve(current));
  });
  try {
    const repo = app.locals.contentRepository;
    const source = repo.upsertSourceConnection({ sourceType: 'feishu', externalId: 'tenant-resync', name: '补拉租户' });
    const space = repo.upsertSpace({ sourceConnectionId: source.id, externalId: 'space-resync', name: '补拉空间' });
    const created = repo.upsertContentItem({
      sourceConnectionId: source.id,
      spaceId: space.id,
      externalId: 'doc-resync',
      contentType: 'docx',
      title: '待补拉文档',
      content: '![图](feishu-asset://missing-image)\n[📎 index.html](feishu-asset://missing-html)',
      mimeType: 'text/markdown',
      metadata: { assetCount: 2, importedAssetCount: 0 }
    });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/content/items/${created.item.id}/attachments/resync`, { method: 'POST' });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.imported, 2);
    assert.equal(body.attachments.length, 2);
    assert.equal(app.locals.contentRepository.listAttachments(created.item.id).length, 2);
    const again = await fetch(`http://127.0.0.1:${server.address().port}/api/content/items/${created.item.id}/attachments/resync`, { method: 'POST' });
    const againBody = await again.json();
    assert.equal(again.status, 200);
    assert.equal(againBody.imported, 0);
    assert.match(againBody.message || '', /没有需要补拉/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await app.locals.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('403 记为没有素材权限，超时会再试一次，临时链接可兜底', async () => {
  const forbiddenCalls = [];
  const forbidden = new FeishuConnector({
    env: {},
    fetchImpl: async (url) => {
      forbiddenCalls.push(String(url));
      if (String(url).includes('batch_get_tmp_download_url')) {
        return { ok: true, json: async () => ({ code: 0, data: { tmp_download_urls: [] } }) };
      }
      return { ok: false, status: 403, headers: { get: () => '' }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
  });
  await assert.rejects(
    () => forbidden.downloadDocAsset({ kind: 'image', token: 'img-403', fileName: 'a.png' }, 'tenant', { documentToken: 'docx-1' }),
    (error) => error.code === 'FEISHU_MEDIA_FORBIDDEN' && error.status === 403
  );
  assert.ok(forbiddenCalls.some((url) => url.includes('/download')));
  assert.ok(forbiddenCalls.some((url) => url.includes('batch_get_tmp_download_url')));

  let timeoutAttempts = 0;
  const retried = new FeishuConnector({
    env: {},
    fetchImpl: async () => {
      timeoutAttempts += 1;
      if (timeoutAttempts === 1) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
      return { ok: true, headers: { get: (name) => name === 'content-type' ? 'image/png' : '' }, arrayBuffer: async () => Buffer.from('PNG') };
    }
  });
  const recovered = await retried.downloadDocAsset({ kind: 'image', token: 'img-timeout', fileName: 'b.png' }, 'tenant', { documentToken: 'docx-1' });
  assert.equal(timeoutAttempts, 2);
  assert.equal(recovered.byteSize, 3);

  const tmp = new FeishuConnector({
    env: {},
    fetchImpl: async (url) => {
      const href = String(url);
      if (href.includes('/download')) return { ok: false, status: 403, headers: { get: () => '' }, arrayBuffer: async () => new ArrayBuffer(0) };
      if (href.includes('batch_get_tmp_download_url')) {
        return { ok: true, json: async () => ({ code: 0, data: { tmp_download_urls: [{ tmp_download_url: 'https://tmp.example/file.png' }] } }) };
      }
      if (href.includes('tmp.example')) {
        return { ok: true, headers: { get: (name) => name === 'content-type' ? 'image/png' : '' }, arrayBuffer: async () => Buffer.from('FROM-TMP') };
      }
      throw new Error(`unexpected ${href}`);
    }
  });
  const fromTmp = await tmp.downloadDocAsset({ kind: 'image', token: 'img-tmp', fileName: 'c.png' }, 'tenant', { documentToken: 'docx-1' });
  assert.equal(fromTmp.data.toString(), 'FROM-TMP');
});

test('文档 token 403 后改试 wiki node token', async () => {
  const calls = [];
  const connector = new FeishuConnector({
    env: {},
    fetchImpl: async (url) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('batch_get_tmp_download_url')) {
        return { ok: true, json: async () => ({ code: 0, data: { tmp_download_urls: [] } }) };
      }
      if (decodeURIComponent(href).includes('wiki-node')) {
        return { ok: true, headers: { get: (name) => name === 'content-type' ? 'image/png' : '' }, arrayBuffer: async () => Buffer.from('NODE') };
      }
      return { ok: false, status: 403, headers: { get: () => '' }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
  });
  const attachment = await connector.downloadDocAsset(
    { kind: 'image', token: 'img-node', fileName: 'd.png' },
    'tenant',
    { documentToken: 'docx-1', nodeToken: 'wiki-node' }
  );
  assert.equal(attachment.data.toString(), 'NODE');
  assert.ok(calls.some((url) => decodeURIComponent(url).includes('docx-1')));
  assert.ok(calls.some((url) => decodeURIComponent(url).includes('wiki-node')));
});

test('应用 403 后改用已登录用户令牌下载', async () => {
  const auths = [];
  const connector = new FeishuConnector({
    env: {},
    getUserAccessToken: async () => 'user-token',
    fetchImpl: async (url, options = {}) => {
      auths.push(options.headers?.Authorization || '');
      if (String(url).includes('batch_get_tmp_download_url')) {
        return { ok: true, json: async () => ({ code: 0, data: { tmp_download_urls: [] } }) };
      }
      if (options.headers?.Authorization === 'Bearer user-token') {
        return { ok: true, headers: { get: (name) => name === 'content-type' ? 'image/png' : '' }, arrayBuffer: async () => Buffer.from('USER') };
      }
      return { ok: false, status: 403, headers: { get: () => '' }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
  });
  const attachment = await connector.downloadDocAsset({ kind: 'image', token: 'img-user', fileName: 'e.png' }, 'tenant', { documentToken: 'docx-1' });
  assert.equal(attachment.data.toString(), 'USER');
  assert.ok(auths.includes('Bearer tenant'));
  assert.ok(auths.includes('Bearer user-token'));
});

test('有附件行但没有 blob 时仍会补拉', async () => {
  const refs = selectAssetsForResync({
    content: '![图](feishu-asset://missing-blob)\n![好](feishu-asset://ready-image)',
    attachments: [
      { id: 'att-1', externalId: 'feishu:image:missing-blob', metadata: { feishuToken: 'missing-blob' } },
      { id: 'att-2', externalId: 'feishu:image:ready-image', metadata: { feishuToken: 'ready-image' } }
    ],
    hasBlob: (attachment) => attachment.id === 'att-2'
  });
  assert.deepEqual(refs.map((row) => row.token), ['missing-blob']);

  const root = await mkdtemp(join(tmpdir(), 'flowmind-feishu-resync-blob-'));
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    connector: {
      ready: Promise.resolve(),
      isConfigured: () => true,
      sync: async () => ({ source: 'feishu', space: { id: 'space-blob', name: 'blob' }, documents: [], warnings: [], stats: { documents: 0, byType: {}, skipped: 0 }, cursor: null }),
      async resyncAssets({ assets }) {
        return {
          imported: assets.map((asset) => ({
            externalId: `feishu:${asset.kind}:${asset.token}`,
            fileName: asset.fileName,
            mimeType: 'image/png',
            byteSize: attachmentBytes.length,
            contentHash: `blob-${asset.token}`,
            data: attachmentBytes,
            metadata: { kind: asset.kind, feishuToken: asset.token }
          })),
          warnings: []
        };
      }
    },
    ocrService: false,
    transcriptionService: false,
    contentOptions: { databasePath: join(root, 'content.sqlite') },
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') }
  });
  const server = await new Promise((resolve) => {
    const current = app.listen(0, '127.0.0.1', () => resolve(current));
  });
  try {
    const repo = app.locals.contentRepository;
    const source = repo.upsertSourceConnection({ sourceType: 'feishu', externalId: 'tenant-blob', name: 'blob' });
    const space = repo.upsertSpace({ sourceConnectionId: source.id, externalId: 'space-blob', name: 'blob' });
    const created = repo.upsertContentItem({
      sourceConnectionId: source.id,
      spaceId: space.id,
      externalId: 'doc-blob',
      contentType: 'docx',
      title: '空壳附件',
      content: '![图](feishu-asset://ghost-image)',
      mimeType: 'text/markdown',
      metadata: { assetCount: 1, importedAssetCount: 1, assetWarnings: [{ code: 'FEISHU_MEDIA_TIMEOUT', tokenSuffix: 'e-image' }] }
    });
    repo.upsertAttachment({
      contentItemId: created.item.id,
      externalId: 'feishu:image:ghost-image',
      fileName: 'ghost.png',
      mimeType: 'image/png',
      metadata: { kind: 'image', feishuToken: 'ghost-image' }
    });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/content/items/${created.item.id}/attachments/resync`, { method: 'POST' });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.imported, 1);
    assert.equal(body.item.metadata.assetWarnings.length, 0);
    assert.ok(repo.getAttachmentData(repo.listAttachments(created.item.id)[0].id)?.length);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
    await rm(root, { recursive: true, force: true });
  }
});
