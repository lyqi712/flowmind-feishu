import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, transformWithEsbuild } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const componentPath = resolve(appRoot, 'src/components/UnifiedWorkspace.jsx');
const cssPath = resolve(appRoot, 'src/components/UnifiedWorkspace.css');
const imaCssPath = resolve(appRoot, 'src/components/UnifiedWorkspaceIma.css');
const workspaceModulesCssPath = resolve(appRoot, 'src/components/WorkspaceModules.css');
const componentSource = readFileSync(componentPath, 'utf8');
const cssSource = readFileSync(cssPath, 'utf8');
const imaCssSource = readFileSync(imaCssPath, 'utf8');
const workspaceModulesCssSource = readFileSync(workspaceModulesCssPath, 'utf8');
let vite;
let workspaceModule;

before(async () => {
  vite = await createServer({ root: appRoot, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  workspaceModule = await vite.ssrLoadModule('/src/components/UnifiedWorkspace.jsx');
});

after(async () => { await vite?.close(); });

function renderWorkspace(overrides = {}) {
  return renderToStaticMarkup(React.createElement(workspaceModule.UnifiedWorkspace, {
    recentItems: [
      { id: 'doc-1', type: 'document', title: '季度研究资料', summary: '继续阅读市场章节', updatedAt: '10 分钟前' },
      { id: 'note-1', type: 'note', title: '产品复盘笔记', summary: '还有 3 个行动项', updatedAt: '昨天' }
    ],
    tabs: [
      { id: 'doc-1', type: 'document', title: '季度研究资料' },
      { id: 'note-1', type: 'note', title: '产品复盘笔记', dirty: true }
    ],
    tasks: [
      { id: 'queued', title: '等待解析', status: 'queued' },
      { id: 'running', title: '生成研究报告', status: 'running', progress: 64 },
      { id: 'success', title: '飞书同步完成', status: 'succeeded' },
      { id: 'failed', title: '附件导入失败', status: 'failed', message: '权限不足' }
    ],
    context: {
      currentDocument: { id: 'doc-1', title: '季度研究资料', source: '飞书文档' },
      selection: { text: '用户体验来自连续工作机制。' },
      resources: [{ id: 'note-1', title: '产品复盘笔记', type: '笔记' }]
    },
    onOpenRecent() {}, onActivateTab() {}, onCloseTab() {}, onNewTab() {}, onAsk() {}, onSearch() {},
    onCollect() {}, onCreateNote() {}, onCreateWriting() {}, onRunSkill() {}, onNavigate() {}, onOpenTask() {}, onRetryTask() {},
    onAttachContext() {}, onRemoveContext() {}, onClearSelection() {},
    ...overrides
  }));
}

function includesAll(source, fragments, label) {
  for (const fragment of fragments) assert.ok(source.includes(fragment), `${label}: missing ${fragment}`);
}

test('UnifiedWorkspace JSX 可由仓库 Vite/React 19 工具链真实编译', async () => {
  const transformed = await transformWithEsbuild(componentSource, componentPath, { loader: 'jsx', jsx: 'automatic' });
  assert.ok(transformed.code.length > 8000);
  assert.equal(typeof workspaceModule.UnifiedWorkspace, 'function');
});

test('主导航 hover/focus 只预取，点击仍保持收集与模块导航原契约', () => {
  const prefetched = [];
  const collected = [];
  const navigated = [];
  const navigation = workspaceModule.PrimaryNavigation({
    activeSection: 'home',
    onPrefetch: route => prefetched.push(route),
    onCollect: () => collected.push('collect'),
    onNavigate: route => navigated.push(route)
  });
  const buttons = React.Children.toArray(navigation.props.children);
  const byLabel = Object.fromEntries(buttons.map(button => [button.props.children[1].props.children, button]));

  byLabel['收集'].props.onPointerEnter();
  byLabel['收集'].props.onFocus();
  byLabel['知识库'].props.onPointerEnter();
  byLabel['笔记'].props.onFocus();
  byLabel['Copilot'].props.onPointerEnter();
  assert.deepEqual(prefetched, ['collect', 'collect', 'knowledge', 'notes', 'copilots']);
  assert.deepEqual(collected, []);
  assert.deepEqual(navigated, []);

  byLabel['收集'].props.onClick();
  byLabel['知识库'].props.onClick();
  byLabel['笔记'].props.onClick();
  byLabel['Copilot'].props.onClick();
  assert.deepEqual(collected, ['collect']);
  assert.deepEqual(navigated, ['knowledge', 'notes', 'copilots']);
});
test('ima 式首页只保留四个主入口、一个提问入口和紧凑最近列表', () => {
  const html = renderWorkspace();
  assert.match(html, /aria-label="主功能"/);
  for (const label of ['收集', '知识库', '笔记', 'Copilot']) assert.match(html, new RegExp(label));
  for (const label of ['解读', 'Skills', '写作', '录音']) assert.doesNotMatch(html, new RegExp(`>${label}<`));
  assert.match(html, /今天想和飞书知识一起做什么？/);
  assert.match(html, /aria-label="快速问答"/);
  assert.match(html, /搜索知识，或直接提问/);
  assert.match(html, /最近/);
  assert.match(html, /季度研究资料/);
  assert.match(html, /产品复盘笔记/);
  assert.doesNotMatch(html, /unified-workspace-task-list/);
  assert.doesNotMatch(html, /id="unified-task-title"/);
  assert.match(html, /打开全局命令框/);
});

test('持久化 Tab 条渲染首页和业务标签，并通过纯契约关闭指定标签', () => {
  const html = renderWorkspace({ activeTabId: 'doc-1', renderActiveTab: tab => React.createElement('article', null, `ACTIVE:${tab.id}`) });
  assert.match(html, /aria-label="工作标签页"/);
  assert.match(html, /data-persisted-tabs="true"/);
  assert.match(html, /role="tab"/);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /关闭 季度研究资料/);
  assert.match(html, /关闭 产品复盘笔记/);
  assert.match(html, /ACTIVE:doc-1/);

  const calls = [];
  assert.equal(workspaceModule.requestCloseWorkspaceTab({ id: 'doc-1', title: '季度研究资料' }, { onCloseTab: tab => calls.push(tab.id) }), true);
  assert.equal(workspaceModule.requestCloseWorkspaceTab({}, { onCloseTab: () => calls.push('invalid') }), false);
  assert.deepEqual(calls, ['doc-1']);
});

test('全局命令面板覆盖搜索、提问、收集、创建笔记、运行 Skill 和跳转', () => {
  const html = renderWorkspace({ defaultCommandOpen: true });
  assert.match(html, /role="dialog"/);
  assert.match(html, /全局命令框/);
  for (const command of workspaceModule.WORKSPACE_COMMANDS) {
    assert.ok(html.includes(command.label), command.id);
  }

  const calls = [];
  const callbacks = {
    onCommand: command => calls.push(['command', command.id]),
    onSearch: query => calls.push(['search', query]),
    onAsk: (query, context) => calls.push(['ask', query, context.currentDocument.id]),
    onCollect: () => calls.push(['collect']),
    onCreateNote: context => calls.push(['note', context.currentDocument.id]),
    onCreateWriting: context => calls.push(['writing', context.currentDocument.id]),
    onRunSkill: (skillId, context) => calls.push(['skill', skillId, context.currentDocument.id]),
    onNavigate: target => calls.push(['navigate', target])
  };
  const context = { currentDocument: { id: 'doc-1' } };
  assert.equal(workspaceModule.dispatchWorkspaceCommand('search', { query: '增长策略' }, callbacks), true);
  assert.equal(workspaceModule.dispatchWorkspaceCommand('ask', { query: '总结结论', context }, callbacks), true);
  assert.equal(workspaceModule.dispatchWorkspaceCommand('collect', {}, callbacks), true);
  assert.equal(workspaceModule.dispatchWorkspaceCommand('note', { context }, callbacks), true);
  assert.equal(workspaceModule.dispatchWorkspaceCommand('writing', { context }, callbacks), true);
  assert.equal(workspaceModule.dispatchWorkspaceCommand({ id: 'skill', payload: { skillId: 'research-report' } }, { context }, callbacks), true);
  assert.equal(workspaceModule.dispatchWorkspaceCommand({ id: 'navigate', payload: { target: 'notes' } }, {}, callbacks), true);
  assert.equal(workspaceModule.dispatchWorkspaceCommand('search', { query: '  ' }, callbacks), false);
  assert.equal(calls.filter(row => row[0] === 'command').length, 7);
  assert.deepEqual(calls.filter(row => row[0] !== 'command'), [
    ['search', '增长策略'],
    ['ask', '总结结论', 'doc-1'],
    ['collect'],
    ['note', 'doc-1'],
    ['writing', 'doc-1'],
    ['skill', 'research-report', 'doc-1'],
    ['navigate', 'notes']
  ]);
});

test('Context 默认关闭且材料变化不抢占主区，用户可主动打开浮层', () => {
  const html = renderWorkspace();
  assert.match(html, /aria-label="AI 上下文面板"/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /class="unified-workspace has-context"/);
  assert.match(html, /基于当前材料/);
  assert.match(html, /季度研究资料/);
  assert.match(html, /当前选区/);
  assert.match(html, /用户体验来自连续工作机制。/);
  assert.match(html, /产品复盘笔记/);
  assert.match(html, /附加材料/);
  assert.match(html, /基于这些材料提问/);
  assert.match(html, /3 项材料/);
  assert.match(html, /aria-label="切换 AI 上下文面板"/);
  assert.match(html, /<i>3<\/i>/);
  includesAll(componentSource, [
    'defaultContextOpen = false',
    'const contextKey = useMemo(() => contextIdentity(contextValue)',
    'if (!contextKey) setContextOpen(false)',
    'setContextOpen(value => !value)'
  ], 'context opt-in contract');
  assert.doesNotMatch(componentSource, /contextKey !== previousContextKey|setContextOpen\(true\)/);
  includesAll(imaCssSource, [
    '.unified-workspace-layout,.unified-workspace.has-context .unified-workspace-layout{position:relative;',
    '.unified-workspace-context{position:absolute;',
    'inset:0 0 0 auto;',
    'transform:translateX(100%)',
    'transform:translateX(0)'
  ], 'context overlay contract');
  const opened = renderWorkspace({ defaultContextOpen: true });
  assert.match(opened, /class="unified-workspace has-context"/);
  assert.match(opened, /aria-hidden="false"/);
});
test('后台任务降为单条低干扰状态，失败优先且保留原位重试', () => {
  const html = renderWorkspace();
  assert.match(html, /class="unified-workspace-activity is-failed"/);
  assert.match(html, /data-task-status="failed"/);
  assert.match(html, /附件导入失败/);
  assert.match(html, /aria-label="重试 附件导入失败"/);
  assert.doesNotMatch(html, /unified-workspace-task-list/);
  assert.equal(workspaceModule.normalizeTaskStatus('pending'), 'queued');
  assert.equal(workspaceModule.normalizeTaskStatus('processing'), 'running');
  assert.equal(workspaceModule.normalizeTaskStatus('completed'), 'succeeded');
  assert.equal(workspaceModule.normalizeTaskStatus('error'), 'failed');

  const retried = [];
  assert.equal(workspaceModule.retryWorkspaceTask({ id: 'failed', status: 'failed' }, { onRetryTask: task => retried.push(task.id) }), true);
  assert.equal(workspaceModule.retryWorkspaceTask({ id: 'running', status: 'running' }, { onRetryTask: task => retried.push(task.id) }), false);
  assert.deepEqual(retried, ['failed']);
});

test('紧凑模式保留在更多菜单，不再占据一级导航', () => {
  const html = renderWorkspace({ compact: true });
  assert.match(html, /class="unified-workspace is-compact"/);
  assert.match(html, /data-density="compact"/);
  assert.match(html, /aria-label="更多"/);
  assert.doesNotMatch(html, /aria-label="切换紧凑模式"/);
  includesAll(componentSource, ['onToggleCompact?.(!compact)', "onNavigate?.('settings')"], 'secondary menu contract');
});

test('键盘快捷键支持 Ctrl/Cmd+K、Ctrl/Cmd+Shift+A 与 Escape', () => {
  assert.equal(workspaceModule.isWorkspaceCommandShortcut({ ctrlKey: true, key: 'k' }), true);
  assert.equal(workspaceModule.isWorkspaceCommandShortcut({ metaKey: true, key: 'K' }), true);
  assert.equal(workspaceModule.isWorkspaceCommandShortcut({ ctrlKey: true, shiftKey: true, key: 'k' }), false);
  assert.equal(workspaceModule.isWorkspaceContextShortcut({ ctrlKey: true, shiftKey: true, key: 'a' }), true);
  assert.equal(workspaceModule.isWorkspaceContextShortcut({ metaKey: true, shiftKey: true, key: 'A' }), true);
  assert.equal(workspaceModule.shouldCloseWorkspaceOverlay({ key: 'Escape' }), true);
  includesAll(componentSource, [
    "window.addEventListener('keydown', onKeyDown)",
    "window.removeEventListener('keydown', onKeyDown)",
    'event.preventDefault()',
    'setCommandOpen(value => !value)',
    'setContextOpen(value => !value)',
    'setCommandOpen(false)'
  ], 'keyboard contract');
});

test('IMA 桌面骨架与 390px 窄屏布局保持统一且无横向溢出', () => {
  includesAll(imaCssSource, [
    'grid-template-columns:240px minmax(0,1fr)',
    '.unified-workspace-new-chat{width:216px',
    'margin:8px 8px 8px 0',
    'background:#f7f7f7',
    'grid-template-columns:repeat(4,minmax(0,1fr))',
    '@media(max-width:390px)',
    '.unified-workspace{width:100%;max-width:100%;overflow-x:hidden}',
    '.unified-workspace-tabs{max-width:calc(100vw - 78px)}',
    '.unified-workspace-context,.unified-workspace-context.is-open{width:100%;max-width:100%}',
    '.unified-workspace-command-palette{width:100%}',
    '.unified-workspace-recent-row{grid-template-columns:36px minmax(0,1fr)}'
  ], 'ima responsive layout contract');
});
test('组件只通过 props/callbacks 集成，不直接耦合 main、API 或存储实现', () => {
  assert.doesNotMatch(componentSource, /fetch\s*\(/);
  assert.doesNotMatch(componentSource, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(componentSource, /main\.jsx/);
  includesAll(componentSource, [
    'onOpenRecent?.(item)',
    'onActivateTab?.(tab)',
    'onCloseTab?.(tab)',
    'onSearch?.(query)',
    'onAsk?.(query, context)',
    'onCollect?.()',
    'onCreateNote?.(context)',
    'onCreateWriting?.(context)',
    'onRunSkill?.(',
    'onNavigate?.(',
    'onRetryTask?.(task)'
  ], 'callback-only integration');
});

test('IMA desktop modules keep a horizontal wide-workspace contract', () => {
  includesAll(imaCssSource, [
    '.unified-workspace .unified-workspace-home-actions{',
    'flex-direction:row;flex-wrap:nowrap',
    'width:auto!important;min-width:max-content',
    'white-space:nowrap;writing-mode:horizontal-tb',
    '@media (min-width:901px){',
    '.app-shell.app-shell-v3 .workspace-tab-frame{grid-template-columns:216px minmax(0,1fr)}',
    '.app-shell.app-shell-v3 .note-workspace-grid{grid-template-columns:minmax(0,1fr) minmax(220px,240px)}',
    '.app-shell.app-shell-v3 .note-editor-canvas{padding:28px clamp(32px,4vw,56px)}',
    '.app-shell.app-shell-v3 .writing-layout{grid-template-columns:minmax(0,1fr) minmax(220px,240px)}',
    '.app-shell.app-shell-v3 .copilot-canvas{grid-template-columns:minmax(0,1fr) minmax(240px,280px)',
    '.app-shell.app-shell-v3 .reader-layout{grid-template-columns:minmax(0,1fr) minmax(260px,300px)}'
  ], 'desktop horizontal workspace contract');
  includesAll(workspaceModulesCssSource, [
    '.note-workspace-grid{display:grid;grid-template-columns:minmax(0,1fr) 280px',
    '.writing-layout{display:grid;grid-template-columns:minmax(0,1fr) 270px',
    '.reader-layout{display:grid;grid-template-columns:minmax(0,1fr) 360px'
  ], 'base auxiliary panel contracts remain explicit');
});
