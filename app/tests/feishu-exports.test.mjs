import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExportRecord, defaultExportTitle, exportedContentPayload, exportHomeAction, rememberExport } from '../server/feishu-exports.mjs';

test('defaultExportTitle 取一级标题', () => {
  assert.equal(defaultExportTitle('# 导出验收\n\n正文'), '导出验收');
});

test('defaultExportTitle 没有标题时取首行', () => {
  assert.equal(defaultExportTitle('第一行结论\n第二行'), '第一行结论');
});

test('rememberExport 把最新记录放在前面并去重', () => {
  const first = createExportRecord({ id: 'e1', title: '旧', url: 'https://feishu.cn/docx/a', documentId: 'a' }, () => '2026-08-14T01:00:00.000Z');
  const second = createExportRecord({ id: 'e2', title: '新', url: 'https://feishu.cn/docx/b', documentId: 'b' }, () => '2026-08-14T02:00:00.000Z');
  const next = rememberExport([first], second);
  assert.equal(next[0].id, 'e2');
  assert.equal(next[1].id, 'e1');
  const replaced = rememberExport(next, { ...first, title: '更新' });
  assert.equal(replaced.length, 2);
  assert.equal(replaced[0].title, '更新');
});

test('exportedContentPayload 用飞书文档 id 做回流项',
  () => {
    const record = createExportRecord({
      title: '回流验收',
      url: 'https://feishu.cn/docx/abc',
      documentId: 'abc',
      folderName: 'FlowMind 导出'
    }, () => '2026-08-14T08:00:00.000Z');
    const payload = exportedContentPayload(record, '# 结论\n可以继续问');
    assert.equal(payload.externalId, 'feishu-export:abc');
    assert.equal(payload.sourceUrl, 'https://feishu.cn/docx/abc');
    assert.equal(payload.metadata.origin, 'feishu-export');
    assert.ok(payload.tags.includes('飞书导出'));
    assert.match(payload.content, /可以继续问/);
  });

test('有 contentItemId 时首页打开本地这篇',
  () => {
    assert.deepEqual(exportHomeAction({ url: 'https://feishu.cn/docx/abc' }), {
      action: 'open-export',
      documentId: '',
      url: 'https://feishu.cn/docx/abc'
    });
    assert.deepEqual(exportHomeAction({ url: 'https://feishu.cn/docx/abc', contentItemId: 'item_1' }), {
      action: 'open-document',
      documentId: 'item_1',
      url: 'https://feishu.cn/docx/abc'
    });
  });
