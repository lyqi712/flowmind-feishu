import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSuggestions, normalizeSearchHistory } from '../src/workspace/smart-search.js';

const mainSrc = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf-8');
const searchSrc = readFileSync(new URL('../src/components/SmartSearch.jsx', import.meta.url), 'utf-8');
const workspaceSrc = readFileSync(new URL('../src/components/UnifiedWorkspace.jsx', import.meta.url), 'utf-8');

test('SmartSearch 使用 React 且默认关闭', () => {
  assert.match(searchSrc, /from 'react'/);
  assert.doesNotMatch(searchSrc, /from 'preact'/);
  assert.match(searchSrc, /if \(!open\) return null/);
});

test('main 接入智能搜索历史、热门话题和快捷键', () => {
  assert.match(mainSrc, /<SmartSearch/);
  assert.match(mainSrc, /trendingTopics/);
  assert.match(mainSrc, /\/api\/search\/history/);
  assert.match(mainSrc, /\/api\/search\/trending/);
  assert.match(workspaceSrc, /toLowerCase\(\) === 'k'/);
  assert.doesNotMatch(mainSrc, /hotTopics=\{hotTopics\}/);
});

test('搜索建议按历史、热门和文档标题排序去重', () => {
  const suggestions = generateSuggestions('规划', {
    recentSearches: [{ query: 'Q2 规划', resultCount: 3 }],
    trendingTopics: [{ name: '规划评审', count: 4 }],
    documents: [{ title: '规划草案' }, { title: '无关文档' }]
  });
  assert.equal(suggestions[0].text, 'Q2 规划');
  assert.ok(suggestions.some(item => item.text === '规划评审'));
  assert.ok(suggestions.some(item => item.text === '规划草案'));
  assert.equal(new Set(suggestions.map(item => item.text)).size, suggestions.length);
});

test('空查询不生成建议，历史会去掉空白项', () => {
  assert.deepEqual(generateSuggestions('   ', { recentSearches: [{ query: 'abc' }] }), []);
  assert.deepEqual(normalizeSearchHistory([{ query: '  ' }, { query: '飞书' }]).map(item => item.query), ['飞书']);
});

test('文档建议带上 documentId，点建议才能打开原文', () => {
  const suggestions = generateSuggestions('Agent', {
    documents: [{ id: 'doc-loop', title: 'Agent Loop：从长时运行幻觉到可验证的责任闭环' }]
  });
  const document = suggestions.find(item => item.kind === 'document');
  assert.ok(document);
  assert.equal(document.documentId, 'doc-loop');
  assert.match(searchSrc, /onOpenDocument/);
  assert.match(searchSrc, /suggestion\?\.kind === 'document'/);
  assert.match(mainSrc, /onOpenDocument=\{handleSmartSearchOpenDocument\}/);
  assert.match(mainSrc, /async function handleSmartSearchOpenDocument/);
});
