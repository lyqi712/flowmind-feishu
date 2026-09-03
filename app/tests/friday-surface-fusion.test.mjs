import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const skin = await readFile(new URL('../src/components/FridaySkin.css', import.meta.url), 'utf8');
const clean = await readFile(new URL('../src/components/UnifiedWorkspaceClean.css', import.meta.url), 'utf8');

test('深浅色共用同一套 friday 色层，不再把系统主题强制成浅色', () => {
  assert.match(skin, /html\[data-theme='dark'\],\s*html\[data-theme-resolved='dark'\]/);
  assert.match(skin, /data-theme-resolved='dark'\] \{\s*color-scheme: dark;/);
  assert.doesNotMatch(skin, /html\[data-theme='dark'\],\s*html\[data-theme='system'\] \{\s*color-scheme: light;/);
  assert.match(skin, /--ink: var\(--friday-ink\)/);
  assert.match(skin, /--paper: var\(--friday-paper\)/);
});

test('标签栏和外壳同色，内容纸面单独抬起，避免灰条压在白卡片上', () => {
  const stage = skin.slice(skin.indexOf('.unified-workspace[data-skin=\'friday\'] .unified-workspace-stage {'), skin.indexOf('.unified-workspace[data-skin=\'friday\'] .unified-workspace-tabs'));
  assert.match(stage, /background: var\(--friday-bg\)/);
  assert.doesNotMatch(stage, /background: var\(--friday-paper\)/);
  assert.match(stage, /background: transparent/);
  assert.match(skin, /unified-workspace-main[\s\S]*?background: var\(--friday-paper\)/);
});

test('深色纸面浅于外壳，卡片从托盘里抬起来而不是挖下去', () => {
  const dark = skin.slice(skin.indexOf("html[data-theme='dark']"), skin.indexOf('@media (prefers-color-scheme: dark)'));
  assert.match(dark, /--friday-bg: #141416/);
  assert.match(dark, /--friday-paper: #1c1c20/);
});

test('侧栏搜索是居中的 40px 图标，不再沿用宽搜索条的两列网格', () => {
  assert.match(skin, /unified-workspace-global-search \{[\s\S]*?grid-template-columns: 40px/);
  assert.match(skin, /unified-workspace-global-search-open \{[\s\S]*?grid-template-columns: 1fr/);
});

test('笔记筛选和顶栏按钮不再用白底药丸', () => {
  assert.match(skin, /\.module-tabs button \{\s*background: transparent/);
  assert.match(skin, /\.note-preview-toggle,\s*\.app-shell\.app-shell-v3\[data-skin='friday'\] \.note-more-toggle \{\s*border-color: transparent;\s*background: transparent/);
  assert.match(skin, /\.module-list b[\s\S]*?color: var\(--friday-ink\)/);
});

test('知识库文件卡透明、标题跟墨色，不再铺深色井和白标签', () => {
  assert.match(skin, /\.library-doc-card \{[\s\S]*?background: transparent/);
  assert.match(skin, /\.library-doc-card b \{[\s\S]*?color: var\(--friday-ink\)/);
  assert.match(skin, /\.library-browse-stage h2 \{[\s\S]*?color: var\(--friday-ink\)/);
  assert.match(skin, /\.tag-filter \{\s*display: none/);
  assert.match(skin, /\.library-file-badge\.is-doc \{\s*color: #1560f7/);
});

test('首页输入和最近列表不再写死黑字白底', () => {
  assert.match(clean, /color: var\(--workspace-ink/);
  assert.match(clean, /background: var\(--paper/);
  assert.doesNotMatch(clean, /color: rgba\(0,0,0,\.86\)/);
  assert.doesNotMatch(clean, /background: #fff;/);
});
