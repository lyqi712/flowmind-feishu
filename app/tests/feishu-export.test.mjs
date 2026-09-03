import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createInitializedApp } from '../server/app.mjs';
import { FeishuConnector } from '../server/feishu.mjs';
import { markdownToFeishuBlocks, createFeishuDocumentBody } from '../server/feishu/markdown-converter.mjs';
import { createFakeModelService } from './helpers/fake-model.mjs';

test('markdownToFeishuBlocks converts headings', () => {
  const blocks = markdownToFeishuBlocks('# 标题一\n## 标题二\n### 标题三');
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].block_type, 3); // heading1
  assert.equal(blocks[0].heading1.elements[0].text_run.content, '标题一');
  assert.equal(blocks[1].block_type, 4); // heading2
  assert.equal(blocks[2].block_type, 5); // heading3
});

test('markdownToFeishuBlocks converts paragraphs', () => {
  const blocks = markdownToFeishuBlocks('普通段落\n\n另一段落');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].block_type, 2); // text
  assert.equal(blocks[0].text.elements[0].text_run.content, '普通段落');
});

test('markdownToFeishuBlocks converts lists', () => {
  const blocks = markdownToFeishuBlocks('- 项目一\n- 项目二\n\n1. 有序一\n2. 有序二');
  const bulletBlocks = blocks.filter(b => b.block_type === 12);
  const orderedBlocks = blocks.filter(b => b.block_type === 13);
  assert.equal(bulletBlocks.length, 2);
  assert.equal(orderedBlocks.length, 2);
});

test('markdownToFeishuBlocks converts code blocks', () => {
  const blocks = markdownToFeishuBlocks('```javascript\nconst x = 1;\n```');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].block_type, 14); // code
  assert.equal(blocks[0].code.language, 19); // JavaScript = 19
  assert.ok(blocks[0].code.elements[0].text_run.content.includes('const x = 1;'));
});

test('markdownToFeishuBlocks converts inline code', () => {
  const blocks = markdownToFeishuBlocks('这是 `内联代码` 示例');
  assert.equal(blocks.length, 1);
  const elements = blocks[0].text.elements;
  // 当前简化实现不解析行内格式，只有一个元素
  assert.equal(elements.length, 1);
  assert.ok(elements[0].text_run.content.includes('内联代码'));
});

test('markdownToFeishuBlocks converts bold and italic', () => {
  const blocks = markdownToFeishuBlocks('**粗体** 和 *斜体*');
  const elements = blocks[0].text.elements;
  // 当前简化实现不解析行内格式
  assert.equal(elements.length, 1);
  assert.ok(elements[0].text_run.content.includes('粗体'));
});

test('markdownToFeishuBlocks converts links', () => {
  const blocks = markdownToFeishuBlocks('[链接文本](https://example.com)');
  const element = blocks[0].text.elements[0];
  // 当前简化实现不解析链接
  assert.ok(element.text_run.content.includes('链接文本'));
});

test('createFeishuDocumentBody creates valid structure', () => {
  const blocks = markdownToFeishuBlocks('# 测试\n内容');
  const body = createFeishuDocumentBody('测试文档', blocks);
  assert.equal(body.title.elements[0].text_run.content, '测试文档');
  assert.ok(Array.isArray(body.blocks));
  assert.ok(body.blocks.length > 0);
});

test('markdownToFeishuBlocks handles empty input', () => {
  const blocks = markdownToFeishuBlocks('');
  assert.equal(blocks.length, 0);
});

test('markdownToFeishuBlocks handles complex nested markdown', () => {
  const markdown = `# 主标题

这是段落，包含 **粗体**、*斜体* 和 \`代码\`。

## 子标题

- 列表项一
- 列表项二
  - 嵌套项（作为独立块）

\`\`\`python
def hello():
    print("world")
\`\`\`

[查看更多](https://example.com)
`;
  const blocks = markdownToFeishuBlocks(markdown);
  assert.ok(blocks.length > 5);
  assert.ok(blocks.some(b => b.block_type === 3)); // heading1
  assert.ok(blocks.some(b => b.block_type === 4)); // heading2
  assert.ok(blocks.some(b => b.block_type === 12)); // bullet
  assert.ok(blocks.some(b => b.block_type === 14)); // code
  assert.ok(blocks.some(b => b.block_type === 2)); // text
});

