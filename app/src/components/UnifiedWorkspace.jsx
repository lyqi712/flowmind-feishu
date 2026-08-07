import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  FilePenLine,
  FileText,
  Inbox,
  LayoutDashboard,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Plus,
  Quote,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  StickyNote,
  WandSparkles,
  X,
  Zap
} from 'lucide-react';
import './UnifiedWorkspace.css';

export const WORKSPACE_COMMANDS = Object.freeze([
  { id: 'search', label: '搜索全部知识', description: '查找文档、笔记、标签与历史对话', keywords: '搜索 查找 文档 笔记 标签', Icon: Search },
  { id: 'ask', label: '向 AI 提问', description: '使用当前上下文开始一次带引用的问答', keywords: '提问 问答 ai 对话', Icon: MessageCircle },
  { id: 'collect', label: '收集新内容', description: '粘贴飞书链接、导入文件或快速保存文本', keywords: '收集 导入 飞书 文件 链接', Icon: Inbox },
  { id: 'note', label: '创建笔记', description: '基于当前材料创建一篇来源笔记', keywords: '新建 创建 笔记 markdown', Icon: StickyNote },
  { id: 'writing', label: '\u521b\u5efa\u5199\u4f5c\u8349\u7a3f', description: '\u628a\u5f53\u524d\u6587\u6863\u3001\u9009\u533a\u548c\u6750\u6599\u5e26\u5165\u5199\u4f5c\u53f0', keywords: '\u65b0\u5efa \u521b\u5efa \u5199\u4f5c \u8349\u7a3f \u6587\u7ae0', Icon: FilePenLine },
  { id: 'skill', label: '运行 Skill', description: '启动深度总结、跨文档对比或研究报告', keywords: 'skill 技能 总结 对比 报告', Icon: WandSparkles, payload: { skillId: 'deep-summary' } },
  { id: 'navigate', label: '跳转到知识库', description: '浏览全部文档、收藏、标签和保存视图', keywords: '跳转 打开 知识库 文档', Icon: BookOpen, payload: { target: 'knowledge' } }
]);

export const PRIMARY_NAV_ITEMS = Object.freeze([
  { id: 'collect', label: '收集', Icon: Inbox },
  { id: 'knowledge', label: '知识库', Icon: BookOpen },
  { id: 'notes', label: '笔记', Icon: StickyNote },
  { id: 'copilots', label: 'Copilot', Icon: WandSparkles }
]);

export const TASK_STATUS_META = Object.freeze({
  queued: { label: '排队中', Icon: Clock3 },
  running: { label: '进行中', Icon: LoaderCircle },
  succeeded: { label: '已完成', Icon: CheckCircle2 },
  failed: { label: '失败', Icon: AlertCircle }
});

const TAB_TYPE_ICONS = Object.freeze({
  document: FileText,
  note: StickyNote,
  chat: MessageCircle,
  skill: WandSparkles,
  home: LayoutDashboard
});

