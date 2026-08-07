import assert from 'node:assert/strict';
import test from 'node:test';
import { FeishuConnector, parseFeishuResource } from '../server/feishu.mjs';

const ok = (data = {}) => Response.json({ code: 0, data });

function fixtureFetch(url, options = {}) {
  const target = String(url);
  if (target.includes('/auth/v3/tenant_access_token/internal')) return Promise.resolve(Response.json({ code: 0, tenant_access_token: 'fixture-token' }));

  if (target.includes('/docx/v1/documents/doc-root/blocks?')) return Promise.resolve(ok({ items: [
    { text: { elements: [{ text_run: { text_element_style: { link: { url: 'https://tenant.feishu.cn/docx/doc-child' } } } }] } },
    { url: 'https://tenant.feishu.cn/docx/doc-child' },
    { url: 'not-a-http-link' }
  ] }));
  if (target.includes('/docx/v1/documents/doc-child/blocks?')) return Promise.resolve(ok({ items: [] }));
  if (target.includes('/docx/v1/documents/doc-folder/blocks?')) return Promise.resolve(ok({ items: [] }));
  if (target.includes('/docx/v1/documents/doc-root/raw_content')) return Promise.resolve(ok({ content: '根文档正文' }));
  if (target.includes('/docx/v1/documents/doc-child/raw_content')) return Promise.resolve(ok({ content: '关联文档正文' }));
  if (target.includes('/docx/v1/documents/doc-folder/raw_content')) return Promise.resolve(ok({ content: '文件夹文档正文' }));
  if (target.match(/\/docx\/v1\/documents\/doc-root(?:\?|$)/)) return Promise.resolve(ok({ document: { title: '根文档', revision_id: 1 } }));
  if (target.match(/\/docx\/v1\/documents\/doc-child(?:\?|$)/)) return Promise.resolve(ok({ document: { title: '关联文档', revision_id: 2 } }));
  if (target.match(/\/docx\/v1\/documents\/doc-folder(?:\?|$)/)) return Promise.resolve(ok({ document: { title: '文件夹文档', revision_id: 3 } }));

  if (target.includes('/wiki/v2/spaces/get_node?')) return Promise.resolve(ok({ node: { obj_type: 'sheet', obj_token: 'sheet-wiki', node_token: 'wiki-sheet', title: 'Wiki 表格' } }));
  if (target.includes('/sheets/v3/spreadsheets/sheet-wiki/sheets/query')) return Promise.resolve(ok({ sheets: [{ sheet_id: 'tab1', title: '数据' }] }));
  if (target.includes('/sheets/v3/spreadsheets/sheet-wiki')) return Promise.resolve(ok({ spreadsheet: { title: '项目数据' } }));
  if (target.includes('/sheets/v2/spreadsheets/sheet-wiki/values/')) return Promise.resolve(ok({ valueRange: { values: [['任务', '负责人'], ['整理', '小飞']] } }));

  if (target.includes('/bitable/v1/apps/base-app/tables/table1/records?')) return Promise.resolve(ok({ items: [{ fields: { 事项: '联调', 状态: '完成' } }], has_more: false }));
  if (target.includes('/bitable/v1/apps/base-app/tables?')) return Promise.resolve(ok({ items: [{ table_id: 'table1', name: '行动项' }], has_more: false }));

  if (target.includes('/drive/v1/files?') && target.includes('folder_token=folder-root')) return Promise.resolve(ok({ files: [
    { type: 'docx', token: 'doc-folder', name: '文件夹文档', url: 'https://tenant.feishu.cn/docx/doc-folder' },
    { type: 'folder', token: 'folder-nested', name: '子文件夹' }
  ], has_more: false }));
  if (target.includes('/drive/v1/files?') && target.includes('folder_token=folder-nested')) return Promise.resolve(ok({ files: [
    { type: 'doc', token: 'legacy-doc', name: '旧文档' }
  ], has_more: false }));
  if (target.includes('/doc/v2/legacy-doc/raw_content')) return Promise.resolve(ok({ title: '旧版文档', content: '旧版正文' }));

  throw new Error(`unexpected fixture URL: ${target}; method=${options.method || 'GET'}`);
}

function connector() {
  return new FeishuConnector({
    env: { FEISHU_APP_ID: 'fixture-app', FEISHU_APP_SECRET: 'fixture-secret' },
    fetchImpl: fixtureFetch,
    minDocRequestIntervalMs: 0
  });
}

test('飞书链接解析覆盖 Docx/Wiki/Sheet/Bitable/Folder，拒绝非 HTTP 块值', () => {
  assert.equal(parseFeishuResource('token-only'), null);
  assert.equal(parseFeishuResource('https://x.feishu.cn/docx/doc1').type, 'docx');
  assert.equal(parseFeishuResource('https://x.feishu.cn/wiki/wiki1').type, 'wiki');
  assert.equal(parseFeishuResource('https://x.feishu.cn/sheets/sheet1').type, 'sheet');
  assert.equal(parseFeishuResource('https://x.feishu.cn/base/base1').type, 'bitable');
  assert.equal(parseFeishuResource('https://x.feishu.cn/folder/folder1').type, 'folder');
});

test('直接 Docx 可递归导入关联文档、去重，并忽略非 HTTP 块值', async () => {
  const result = await connector().sync({ documentUrls: ['https://tenant.feishu.cn/docx/doc-root'], recursiveLinks: true, maxDepth: 2 });
  assert.equal(result.documents.length, 2);
  assert.deepEqual(result.stats.byType, { docx: 2 });
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.documents.map((item) => item.title).sort(), ['关联文档', '根文档']);
});

test('Wiki 链接解析实际 Sheet，多维表格读取表和记录', async () => {
  const result = await connector().sync({ documentUrls: [
    'https://tenant.feishu.cn/wiki/wiki-sheet',
    'https://tenant.feishu.cn/base/base-app'
  ], recursiveLinks: false });
  assert.equal(result.documents.length, 2);
  assert.equal(result.stats.byType.sheet, 1);
  assert.equal(result.stats.byType.bitable, 1);
  assert.match(result.documents.find((item) => item.sourceType === 'sheet').content, /任务\t负责人/);
  assert.match(result.documents.find((item) => item.sourceType === 'bitable').content, /联调/);
});

test('Drive Folder 可递归读取子文件夹，Unsupported 类型形成可见 warning', async () => {
  const result = await connector().sync({
    folderTokens: ['https://tenant.feishu.cn/folder/folder-root'],
    documentUrls: ['https://tenant.feishu.cn/slides/slides-unsupported'],
    recursiveLinks: true,
    maxDepth: 3
  });
  assert.equal(result.documents.length, 2);
  assert.equal(result.stats.byType.docx, 1);
  assert.equal(result.stats.byType.doc, 1);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'FEISHU_RESOURCE_UNSUPPORTED');
  assert.equal(result.warnings[0].type, 'slides');
});