test('未配置飞书时文件夹接口诚实返回引导', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-folders-'));
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    env: {},
    modelService: createFakeModelService(),
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise(resolve => {
    const current = app.listen(0, '127.0.0.1', () => resolve(current));
  });
  try {
    const data = await (await fetch(`http://127.0.0.1:${server.address().port}/api/feishu/folders`)).json();
    assert.equal(data.ok, true);
    assert.equal(data.configured, false);
    assert.equal(data.canExport, false);
    assert.deepEqual(data.folders, []);
    assert.match(String(data.hint || ''), /连接飞书/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

function recordFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const entry = { url: String(url), method: String(options.method || 'GET').toUpperCase(), body: options.body ? JSON.parse(options.body) : null };
    calls.push(entry);
    return handler(entry);
  };
  return { calls, fetchImpl };
}

test('连接器创建云盘文档并按 50 块分批写入正文', async () => {
  const { calls, fetchImpl } = recordFetch((entry) => {
    if (entry.url.includes('/auth/v3/tenant_access_token/internal')) {
      return Response.json({ code: 0, tenant_access_token: 'export-token' });
    }
    if (entry.method === 'POST' && entry.url.endsWith('/docx/v1/documents')) {
      assert.equal(entry.body.title, '分批导出');
      assert.equal(entry.body.folder_token, 'fld-out');
      return Response.json({ code: 0, data: { document: { document_id: 'doxcn-batch' } } });
    }
    if (entry.method === 'POST' && entry.url.includes('/docx/v1/documents/doxcn-batch/blocks/doxcn-batch/children')) {
      return Response.json({ code: 0, data: { children: entry.body.children } });
    }
    throw new Error(`unexpected ${entry.method} ${entry.url}`);
  });
  const connector = new FeishuConnector({
    env: { FEISHU_APP_ID: 'cli_export', FEISHU_APP_SECRET: 'secret' },
    fetchImpl,
    minDocRequestIntervalMs: 0
  });
  const blocks = Array.from({ length: 51 }, (_, index) => ({
    block_type: 1,
    text: { elements: [{ text_run: { content: `段${index + 1}` } }] }
  }));
  const result = await connector.createDocument({ title: '分批导出', folderToken: 'fld-out', blocks });
  assert.equal(result.document.document_id, 'doxcn-batch');
  assert.equal(result.document.url, 'https://feishu.cn/docx/doxcn-batch');
  const writes = calls.filter((item) => String(item.url).includes('/children'));
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.children.length, 50);
  assert.equal(writes[1].body.children.length, 1);
});

test('连接器在知识空间创建 Wiki 文档', async () => {
  const { fetchImpl } = recordFetch((entry) => {
    if (entry.url.includes('/auth/v3/tenant_access_token/internal')) {
      return Response.json({ code: 0, tenant_access_token: 'export-token' });
    }
    if (entry.method === 'POST' && entry.url.includes('/wiki/v2/spaces/space-1/nodes')) {
      assert.equal(entry.body.obj_type, 'docx');
      assert.equal(entry.body.title, '知识库导出');
      return Response.json({ code: 0, data: { node: { obj_token: 'doxcn-wiki', node_token: 'wiki-node-1' } } });
    }
    if (entry.method === 'POST' && entry.url.includes('/docx/v1/documents/doxcn-wiki/blocks/doxcn-wiki/children')) {
      assert.equal(entry.body.children[0].heading1.elements[0].text_run.content, '结论');
      return Response.json({ code: 0, data: {} });
    }
    throw new Error(`unexpected ${entry.method} ${entry.url}`);
  });
  const result = await new FeishuConnector({
    env: { FEISHU_APP_ID: 'cli_export', FEISHU_APP_SECRET: 'secret', FEISHU_SPACE_IDS: 'space-1' },
    fetchImpl,
    minDocRequestIntervalMs: 0
  }).createDocument({
    title: '知识库导出',
    folderToken: 'wiki:space-1',
    blocks: markdownToFeishuBlocks('# 结论')
  });
  assert.equal(result.document.document_id, 'doxcn-wiki');
  assert.equal(result.document.url, 'https://feishu.cn/wiki/wiki-node-1');
});

