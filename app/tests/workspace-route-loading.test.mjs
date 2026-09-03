import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createWorkspaceSurfaceLoader,
  workspaceRouteSurfaces
} from '../src/workspace/workspace-route-loading.js';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const mainSource = readFileSync(resolve(appRoot, 'src/main.jsx'), 'utf8');
const loaderSource = readFileSync(resolve(appRoot, 'src/workspace/workspace-route-loading.js'), 'utf8');
const workspaceSource = readFileSync(resolve(appRoot, 'src/components/UnifiedWorkspace.jsx'), 'utf8');
const stylesSource = readFileSync(resolve(appRoot, 'src/styles.css'), 'utf8');

test('重型工作区 surface 通过动态 import 离开主入口静态依赖', () => {
  const forbiddenStaticImports = [
    'FeishuSyncWizard',
    'CollectionCenter',
    'ContentReader',
    'KnowledgeGraph',
    'SettingsExperience',
    'DeepAnswerPanel',
    'NotesWorkspace',
    'WritingWorkspace',
    'DocumentAnalysisWorkspace',
    'CopilotWorkspace',
    'RecordingWorkspace',
    'ComposerCommandMenu',
    'EmbeddedBrowser'
  ];
  for (const component of forbiddenStaticImports) {
    assert.doesNotMatch(mainSource, new RegExp(`^import[^\\n]+components/${component}\\.jsx`, 'm'), component);
  }
  for (const component of forbiddenStaticImports) {
    assert.match(loaderSource, new RegExp(`import\\(['\"]\\.\\.\\/components\\/${component}\\.jsx['\"]\\)`), component);
  }
  assert.match(mainSource, /lazyDefaultSurface\('feishu-sync'\)/);
  assert.match(mainSource, /lazyNamedSurface\('notes', 'NotesModule'\)/);
  assert.match(mainSource, /lazyNamedSurface\('writing', 'WritingModule'\)/);
  assert.match(mainSource, /lazyNamedSurface\('analysis', 'DocumentAnalysisModule'\)/);
  assert.match(mainSource, /lazyNamedSurface\('copilot', 'CopilotModule'\)/);
});

