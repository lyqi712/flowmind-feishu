import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSrc = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf-8');
const smartHomeSrc = readFileSync(new URL('../src/components/SmartHome.jsx', import.meta.url), 'utf-8');

test('SmartHome 组件包含今日待办和推荐操作', () => {
  assert.ok(smartHomeSrc.includes('todayItems'), 'SmartHome 应渲染今日待办');
  assert.ok(smartHomeSrc.includes('recommendations'), 'SmartHome 应渲染推荐操作');
});

test('首页不再堆今日待办和推荐操作', () => {
  const workspaceSrc = readFileSync(new URL('../src/components/UnifiedWorkspace.jsx', import.meta.url), 'utf-8');
  assert.doesNotMatch(workspaceSrc, /<SmartHome/);
  assert.doesNotMatch(workspaceSrc, /今日待办/);
  assert.doesNotMatch(workspaceSrc, /推荐操作/);
});

test('SmartHome 支持一键执行操作', () => {
  assert.ok(smartHomeSrc.includes('onAction'), 'SmartHome 应支持一键操作');
  assert.ok(smartHomeSrc.includes('open-document') && smartHomeSrc.includes('run-skill'), 'SmartHome 应支持文档和 Skill 操作');
  assert.match(smartHomeSrc, /open-export/);
  assert.match(smartHomeSrc, /item.documentId/);
  assert.match(mainSrc, /handleFeishuExported/);
  assert.match(mainSrc, /refreshContentItems/);
});
