import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToFeishuBlocks, createFeishuDocumentBody } from '../server/feishu/markdown-converter.mjs';

test('转换一级标题', () => {
  const blocks = markdownToFeishuBlocks('# 这是标题');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].block_type, 3);
  assert.ok(blocks[0].heading1);
  assert.equal(blocks[0].heading1.elements[0].text_run.content, '这是标题');
});

test('转换二级标题', () => {
  const blocks = markdownToFeishuBlocks('## 子标题');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].block_type, 4);
  assert.ok(blocks[0].heading2);
});

test('转换三级标题', () => {
  const blocks = markdownToFeishuBlocks('### 小标题');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].block_type, 5);
  assert.ok(blocks[0].heading3);
});

test('转换普通段落', () => {
  const blocks = markdownToFeishuBlocks('这是一段普通文字');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].block_type, 2);
  assert.ok(blocks[0].text);
  assert.equal(blocks[0].text.elements[0].text_run.content, '这是一段普通文字');
});

test('转换无序列表', () => {
  const blocks = markdownToFeishuBlocks('- 列表项1\n- 列表项2');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].block_type, 12);
  assert.ok(blocks[0].bullet);
  assert.equal(blocks[0].bullet.elements[0].text_run.content, '列表项1');
});

test('转换有序列表', () => {
  const blocks = markdownToFeishuBlocks('1. 第一项\n2. 第二项');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].block_type, 13);
  assert.ok(blocks[0].ordered);
});

test('转换代码块', () => {
  const markdown = '```javascript\nconst x = 1;\n```';
  const blocks = markdownToFeishuBlocks(markdown);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].block_type, 14);
  assert.ok(blocks[0].code);
  assert.equal(blocks[0].code.elements[0].text_run.content, 'const x = 1;');
  assert.equal(blocks[0].code.language, 19); // JavaScript
});

test('转换引用块', () => {
  const blocks = markdownToFeishuBlocks('> 这是引用');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].block_type, 15);
  assert.ok(blocks[0].quote);
});

test('转换混合内容', () => {
  const markdown = `# 标题

段落1

## 子标题

- 列表项1
- 列表项2

\`\`\`python
print("hello")
\`\`\`

> 引用内容`;

  const blocks = markdownToFeishuBlocks(markdown);
  assert.ok(blocks.length >= 6, '应包含多个 Block');
  assert.equal(blocks[0].block_type, 3, '第一个应是一级标题');
  assert.equal(blocks[1].block_type, 2, '第二个应是段落');
});

test('跳过空行', () => {
  const blocks = markdownToFeishuBlocks('段落1\n\n\n段落2');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text.elements[0].text_run.content, '段落1');
  assert.equal(blocks[1].text.elements[0].text_run.content, '段落2');
});

test('创建文档请求体', () => {
  const blocks = markdownToFeishuBlocks('# 内容');
  const body = createFeishuDocumentBody('测试文档', blocks);
  assert.ok(body.title);
  assert.equal(body.title.elements[0].text_run.content, '测试文档');
  assert.ok(Array.isArray(body.blocks));
  assert.equal(body.blocks.length, 1);
});

test('处理特殊字符', () => {
  const blocks = markdownToFeishuBlocks('这是<特殊>字符 & "引号"');
  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].text.elements[0].text_run.content.includes('<特殊>'));
});
