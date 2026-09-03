import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';

function mockOcrService(text = 'SYNCED IMAGE OCR TEXT 提示词模板') {
  return {
    languages: 'eng,chi_sim',
    async recognize(bytes, { pageNumber = 1 } = {}) {
      return {
        data: {
          engine: 'mock-ocr', width: 800, height: 600, confidence: 95,
          text,
          regions: [{ text, confidence: 95, bbox: { x0: 10, y0: 20, x1: 700, y1: 80 } }]
        }
      };
    }
  };
}

function syncResultWithImageAttachment() {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 0x20, 0, 0, 2, 0x58, 8, 2, 0, 0, 0]);
  return {
    source: 'feishu',
    space: { id: 'space-ocr', name: 'OCR 测试空间' },
    documents: [{
      id: 'doc-ocr-1',
      externalId: 'docn-ocr-1',
      nodeToken: 'docn-ocr-1',
      title: '提示词模板文档（含图片）',
      content: '文档正文：企业 AI 落地需要结构化提示词模板。',
      source: 'feishu',
      url: 'https://example.feishu.cn/docx/docn-ocr-1',
      updatedAt: '2026-08-12T10:00:00.000Z',
      attachments: [{
        externalId: 'feishu:docx-image:image-token-1',
        fileName: 'prompt-template.png',
        mimeType: 'image/png',
        byteSize: png.length,
        contentHash: 'fixture-png-hash',
        data: png,
        metadata: { kind: 'docx-image', feishuToken: 'image-token-1', blockId: 'image-block-1', anchor: 'block:image-block-1' }
      }]
    }],
    stats: { discovered: 1, imported: 1, skipped: 0 },
    cursor: 'ocr:1'
  };
}

async function harness(ocrService) {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-sync-ocr-'));
  const connector = {
    ready: Promise.resolve(),
    isConfigured: () => true,
    sync: async () => syncResultWithImageAttachment()
  };
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    connector,
    ocrService,
    transcriptionService: false,
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  return {
    root,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise(resolveServer => server.close(() => resolveServer()));
      await app.locals.close?.();
      await rm(root, { recursive: true, force: true });
    }
  };
}

test('飞书同步的图片附件自动 OCR：文本并入正文、可检索且带稳定锚点', async () => {
  const h = await harness(mockOcrService());
  try {
    const response = await fetch(`${h.base}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'feishu', mode: 'feishu' }) });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ocrImport.imported, 1);
    assert.equal(body.ocrImport.processed, 1);
    assert.equal(body.ocrImport.failed, 0);

    const search = await (await fetch(`${h.base}/api/search?q=提示词模板&limit=5`)).json();
    assert.ok(search.total >= 1, 'OCR 文本必须可检索');
    const itemId = search.results[0].id;

    const detail = await (await fetch(`${h.base}/api/content/items/${itemId}`)).json();
    assert.match(detail.item.content, /SYNCED IMAGE OCR TEXT/);
    assert.match(detail.item.content, /图片 OCR 提取/);
    assert.equal(detail.item.metadata.ocrAttachments[0].fileName, 'prompt-template.png');
    const ocrChunk = detail.chunks.find(chunk => chunk.metadata?.source === 'sync-ocr');
    assert.ok(ocrChunk, 'OCR chunk 必须存在');
    assert.match(ocrChunk.metadata.anchor, /^page:1:region:1/);
    assert.match(ocrChunk.text, /SYNCED IMAGE OCR TEXT/);
    assert.ok(detail.chunks.some(chunk => /文档正文/.test(chunk.text)), '原正文 chunks 必须保留');

    // 重复同步不重复追加（按附件 externalId 去重）。
    await fetch(`${h.base}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'feishu', mode: 'feishu' }) });
    const detail2 = await (await fetch(`${h.base}/api/content/items/${itemId}`)).json();
    const ocrMarkers = detail2.item.content.split('[图片 OCR 提取').length - 1;
    assert.equal(ocrMarkers, 1, '重复同步不得重复追加 OCR 文本');
  } finally {
    await h.close();
  }
});

test('OCR 不可用时同步不受影响，附件仍正常落库', async () => {
  const h = await harness(false);
  try {
    const response = await fetch(`${h.base}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'feishu', mode: 'feishu' }) });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.ocrImport, { processed: 0, imported: 0, empty: 0, failed: 0, warnings: [] });
    assert.equal(body.attachmentImport.imported, 1);
  } finally {
    await h.close();
  }
});
