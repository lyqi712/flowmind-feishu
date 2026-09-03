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
  House,
  Globe,
  LoaderCircle,
  ListChecks,
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
import './UnifiedWorkspaceClean.css';
import { humanizeSourceLabel, searchResultTitle, searchResultType } from '../workspace/display-text.js';
import { searchExcerptPreview } from '../workspace/note-capture.js';

export const WORKSPACE_COMMANDS = Object.freeze([
  { id: 'search', label: '搜索全部知识', description: '查找文档、笔记、标签与历史对话', keywords: '搜索 查找 文档 笔记 标签', Icon: Search },
  { id: 'ask', label: '向 AI 提问', description: '使用当前上下文开始一次带引用的问答', keywords: '提问 问答 ai 对话', Icon: MessageCircle },
  { id: 'collect', label: '收集新内容', description: '粘贴飞书链接、导入文件或快速保存文本', keywords: '收集 导入 飞书 文件 链接', Icon: Inbox },
  { id: 'analysis', label: '文档解读', description: '导入并解读文档、图片、音频和 Office 文件', keywords: '解读 分析 文档 图片 音频 翻译 导出', Icon: FileText, payload: { target: 'analysis' } },
  { id: 'note', label: '创建笔记', description: '基于当前材料创建一篇来源笔记', keywords: '新建 创建 笔记 markdown', Icon: StickyNote },
  { id: 'problem-note', label: '新建问题记录', description: '只记下这次容易忘的点，而不是整篇答案', keywords: '问题 记录 教训 例外 踩坑', Icon: ListChecks },
  { id: 'browse', label: '打开网页', description: '在工作台内嵌打开网页，看完剪进问题记录', keywords: '浏览器 网页 剪藏 url', Icon: Globe },
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
  paused: { label: '可继续', Icon: RotateCcw },
  succeeded: { label: '已完成', Icon: CheckCircle2 },
  failed: { label: '失败', Icon: AlertCircle }
});

