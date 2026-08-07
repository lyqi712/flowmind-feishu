import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const componentPath = path.join(appRoot, 'src', 'components', 'ComposerCommandMenu.jsx');
const cssPath = path.join(appRoot, 'src', 'components', 'ComposerCommandMenu.css');

let source;
let css;
let vite;
let menuModule;

before(async () => {
  [source, css] = await Promise.all([
    fs.readFile(componentPath, 'utf8'),
    fs.readFile(cssPath, 'utf8')
  ]);

  vite = await createServer({
    root: appRoot,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    plugins: [react()],
    server: { middlewareMode: true }
  });
  menuModule = await vite.ssrLoadModule('/src/components/ComposerCommandMenu.jsx');
});

after(async () => {
  await vite?.close();
});

const slashGroups = [
  {
    id: 'skills',
    label: 'Skills',
    kind: 'skills',
    items: [
      {
        id: 'deep-summary',
        label: '深度总结',
        description: '提炼结构、结论与行动项',
        keywords: ['summary', '摘要'],
        icon: 'skill',
        badge: 'Skill',
        data: { skillId: 'deep-summary' }
      },
      {
        id: 'translate',
        label: '全文翻译',
        description: '保持原有结构',
        icon: 'sparkles',
        disabled: true
      }
    ]
  },
  {
    id: 'actions',
    label: '常用动作',
    kind: 'actions',
    items: [
      { id: 'new-note', label: '新建笔记', description: '记录当前想法', icon: 'note', shortcut: '⌘N' }
    ]
  },
  {
    id: 'documents',
    label: '文档',
    kind: 'documents',
    items: [{ id: 'doc-1', label: '项目方案', icon: 'document' }]
  }
];

const mentionGroups = [
  {
    id: 'documents',
    label: '最近文档',
    kind: 'documents',
    items: [{ id: 'doc-1', label: '项目方案', description: '今天更新', icon: 'document' }]
  },
  {
    id: 'attachments',
    label: '本轮附件',
    kind: 'attachments',
    items: [{ id: 'attachment-1', label: '需求截图.png', description: 'OCR 已完成', icon: 'attachment' }]
  },
  {
    id: 'context',
    label: '当前上下文',
    kind: 'context',
    items: [{ id: 'selection', label: '当前选区', description: '引用阅读器选中的段落', icon: 'context' }]
  },
  {
    id: 'skills',
    label: 'Skills',
    kind: 'skills',
    items: [{ id: 'deep-summary', label: '深度总结' }]
  }
];

test('ComposerCommandMenu JSX 可由 Vite 插件链真实编译', async () => {
  const result = await vite.transformRequest('/src/components/ComposerCommandMenu.jsx', { ssr: true });

  assert.ok(result?.code?.length > 1000);
  assert.match(result.code, /function ComposerCommandMenu/);
  assert.match(result.code, /react\/jsx(?:-dev)?-runtime/);
});

test('/ 模式只展示 skills/常用动作，并支持 label、description 与 keywords 搜索', () => {
  const normalized = menuModule.normalizeComposerCommandGroups(slashGroups, '/');
  assert.deepEqual(normalized.map(group => group.id), ['skills', 'actions']);

  const byKeyword = menuModule.filterComposerCommandGroups(normalized, 'summary');
  assert.deepEqual(byKeyword.flatMap(group => group.items.map(item => item.id)), ['deep-summary']);

  const byDescription = menuModule.filterComposerCommandGroups(normalized, '记录');
  assert.deepEqual(byDescription.flatMap(group => group.items.map(item => item.id)), ['new-note']);
});

test('@ 模式只展示 documents/attachments/current context', () => {
  const normalized = menuModule.normalizeComposerCommandGroups(mentionGroups, '@');
  assert.deepEqual(normalized.map(group => group.id), ['documents', 'attachments', 'context']);
  assert.deepEqual(
    menuModule.flattenComposerCommandOptions(normalized).map(item => item.id),
    ['doc-1', 'attachment-1', 'selection']
  );
});