test('四个业务路由保持物理依赖隔离且运行时不回退到兼容 barrel', () => {
  const routeFiles = [
    'NotesWorkspace.jsx',
    'WritingWorkspace.jsx',
    'DocumentAnalysisWorkspace.jsx',
    'CopilotWorkspace.jsx'
  ];
  const routeSources = new Map(routeFiles.map(file => [
    file,
    readFileSync(resolve(appRoot, 'src/components', file), 'utf8')
  ]));
  for (const [file, source] of routeSources) {
    assert.doesNotMatch(source, /(?:from\s+|import\()['"]\.\/WorkspaceModules\.jsx['"]/, file);
    for (const otherFile of routeFiles) {
      if (otherFile === file) continue;
      assert.doesNotMatch(source, new RegExp(`(?:from\\s+|import\\()['"]\\.\\/${otherFile.replace('.', '\\.')}['"]`), `${file} -> ${otherFile}`);
    }
  }
  assert.doesNotMatch(mainSource, /WorkspaceModules\.jsx/);
  assert.doesNotMatch(loaderSource, /WorkspaceModules\.jsx/);
});
test('路由预取保持原 route id，并只加载该交互需要的 surface', () => {
  assert.deepEqual(workspaceRouteSurfaces('home'), []);
  assert.deepEqual(workspaceRouteSurfaces('collect'), ['collection']);
  assert.deepEqual(workspaceRouteSurfaces('knowledge'), ['composer-menu', 'content-reader', 'deep-answer']);
  assert.deepEqual(workspaceRouteSurfaces('notes'), ['notes']);
  assert.deepEqual(workspaceRouteSurfaces('web'), ['embedded-browser']);
  assert.deepEqual(workspaceRouteSurfaces('writing'), ['writing']);
  assert.deepEqual(workspaceRouteSurfaces('analysis'), ['analysis']);
  assert.deepEqual(workspaceRouteSurfaces('copilots'), ['copilot']);
  assert.notDeepEqual(workspaceRouteSurfaces('notes'), workspaceRouteSurfaces('writing'));
  assert.notDeepEqual(workspaceRouteSurfaces('analysis'), workspaceRouteSurfaces('copilots'));
  assert.deepEqual(workspaceRouteSurfaces('recording'), ['recording']);
  assert.deepEqual(workspaceRouteSurfaces('settings'), ['settings']);
  assert.deepEqual(workspaceRouteSurfaces('unknown'), []);
});

test('同一 surface 的并发加载复用一个 Promise', async () => {
  let calls = 0;
  const deferred = Promise.withResolvers();
  const preloader = createWorkspaceSurfaceLoader({
    notes: async () => {
      calls += 1;
      await deferred.promise;
      return { NotesModule() {} };
    }
  });
  const first = preloader.load('notes');
  const second = preloader.load('notes');
  const third = preloader.preload('notes');
  assert.strictEqual(first, second);
  assert.equal(calls, 0, 'loader runs in a microtask so all same-turn calls can share it');
  deferred.resolve();
  const [module, sameModule, preloadResult] = await Promise.all([first, second, third]);
  assert.strictEqual(module, sameModule);
  assert.equal(calls, 1);
  assert.deepEqual(preloadResult, { surface: 'notes', status: 'loaded' });
});

test('失败的动态 import 会清除缓存，下一次交互可以重试', async () => {
  let calls = 0;
  const preloader = createWorkspaceSurfaceLoader({
    notes: async () => {
      calls += 1;
      if (calls === 1) throw new Error('chunk unavailable');
      return { NotesModule() {} };
    }
  });
  await assert.rejects(preloader.load('notes'), /chunk unavailable/);
  await assert.doesNotReject(preloader.load('notes'));
  assert.equal(calls, 2);
});

test('导航 hover/focus 预取与点击导航保持解耦', () => {
  for (const fragment of [
    'onPointerEnter={() => onPrefetch?.(id)}',
    'onFocus={() => onPrefetch?.(id)}',
    "onPointerEnter={() => onPrefetch?.('settings')}",
    "onFocus={() => onPrefetch?.('settings')}",
    'onClick={() => id === \'collect\' ? onCollect?.() : onNavigate?.(id)}'
  ]) assert.ok(workspaceSource.includes(fragment), fragment);
  assert.match(mainSource, /onPrefetch=\{route => \{ void preloadWorkspaceRoute\(route\); \}\}/);
  assert.match(mainSource, /void preloadWorkspaceRoute\(id\);/);
  assert.match(mainSource, /void preloadWorkspaceSurface\('composer-menu'\)/);
  assert.match(mainSource, /void preloadWorkspaceSurface\('deep-answer'\)/);
  assert.match(mainSource, /function prefetchWorkspaceDocument/);
  assert.match(mainSource, /onPrefetchDocument=\{prefetchWorkspaceDocument\}/);
  assert.match(mainSource, /onPointerEnter=\{\(\) => onPrefetchDocument\?\.\(doc\)\}/);
});

test('lazy surface 使用局部 Suspense 和可读 loading，避免整套工作台闪退为空白', () => {
  const labels = ['知识图谱', '文档', '文档分析', '笔记', '网页', '写作台', '录音纪要', 'Copilot', '设置', '收集中心', '飞书同步', '深度答案', 'Skill 菜单'];
  for (const label of labels) assert.match(mainSource, new RegExp(`WorkspaceRouteFallback label=[\"']${label}[\"']`), label);
  assert.match(mainSource, /function WorkspaceRouteFallback/);
  assert.match(mainSource, /保留当前飞书知识库、文档和引用上下文/);
  assert.match(stylesSource, /\.workspace-route-loading\{/);
  assert.match(stylesSource, /\.workspace-route-loading-overlay\{/);
});