const TAB_TYPE_ICONS = Object.freeze({
  document: FileText,
  note: StickyNote,
  web: Globe,
  chat: MessageCircle,
  skill: WandSparkles,
  home: House,
  task: Clock3,
  writing: FilePenLine,
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
  if (['paused', 'recoverable', 'interrupted'].includes(value)) return 'paused';
  if (['success', 'complete', 'completed', 'done', 'succeeded'].includes(value)) return 'succeeded';
  if (['error', 'failure', 'failed'].includes(value)) return 'failed';
  return 'queued';
}

export function isWorkspaceCommandShortcut(event = {}) {
  return Boolean((event.ctrlKey || event.metaKey) && !event.shiftKey && String(event.key || '').toLowerCase() === 'k');
}

export function isComposerFocused() {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  return Boolean(active?.closest?.('.composer'));
}

export function isWorkspaceContextShortcut(event = {}) {
  return Boolean((event.ctrlKey || event.metaKey) && event.shiftKey && String(event.key || '').toLowerCase() === 'a');
}

export function shouldCloseWorkspaceOverlay(event = {}) {
  return String(event.key || '') === 'Escape';
}

export function homeComposerIntent(text = '') {
  const value = String(text || '').trim();
  if (!value) return 'empty';
  return 'ask';
}

export function compactSearchLabel(query = '', limit = 14) {
  const value = String(query || '').replace(/\s+/g, ' ').trim();
  if (!value) return '搜索结果';
  const max = Math.max(4, Number(limit) || 14);
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function shouldShowReturnSearch(search = {}, activeTabId = null) {
  if (search?.open) return false;
  if (!String(search?.query || '').trim()) return false;
  if (!Array.isArray(search?.results) || search.results.length === 0) return false;
  const origin = String(search?.originTabId || '').trim();
  const active = String(activeTabId || '').trim();
  return Boolean(origin && active && origin === active);
}

export function commandPaletteIndex(currentIndex, count, key) {
  const total = Math.max(0, Number(count) || 0);
  if (!total) return -1;
  const current = Math.max(0, Math.min(total - 1, Number(currentIndex) || 0));
  if (key === 'ArrowDown') return (current + 1) % total;
  if (key === 'ArrowUp') return (current - 1 + total) % total;
  if (key === 'Home') return 0;
  if (key === 'End') return total - 1;
  return current;
}

export function workspaceTabIndex(currentIndex, count, key) {
  const total = Math.max(0, Number(count) || 0);
  if (!total) return -1;
  const current = Math.max(0, Math.min(total - 1, Number(currentIndex) || 0));
  if (key === 'ArrowRight') return (current + 1) % total;
  if (key === 'ArrowLeft') return (current - 1 + total) % total;
  if (key === 'Home') return 0;
  if (key === 'End') return total - 1;
  return current;
}

function workspaceTabId(value) {
  return `workspace-tab-${encodeURIComponent(String(value || 'home'))}`;
}

function workspaceTabPanelId(value) {
  return `workspace-tabpanel-${encodeURIComponent(String(value || 'home'))}`;
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
    case 'analysis': callbacks.onNavigate?.('analysis'); return true;
    case 'note': callbacks.onCreateNote?.(context); return true;
    case 'problem-note': callbacks.onCreateProblemNote?.(context); return true;
    case 'browse': callbacks.onOpenWeb?.(mergedPayload.url || query); return true;
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
  if (!task?.id || !['failed', 'paused'].includes(normalizeTaskStatus(task.status))) return false;
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

function isLibraryPlaceholder(item) {
  return item?.kind === 'knowledge-base' || (item?.removable === false && String(item?.id || '').startsWith('knowledge-base-'));
}

function scopedContextCount(snapshot) {
  const resources = (snapshot.resources || []).filter(item => !isLibraryPlaceholder(item));
  return resources.length + (snapshot.currentDocument ? 1 : 0) + (snapshot.selection ? 1 : 0);
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
  const resourceIds = snapshot.resources
    .filter(item => !isLibraryPlaceholder(item))
    .map(item => item?.id || item?.sourceId || item?.title || item?.name || '')
    .filter(Boolean)
    .join('|');
  return [documentId, selectionId, resourceIds].filter(Boolean).join('::');
}

function EmptyRecent({ onCollect }) {
  return (
    <div className="unified-workspace-empty" data-onboarding="home">
      <span><Inbox size={19} aria-hidden="true" /></span>
      <div>
        <b>先收一份材料，再提问</b>
        <ol className="unified-workspace-empty-steps">
          <li>收集飞书链接或文件</li>
          <li>向导里开通只读权限</li>
          <li>回这里问，或 @ 笔记</li>
        </ol>
      </div>
      <button type="button" onClick={onCollect}><Plus size={14} aria-hidden="true" />开始收集</button>
    </div>
  );
}

function RecentWork({ items, onOpenRecent, onOpenTask, onCollect }) {
  const [collapsed, setCollapsed] = useState(false);
  const visibleItems = items.slice(0, 3);
  return (
    <section className="unified-workspace-recent unified-workspace-recent-compact" aria-labelledby="unified-recent-title">
      <div className="unified-workspace-section-heading">
        <button type="button" className="section-toggle" onClick={() => setCollapsed(!collapsed)}>
          <h2 id="unified-recent-title">最近使用</h2>
          <ChevronRight size={14} aria-hidden="true" style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }} />
        </button>
      </div>
      {!collapsed && (
        visibleItems.length === 0 ? <EmptyRecent onCollect={onCollect} /> : (
          <div className="unified-workspace-recent-list" data-home-ranking="true">
          {visibleItems.map((item, index) => {
            const isTask = item.kind === 'task' || item.type === 'task';
            const Icon = TAB_TYPE_ICONS[item.type] || FileText;
            const title = item.title || '未命名内容';
            const summary = item.summary || item.description || '继续上次的工作';
            const reason = item.priorityReason || '';
            const timeLabel = formatTime(item.updatedAt || item.time);
            const accessibleName = [title, summary, reason, timeLabel].filter(Boolean).join(' · ');
            return (
              <button
                type="button"
                className={joinClassNames('unified-workspace-recent-row', isTask && 'is-task')}
                key={item.id || `${title}-${index}`}
                data-home-rank={item.homeRank || index + 1}
                data-priority-reason={reason || undefined}
                aria-label={accessibleName}
                onClick={() => isTask ? onOpenTask?.(item) : onOpenRecent?.(item)}
              >
                <span className="unified-workspace-recent-icon"><Icon size={17} aria-hidden="true" /></span>
                <span className="unified-workspace-recent-copy">
                  <b>{title}</b>
                  <small>{summary}</small>
                  {reason && <em>{reason}</em>}
                </span>
                <time>{timeLabel}</time>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            );
          })}
          </div>
        )
      )}
    </section>
  );
}

function QuickAsk({ context, onAsk }) {
  const [question, setQuestion] = useState('');
  const intent = homeComposerIntent(question);
  function askNow() {
    const normalized = question.trim();
    if (!normalized) return;
    onAsk?.(normalized, { currentDocument: null, selection: null, resources: [] });
    setQuestion('');
  }
  function submit(event) {
    event.preventDefault();
    askNow();
  }
  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit(event);
    }
  }
  return (
    <section className="unified-workspace-hero unified-workspace-hero-clean" aria-labelledby="unified-home-title">
      <div className="unified-workspace-hero-brand"><span><Sparkles size={18} aria-hidden="true" /></span><b>FlowMind</b></div>
      <h1 id="unified-home-title">今天想了解什么？</h1>
      <form className="unified-workspace-ask unified-workspace-ask-large" data-composer-intent={intent} onSubmit={submit}>
        <textarea name="home-quick-question" rows="3" value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={handleKeyDown} placeholder="有问题尽管问" aria-label="快速问答" />
        <footer>
          <div className="unified-workspace-home-actions" />
          <div className="unified-workspace-ask-submit">
            <button className="unified-workspace-ask-send" type="submit" disabled={!question.trim()} aria-label="发送问题"><ArrowRight size={18} aria-hidden="true" /></button>
          </div>
        </footer>
      </form>
    </section>
  );
}
function TabStrip({ tabs, activeTabId, onActivateTab, onCloseTab, onNewTab }) {
  const items = [{ id: 'home', tab: null }, ...tabs.map(tab => ({ id: tab.id, tab }))];
  const activeIndex = Math.max(0, items.findIndex(item => item.tab ? item.id === activeTabId : !activeTabId));
  function activateFromKey(event, index) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = workspaceTabIndex(index, items.length, event.key);
    const next = items[nextIndex];
    onActivateTab?.(next?.tab || null);
    requestAnimationFrame(() => document.getElementById(workspaceTabId(next?.id || 'home'))?.focus());
  }
  return (
    <div className="unified-workspace-tabs" role="tablist" aria-label="工作标签页" data-persisted-tabs="true">
      <button id={workspaceTabId('home')} type="button" role="tab" tabIndex={activeIndex === 0 ? 0 : -1} aria-controls={workspaceTabPanelId('home')} aria-selected={!activeTabId} className={joinClassNames('unified-workspace-tab', !activeTabId && 'is-active')} onKeyDown={event => activateFromKey(event, 0)} onClick={() => onActivateTab?.(null)}>
        <House size={14} strokeWidth={1.8} aria-hidden="true" /><span>首页</span>
      </button>
      {tabs.map((tab, index) => {
        const Icon = TAB_TYPE_ICONS[tab.type] || FileText;
        const active = activeTabId === tab.id;
        return (
          <div className={joinClassNames('unified-workspace-tab', active && 'is-active')} role="presentation" key={tab.id} onClick={() => onActivateTab?.(tab)}>
            <button id={workspaceTabId(tab.id)} type="button" role="tab" tabIndex={active ? 0 : -1} aria-controls={workspaceTabPanelId(tab.id)} aria-selected={active} title={tab.title} onKeyDown={event => activateFromKey(event, index + 1)} onClick={event => { event.stopPropagation(); onActivateTab?.(tab); }}>
              <Icon size={14} aria-hidden="true" /><span>{tab.title}</span>{tab.busy ? <i className="unified-workspace-tab-busy" aria-label="正在生成" /> : tab.dirty ? <i aria-label="有未保存更改" /> : null}
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
  const scopedResources = snapshot.resources.filter(item => !isLibraryPlaceholder(item));
  const hasContext = Boolean(snapshot.currentDocument || snapshot.selection || scopedResources.length);
  function submit(event) {
    event.preventDefault();
    const value = question.trim();
    if (!value) return;
    onAsk?.(value, snapshot);
    setQuestion('');
  }
  return (
    <aside className={joinClassNames('unified-workspace-context', open && 'is-open')} aria-label="AI 上下文面板" aria-hidden={!open} inert={!open ? true : undefined}>
      <header><div><span><Sparkles size={14} aria-hidden="true" />上下文</span><h2>基于当前材料</h2></div><button type="button" onClick={onClose} aria-label="关闭 AI 上下文面板"><PanelRightClose size={17} aria-hidden="true" /></button></header>
      <div className="unified-workspace-context-body">
        {!hasContext && <div className="unified-workspace-context-empty"><Circle size={18} aria-hidden="true" /><b>还没有材料</b><p>打开文档、选择文字，或附加资料后会自动出现在这里。</p></div>}
        {snapshot.currentDocument && <ContextChip kind="document" title={snapshot.currentDocument.title || '当前文档'} detail={humanizeSourceLabel(snapshot.currentDocument.source || snapshot.currentDocument.type)} onRemove={() => onRemoveContext?.(snapshot.currentDocument)} />}
        {snapshot.selection && <ContextChip kind="selection" title="当前选区" detail={snapshot.selection.text || snapshot.selection.content || ''} onRemove={() => onClearSelection?.()} />}
        {scopedResources.map((resource, index) => <ContextChip key={resource.id || index} kind="resource" title={resource.title || resource.name || '附加资料'} detail={resource.type || resource.source} onRemove={resource.removable === false ? undefined : () => onRemoveContext?.(resource)} />)}
        <button type="button" className="unified-workspace-add-context" onClick={onAttachContext}><Plus size={14} aria-hidden="true" />附加材料</button>
        <div className="unified-workspace-context-artifacts"><button type="button" disabled={!hasContext} onClick={() => onCreateNote?.(snapshot)}><StickyNote size={14} aria-hidden="true" />{'\u521b\u5efa\u7b14\u8bb0'}</button><button type="button" disabled={!hasContext} onClick={() => onCreateWriting?.(snapshot)}><FilePenLine size={14} aria-hidden="true" />{'\u521b\u5efa\u5199\u4f5c\u8349\u7a3f'}</button></div>
      </div>
      <form className="unified-workspace-context-composer" onSubmit={submit}>
        <textarea name="context-question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="基于这些材料提问…" aria-label="基于上下文提问" rows={3} />
        <div><small>{scopedContextCount(snapshot)} 项材料</small><button type="submit" disabled={!question.trim()}><Sparkles size={14} aria-hidden="true" />提问</button></div>
      </form>
    </aside>
  );
}

function BackgroundActivity({ tasks, onRetryTask, onOpenTask }) {
  const normalized = tasks.map(task => ({ ...task, normalizedStatus: normalizeTaskStatus(task.status) }));
  const task = normalized.find(item => item.normalizedStatus === 'failed') || normalized.find(item => item.normalizedStatus === 'running') || normalized.find(item => item.normalizedStatus === 'paused') || normalized.find(item => item.normalizedStatus === 'queued');
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
      {['failed', 'paused'].includes(task.normalizedStatus) && <button type="button" className="unified-workspace-activity-retry" onClick={() => retryWorkspaceTask(task, { onRetryTask })} aria-label={`${task.normalizedStatus === 'paused' ? '继续' : '重试'} ${task.title || '后台任务'}`}><RotateCcw size={13} aria-hidden="true" /></button>}
    </div>
  );
}

export function PrimaryNavigation({ activeSection, onCollect, onNavigate, onPrefetch }) {
  return (
    <nav className="unified-workspace-primary-nav" aria-label="主功能">
      {PRIMARY_NAV_ITEMS.map(({ id, label, Icon }) => {
        const active = activeSection === id;
        return <button type="button" key={id} className={active ? 'is-active' : ''} aria-label={label} aria-current={active ? 'page' : undefined} onPointerEnter={() => onPrefetch?.(id)} onFocus={() => onPrefetch?.(id)} onClick={() => id === 'collect' ? onCollect?.() : onNavigate?.(id)}><Icon size={15} aria-hidden="true" /><span>{label}</span></button>;
      })}
    </nav>
  );
}

function CommandPalette({ open, query, setQuery, context, onClose, callbacks }) {
  const paletteTitleId = useId();
  const inputRef = useRef(null);
  const resultsId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim().toLowerCase();
  const commands = useMemo(() => WORKSPACE_COMMANDS.filter(command => {
    if (!normalizedQuery) return true;
    return `${command.label} ${command.description} ${command.keywords}`.toLowerCase().includes(normalizedQuery) || ['search', 'ask'].includes(command.id);
  }), [normalizedQuery]);
  const activeCommand = commands[activeIndex] || null;

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, normalizedQuery]);

  useEffect(() => {
    if (!open || !activeCommand || typeof document === 'undefined') return;
    document.getElementById(`workspace-command-${activeCommand.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeCommand?.id, open]);

  if (!open) return null;
  function commandIsDisabled(command) {
    return ['search', 'ask'].includes(command?.id) && !query.trim();
  }
  function run(command) {
    if (!command || commandIsDisabled(command)) return;
    const succeeded = dispatchWorkspaceCommand(command, { query, context }, callbacks);
    if (succeeded || !['search', 'ask'].includes(command.id)) onClose?.();
  }
  function submit(event) {
    event.preventDefault();
    run(activeCommand || WORKSPACE_COMMANDS.find(command => command.id === 'search'));
  }
  function handleInputKeyDown(event) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      setActiveIndex(index => commandPaletteIndex(index, commands.length, event.key));
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
    }
  }
  return (
    <div className="unified-workspace-command-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}>
      <section className="unified-workspace-command-palette" role="dialog" aria-modal="true" aria-labelledby={paletteTitleId}>
        <h2 id={paletteTitleId}>全局命令框</h2>
        <form onSubmit={submit} className="unified-workspace-command-input"><Search size={18} aria-hidden="true" /><input name="workspace-command" ref={inputRef} autoFocus value={query} onChange={event => setQuery(event.target.value)} onKeyDown={handleInputKeyDown} placeholder="搜索、提问或输入命令" aria-label="全局命令" aria-controls={resultsId} aria-activedescendant={activeCommand ? `workspace-command-${activeCommand.id}` : undefined} /><kbd>ESC</kbd></form>
        <div id={resultsId} className="unified-workspace-command-results" role="listbox" aria-label="可用命令">
          {commands.length === 0 && <div className="unified-workspace-command-empty" role="status">没有匹配的命令</div>}
          {commands.map((command, index) => {
            const Icon = command.Icon;
            const disabled = commandIsDisabled(command);
            const active = index === activeIndex;
            const detail = ['search', 'ask'].includes(command.id) && query.trim() ? `${command.description}：「${query.trim()}」` : command.description;
            return <button id={`workspace-command-${command.id}`} type="button" role="option" aria-selected={active} key={command.id} disabled={disabled} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onClick={() => run(command)}><span><Icon size={17} aria-hidden="true" /></span><span><b>{command.label}</b><small>{detail}</small></span><ChevronRight size={15} aria-hidden="true" /></button>;
          })}
        </div>
        <footer><span><kbd>↑ ↓</kbd>选择</span><span><kbd>↵</kbd>执行</span><span><kbd>Ctrl K</kbd>打开</span></footer>
      </section>
    </div>
  );
}

function searchResultMeta(type) {
  if (type === 'note') return { label: '笔记', Icon: StickyNote };
  if (type === 'conversation') return { label: '会话', Icon: MessageCircle };
  return { label: '文档', Icon: FileText };
}

const SEARCH_TYPE_FILTERS = Object.freeze([
  { id: 'all', label: '全部' },
  { id: 'document', label: '文档' },
  { id: 'note', label: '笔记' },
  { id: 'conversation', label: '会话' }
]);

function GlobalSearchPanel({ search = {}, onSearch, onClose, onOpenResult }) {
  const open = Boolean(search.open);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const [query, setQuery] = useState(String(search.query || ''));
  const [activeIndex, setActiveIndex] = useState(0);
  const [openedId, setOpenedId] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const results = Array.isArray(search.results) ? search.results : [];
  const typeCounts = useMemo(() => {
    const counts = { all: results.length, document: 0, note: 0, conversation: 0 };
    for (const result of results) counts[searchResultType(result)] += 1;
    return counts;
  }, [results]);
  const visibleResults = typeFilter === 'all' ? results : results.filter(result => searchResultType(result) === typeFilter);
  const activeResult = visibleResults[activeIndex] || null;
  const filterLabel = SEARCH_TYPE_FILTERS.find(item => item.id === typeFilter)?.label || '全部';

  useEffect(() => {
    if (!open) return;
    setQuery(String(search.query || ''));
    setActiveIndex(0);
    setTypeFilter('all');
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, search.query]);

  useEffect(() => {
    if (activeIndex < visibleResults.length) return;
    setActiveIndex(Math.max(0, visibleResults.length - 1));
  }, [activeIndex, visibleResults.length]);

  if (!open) return null;
  function submit(event) {
    event.preventDefault();
    const value = query.trim();
    if (value) onSearch?.(value);
  }
  function chooseResult(result) {
    if (!result) return;
    setOpenedId(String(result.id));
    onOpenResult?.(result);
    onClose?.({ restoreFocus: false });
  }
  function openActiveResult() {
    chooseResult(activeResult);
  }
  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
      return;
    }
    if (event.key === 'ArrowDown' && visibleResults.length) {
      event.preventDefault();
      setActiveIndex(index => (index + 1) % visibleResults.length);
      return;
    }
    if (event.key === 'ArrowUp' && visibleResults.length) {
      event.preventDefault();
      setActiveIndex(index => (index - 1 + visibleResults.length) % visibleResults.length);
      return;
    }
    if (event.key === 'Enter' && activeResult && query.trim() === String(search.query || '').trim()) {
      event.preventDefault();
      openActiveResult();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(panelRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled])') || [])];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  return <div className="unified-workspace-search-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}>
    <section className="unified-workspace-search-panel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="workspace-search-title" onKeyDown={handleKeyDown}>
      <header><div><span>WORKSPACE SEARCH</span><h2 id="workspace-search-title">搜索全部内容</h2></div><button type="button" aria-label="关闭全局搜索" onClick={onClose}><X size={17} aria-hidden="true" /></button></header>
      <form className="unified-workspace-search-form" onSubmit={submit}><Search size={17} aria-hidden="true" /><input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文档、笔记或历史会话" aria-label="全局搜索" aria-controls="workspace-search-results" /><button type="submit" disabled={!query.trim() || search.busy}>{search.busy ? <LoaderCircle className="is-spinning" size={15} /> : '搜索'}</button></form>
      {results.length ? <div className="unified-workspace-search-filters" role="tablist" aria-label="按类型筛选">
        {SEARCH_TYPE_FILTERS.map(filter => {
          const count = typeCounts[filter.id] || 0;
          const disabled = filter.id !== 'all' && count === 0;
          return <button key={filter.id} type="button" role="tab" aria-selected={typeFilter === filter.id} disabled={disabled} className={joinClassNames('unified-workspace-search-filter', typeFilter === filter.id && 'is-active')} onClick={() => { setTypeFilter(filter.id); setActiveIndex(0); }}>{filter.label}{count ? ` ${count}` : ''}</button>;
        })}
      </div> : null}
      <div className="unified-workspace-search-summary" role="status" aria-live="polite">{search.busy ? '正在检索本地工作区…' : search.error ? search.error : search.query ? (typeFilter === 'all' ? `找到 ${Number(search.total || 0)} 项${search.limited ? '，仅显示前 40 项' : ''}` : `当前显示 ${visibleResults.length} 项${filterLabel}`) : '输入关键词后开始搜索'}</div>
      <div id="workspace-search-results" className="unified-workspace-search-results" role="listbox" aria-label="搜索结果">
        {visibleResults.map((result, index) => {
          const meta = searchResultMeta(searchResultType(result));
          const Icon = meta.Icon;
          const active = index === activeIndex;
          const excerpt = searchExcerptPreview(result.excerpt, { title: result.title, limit: 80 });
          const title = searchResultTitle(result.title, '未命名内容');
          return <button key={`${searchResultType(result)}:${result.id}:${index}`} type="button" role="option" aria-selected={active} data-search-opened={openedId === String(result.id) ? 'true' : undefined} className={joinClassNames('unified-workspace-search-option', active && 'is-active', openedId === String(result.id) && 'is-opened')} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onClick={() => chooseResult(result)}><span className="unified-workspace-search-icon"><Icon size={16} aria-hidden="true" /></span><span className="unified-workspace-search-copy"><b>{title}</b><small>{excerpt || '没有可预览的内容'}</small><em>{meta.label}{openedId === String(result.id) ? ' · 已打开' : ''}{result.tags?.length ? ` · ${result.tags.slice(0, 3).map(tag => typeof tag === 'string' ? tag : tag?.name).filter(Boolean).join('、')}` : ''}</em></span><time>{formatTime(result.updatedAt)}</time><ChevronRight size={15} aria-hidden="true" /></button>;
        })}
        {!search.busy && !search.error && search.query && !results.length && <div className="unified-workspace-search-empty"><Search size={21} aria-hidden="true" /><b>没有找到匹配内容</b><small>换用标题、正文、标签或历史问题中的关键词。</small></div>}
        {!search.busy && !search.error && search.query && results.length > 0 && !visibleResults.length && <div className="unified-workspace-search-empty"><Search size={21} aria-hidden="true" /><b>这一类没有匹配</b><small>换一个类型，或回到全部结果。</small></div>}
      </div>
      <footer><span><kbd>↑ ↓</kbd>选择</span><span><kbd>↵</kbd>打开</span><span><kbd>ESC</kbd>关闭</span></footer>
    </section>
  </div>;
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
  onOpenSearch,
  onAsk,
  onCollect,
  onCreateNote,
  onCreateProblemNote,
  onOpenWeb,
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
  onToggleCompact,
  search = {},
  onCloseSearch,
  onOpenSearchResult,
  onReopenSearch,
  smartHome = null,
  onSmartHomeAction,
  libraryName = ''
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
  const commandTriggerRef = useRef(null);
  const commandReturnFocusRef = useRef(null);
  const callbacks = { onCommand, onSearch, onAsk, onCollect, onCreateNote, onCreateProblemNote, onCreateWriting, onRunSkill, onNavigate, onOpenWeb };

  function openCommandPalette() {
    if (typeof document !== 'undefined') commandReturnFocusRef.current = document.activeElement;
    setCommandQuery('');
    setCommandOpen(true);
    setMenuOpen(false);
  }

  function openSearchPanel() {
    setCommandOpen(false);
    setMenuOpen(false);
    if (onOpenSearch) onOpenSearch?.();
    else onSearch?.(search.query || '');
  }

  function closeCommandPalette() {
    setCommandOpen(false);
    setCommandQuery('');
    requestAnimationFrame(() => {
      const target = commandReturnFocusRef.current || commandTriggerRef.current;
      target?.focus?.();
      commandReturnFocusRef.current = null;
    });
  }

  function closeSearchPanel(options = {}) {
    onCloseSearch?.();
    if (options.restoreFocus === false) return;
    requestAnimationFrame(() => commandTriggerRef.current?.focus());
  }

  useEffect(() => {
    if (!contextKey) setContextOpen(false);
  }, [contextKey]);

  useEffect(() => {
    const id = activeTab?.id || 'home';
    document.getElementById(workspaceTabId(id))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab?.id]);

  useEffect(() => {
    function onKeyDown(event) {
      if (isWorkspaceCommandShortcut(event)) {
        if (isComposerFocused()) return;
        event.preventDefault();
        if (commandOpen) closeCommandPalette(); else openCommandPalette();
        return;
      }
      if (isWorkspaceContextShortcut(event)) {
        event.preventDefault();
        setContextOpen(value => !value);
        return;
      }
      if (shouldCloseWorkspaceOverlay(event)) {
        if (commandOpen) closeCommandPalette();
        else if (contextOpen) setContextOpen(false);
        else setMenuOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandOpen, contextOpen]);

  const activeContent = activeTab ? (renderActiveTab?.(activeTab) ?? children) : null;
  const contextCount = scopedContextCount(contextValue);

  return (
    <div className={joinClassNames('unified-workspace', compact && 'is-compact', contextOpen && 'has-context', className)} data-skin="friday" data-density={compact ? 'compact' : 'comfortable'}>
      <aside className="unified-workspace-topbar" aria-label="工作台侧边栏">
        <button type="button" className="unified-workspace-brand" onClick={() => onActivateTab?.(null)} aria-label="返回工作台首页"><span><Zap size={17} aria-hidden="true" /></span><b>FlowMind</b><small>飞书 AI 工作台</small></button>
        <button type="button" aria-label="新对话" className={joinClassNames('unified-workspace-new-chat', activeSection === 'home' && 'is-active')} onClick={onNewTab}><Plus size={17} aria-hidden="true" /><span><b>新对话</b><small>开始新的知识任务</small></span></button>
        <PrimaryNavigation activeSection={activeSection} onCollect={onCollect} onNavigate={onNavigate} onPrefetch={onPrefetch} />
        <div className="unified-workspace-global-search" role="search">
          <button type="button" className="unified-workspace-global-search-open" onClick={openSearchPanel} aria-label="搜索全部内容"><Search size={16} aria-hidden="true" /><span>搜索全部内容</span></button>
          <button type="button" ref={commandTriggerRef} className="unified-workspace-global-search-command" onClick={openCommandPalette} aria-label="打开全局命令框"><kbd>Ctrl K</kbd></button>
        </div>
        <div className="unified-workspace-sidebar-footer">
          <button type="button" className={joinClassNames('unified-workspace-settings', activeSection === 'settings' && 'is-active')} aria-label="设置" onPointerEnter={() => onPrefetch?.('settings')} onFocus={() => onPrefetch?.('settings')} onClick={() => onNavigate?.('settings')}><Settings size={20} aria-hidden="true" /><span>设置</span></button>
          <span>本地工作空间</span><small>飞书资料、笔记和引用持续连接</small>
        </div>
      </aside>

      <section className="unified-workspace-stage">
        <header className="unified-workspace-stage-header">
          <TabStrip tabs={normalizedTabs} activeTabId={activeTab?.id || null} onActivateTab={onActivateTab} onCloseTab={onCloseTab} onNewTab={onNewTab} />
          <div className="unified-workspace-top-actions">
            <button type="button" className="unified-workspace-stage-search" onClick={openSearchPanel} aria-label="搜索全部内容" title="搜索全部内容"><Search size={17} aria-hidden="true" /></button>
            {shouldShowReturnSearch(search, activeTab?.id) && <button type="button" className="unified-workspace-return-search" onClick={onReopenSearch} aria-label="返回搜索结果" title={`返回“${search.query}”的搜索结果`}><Search size={15} aria-hidden="true" /><span>返回“{compactSearchLabel(search.query)}”</span><i>{search.results.length}</i></button>}
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
              <section key={activeTab.id} id={workspaceTabPanelId(activeTab.id)} role="tabpanel" tabIndex={0} aria-labelledby={workspaceTabId(activeTab.id)} className="unified-workspace-active" aria-label={`${activeTab.title} 工作区`}>
                {activeContent || <div className="unified-workspace-active-placeholder"><BookOpen size={24} aria-hidden="true" /><h1>{activeTab.title}</h1><p>此标签页已恢复，等待载入内容。</p></div>}
              </section>
            ) : (
              <div id={workspaceTabPanelId('home')} role="tabpanel" tabIndex={0} aria-labelledby={workspaceTabId('home')} className="unified-workspace-home">
                <QuickAsk context={contextValue} onAsk={onAsk} />
                <RecentWork items={recentItems} onOpenRecent={onOpenRecent} onOpenTask={onOpenTask} onCollect={onCollect} />
              </div>
            )}
          </main>
          <AIContextPanel open={contextOpen} context={contextValue} onClose={() => setContextOpen(false)} onRemoveContext={onRemoveContext} onClearSelection={onClearSelection} onAttachContext={onAttachContext} onCreateNote={onCreateNote} onCreateWriting={onCreateWriting} onAsk={onAsk} />
          <BackgroundActivity tasks={tasks} onRetryTask={onRetryTask} onOpenTask={onOpenTask} />
        </div>
      </section>

      <GlobalSearchPanel search={search} onSearch={onSearch} onClose={closeSearchPanel} onOpenResult={onOpenSearchResult} />
      <CommandPalette open={commandOpen} query={commandQuery} setQuery={setCommandQuery} context={contextValue} onClose={closeCommandPalette} callbacks={callbacks} />
    </div>
  );
}

export default UnifiedWorkspace;