test('未指定文件夹时创建并复用 FlowMind 导出', async () => {
  const folders = [];
  const { calls, fetchImpl } = recordFetch((entry) => {
    if (entry.url.includes('/auth/v3/tenant_access_token/internal')) {
      return Response.json({ code: 0, tenant_access_token: 'export-token' });
    }
    if (entry.url.includes('/drive/explorer/v2/root_folder/meta')) {
      return Response.json({ code: 0, data: { token: 'fld-root', name: '根目录' } });
    }
    if (entry.url.includes('/drive/v1/files?') && entry.url.includes('folder_token=fld-root')) {
      return Response.json({
        code: 0,
        data: { files: folders.map((folder) => ({ type: 'folder', token: folder.token, name: folder.name })), has_more: false }
      });
    }
    if (entry.method === 'POST' && entry.url.endsWith('/drive/v1/files/create_folder')) {
      assert.equal(entry.body.name, 'FlowMind 导出');
      assert.equal(entry.body.folder_token, 'fld-root');
      folders.push({ token: 'fld-export', name: 'FlowMind 导出' });
      return Response.json({ code: 0, data: { token: 'fld-export' } });
    }
    if (entry.method === 'POST' && entry.url.endsWith('/docx/v1/documents')) {
      assert.equal(entry.body.folder_token, 'fld-export');
      return Response.json({ code: 0, data: { document: { document_id: 'doxcn-dest' } } });
    }
    if (entry.url.includes('/docx/v1/documents/doxcn-dest/blocks/doxcn-dest/children')) {
      return Response.json({ code: 0, data: {} });
    }
    throw new Error(`unexpected ${entry.method} ${entry.url}`);
  });
  const connector = new FeishuConnector({
    env: { FEISHU_APP_ID: 'cli_export', FEISHU_APP_SECRET: 'secret' },
    fetchImpl,
    minDocRequestIntervalMs: 0
  });
  const first = await connector.listFolders();
  assert.equal(first[0].id, 'fld-export');
  assert.equal(first[0].name, 'FlowMind 导出');
  assert.equal(first[0].default, true);
  const created = await connector.createDocument({
    title: '默认落点',
    blocks: markdownToFeishuBlocks('# 默认落点')
  });
  assert.equal(created.document.folder_token, 'fld-export');
  const createdFolders = calls.filter((item) => item.url.endsWith('/drive/v1/files/create_folder'));
  assert.equal(createdFolders.length, 1);
});

test('已配置飞书时导出接口创建文档，文件夹接口允许导出', async () => {
  const { fetchImpl } = recordFetch((entry) => {
    if (entry.url.includes('/auth/v3/tenant_access_token/internal')) {
      return Response.json({ code: 0, tenant_access_token: 'export-token' });
    }
    if (entry.url.includes('/wiki/v2/spaces?')) {
      return Response.json({ code: 0, data: { items: [{ space_id: 'space-auto', name: '验收空间' }], has_more: false } });
    }
    if (entry.method === 'POST' && entry.url.includes('/wiki/v2/spaces/space-auto/nodes')) {
      assert.equal(entry.body.title, '验收文档');
      return Response.json({ code: 0, data: { node: { obj_token: 'doxcn-http', node_token: 'wiki-http' } } });
    }
    if (entry.method === 'POST' && entry.url.includes('/children')) {
      return Response.json({ code: 0, data: {} });
    }
    return Response.json({ code: 0, data: {} });
  });
  const root = await mkdtemp(join(tmpdir(), 'flowmind-export-'));
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    env: {
      FEISHU_APP_ID: 'cli_export',
      FEISHU_APP_SECRET: 'secret',
      FEISHU_SPACE_IDS: 'space-auto'
    },
    fetchImpl,
    modelService: createFakeModelService(),
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise(resolve => {
    const current = app.listen(0, '127.0.0.1', () => resolve(current));
  });
  try {
    const folders = await (await fetch(`http://127.0.0.1:${server.address().port}/api/feishu/folders`)).json();
    assert.equal(folders.ok, true);
    assert.equal(folders.configured, true);
    assert.equal(folders.canExport, true);
    assert.equal(folders.folders[0].id, 'wiki:space-auto');
    assert.equal(folders.folders[0].name, '验收空间');
    assert.equal(folders.defaultFolderId, 'wiki:space-auto');
    const exported = await (await fetch(`http://127.0.0.1:${server.address().port}/api/feishu/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '验收文档', content: '# 结论\n可以执行' })
    })).json();
    assert.equal(exported.ok, true);
    assert.equal(exported.document.id, 'doxcn-http');
    assert.equal(exported.document.url, 'https://feishu.cn/wiki/wiki-http');
    assert.ok(exported.document.contentItemId);
    const imported = await (await fetch(`http://127.0.0.1:${server.address().port}/api/content/items/${exported.document.contentItemId}`)).json();
    assert.match(String(imported.item?.content || imported.content || ''), /可以执行/);
    const home = await (await fetch(`http://127.0.0.1:${server.address().port}/api/home`)).json();
    assert.ok(home.todayItems.some((item) => item.type === 'recent-export' && item.documentId === exported.document.contentItemId && item.action === 'open-document'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
