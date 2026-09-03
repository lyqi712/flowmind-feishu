import assert from 'node:assert/strict';
import test from 'node:test';
import { extractFeishuAssetRefs, renderFeishuDocumentBlocks, renderTextElements } from '../server/feishu-richtext.mjs';

function textRun(content, style = {}) {
  return { text_run: { content, text_element_style: style } };
}

function textBlock(blockId, parentId, content) {
  return {
    block_id: blockId,
    parent_id: parentId,
    block_type: 2,
    text: { elements: [textRun(content)] }
  };
}

test('飞书块级富文本保留标题、链接、嵌套列表与 Todo，并生成 Outline/Anchor', () => {
  const blocks = [
    { block_id: 'page', block_type: 1, children: ['heading', 'link', 'bullet'] },
    {
      block_id: 'heading', parent_id: 'page', block_type: 3,
      heading1: { elements: [textRun('发布计划')] }
    },
    {
      block_id: 'link', parent_id: 'page', block_type: 2,
      text: { elements: [textRun('查看飞书', { bold: true, link: { url: 'https://example.test/spec' } })] }
    },
    {
      block_id: 'bullet', parent_id: 'page', block_type: 12, children: ['todo', 'ordered'],
      bullet: { elements: [textRun('父级事项')] }
    },
    {
      block_id: 'todo', parent_id: 'bullet', block_type: 17,
      todo: { elements: [textRun('已完成检查')], style: { done: true } }
    },
    {
      block_id: 'ordered', parent_id: 'bullet', block_type: 13,
      ordered: { elements: [textRun('补充说明')] }
    }
  ];

  const rendered = renderFeishuDocumentBlocks(blocks, { title: '降级标题' });

  assert.match(rendered.content, /^# 发布计划/m);
  assert.match(rendered.content, /\[\*\*查看飞书\*\*\]\(https:\/\/example\.test\/spec\)/);
  assert.match(rendered.content, /^- 父级事项$/m);
  assert.match(rendered.content, /^  - \[x\] 已完成检查$/m);
  assert.match(rendered.content, /^  1\. 补充说明$/m);
  assert.deepEqual(rendered.links, ['https://example.test/spec']);
  assert.deepEqual(rendered.metadata.outline, [
    { level: 1, title: '发布计划', anchor: 'block:heading', blockId: 'heading' }
  ]);
  assert.ok(rendered.metadata.blockAnchors.some(item => item.anchor === 'block:heading' && item.kind === 'heading1'));
  assert.ok(rendered.metadata.blockAnchors.some(item => item.anchor === 'block:todo' && item.kind === 'todo'));
  assert.equal(rendered.metadata.documentFormat, 'feishu-docx-blocks-v1');
  assert.equal(rendered.metadata.richText, true);
  assert.equal(rendered.metadata.blockCount, blocks.length);
  assert.equal(rendered.metadata.contentHash.length, 64);
});

test('飞书表格按块树还原为 GFM 表格', () => {
  const blocks = [
    { block_id: 'page', block_type: 1, children: ['table'] },
    {
      block_id: 'table', parent_id: 'page', block_type: 31,
      table: { property: { row_size: 2, column_size: 2 }, cells: ['c11', 'c12', 'c21', 'c22'] },
      children: ['c11', 'c12', 'c21', 'c22']
    },
    { block_id: 'c11', parent_id: 'table', block_type: 32, children: ['t11'] },
    { block_id: 'c12', parent_id: 'table', block_type: 32, children: ['t12'] },
    { block_id: 'c21', parent_id: 'table', block_type: 32, children: ['t21'] },
    { block_id: 'c22', parent_id: 'table', block_type: 32, children: ['t22'] },
    textBlock('t11', 'c11', '任务'),
    textBlock('t12', 'c12', '负责人'),
    textBlock('t21', 'c21', '排版 | 复核'),
    textBlock('t22', 'c22', '小飞')
  ];

  const rendered = renderFeishuDocumentBlocks(blocks);

  assert.match(rendered.content, /^\| 任务 \| 负责人 \|$/m);
  assert.match(rendered.content, /^\| --- \| --- \|$/m);
  assert.match(rendered.content, /^\| 排版 \\?\| 复核 \| 小飞 \|$/m);
  assert.ok(rendered.metadata.blockAnchors.some(item => item.anchor === 'block:table' && item.kind === 'table'));
  assert.ok(rendered.metadata.structuredBlocks.some(item => item.id === 'table' && item.kind === 'table' && item.children.length === 4));
});

test('飞书图片与文件生成稳定资源清单、Markdown 引用和块锚点', () => {
  const blocks = [
    { block_id: 'page', block_type: 1, children: ['image', 'file'] },
    {
      block_id: 'image', parent_id: 'page', block_type: 27,
      image: { token: 'img-token-001', name: '架构图.png', mime_type: 'image/png', width: 1280, height: 720 }
    },
    {
      block_id: 'file', parent_id: 'page', block_type: 23,
      file: { token: 'file-token-002', name: '需求说明.pdf', mime_type: 'application/pdf' }
    }
  ];

  const rendered = renderFeishuDocumentBlocks(blocks);

  assert.match(rendered.content, /!\[架构图\.png\]\(feishu-asset:\/\/img-token-001\)/);
  assert.match(rendered.content, /\[📎 需求说明\.pdf\]\(feishu-asset:\/\/file-token-002\)/);
  assert.deepEqual(rendered.assets, [
    {
      kind: 'image', token: 'img-token-001', fileName: '架构图.png', mimeType: 'image/png',
      width: 1280, height: 720, blockId: 'image', anchor: 'block:image'
    },
    {
      kind: 'file', token: 'file-token-002', fileName: '需求说明.pdf', mimeType: 'application/pdf',
      blockId: 'file', anchor: 'block:file'
    }
  ]);
  assert.ok(rendered.metadata.blockAnchors.some(item => item.anchor === 'block:image'));
  assert.ok(rendered.metadata.blockAnchors.some(item => item.anchor === 'block:file'));
});

test('飞书图片 extra 进入资源清单，Markdown 引用可反向提取 token', () => {
  const rendered = renderFeishuDocumentBlocks([
    { block_id: 'page', block_type: 1, children: ['image', 'file'] },
    { block_id: 'image', parent_id: 'page', block_type: 27, image: { token: 'img-extra', name: 'cover.png', mime_type: 'image/png', extra: '{"drive_route_token":"docx-1"}' } },
    { block_id: 'file', parent_id: 'page', block_type: 23, file: { token: 'html-extra', name: 'index.html', mime_type: 'text/html' } }
  ]);
  assert.equal(rendered.assets[0].extra, '{"drive_route_token":"docx-1"}');
  assert.deepEqual(extractFeishuAssetRefs(rendered.content), [
    { kind: 'image', token: 'img-extra', fileName: 'cover.png', mimeType: 'image/png' },
    { kind: 'file', token: 'html-extra', fileName: 'index.html', mimeType: 'text/html' }
  ]);
});

test('空块列表使用文档标题降级，富文本样式和链接可独立渲染', () => {
  assert.equal(renderFeishuDocumentBlocks([], { title: '空文档标题' }).content, '空文档标题');

  const rendered = renderTextElements([
    textRun('粗体', { bold: true }),
    textRun('代码', { inline_code: true }),
    textRun('入口', { link: { url: 'https://example.test/entry' } })
  ]);
  assert.equal(rendered.markdown, '**粗体**`代码`[入口](https://example.test/entry)');
  assert.equal(rendered.plain, '粗体代码入口');
  assert.deepEqual(rendered.links, ['https://example.test/entry']);
});