export function normalizeWorkspaceTabs(tabs = []) {
  const seen = new Set();
  return (Array.isArray(tabs) ? tabs : []).filter(tab => {
    const id = String(tab?.id || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map(tab => ({
    ...tab,
    id: String(tab.id),
    title: String(tab.title || '未命名'),
    type: String(tab.type || 'document')
  }));
}

export function normalizeTaskStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['waiting', 'pending', 'queue', 'queued'].includes(value)) return 'queued';
  if (['processing', 'loading', 'active', 'running'].includes(value)) return 'running';
  if (['success', 'complete', 'completed', 'done', 'succeeded'].includes(value)) return 'succeeded';
  if (['error', 'failure', 'failed'].includes(value)) return 'failed';
  return 'queued';
}

export function isWorkspaceCommandShortcut(event = {}) {
  return Boolean((event.ctrlKey || event.metaKey) && !event.shiftKey && String(event.key || '').toLowerCase() === 'k');
}

export function isWorkspaceContextShortcut(event = {}) {
  return Boolean((event.ctrlKey || event.metaKey) && event.shiftKey && String(event.key || '').toLowerCase() === 'a');
}

export function shouldCloseWorkspaceOverlay(event = {}) {
  return String(event.key || '') === 'Escape';
}

export function dispatchWorkspaceCommand(command, payload = {}, callbacks = {}) {
  const commandId = typeof command === 'string' ? command : command?.id;
  if (!commandId) return false;
  const mergedPayload = { ...(typeof command === 'object' ? command.payload : {}), ...payload };
  const query = String(mergedPayload.query || '').trim();
  const context = mergedPayload.context || {};

  if (['search', 'ask'].includes(commandId) && !query) return false;
  callbacks.onCommand?.({ id: commandId, ...mergedPayload, query, context });
  switch (commandId) {
    case 'search': callbacks.onSearch?.(query); return true;
    case 'ask': callbacks.onAsk?.(query, context); return true;
    case 'collect': callbacks.onCollect?.(); return true;
    case 'note': callbacks.onCreateNote?.(context); return true;
    case 'writing': callbacks.onCreateWriting?.(context); return true;
    case 'skill': callbacks.onRunSkill?.(mergedPayload.skillId || 'deep-summary', context); return true;
    case 'navigate': callbacks.onNavigate?.(mergedPayload.target || 'knowledge'); return true;
    default: return false;
  }
}

export function requestCloseWorkspaceTab(tab, callbacks = {}) {
  if (!tab?.id) return false;
  callbacks.onCloseTab?.(tab);
  return true;
}

export function retryWorkspaceTask(task, callbacks = {}) {
  if (!task?.id || normalizeTaskStatus(task.status) !== 'failed') return false;
  callbacks.onRetryTask?.(task);
  return true;
}

function joinClassNames(...values) {
  return values.filter(Boolean).join(' ');
}

function formatTime(value) {
  if (!value) return '刚刚';
  if (typeof value === 'string' && !/^\d{4}-\d{2}/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function contextSnapshot(context = {}) {
  const currentDocument = context.currentDocument || context.document || null;
  const selection = typeof context.selection === 'string' ? { id: 'selection', text: context.selection } : context.selection;
  const resources = context.resources || context.attachments || [];
  return { currentDocument, selection, resources: Array.isArray(resources) ? resources : [] };
}

function contextIdentity(snapshot) {
  const documentId = snapshot.currentDocument?.id || snapshot.currentDocument?.documentId || snapshot.currentDocument?.title || '';
  const selectionId = snapshot.selection?.id || snapshot.selection?.anchor || snapshot.selection?.text || snapshot.selection?.content || '';
  const resourceIds = snapshot.resources.map(item => item?.id || item?.sourceId || item?.title || item?.name || '').filter(Boolean).join('|');
  return [documentId, selectionId, resourceIds].filter(Boolean).join('::');
}

function EmptyRecent({ onCollect }) {
  return (
    <div className="unified-workspace-empty">
      <span><Inbox size={19} aria-hidden="true" /></span>
      <div><b>把第一份资料放进来</b><p>粘贴飞书链接、拖入文件，或保存一段文字。</p></div>
      <button type="button" onClick={onCollect}><Plus size={14} aria-hidden="true" />收集</button>
    </div>
  );
}

function RecentWork({ items, onOpenRecent, onCollect }) {
  const visibleItems = items.slice(0, 5);
  return (
    <section className="unified-workspace-recent" aria-labelledby="unified-recent-title">
      <div className="unified-workspace-section-heading">
        <h2 id="unified-recent-title">最近</h2>
        <button type="button" onClick={() => onOpenRecent?.({ id: 'recent', type: 'view' })}>全部<ChevronRight size={14} aria-hidden="true" /></button>
      </div>
      {visibleItems.length === 0 ? <EmptyRecent onCollect={onCollect} /> : (
        <div className="unified-workspace-recent-list">
          {visibleItems.map((item, index) => {
            const Icon = TAB_TYPE_ICONS[item.type] || FileText;
            return (
              <button type="button" className="unified-workspace-recent-row" key={item.id || `${item.title}-${index}`} onClick={() => onOpenRecent?.(item)}>
                <span className="unified-workspace-recent-icon"><Icon size={17} aria-hidden="true" /></span>
                <span className="unified-workspace-recent-copy"><b>{item.title || '未命名内容'}</b><small>{item.summary || item.description || '继续上次的工作'}</small></span>
                <time>{formatTime(item.updatedAt || item.time)}</time>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function QuickAsk({ context, onAsk, onCollect, onOpenLibrary }) {
  const [question, setQuestion] = useState('');
  const snapshot = contextSnapshot(context);
  const contextCount = snapshot.resources.length + (snapshot.currentDocument ? 1 : 0) + (snapshot.selection ? 1 : 0);
  function submit(event) {
    event.preventDefault();
    const normalized = question.trim();
    if (!normalized) return;
    onAsk?.(normalized, context);
    setQuestion('');
  }
  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit(event);
    }
  }
  return (
    <section className="unified-workspace-hero" aria-labelledby="unified-home-title">
      <div className="unified-workspace-hero-brand"><span><Sparkles size={18} aria-hidden="true" /></span><b>FlowMind</b><small>飞书 AI 工作台</small></div>
      <h1 id="unified-home-title">今天想和飞书知识一起做什么？</h1>
      <p>搜索资料、追问引用、整理笔记或直接生成下一份工作成果。</p>
      <form className="unified-workspace-ask" onSubmit={submit}>
        <textarea rows="2" value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={handleKeyDown} placeholder="搜索知识，或直接提问" aria-label="快速问答" />
        <footer>
          <div className="unified-workspace-home-actions">
            <button type="button" onClick={onCollect}><Plus size={14} aria-hidden="true" />添加资料</button>
            <button type="button" onClick={onOpenLibrary}><BookOpen size={14} aria-hidden="true" />选择知识库</button>
            <span>{contextCount ? `已带入 ${contextCount} 项上下文` : '基于已同步的飞书知识回答'}</span>
          </div>
          <button className="unified-workspace-ask-send" type="submit" disabled={!question.trim()} aria-label="发送问题"><ArrowRight size={18} aria-hidden="true" /></button>
        </footer>
      </form>
    </section>
  );
}
function TabStrip({ tabs, activeTabId, onActivateTab, onCloseTab, onNewTab }) {
  return (
    <div className="unified-workspace-tabs" role="tablist" aria-label="工作标签页" data-persisted-tabs="true">
      <button type="button" role="tab" aria-selected={!activeTabId} className={joinClassNames('unified-workspace-tab', !activeTabId && 'is-active')} onClick={() => onActivateTab?.(null)}>
        <LayoutDashboard size={14} aria-hidden="true" /><span>首页</span>
      </button>
      {tabs.map(tab => {
        const Icon = TAB_TYPE_ICONS[tab.type] || FileText;
        const active = activeTabId === tab.id;
        return (
          <div className={joinClassNames('unified-workspace-tab', active && 'is-active')} role="presentation" key={tab.id}>
            <button type="button" role="tab" aria-selected={active} title={tab.title} onClick={() => onActivateTab?.(tab)}>
              <Icon size={14} aria-hidden="true" /><span>{tab.title}</span>{tab.dirty && <i aria-label="有未保存更改" />}
            </button>
            {tab.closable !== false && <button type="button" className="unified-workspace-tab-close" aria-label={`关闭 ${tab.title}`} onClick={event => { event.stopPropagation(); requestCloseWorkspaceTab(tab, { onCloseTab }); }}><X size={12} aria-hidden="true" /></button>}
          </div>
        );
      })}
      <button type="button" className="unified-workspace-new-tab" aria-label="新建工作标签页" onClick={onNewTab}><Plus size={14} aria-hidden="true" /></button>
    </div>
  );
}

function ContextChip({ kind, title, detail, onRemove }) {
  const Icon = kind === 'selection' ? Quote : kind === 'resource' ? Paperclip : FileText;
  return (
    <div className={`unified-workspace-context-chip is-${kind}`}>
      <Icon size={14} aria-hidden="true" />
      <span><b>{title}</b>{detail && <small>{detail}</small>}</span>
      {onRemove && <button type="button" aria-label={`移除 ${title}`} onClick={onRemove}><X size={12} aria-hidden="true" /></button>}
    </div>
  );
}

function AIContextPanel({ open, context, onClose, onRemoveContext, onClearSelection, onAttachContext, onCreateNote, onCreateWriting, onAsk }) {
  const snapshot = contextSnapshot(context);
  const [question, setQuestion] = useState('');
  const hasContext = snapshot.currentDocument || snapshot.selection || snapshot.resources.length > 0;
  function submit(event) {
    event.preventDefault();
    const value = question.trim();
    if (!value) return;
    onAsk?.(value, snapshot);
    setQuestion('');
  }
  return (
    <aside className={joinClassNames('unified-workspace-context', open && 'is-open')} aria-label="AI 上下文面板" aria-hidden={!open}>
      <header><div><span><Sparkles size={14} aria-hidden="true" />上下文</span><h2>基于当前材料</h2></div><button type="button" onClick={onClose} aria-label="关闭 AI 上下文面板"><PanelRightClose size={17} aria-hidden="true" /></button></header>
      <div className="unified-workspace-context-body">
        {!hasContext && <div className="unified-workspace-context-empty"><Circle size={18} aria-hidden="true" /><b>还没有材料</b><p>打开文档、选择文字，或附加资料后会自动出现在这里。</p></div>}
        {snapshot.currentDocument && <ContextChip kind="document" title={snapshot.currentDocument.title || '当前文档'} detail={snapshot.currentDocument.source || snapshot.currentDocument.type} onRemove={() => onRemoveContext?.(snapshot.currentDocument)} />}
        {snapshot.selection && <ContextChip kind="selection" title="当前选区" detail={snapshot.selection.text || snapshot.selection.content || ''} onRemove={() => onClearSelection?.()} />}
        {snapshot.resources.map((resource, index) => <ContextChip key={resource.id || index} kind="resource" title={resource.title || resource.name || '附加资料'} detail={resource.type || resource.source} onRemove={resource.removable === false ? undefined : () => onRemoveContext?.(resource)} />)}
        <button type="button" className="unified-workspace-add-context" onClick={onAttachContext}><Plus size={14} aria-hidden="true" />附加材料</button>
        <div className="unified-workspace-context-artifacts"><button type="button" disabled={!hasContext} onClick={() => onCreateNote?.(snapshot)}><StickyNote size={14} aria-hidden="true" />{'\u521b\u5efa\u7b14\u8bb0'}</button><button type="button" disabled={!hasContext} onClick={() => onCreateWriting?.(snapshot)}><FilePenLine size={14} aria-hidden="true" />{'\u521b\u5efa\u5199\u4f5c\u8349\u7a3f'}</button></div>
      </div>
      <form className="unified-workspace-context-composer" onSubmit={submit}>
        <textarea value={question} onChange={event => setQuestion(event.target.value)} placeholder="基于这些材料提问…" aria-label="基于上下文提问" rows={3} />
        <div><small>{snapshot.resources.length + (snapshot.currentDocument ? 1 : 0) + (snapshot.selection ? 1 : 0)} 项材料</small><button type="submit" disabled={!question.trim()}><Sparkles size={14} aria-hidden="true" />提问</button></div>
      </form>
    </aside>
  );
}

function BackgroundActivity({ tasks, onRetryTask, onOpenTask }) {
  const normalized = tasks.map(task => ({ ...task, normalizedStatus: normalizeTaskStatus(task.status) }));
  const task = normalized.find(item => item.normalizedStatus === 'failed') || normalized.find(item => item.normalizedStatus === 'running') || normalized.find(item => item.normalizedStatus === 'queued');
  if (!task) return null;
  const meta = TASK_STATUS_META[task.normalizedStatus];
  const Icon = meta.Icon;
  const progress = Math.max(0, Math.min(100, Number(task.progress || 0)));
  return (
    <div className={`unified-workspace-activity is-${task.normalizedStatus}`} data-task-status={task.normalizedStatus}>
      <button type="button" onClick={() => onOpenTask?.(task)} aria-label={`查看后台任务：${task.title || meta.label}`}>
        <Icon size={14} className={task.normalizedStatus === 'running' ? 'is-spinning' : ''} aria-hidden="true" />
        <span>{task.title || '后台任务'}</span><small>{task.normalizedStatus === 'running' && progress ? `${progress}%` : meta.label}</small>
      </button>
      {task.normalizedStatus === 'failed' && <button type="button" className="unified-workspace-activity-retry" onClick={() => retryWorkspaceTask(task, { onRetryTask })} aria-label={`重试 ${task.title || '后台任务'}`}><RotateCcw size={13} aria-hidden="true" /></button>}
    </div>
  );
}

export function PrimaryNavigation({ activeSection, onCollect, onNavigate, onPrefetch }) {
  return (
    <nav className="unified-workspace-primary-nav" aria-label="主功能">
      {PRIMARY_NAV_ITEMS.map(({ id, label, Icon }) => {
        const active = activeSection === id;
        return <button type="button" key={id} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} onPointerEnter={() => onPrefetch?.(id)} onFocus={() => onPrefetch?.(id)} onClick={() => id === 'collect' ? onCollect?.() : onNavigate?.(id)}><Icon size={15} aria-hidden="true" /><span>{label}</span></button>;
      })}
    </nav>
  );
}

function CommandPalette({ open, query, setQuery, context, onClose, callbacks }) {
  const paletteTitleId = useId();
  const inputRef = useRef(null);
  const normalizedQuery = query.trim().toLowerCase();
  const commands = useMemo(() => WORKSPACE_COMMANDS.filter(command => {
    if (!normalizedQuery) return true;
    return `${command.label} ${command.description} ${command.keywords}`.toLowerCase().includes(normalizedQuery) || ['search', 'ask'].includes(command.id);
  }), [normalizedQuery]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;
  function run(command) {
    const succeeded = dispatchWorkspaceCommand(command, { query, context }, callbacks);
    if (succeeded || !['search', 'ask'].includes(command.id)) onClose?.();
  }
  function submit(event) {
    event.preventDefault();
    run(WORKSPACE_COMMANDS.find(command => command.id === 'search'));
  }
  return (
    <div className="unified-workspace-command-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}>
      <section className="unified-workspace-command-palette" role="dialog" aria-modal="true" aria-labelledby={paletteTitleId}>
        <h2 id={paletteTitleId}>全局命令框</h2>
        <form onSubmit={submit} className="unified-workspace-command-input"><Search size={18} aria-hidden="true" /><input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索、提问或输入命令" aria-label="全局命令" /><kbd>ESC</kbd></form>
        <div className="unified-workspace-command-results" role="listbox" aria-label="可用命令">
          {commands.map(command => {
            const Icon = command.Icon;
            const requiresText = ['search', 'ask'].includes(command.id);
            return <button type="button" role="option" aria-selected="false" key={command.id} disabled={requiresText && !query.trim()} onClick={() => run(command)}><span><Icon size={17} aria-hidden="true" /></span><span><b>{command.label}</b><small>{command.description}</small></span><ChevronRight size={15} aria-hidden="true" /></button>;
          })}
        </div>
        <footer><span><kbd>↵</kbd>执行</span><span><kbd>Ctrl K</kbd>打开</span><span>上下文会随任务继续</span></footer>
      </section>
    </div>
  );
}

export function UnifiedWorkspace({
  className = '',
  compact = false,
  activeSection = 'home',
  recentItems = [],
  tabs = [],
  activeTabId = null,
  tasks = [],
  context = {},
  defaultCommandOpen = false,
  defaultContextOpen = false,
  children,
  renderActiveTab,
  onOpenRecent,
  onActivateTab,
  onCloseTab,
  onNewTab,
  onSearch,
  onAsk,
  onCollect,
  onCreateNote,
  onCreateWriting,
  onRunSkill,
  onNavigate,
  onPrefetch,
  onCommand,
  onOpenTask,
  onRetryTask,
  onAttachContext,
  onRemoveContext,
  onClearSelection,
  onToggleCompact
}) {
  const normalizedTabs = useMemo(() => normalizeWorkspaceTabs(tabs), [tabs]);
  const activeTab = normalizedTabs.find(tab => tab.id === activeTabId) || null;
  const contextValue = useMemo(() => contextSnapshot(context), [context]);
  const contextKey = useMemo(() => contextIdentity(contextValue), [contextValue]);
  const previousContextKey = useRef('');
  const [commandOpen, setCommandOpen] = useState(defaultCommandOpen);
  const [commandQuery, setCommandQuery] = useState('');
  const [contextOpen, setContextOpen] = useState(defaultContextOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const callbacks = { onCommand, onSearch, onAsk, onCollect, onCreateNote, onCreateWriting, onRunSkill, onNavigate };

  useEffect(() => {
    if (!contextKey) setContextOpen(false);
  }, [contextKey]);

  useEffect(() => {
    function onKeyDown(event) {
      if (isWorkspaceCommandShortcut(event)) {
        event.preventDefault();
        setCommandOpen(value => !value);
        setMenuOpen(false);
        return;
      }
      if (isWorkspaceContextShortcut(event)) {
        event.preventDefault();
        setContextOpen(value => !value);
        return;
      }
      if (shouldCloseWorkspaceOverlay(event)) {
        setCommandOpen(false);
        setMenuOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const activeContent = activeTab ? (renderActiveTab?.(activeTab) ?? children) : null;
  const contextCount = contextValue.resources.length + (contextValue.currentDocument ? 1 : 0) + (contextValue.selection ? 1 : 0);

  return (
    <div className={joinClassNames('unified-workspace', compact && 'is-compact', contextOpen && 'has-context', className)} data-density={compact ? 'compact' : 'comfortable'}>
      <aside className="unified-workspace-topbar" aria-label="工作台侧边栏">
        <button type="button" className="unified-workspace-brand" onClick={() => onActivateTab?.(null)} aria-label="返回工作台首页"><span><Zap size={17} aria-hidden="true" /></span><b>FlowMind</b><small>飞书 AI 工作台</small></button>
        <button type="button" className={joinClassNames('unified-workspace-new-chat', activeSection === 'home' && 'is-active')} onClick={onNewTab}><Plus size={17} aria-hidden="true" /><span><b>新对话</b><small>开始新的知识任务</small></span></button>
        <PrimaryNavigation activeSection={activeSection} onCollect={onCollect} onNavigate={onNavigate} onPrefetch={onPrefetch} />
        <button type="button" className="unified-workspace-global-search" onClick={() => setCommandOpen(true)} aria-label="打开全局命令框"><Search size={16} aria-hidden="true" /><span>搜索全部内容</span><kbd>Ctrl K</kbd></button>
        <div className="unified-workspace-sidebar-footer"><span>本地工作空间</span><small>飞书资料、笔记和引用持续连接</small></div>
      </aside>

      <section className="unified-workspace-stage">
        <header className="unified-workspace-stage-header">
          <TabStrip tabs={normalizedTabs} activeTabId={activeTab?.id || null} onActivateTab={onActivateTab} onCloseTab={onCloseTab} onNewTab={onNewTab} />
          <div className="unified-workspace-top-actions">
            <button type="button" className={contextOpen ? 'is-active' : ''} onClick={() => setContextOpen(value => !value)} aria-pressed={contextOpen} aria-label="切换 AI 上下文面板"><PanelRightOpen size={17} aria-hidden="true" />{contextCount > 0 && <i>{contextCount}</i>}</button>
            <div className="unified-workspace-more">
              <button type="button" onClick={() => setMenuOpen(value => !value)} aria-expanded={menuOpen} aria-label="更多"><MoreHorizontal size={17} aria-hidden="true" /></button>
              {menuOpen && <div className="unified-workspace-more-menu" role="menu"><button type="button" role="menuitem" onClick={() => { onToggleCompact?.(!compact); setMenuOpen(false); }}><MoreHorizontal size={15} aria-hidden="true" />{compact ? '舒适密度' : '紧凑密度'}</button><button type="button" role="menuitem" onPointerEnter={() => onPrefetch?.('settings')} onFocus={() => onPrefetch?.('settings')} onClick={() => { onNavigate?.('settings'); setMenuOpen(false); }}><Settings size={15} aria-hidden="true" />设置</button></div>}
            </div>
          </div>
        </header>

        <div className="unified-workspace-layout">
          <main className="unified-workspace-main">
            {activeTab ? (
              <section key={activeTab.id} className="unified-workspace-active" aria-label={`${activeTab.title} 工作区`}>
                {activeContent || <div className="unified-workspace-active-placeholder"><BookOpen size={24} aria-hidden="true" /><h1>{activeTab.title}</h1><p>此标签页已恢复，等待载入内容。</p></div>}
              </section>
            ) : (
              <div className="unified-workspace-home">
                <QuickAsk context={contextValue} onAsk={onAsk} onCollect={onCollect} onOpenLibrary={() => onNavigate?.('knowledge')} />
                <RecentWork items={recentItems} onOpenRecent={onOpenRecent} onCollect={onCollect} />
              </div>
            )}
          </main>
          <AIContextPanel open={contextOpen} context={contextValue} onClose={() => setContextOpen(false)} onRemoveContext={onRemoveContext} onClearSelection={onClearSelection} onAttachContext={onAttachContext} onCreateNote={onCreateNote} onCreateWriting={onCreateWriting} onAsk={onAsk} />
          <BackgroundActivity tasks={tasks} onRetryTask={onRetryTask} onOpenTask={onOpenTask} />
        </div>
      </section>

      <CommandPalette open={commandOpen} query={commandQuery} setQuery={setCommandQuery} context={contextValue} onClose={() => setCommandOpen(false)} callbacks={callbacks} />
    </div>
  );
}

export default UnifiedWorkspace;
