import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/FeishuExportDialog.jsx', import.meta.url), 'utf-8');

test('飞书导出在未连接和空文件夹时给出诚实引导', () => {
  assert.match(source, /还没连接飞书/);
  assert.match(source, /去连接飞书/);
  assert.match(source, /导出到默认位置/);
  assert.match(source, /onConnect/);
  assert.match(source, /canExport/);
  assert.match(source, /defaultFolderId/);
  assert.match(source, /titleFromContent/);
  assert.match(source, /已放到/);
  assert.match(source, /收回知识库/);
  assert.match(source, /打开这篇/);
  assert.match(source, /contentItemId/);
  assert.match(source, /onOpenDocument/);
  assert.match(source, /在飞书打开/);
});