test('键盘 ArrowUp/ArrowDown 循环移动，Enter 选择，Escape 关闭', () => {
  const navigate = menuModule.resolveComposerCommandNavigation;
  assert.deepEqual(navigate({ key: 'ArrowDown', currentIndex: -1, optionCount: 3 }), {
    action: 'move', index: 0, preventDefault: true
  });
  assert.equal(navigate({ key: 'ArrowDown', currentIndex: 2, optionCount: 3 }).index, 0);
  assert.equal(navigate({ key: 'ArrowUp', currentIndex: 0, optionCount: 3 }).index, 2);
  assert.deepEqual(navigate({ key: 'Enter', currentIndex: 1, optionCount: 3 }), {
    action: 'select', index: 1, preventDefault: true
  });
  assert.equal(navigate({ key: 'Escape', currentIndex: 1, optionCount: 3 }).action, 'close');
  assert.equal(navigate({ key: 'Tab', currentIndex: 1, optionCount: 3 }).preventDefault, false);
});

test('SSR 输出分组、图标、搜索高亮与完整 listbox/option ARIA', () => {
  const html = renderToStaticMarkup(React.createElement(menuModule.default, {
    open: true,
    mode: '/',
    query: '总结',
    groups: slashGroups,
    defaultActiveId: 'deep-summary',
    ariaLabel: '对话命令'
  }));

  assert.match(html, /data-mode="slash"/);
  assert.match(html, /data-trigger="\/"/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /aria-label="对话命令"/);
  assert.match(html, /aria-activedescendant="[^"]*deep-summary"/);
  assert.match(html, /role="option"/);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /composer-command-menu__group-label/);
  assert.match(html, /composer-command-menu__icon/);
  assert.match(html, /<mark class="composer-command-menu__highlight">总结<\/mark>/);
  assert.doesNotMatch(html, /项目方案/);
});

test('SSR 支持 @ 菜单、禁用项及空状态', () => {
  const mentionHtml = renderToStaticMarkup(React.createElement(menuModule.default, {
    open: true,
    mode: '@',
    groups: mentionGroups,
    query: '截图'
  }));
  assert.match(mentionHtml, /data-mode="mention"/);
  assert.match(mentionHtml, /需求<mark class="composer-command-menu__highlight">截图<\/mark>\.png/);
  assert.doesNotMatch(mentionHtml, /深度总结/);

  const emptyHtml = renderToStaticMarkup(React.createElement(menuModule.default, {
    open: true,
    mode: '@',
    groups: mentionGroups,
    query: '不存在的内容'
  }));
  assert.match(emptyHtml, /没有匹配的文档或上下文/);
  assert.match(emptyHtml, /role="status"/);
  assert.match(emptyHtml, /0 项/);
});

test('组件真实绑定外部输入框键盘、ARIA 与鼠标选择事件', () => {
  assert.match(source, /input\.addEventListener\('keydown', handleKeyDown\)/);
  assert.match(source, /input\.setAttribute\('aria-controls', listboxId\)/);
  assert.match(source, /input\.setAttribute\('aria-expanded'/);
  assert.match(source, /input\.setAttribute\('aria-activedescendant', activeDomId\)/);
  assert.match(source, /onMouseMove=\{\(\) => setActiveOption\(item, 'pointer'\)\}/);
  assert.match(source, /onMouseDown=\{event => event\.preventDefault\(\)\}/);
  assert.match(source, /onClick=\{\(\) => selectOption\(item, 'pointer'\)\}/);
});

test('样式包含 390px 响应式、reduced motion 与清晰的激活态', () => {
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.composer-command-menu__option\.is-active/);
  assert.match(css, /\.composer-command-menu__highlight/);
  assert.match(css, /--composer-command-menu-max-height/);
});
