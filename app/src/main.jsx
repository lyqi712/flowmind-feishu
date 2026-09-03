import React, { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle, AtSign, BarChart3, BookOpen, BookOpenCheck, Bot, Bookmark, BrainCircuit, Check, ChevronDown, CircleCheck, CircleHelp, Clock3, Compass, Copy,
  Download, Eye, EyeOff, FileAudio, FilePenLine, FileText, FolderKanban, Globe2, History,
  LibraryBig, Link2, ListChecks, LoaderCircle, MessageSquareText, Mic, MicOff, MoreHorizontal, Network, NotebookPen, PanelLeftClose,
  Paperclip, Play, Plus, RefreshCw, RotateCcw, Save, Search, Send, Settings,
  Sparkles, Square, Star, Tags, TestTube2, Workflow, X
} from 'lucide-react';
import UnifiedWorkspace from './components/UnifiedWorkspace.jsx';
import SmartSearch from './components/SmartSearch.jsx';
import { FeishuExportDialog } from './components/FeishuExportDialog.jsx';
import { ReasoningChain } from './components/ReasoningChain.jsx';
import { loadWorkspaceSurface, preloadWorkspaceRoute, preloadWorkspaceSurface } from './workspace/workspace-route-loading.js';
import { applyAssistantStreamEvent, createStreamEventBatcher, scrollTranscriptToEnd } from './workspace/stream-events.js';
import { createChatTabScene, createWorkspaceStorageAdapter, findChatTabByConversationId, getChatTabScene, isChatWorkspaceTab, normalizeWorkspaceSession, workspaceSessionReducer } from './workspace/workspace-session.js';
import { restoredReaderChat } from './workspace/reader-conversation.js';
import { applySkillReasoningEvent, shouldShowReasoningChain } from './workspace/reasoning-chain.js';
import { buildWorkspaceContextNote, buildWorkspaceContextWritingDraft, deriveWorkspaceContext, deriveWorkspaceHomeItems, workspaceTaskRoute } from './workspace/workspace-integrations.js';
import { buildSourceNoteContent, buildSourceNoteTitle, problemNoteDraft } from './workspace/note-capture.js';
import { appendWebClipToProblemContent, createWebWorkspaceTab, mergeNoteSourceRefs, normalizeClientBrowseUrl, pickProblemNoteForWebClip, problemNoteFromWebClip, webClipSourceRef } from './workspace/web-browse.js';
import { humanizeSourceLabel, searchResultType } from './workspace/display-text.js';
import { isLibraryNote, isNotesLibrary, libraryFileKind, libraryFileLabel } from './workspace/knowledge-file.js';
import { hasSubstantiveEvidenceAnalysis, stripTemplatedAnswerSections } from '../shared/answer-text.mjs';
import { retryChatRequest } from './workspace/chat-retry.js';
import { consumeFeishuLoginQuery, startFeishuUserLogin } from './workspace/feishu-login.js';
import { EvidenceStatusBadge } from './components/EvidenceStatus.jsx';
import { injectCitationNodes } from './components/CitationTooltip.jsx';
import './styles.css';
import './components/UnifiedWorkspaceIma.css';
import './components/SmartHome.css';
import './components/SmartSearch.css';
import './components/FeishuExportDialog.css';
import './components/ReasoningChain.css';
import './claude-theme.css';
import './components/FridaySkin.css';
import { applyAppearance, loadAppearance, watchSystemAppearance } from './workspace/appearance.js';

const lazyDefaultSurface = surface => lazy(() => loadWorkspaceSurface(surface).then(module => ({ default: module.default })));
const lazyNamedSurface = (surface, exportName) => lazy(() => loadWorkspaceSurface(surface).then(module => ({ default: module[exportName] })));

const FeishuSyncWizard = lazyDefaultSurface('feishu-sync');
const CollectionCenter = lazyNamedSurface('collection', 'CollectionCenter');
const ContentReader = lazyNamedSurface('content-reader', 'ContentReader');
const KnowledgeGraph = lazyNamedSurface('knowledge-graph', 'KnowledgeGraph');
const SettingsExperienceSidebar = lazyNamedSurface('settings', 'SettingsSidebar');
const SettingsExperienceWorkspace = lazyNamedSurface('settings', 'SettingsWorkspace');
const EvidenceWorkbench = lazy(() => import('./components/EvidenceWorkbench.jsx').then(module => ({ default: module.EvidenceWorkbench })));
const DeepAnswerPanel = lazyNamedSurface('deep-answer', 'DeepAnswerPanel');
const CopilotModule = lazyNamedSurface('copilot', 'CopilotModule');
const DocumentAnalysisModule = lazyNamedSurface('analysis', 'DocumentAnalysisModule');
const NotesModule = lazyNamedSurface('notes', 'NotesModule');
const EmbeddedBrowser = lazyNamedSurface('embedded-browser', 'EmbeddedBrowser');
const WritingModule = lazyNamedSurface('writing', 'WritingModule');
const RecordingWorkspace = lazyNamedSurface('recording', 'RecordingWorkspace');
const ComposerCommandMenu = lazyDefaultSurface('composer-menu');

const INLINE_SOURCE_MARKER = /\[(?:source|source-id|selection)\b[^\]\n]*\]/gi;
const sanitizeAssistantText = value => stripTemplatedAnswerSections(String(value ?? '').replace(INLINE_SOURCE_MARKER, ''));

function composerTaskSkillId(value = '') {
  const text = String(value).trim();
  if (!text) return '';
  if (/(?:播客|音频节目|生成音频|朗读成音频)/i.test(text)) return 'podcast';
  if (/(?:研究报告|调研报告|分析报告|生成报告|做一份报告)/i.test(text)) return 'research-report';
  return '';
}

function artifactFileLabel(file = {}) {
  if (file.kind === 'audio') return '下载音频';
  return '下载文稿';
}
function WorkspaceRouteFallback({ label = '工作区', overlay = false }) {
  const content = <div className="workspace-route-loading" role="status" aria-live="polite"><LoaderCircle className="spin" size={22}/><span><b>正在打开{label}</b><small>保留当前飞书知识库、文档和引用上下文</small></span></div>;
  return overlay ? <div className="workspace-route-loading-overlay">{content}</div> : content;
}

class WorkspaceSurfaceErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="workspace-surface-error" role="alert">
        <b>这一页打不开</b>
        <p>{this.state.error.message || '页面出错了，其他页还可以继续用。'}</p>
        <button type="button" onClick={() => this.setState({ error: null })}>重试</button>
      </div>
    );
  }
}

const PROVIDERS = [
  { id: 'openai-chat', name: 'OpenAI Compatible · Chat Completions', short: 'OpenAI Chat', url: 'https://api.openai.com/v1', key: true, hint: '兼容 /chat/completions 的官方 API、中转站与私有网关。' },
  { id: 'openai-responses', name: 'OpenAI Compatible · Responses', short: 'OpenAI Responses', url: 'https://api.openai.com/v1', key: true, hint: '兼容 /responses 的流式接口与工具调用。' },
  { id: 'anthropic', name: 'Anthropic Messages', short: 'Anthropic', url: 'https://api.anthropic.com/v1', key: true, hint: 'Anthropic Messages API 或兼容中转站。' },
  { id: 'gemini', name: 'Google Gemini', short: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta', key: true, hint: 'Gemini generateContent 与流式接口。' },
  { id: 'ollama', name: 'Ollama', short: 'Ollama', url: 'http://127.0.0.1:11434', key: false, hint: '本地 Ollama 服务，默认无需 API Key。' },
  { id: 'azure-openai', name: 'Azure OpenAI', short: 'Azure', url: '', key: true, hint: 'Azure Endpoint、Deployment 与 api-version。' },
  { id: 'custom-http', name: '自定义 HTTP', short: 'Custom HTTP', url: '', key: true, hint: '适配自定义 REST 网关、模型聚合平台和第三方中转站。' }
];
const FALLBACK_SKILLS = [
  { id: 'summary', name: '知识总结', description: '把材料压缩成结构化摘要与行动项', steps: ['选择材料', '提取要点', '生成总结'] },
  { id: 'compare', name: '多文档对比', description: '提取共识、差异与适用场景', steps: ['选择材料', '建立维度', '输出矩阵'] },
  { id: 'research-report', name: '研究报告', description: '围绕主题检索证据并生成研究报告', steps: ['检索证据', '综合分析', '生成报告'] },
  { id: 'mind-map', name: '思维导图', description: '把当前材料解析为可交互导图', steps: ['读取结构', '组织层级', '生成导图'] },
  { id: 'quiz', name: '互动测验', description: '生成带答案、解释和来源的测验', steps: ['提取事实', '设计题目', '生成测验'] },
  { id: 'podcast', name: '播客', description: '从当前材料生成可播放音频', steps: ['选择材料', '生成讲稿', '合成音频'] }
];
const SKILL_ICONS = { summary: FileText, compare: FolderKanban, 'research-report': Workflow, 'mind-map': BrainCircuit, quiz: CircleHelp, podcast: FileAudio, 'q2-planning': BarChart3, 'tech-selection': Settings, 'customer-proposal': FileText };
const AGENT_MODE_OPTIONS = Object.freeze([
  { id: 'auto', label: '对话', description: '由系统判断任务意图并调用工具' }
]);
function libraryDocumentCount(library, documents = []) {
  const declared = Number(library?.documentCount);
  if (Number.isFinite(declared) && declared > 0) return declared;
  const libraryId = library?.id;
  if (!libraryId) return 0;
  return (documents || []).filter(doc => {
    const documentLibraryId = doc.knowledgeBaseId || doc.spaceId;
    return documentLibraryId ? documentLibraryId === libraryId : libraryId === 'feishu-space' || libraryId === 'local-content';
  }).length;
}

function resolveDefaultLibrary(libraries = [], { preferredId, documents = [] } = {}) {
  const list = Array.isArray(libraries) ? libraries : [];
  if (preferredId && list.some(item => item.id === preferredId && libraryDocumentCount(item, documents) > 0)) return preferredId;
  const populated = list.find(item => libraryDocumentCount(item, documents) > 0);
  if (populated) return populated.id;
  if (preferredId && list.some(item => item.id === preferredId)) return preferredId;
  return list[0]?.id || 'local-content';
}

function resolveLibraryAfterSync(next, items) {
  const preferred = next?.settings?.activeKnowledgeBaseId;
  const countByLibrary = new Map();
  for (const item of items || []) {
    const libraryId = item.knowledgeBaseId || item.spaceId || 'local-content';
    countByLibrary.set(libraryId, (countByLibrary.get(libraryId) || 0) + 1);
  }
  return (preferred && countByLibrary.get(preferred)) ? preferred
    : [...countByLibrary.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
    || preferred || next?.knowledgeBases?.[0]?.id || 'feishu-space';
}

const agentModeOption = value => {
  const id = String(value || '').trim().toLowerCase();
  if (id === 'research' || id === 'write' || id === 'quick') return { id };
  if (id === 'change') return { id: 'write' };
  if (id === 'answer') return { id: 'quick' };
  return AGENT_MODE_OPTIONS[0];
};
const DEFAULT_STATE = {
  mode: 'mock', knowledgeBases: [{ id: 'feishu-space', name: '飞书知识库', source: 'mock', documentCount: 0 }],
  documents: [], conversations: [], skillRuns: [], sync: { status: 'idle', stats: { imported: 0 } }
};
const EMPTY_INDEXED_GRAPH = Object.freeze({
  nodes: Object.freeze([]), edges: Object.freeze([]), unresolved: Object.freeze([]), suggestions: Object.freeze([]),
  stats: Object.freeze({ nodes: 0, edges: 0, unresolved: 0, suggestions: 0, explicitEdges: 0 })
});
const EMPTY_MODEL = {
  provider: 'openai-chat', baseUrl: '', apiKey: '', model: '', defaultModel: '', timeoutMs: 120000, retries: 2, retryDelayMs: 500, temperature: 0.2, maxTokens: 4096, fallbackToLocal: false,
  extraHeadersText: '{}', azureDeployment: '', azureApiVersion: '2024-10-21', customChatPath: '',
  customModelsPath: '', customAuthType: 'bearer', customRequestFormat: 'openai', customResponseFormat: 'auto', hasApiKey: false, configured: false
};

const providerById = id => PROVIDERS.find(item => item.id === id) || PROVIDERS[0];
const errText = (error, fallback = '请求失败') => error?.error?.message || error?.message || (typeof error?.error === 'string' ? error.error : '') || (typeof error === 'string' ? error : fallback);
const CHAT_ATTACHMENT_MIME = {
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', html: 'text/html', htm: 'text/html', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  epub: 'application/epub+zip', xmind: 'application/x-xmind', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac'
};
const attachmentMimeType = file => file?.type || CHAT_ATTACHMENT_MIME[String(file?.name || '').split('.').pop()?.toLowerCase()] || 'application/octet-stream';
const attachmentSizeLabel = bytes => {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value > 10240 ? 0 : 1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};
function detectComposerTrigger(value, caret = String(value || '').length) {
  const source = String(value || '');
  const end = Math.max(0, Math.min(source.length, Number(caret) || source.length));
  const before = source.slice(0, end);
  const match = before.match(/(^|\s)([\/@])([^\s\/@]*)$/u);
  if (!match) return null;
  const leading = match[1] || '';
  const start = end - match[0].length + leading.length;
  return { mode: match[2] === '@' ? 'mention' : 'slash', trigger: match[2], query: match[3] || '', start, end };
}
function replaceComposerTrigger(value, trigger, replacement = '') {
  if (!trigger) return String(value || '');
  return String(value || '').slice(0, trigger.start) + replacement + String(value || '').slice(trigger.end);
}
const formatDate = value => {
  if (!value) return '尚未运行';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
};

function focusableDialogElements(root) {
  return [...(root?.querySelectorAll?.('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])]
    .filter(element => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
}

function useModalFocus(open, dialogRef, onClose, initialFocusRef = null) {
  const returnFocusRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    returnFocusRef.current = document.activeElement;
    const timer = window.setTimeout(() => (initialFocusRef?.current || focusableDialogElements(dialogRef.current)[0])?.focus(), 0);
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableDialogElements(dialogRef.current);
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
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      const target = returnFocusRef.current;
      window.requestAnimationFrame(() => target?.focus?.());
      returnFocusRef.current = null;
    };
  }, [open]);
}

async function parseResponse(response) {
  const text = await response.text();
  let data = {};
  if (text) try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!response.ok) throw new Error(errText(data, `HTTP ${response.status}`));
  return data;
}

async function readNdjson(response, onEvent, signal) {
  if (!response.ok) throw new Error(errText(await parseResponse(response), `HTTP ${response.status}`));
  if (!response.body) throw new Error('服务端未返回流式响应');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('已停止生成', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) if (line.trim()) {
        const event = JSON.parse(line);
        if (event.type === 'error') {
          const error = new Error(errText(event.error, '流式任务失败'));
          error.code = event.error?.code;
          error.status = event.error?.status;
          error.retryable = event.error?.retryable;
          throw error;
        }
        onEvent(event);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = JSON.parse(buffer);
      if (event.type === 'error') {
        const error = new Error(errText(event.error, '流式任务失败'));
        error.code = event.error?.code;
        error.status = event.error?.status;
        error.retryable = event.error?.retryable;
        throw error;
      }
      onEvent(event);
    }
  } finally { reader.releaseLock(); }
}

function normalizeModel(data) {
  const source = data?.settings || data?.modelSettings || data || {};
  const model = source.defaultModel || source.model || '';
  return {
    ...EMPTY_MODEL, provider: source.provider || source.type || EMPTY_MODEL.provider,
    baseUrl: source.baseUrl || source.baseURL || source.endpoint || '', apiKey: '', model, defaultModel: model,
    timeoutMs: Number(source.timeoutMs || source.timeout || EMPTY_MODEL.timeoutMs), retries: Number(source.retries ?? EMPTY_MODEL.retries), retryDelayMs: Number(source.retryDelayMs ?? EMPTY_MODEL.retryDelayMs), temperature: Number(source.temperature ?? EMPTY_MODEL.temperature), maxTokens: Number(source.maxTokens ?? EMPTY_MODEL.maxTokens), fallbackToLocal: false,
    extraHeadersText: JSON.stringify(source.extraHeaders || source.headers || {}, null, 2),
    azureDeployment: source.azureDeployment || source.deployment || '',
    azureApiVersion: source.azureApiVersion || source.apiVersion || EMPTY_MODEL.azureApiVersion,
    customChatPath: source.customChatPath || source.chatPath || '', customModelsPath: source.customModelsPath || source.modelsPath || '',
    customAuthType: source.customAuthType || source.authMode || 'bearer', customRequestFormat: source.customRequestFormat || source.requestFormat || 'openai', customResponseFormat: source.customResponseFormat || source.responseFormat || 'auto',
    hasApiKey: Boolean(source.hasApiKey || source.apiKeyConfigured || source.maskedApiKey),
    configured: Boolean(source.configured ?? source.isConfigured ?? (source.baseUrl && model)), updatedAt: source.updatedAt || null
  };
}
const modelLabel = settings => settings.defaultModel || settings.model || providerById(settings.provider).short;

function normalizedDocumentIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => String(item || '').trim()).filter(Boolean))];
}

function humanModelStatusMessage(status) {
  if (status === 401 || status === 403) return '模型密钥无效或没有权限，请到设置里检查接口配置';
  if (status === 404) return '找不到指定的模型，请到设置里核对模型名称';
  if (status === 408) return '模型响应超时，请稍后重试';
  if (status === 409) return '模型请求冲突，请稍后重试';
  if (status === 429) return '提问太频繁，请稍等一会儿再试';
  if (status >= 500) return '模型暂时连不上，请稍后重试';
  if (status >= 400) return '模型请求没有被接受，请检查设置后重试';
  return '';
}

function formatModelError(error, fallback = '模型暂时不可用') {
  const status = Number(error?.status);
  const mapped = Number.isInteger(status) ? humanModelStatusMessage(status) : '';
  if (mapped) return mapped;
  const message = errText(error, '');
  if (/模型服务请求失败|api_error|Service temporarily|"error"\s*:/i.test(message)) {
    return '模型暂时连不上，请稍后重试';
  }
  return message || fallback;
}

function uniqueCitationSources(citations = []) {
  const seen = new Set();
  return (Array.isArray(citations) ? citations : []).filter(citation => {
    const key = String(citation?.documentId || citation?.id || citation?.title || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function graphSuggestionStatusMap(graph) {
  const statuses = new Map();
  for (const suggestion of Array.isArray(graph?.suggestions) ? graph.suggestions : []) {
    if (suggestion?.id) statuses.set(String(suggestion.id), suggestion.status || 'pending');
  }
  for (const edge of Array.isArray(graph?.edges) ? graph.edges : []) {
    const suggestionId = edge?.provenance?.suggestionId || edge?.suggestionId;
    if (suggestionId) statuses.set(String(suggestionId), 'approved');
  }
  return statuses;
}

function applyGraphSuggestionStatuses(messages, statuses) {
  if (!statuses?.size) return Array.isArray(messages) ? messages : [];
  return (Array.isArray(messages) ? messages : []).map(item => {
    const relations = item?.relations;
    if (!relations?.graphSuggestions?.length) return item;
    let changed = false;
    const graphSuggestions = relations.graphSuggestions.map(suggestion => {
      const nextStatus = statuses.get(String(suggestion.id));
      if (!nextStatus || nextStatus === suggestion.status) return suggestion;
      changed = true;
      return { ...suggestion, status: nextStatus };
    });
    return changed ? { ...item, relations: { ...relations, graphSuggestions } } : item;
  });
}

function withGraphSuggestionStatus(messages, suggestionId, status) {
  const id = String(suggestionId || '');
  if (!id) return Array.isArray(messages) ? messages : [];
  return (Array.isArray(messages) ? messages : []).map(item => {
    const relations = item?.relations;
    if (!relations?.graphSuggestions?.length) return item;
    let changed = false;
    const graphSuggestions = relations.graphSuggestions.map(suggestion => {
      if (String(suggestion.id) !== id || suggestion.status === status) return suggestion;
      changed = true;
      return { ...suggestion, status };
    });
    return changed ? { ...item, relations: { ...relations, graphSuggestions } } : item;
  });
}

function formatEvidenceChars(value) {
  const chars = Number(value) || 0;
  return chars.toLocaleString('zh-CN');
}

function App() {
  useEffect(() => watchSystemAppearance(), []);
  const [active, setActive] = useState('home');
  const [state, setState] = useState(DEFAULT_STATE);
  const [selectedKb, setSelectedKb] = useState('feishu-space');
  const [knowledgeLibraries, setKnowledgeLibraries] = useState([]);
  const [knowledgeLibraryFilter, setKnowledgeLibraryFilter] = useState('all');
  const [knowledgeTagFilter, setKnowledgeTagFilter] = useState('');
  const [starredIds, setStarredIds] = useState([]);
  const [knowledgeLibraryBusy, setKnowledgeLibraryBusy] = useState(false);
  const [selectedDocs, setSelectedDocsState] = useState([]);
  const [chatScopeExplicit, setChatScopeExplicitState] = useState(false);
  const [query, setQueryState] = useState('');
  const [messages, setMessagesState] = useState([]);
  const [streaming, setStreamingState] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [readerDetail, setReaderDetail] = useState(null);
  const [readerEvidence, setReaderEvidence] = useState(null);
  const [readerAnchor, setReaderAnchor] = useState('');
  const [readerExcerpt, setReaderExcerpt] = useState('');
  const [readerBusy, setReaderBusy] = useState(false);
  const [readerResyncBusy, setReaderResyncBusy] = useState(false);
  const [readerResyncError, setReaderResyncError] = useState('');
  const [feishuUser, setFeishuUser] = useState({ loggedIn: false });
  const [readerChat, setReaderChat] = useState({ documentId: '', conversationId: '', messages: [], streaming: false, error: '' });
  const [graphOpen, setGraphOpen] = useState(false);
  const [graphFocus, setGraphFocus] = useState(null);
  const [graphNotes, setGraphNotes] = useState([]);
  const [graphData, setGraphData] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [noteDeepLinkId, setNoteDeepLinkId] = useState('');
  const [writingDeepLinkId, setWritingDeepLinkId] = useState('');
  const [settingsSection, setSettingsSection] = useState('appearance');
  const [toast, setToast] = useState(null);
  const [chatError, setChatErrorState] = useState('');
  const [modelSettings, setModelSettings] = useState(EMPTY_MODEL);
  const [modelDrawerOpen, setModelDrawerOpen] = useState(false);
  const [modelForm, setModelForm] = useState(EMPTY_MODEL);
  const [modelOptions, setModelOptions] = useState([]);
  const [modelBusy, setModelBusy] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [skills, setSkills] = useState(FALLBACK_SKILLS);
  const [selectedSkill, setSelectedSkill] = useState('summary');
  const [skillTopic, setSkillTopic] = useState('');
  const [skillRun, setSkillRunState] = useState(null);
  const [skillRuns, setSkillRuns] = useState([]);
  const [historyOpen, setHistoryOpenState] = useState(false);
  const [chatConversationId, setChatConversationIdState] = useState('');
  const [chatAttachments, setChatAttachments] = useState([]);
  const [chatAttachmentBusy, setChatAttachmentBusy] = useState(false);
  const [chatAttachmentCapabilities, setChatAttachmentCapabilities] = useState(null);
  const [chatIncludeKnowledgeBase, setChatIncludeKnowledgeBaseState] = useState(false);
  const [chatRuntimeRevision, setChatRuntimeRevision] = useState(0);
  const [artifactBusy, setArtifactBusy] = useState('');
  const [agentMode, setAgentModeState] = useState('auto');
  const [smartHome, setSmartHome] = useState(null);
  const [exportDialog, setExportDialog] = useState(null);
  const [smartSearchOpen, setSmartSearchOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState([]);
  const [trendingTopics, setTrendingTopics] = useState([]);
  const [recordingSession, setRecordingSession] = useState(() => { try { return JSON.parse(globalThis.localStorage?.getItem('flowmind.recording.session') || 'null'); } catch { return null; } });
  const endRef = useRef(null);
  const abortRef = useRef(null);
  const readerAskAbortRef = useRef(null);
  const chatAbortControllersRef = useRef(new Map());
  const chatRuntimeRef = useRef(new Map());
  const activeChatTabIdRef = useRef('');
  const chatRestoreRequestRef = useRef(0);
  const chatAttachmentsRef = useRef([]);
  const queryRef = useRef('');
  const chatScopeExplicitRef = useRef(false);
  const chatIncludeKnowledgeBaseRef = useRef(false);
  const chatAttachmentGenerationRef = useRef(0);
  const chatAttachmentBatchRef = useRef(0);
  const graphLoadRef = useRef(null);
  const graphRequestVersionRef = useRef(0);
  const readerHydrateRef = useRef({ documentId: '', conversationId: '' });
  const documentPreviewCacheRef = useRef(new Map());
  const workspaceStorageRef = useRef(null);
  const workspaceSearchRequestRef = useRef(0);
  if (!workspaceStorageRef.current) {
    workspaceStorageRef.current = createWorkspaceStorageAdapter({ onError: (error, operation) => console.warn(`[workspace:${operation}]`, error) });
  }
  const [workspaceSession, dispatchWorkspace] = useReducer(workspaceSessionReducer, null, () => normalizeWorkspaceSession(workspaceStorageRef.current.load(), { recoverRunningTasks: true }));
  const [workspaceCompact, setWorkspaceCompact] = useState(() => {
    try { return globalThis.localStorage?.getItem('flowmind.workspace.compact') === 'true'; } catch { return false; }
  });
  const [workspaceSearch, setWorkspaceSearch] = useState({ open: false, query: '', results: [], total: 0, limited: false, busy: false, error: '', originTabId: '' });
  const [knowledgeIntent, setKnowledgeIntent] = useState('browse');
  const [contextExclusion, setContextExclusion] = useState('');

  const kb = state.knowledgeBases?.find(item => item.id === selectedKb) || state.knowledgeBases?.[0];
  const docs = useMemo(() => (state.documents || []).filter(doc => {
    if (isLibraryNote(doc)) return false;
    if (!selectedKb) return true;
    const documentLibraryId = doc.knowledgeBaseId || doc.spaceId;
    return documentLibraryId ? documentLibraryId === selectedKb : selectedKb === 'feishu-space' || selectedKb === 'local-content';
  }), [state.documents, selectedKb]);
  const conversationMaterials = useMemo(() => {
    const byId = new Map(docs.map(item => [String(item.id), item]));
    for (const note of state.notes || []) {
      if (!note || note.deletedAt || !note.id || byId.has(String(note.id))) continue;
      byId.set(String(note.id), {
        id: note.id,
        title: note.title || '未命名笔记',
        content: note.content || '',
        type: 'note',
        contentType: 'note',
        source: note.source || 'local-note',
        tags: note.tags || [],
        updatedAt: note.updatedAt || note.createdAt || null
      });
    }
    return [...byId.values()];
  }, [docs, state.notes]);
  const activeSkill = skills.find(item => item.id === selectedSkill) || skills[0];
  const runs = skillRuns.length ? skillRuns : (state.skillRuns || []);
  const activeWorkspaceTab = useMemo(() => workspaceSession.tabs.find(tab => tab.id === workspaceSession.activeTabId) || null, [workspaceSession.tabs, workspaceSession.activeTabId]);
  const activeChatTabId = activeWorkspaceTab && isChatWorkspaceTab(activeWorkspaceTab) ? activeWorkspaceTab.id : '';
  activeChatTabIdRef.current = activeChatTabId;
  const activeChatScene = activeChatTabId ? getChatTabScene(activeWorkspaceTab) : createChatTabScene();
  const currentContextDocument = activeWorkspaceTab?.kind === 'document' && contextExclusion !== activeWorkspaceTab.resourceId
    ? { id: activeWorkspaceTab.resourceId, documentId: activeWorkspaceTab.resourceId, title: activeWorkspaceTab.title, source: activeWorkspaceTab.source || '知识库', type: 'document' }
    : activeWorkspaceTab?.contextDocument && contextExclusion !== activeWorkspaceTab.contextDocument.id
      ? activeWorkspaceTab.contextDocument
      : null;
  const currentChatSelection = activeChatTabId ? activeChatScene.selection : null;
  const chatContextItems = currentChatSelection ? [
    {
      id: `chat-selection-${activeChatTabId}`,
      kind: 'selection',
      type: 'selection',
      sourceId: currentChatSelection.documentId,
      documentId: currentChatSelection.documentId,
      title: '当前选区',
      text: currentChatSelection.quote,
      quote: currentChatSelection.quote,
      anchor: currentChatSelection.anchor,
      startOffset: currentChatSelection.startOffset,
      endOffset: currentChatSelection.endOffset
    },
    ...workspaceSession.aiContextItems.filter(item => item?.kind !== 'selection')
  ] : workspaceSession.aiContextItems;
  const workspaceContext = useMemo(() => deriveWorkspaceContext({
    currentDocument: currentContextDocument,
    aiContextItems: chatContextItems,
    selectedDocumentIds: selectedDocs,
    documents: docs,
    activeRoute: active,
    knowledgeBase: kb,
    excludedDocumentId: contextExclusion
  }), [currentContextDocument, chatContextItems, selectedDocs, docs, active, kb, contextExclusion]);
  const workspaceRecentItems = useMemo(() => deriveWorkspaceHomeItems({
    recentWork: workspaceSession.recentWork,
    documents: state.documents,
    tasks: workspaceSession.tasks,
    libraries: knowledgeLibraries.length ? knowledgeLibraries : state.knowledgeBases,
    followedLibraryIds: state.knowledgeLibraryState?.followedIds,
    draftMarkers: workspaceSession.draftMarkers,
    readingPositions: workspaceSession.readingPositions,
    starredIds,
    limit: 8
  }), [workspaceSession.recentWork, workspaceSession.tasks, workspaceSession.draftMarkers, workspaceSession.readingPositions, state.documents, state.knowledgeLibraryState?.followedIds, state.knowledgeBases, knowledgeLibraries, starredIds]);
  const visibleWorkspaceTasks = useMemo(() => workspaceSession.tasks.map(task => ({ ...task, progress: Number(task.progress || 0) <= 1 ? Math.round(Number(task.progress || 0) * 100) : Number(task.progress || 0) })), [workspaceSession.tasks]);

  const shellWorkspaceTabs = useMemo(() => workspaceSession.tabs.map(tab => ({
    ...tab,
    type: tab.type || tab.kind,
    busy: isChatWorkspaceTab(tab) ? Boolean(chatRuntimeRef.current.get(String(tab.id))?.streaming) : false
  })), [workspaceSession.tabs, chatRuntimeRevision]);

  function currentChatTabId() {
    return String(activeChatTabIdRef.current || '');
  }

  function setQuery(updater) {
    const current = queryRef.current;
    const next = typeof updater === 'function' ? updater(current) : updater;
    const normalized = String(next ?? '');
    queryRef.current = normalized;
    setQueryState(normalized);
  }

  function setChatIncludeKnowledgeBase(updater) {
    const current = chatIncludeKnowledgeBaseRef.current;
    const next = typeof updater === 'function' ? updater(current) : updater;
    const normalized = Boolean(next);
    chatIncludeKnowledgeBaseRef.current = normalized;
    setChatIncludeKnowledgeBaseState(normalized);
  }

  function bumpChatRuntimeUI() {
    setChatRuntimeRevision(value => value + 1);
  }

  function persistChatComposer(tabId) {
    const id = String(tabId || '');
    if (!id) return;
    const runtime = chatRuntimeForTab(id);
    const attachments = Array.isArray(chatAttachmentsRef.current) ? chatAttachmentsRef.current : [];
    runtime.query = String(queryRef.current || '');
    runtime.chatAttachments = attachments.map(item => ({ ...item, file: undefined }));
    runtime.attachmentFiles = Object.fromEntries(attachments.filter(item => item?.file && item.clientId).map(item => [item.clientId, item.file]));
    runtime.chatIncludeKnowledgeBase = chatIncludeKnowledgeBaseRef.current === true;
  }

  function restoreChatComposer(runtime) {
    const nextQuery = String(runtime?.query || '');
    const storedAttachments = Array.isArray(runtime?.chatAttachments) ? runtime.chatAttachments : [];
    const attachmentFiles = runtime?.attachmentFiles && typeof runtime.attachmentFiles === 'object' ? runtime.attachmentFiles : {};
    const nextAttachments = storedAttachments.map(item => attachmentFiles[item.clientId] ? { ...item, file: attachmentFiles[item.clientId] } : item);
    const nextIncludeKb = runtime?.chatIncludeKnowledgeBase === true;
    queryRef.current = nextQuery;
    chatAttachmentsRef.current = nextAttachments;
    chatIncludeKnowledgeBaseRef.current = nextIncludeKb;
    setQuery(nextQuery);
    setChatAttachments(nextAttachments);
    setChatIncludeKnowledgeBase(nextIncludeKb);
  }

  function resolveChatTabIdForMessage(message, fallbackTabId = currentChatTabId()) {
    const messageId = String(message?.id || '');
    const explicit = String(message?.chatTabId || '');
    if (explicit) return explicit;
    if (!messageId) return String(fallbackTabId || '');
    for (const [tabId, runtime] of chatRuntimeRef.current.entries()) {
      if ((runtime?.messages || []).some(item => item.id === messageId)) return tabId;
    }
    return String(fallbackTabId || '');
  }

  function chatRuntimeForTab(tabId) {
    const id = String(tabId || '');
    if (!id) return null;
    const current = chatRuntimeRef.current.get(id);
    if (current) return current;
    const created = {
      messages: [], streaming: false, error: '', historyOpen: false, loadedConversationId: '',
      query: '', chatAttachments: [], chatIncludeKnowledgeBase: false
    };
    chatRuntimeRef.current.set(id, created);
    return created;
  }

  function setChatTabScene(tabId, patch) {
    const id = String(tabId || '');
    if (!id) return;
    dispatchWorkspace({ type: 'SET_CHAT_TAB_SCENE', tabId: id, patch });
  }

  function setMessagesForChatTab(tabId, updater) {
    const id = String(tabId || '');
    if (!id) {
      setMessagesState(updater);
      return;
    }
    const runtime = chatRuntimeForTab(id);
    const next = typeof updater === 'function' ? updater(runtime.messages) : updater;
    runtime.messages = Array.isArray(next) ? next : [];
    if (currentChatTabId() === id) setMessagesState(runtime.messages);
    else bumpChatRuntimeUI();
  }

  function setMessages(updater) {
    setMessagesForChatTab(currentChatTabId(), updater);
  }

  function setStreamingForChatTab(tabId, updater) {
    const id = String(tabId || '');
    if (!id) {
      setStreamingState(updater);
      return;
    }
    const runtime = chatRuntimeForTab(id);
    runtime.streaming = typeof updater === 'function' ? Boolean(updater(runtime.streaming)) : Boolean(updater);
    if (currentChatTabId() === id) setStreamingState(runtime.streaming);
    bumpChatRuntimeUI();
  }

  function setStreaming(updater) {
    setStreamingForChatTab(currentChatTabId(), updater);
  }

  function setChatErrorForTab(tabId, updater) {
    const id = String(tabId || '');
    if (!id) {
      setChatErrorState(updater);
      return;
    }
    const runtime = chatRuntimeForTab(id);
    runtime.error = typeof updater === 'function' ? String(updater(runtime.error) || '') : String(updater || '');
    if (currentChatTabId() === id) setChatErrorState(runtime.error);
  }

  function setChatError(updater) {
    setChatErrorForTab(currentChatTabId(), updater);
  }

  function setHistoryOpen(updater) {
    const tabId = currentChatTabId();
    if (!tabId) {
      setHistoryOpenState(updater);
      return;
    }
    const runtime = chatRuntimeForTab(tabId);
    runtime.historyOpen = typeof updater === 'function' ? Boolean(updater(runtime.historyOpen)) : Boolean(updater);
    setHistoryOpenState(runtime.historyOpen);
  }

  function setChatScopeExplicit(value) {
    const normalized = value === true;
    chatScopeExplicitRef.current = normalized;
    setChatScopeExplicitState(normalized);
  }

  function setSelectedDocs(updater) {
    setSelectedDocsState(current => {
      const next = normalizedDocumentIds(typeof updater === 'function' ? updater(current) : updater);
      const tabId = currentChatTabId();
      if (tabId) {
        setChatTabScene(tabId, { documentIds: next, scopeExplicit: true });
        setChatScopeExplicit(true);
      }
      return next;
    });
  }

  function setAgentMode(updater) {
    setAgentModeState(current => {
      const requested = typeof updater === 'function' ? updater(current) : updater;
      const next = agentModeOption(requested).id;
      const tabId = currentChatTabId();
      if (tabId) setChatTabScene(tabId, { agentMode: next });
      return next;
    });
  }

  function setChatConversationIdForTab(tabId, value) {
    const id = String(tabId || '');
    const next = String(value || '');
    if (id) setChatTabScene(id, { conversationId: next || null });
    if (currentChatTabId() === id || !id) setChatConversationIdState(next);
  }

  function setChatConversationId(updater) {
    const tabId = currentChatTabId();
    setChatConversationIdState(current => {
      const next = String(typeof updater === 'function' ? updater(current) : updater || '');
      if (tabId) setChatTabScene(tabId, { conversationId: next || null });
      return next;
    });
  }

  function setSkillRun(updater) {
    setSkillRunState(current => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      const tabId = currentChatTabId();
      if (tabId) setChatTabScene(tabId, { skillRun: next || null });
      return next;
    });
  }

  function closeKnowledgeOverlays() {
    setGraphOpen(false);
    setGraphFocus(null);
  }

  function createChatWorkspaceTab({ id = `chat-${Date.now()}`, title = '新对话', contextDocument = null, scene = {} } = {}) {
    closeKnowledgeOverlays();
    setReaderDetail(null);
    const existing = findChatTabByConversationId(workspaceSession.tabs, scene?.conversationId);
    const tab = existing
      ? {
        ...existing,
        title: title || existing.title,
        contextDocument: contextDocument || existing.contextDocument || null,
        chat: createChatTabScene({ ...getChatTabScene(existing), ...scene }),
        lastActiveAt: Date.now()
      }
      : {
        id, kind: 'chat', type: 'chat', route: 'knowledge', title, contextDocument,
        chat: createChatTabScene(scene), openedAt: Date.now(), lastActiveAt: Date.now()
      };
    setKnowledgeIntent('chat');
    dispatchWorkspace({ type: 'OPEN_TAB', tab });
    setActive('knowledge');
    void preloadWorkspaceSurface('composer-menu');
    void preloadWorkspaceSurface('deep-answer');
    void hydrateChatTab(tab);
    return tab;
  }

  async function hydrateChatTab(tab) {
    const tabId = String(tab?.id || '');
    if (!tabId) return;
    const previousTabId = activeChatTabIdRef.current;
    if (previousTabId && previousTabId !== tabId) persistChatComposer(previousTabId);
    activeChatTabIdRef.current = tabId;
    const scene = getChatTabScene(tab);
    const runtime = chatRuntimeForTab(tabId);
    setSelectedDocsState(scene.documentIds);
    setChatScopeExplicit(scene.scopeExplicit);
    setAgentModeState(scene.agentMode);
    setChatConversationIdState(scene.conversationId || '');
    setSkillRunState(scene.skillRun ? { ...scene.skillRun, running: false, recoverable: scene.skillRun.recoverable || scene.skillRun.status === 'recoverable' || scene.skillRun.status === 'failed' } : null);
    setMessagesState(runtime.messages);
    setStreamingState(Boolean(runtime.streaming));
    setChatErrorState(runtime.error || '');
    setHistoryOpenState(Boolean(runtime.historyOpen));
    restoreChatComposer(runtime);
    if (!scene.conversationId || runtime.loadedConversationId === scene.conversationId || runtime.loadingConversationId === scene.conversationId) return;
    runtime.loadingConversationId = scene.conversationId;
    const requestId = ++chatRestoreRequestRef.current;
    try {
      const data = await fetch(`/api/conversations/${encodeURIComponent(scene.conversationId)}`, { cache: 'no-store' }).then(parseResponse);
      if (requestId < chatRestoreRequestRef.current && currentChatTabId() === tabId) return;
      restoreConversation(data.conversation, tabId);
    } catch (error) {
      setChatErrorForTab(tabId, errText(error, '会话恢复失败，请重试'));
    } finally {
      const current = chatRuntimeForTab(tabId);
      if (current) current.loadingConversationId = '';
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      fetch('/api/state').then(parseResponse),
      fetch('/api/settings/model').then(parseResponse),
      fetch('/api/skills').then(parseResponse),
      fetch('/api/content/items?limit=500').then(parseResponse),
      fetch('/api/knowledge/libraries').then(parseResponse),
      fetch('/api/home').then(parseResponse),
      fetch('/api/search/history').then(parseResponse),
      fetch('/api/search/trending').then(parseResponse)
    ]).then(([stateResult, modelResult, skillResult, contentResult, libraryResult, homeResult, historyResult, trendingResult]) => {
      if (cancelled) return;
      const rawContentItems = contentResult.status === 'fulfilled' && Array.isArray(contentResult.value.items) ? contentResult.value.items : null;
      const loadedLibraries = libraryResult.status === 'fulfilled' && Array.isArray(libraryResult.value.libraries) ? libraryResult.value.libraries : [];
      const libraryBySpaceId = new Map(loadedLibraries.filter(item => item.spaceId).map(item => [item.spaceId, item.id]));
      const contentItems = rawContentItems?.map(item => ({ ...item, knowledgeBaseId: item.knowledgeBaseId || libraryBySpaceId.get(item.spaceId) || item.spaceId || null })) || null;
      if (stateResult.status === 'fulfilled') {
        const next = stateResult.value;
        if (Array.isArray(next.starredIds)) setStarredIds(next.starredIds.map(String));
        const fallbackBases = Array.isArray(next.knowledgeBases) && next.knowledgeBases.length ? next.knowledgeBases : [{ id: 'local-content', name: '本地知识库', source: 'local', documentCount: 0 }];
        const libraries = loadedLibraries.length ? loadedLibraries : fallbackBases;
        const libraryBySpace = new Map(libraries.filter(item => item.spaceId).map(item => [item.spaceId, item.id]));
        const documents = contentItems || next.documents || [];
        const normalizedDocuments = documents.map(item => ({ ...item, knowledgeBaseId: item.knowledgeBaseId || libraryBySpace.get(item.spaceId) || item.spaceId || null }));
        setKnowledgeLibraries(libraries);
        // Keep the unified projection contract explicit: setState({ ...next, documents, ... }).
        setState({ ...next, documents: normalizedDocuments, knowledgeBases: libraries, knowledgeLibraryState: libraryResult.status === 'fulfilled' ? { followedIds: libraryResult.value.followedIds || [], refreshedAt: libraryResult.value.refreshedAt || null } : next.knowledgeLibraryState });
        setSkillRuns(Array.isArray(next.skillRuns) ? [...next.skillRuns].reverse() : []);
        const requestedKb = next.settings?.activeKnowledgeBaseId;
        setSelectedKb(resolveDefaultLibrary(libraries, { preferredId: requestedKb, documents: normalizedDocuments }));
      } else if (contentItems) {
        setKnowledgeLibraries(loadedLibraries);
        setState(current => ({ ...current, documents: contentItems, knowledgeBases: loadedLibraries.length ? loadedLibraries : current.knowledgeBases }));
      }
      if (modelResult.status === 'fulfilled') {
        const normalized = normalizeModel(modelResult.value);
        setModelSettings(normalized); setModelForm(normalized);
      }
      if (skillResult.status === 'fulfilled' && Array.isArray(skillResult.value.skills)) {
        setSkills(skillResult.value.skills);
        if (skillResult.value.skills[0]) setSelectedSkill(skillResult.value.skills[0].id);
      }
      if (homeResult.status === 'fulfilled') {
        setSmartHome(homeResult.value);
      }
      if (historyResult.status === 'fulfilled' && Array.isArray(historyResult.value.history)) {
        setSearchHistory(historyResult.value.history);
      }
      if (trendingResult.status === 'fulfilled' && Array.isArray(trendingResult.value.trending)) {
        setTrendingTopics(trendingResult.value.trending);
      }
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const last = messages[messages.length - 1];
    scrollTranscriptToEnd(endRef.current, { streaming, force: last?.role === 'user' });
  }, [messages, skillRun, streaming]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const warm = () => {
      for (const route of ['notes', 'knowledge', 'settings', 'copilots', 'collect', 'analysis', 'web']) void preloadWorkspaceRoute(route);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(warm, { timeout: 1800 });
      return () => window.cancelIdleCallback?.(idleId);
    }
    const timer = window.setTimeout(warm, 400);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => () => {
    abortRef.current?.abort();
    for (const controller of chatAbortControllersRef.current.values()) controller.abort();
    chatAbortControllersRef.current.clear();
  }, []);
  useEffect(() => { chatAttachmentsRef.current = chatAttachments; }, [chatAttachments]);
  useEffect(() => {
    fetch('/api/chat/attachments/capabilities').then(parseResponse).then(setChatAttachmentCapabilities).catch(() => null);
    return () => {
      for (const item of chatAttachmentsRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        if (item.temporaryId) fetch(`/api/chat/attachments/${encodeURIComponent(item.temporaryId)}`, { method: 'DELETE', keepalive: true }).catch(() => null);
      }
    };
  }, []);
  useEffect(() => { workspaceStorageRef.current.save(workspaceSession); }, [workspaceSession]);
  useEffect(() => { try { if (recordingSession) globalThis.localStorage?.setItem('flowmind.recording.session', JSON.stringify(recordingSession)); else globalThis.localStorage?.removeItem('flowmind.recording.session'); } catch {} }, [recordingSession]);
  useEffect(() => {
    try { globalThis.localStorage?.setItem('flowmind.workspace.compact', String(workspaceCompact)); } catch {}
  }, [workspaceCompact]);
  useEffect(() => {
    const tab = workspaceSession.tabs.find(item => item.id === workspaceSession.activeTabId) || null;
    if (!tab) { activeChatTabIdRef.current = ''; setActive('home'); clearHomeAskResidue(); return; }
    const route = tab.route || (tab.kind === 'document' || tab.kind === 'chat' ? 'knowledge' : tab.kind);
    setActive(route || 'knowledge');
    setContextExclusion('');
    if (isChatWorkspaceTab(tab)) void hydrateChatTab(tab);
    if (route === 'graph' && !graphData) {
      void requestGraphSnapshot().catch(error => notify(errText(error, '知识图谱加载失败'), 'error'));
    }
    if (tab.kind === 'document' && tab.resourceId && readerChat.documentId && readerChat.documentId !== tab.resourceId) {
      readerAskAbortRef.current?.abort();
    }
    if (tab.kind === 'document' && tab.resourceId) {
      // 仅当 Tab 明确绑定历史版本时才回源历史端点；当前文档始终读取最新正文，避免 OCR/版本更新后被旧快照覆盖。
      const historicalRequested = ['stale', 'unavailable'].includes(String(tab.evidenceStatus || '').toLowerCase()) || tab.isHistoricalVersion === true;
      const requestedVersionId = historicalRequested ? (tab.contentVersionId ?? null) : null;
      const loadedVersionId = readerDetail?.item?.contentVersionId ?? null;
      const needsDocument = readerDetail?.item?.id !== tab.resourceId;
      const needsVersion = requestedVersionId !== null && String(loadedVersionId) !== String(requestedVersionId);
      if (needsDocument || needsVersion) {
        loadWorkspaceDocument(tab.resourceId, requestedVersionId).then(data => {
          setReaderEvidence(current => ({
            ...(current || {}),
            ...(data?.evidence || {}),
            ...(tab.evidenceStatus ? { evidenceStatus: tab.evidenceStatus, evidenceStatusReason: tab.evidenceStatusReason || current?.evidenceStatusReason || null } : {})
          }));
        }).catch(error => notify(errText(error, '文档恢复失败'), 'error'));
      }
    }
  }, [workspaceSession.activeTabId, readerDetail?.item?.id, readerDetail?.item?.contentVersionId, graphData]);

  useEffect(() => {
    const itemId = String(readerDetail?.item?.id || '');
    if (!itemId) return undefined;
    const tab = workspaceSession.tabs.find(entry => entry.kind === 'document' && String(entry.resourceId) === itemId);
    const conversationId = String(tab?.readerConversationId || '');
    if (readerChat.streaming && readerChat.documentId === itemId) return undefined;
    if (readerChat.documentId === itemId && String(readerChat.conversationId || '') === conversationId && (conversationId || readerChat.messages.length)) return undefined;
    if (!conversationId) {
      if (readerChat.documentId !== itemId) {
        readerHydrateRef.current = { documentId: itemId, conversationId: '' };
        setReaderChat({ documentId: itemId, conversationId: '', messages: [], streaming: false, error: '' });
      }
      return undefined;
    }
    if (readerHydrateRef.current.documentId === itemId && readerHydrateRef.current.conversationId === conversationId && readerChat.documentId === itemId) return undefined;
    readerHydrateRef.current = { documentId: itemId, conversationId };
    let cancelled = false;
    fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, { cache: 'no-store' })
      .then(parseResponse)
      .then(data => {
        if (cancelled) return;
        const restored = restoredReaderChat(data.conversation, itemId);
        if (restored) setReaderChat(restored);
        else dispatchWorkspace({ type: 'UPDATE_TAB', tabId: `document-${itemId}`, patch: { readerConversationId: null } });
      })
      .catch(() => {
        if (!cancelled) setReaderChat(current => current.documentId === itemId ? current : { documentId: itemId, conversationId: '', messages: [], streaming: false, error: '' });
      });
    return () => { cancelled = true; };
  }, [readerDetail?.item?.id, workspaceSession.tabs, readerChat.conversationId, readerChat.documentId, readerChat.streaming, readerChat.messages.length]);

  const notify = (message, kind = 'success') => setToast({ message, kind });

  useEffect(() => {
    const result = consumeFeishuLoginQuery(window.location.search);
    if (result) {
      notify(result.message, result.ok ? 'success' : 'error');
      window.history.replaceState({}, '', `${window.location.pathname}${result.nextSearch}${window.location.hash}`);
    }
    fetch('/api/settings/feishu').then(parseResponse).then(settings => {
      setFeishuUser(settings.user || { loggedIn: false });
    }).catch(() => {});
  }, []);

  async function handleFeishuUserLogin() {
    try {
      await startFeishuUserLogin();
    } catch (error) {
      notify(errText(error, '无法打开飞书登录'), 'error');
    }
  }

  function moduleTab(id, overrides = {}) {
    const definitions = {
      knowledge: { title: '知识库', type: 'chat' },
      graph: { title: '知识图谱', type: 'graph' },
      evidence: { title: '证据工作台', type: 'document' },
      analysis: { title: '文档解读', type: 'document' },
      skills: { title: 'Skill 工作台', type: 'skill' },
      notes: { title: '笔记', type: 'note' },
      writing: { title: '写作', type: 'document' },
      copilots: { title: 'Copilot', type: 'chat' },
      settings: { title: '设置', type: 'document' },
      recording: { title: '录音纪要', type: 'document' }
    };
    const definition = definitions[id] || { title: id, type: 'document' };
    return {
      id: `module-${id}`, kind: id === 'knowledge' ? 'chat' : 'module', route: id, closable: true,
      ...definition, ...overrides,
      ...(id === 'knowledge' ? { chat: createChatTabScene(overrides.chat) } : {}),
      openedAt: Date.now(), lastActiveAt: Date.now()
    };
  }

  function openWorkspaceModule(id, overrides = {}) {
    void preloadWorkspaceRoute(id);
    if (id === 'home') {
      closeKnowledgeOverlays();
      activeChatTabIdRef.current = '';
      dispatchWorkspace({ type: 'ACTIVATE_HOME' });
      setActive('home');
      clearHomeAskResidue();
      return;
    }
    if (id === 'knowledge') {
      setReaderDetail(null);
      setGraphOpen(false);
      setKnowledgeIntent('browse');
    }
    if (id === 'graph') { setReaderDetail(null); setGraphOpen(false); }
    const candidate = moduleTab(id, overrides);
    const existing = isChatWorkspaceTab(candidate) ? workspaceSession.tabs.find(item => item.id === candidate.id) : null;
    const tab = existing ? { ...candidate, chat: getChatTabScene(existing) } : candidate;
    if (isChatWorkspaceTab(tab)) activeChatTabIdRef.current = tab.id;
    dispatchWorkspace({ type: 'OPEN_TAB', tab });
    if (isChatWorkspaceTab(tab)) void hydrateChatTab(tab);
    setActive(id);
    if (id === 'knowledge') {
      window.requestAnimationFrame(() => {
        document.querySelector('input[name="knowledge-document-search"]')?.focus();
      });
    }
  }

  function rememberDocumentRequest(cacheKey, promise) {
    const cache = documentPreviewCacheRef.current;
    cache.set(cacheKey, promise);
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    return promise;
  }

  async function fetchWorkspaceDocument(documentId, versionId = null) {
    const id = String(documentId || '');
    if (!id) return null;
    const requestedVersionId = versionId !== null && versionId !== undefined && String(versionId) !== '' ? String(versionId) : '';
    const cacheKey = `${id}::${requestedVersionId}`;
    const cached = documentPreviewCacheRef.current.get(cacheKey);
    if (cached) return cached;
    const endpoint = requestedVersionId
      ? `/api/content/items/${encodeURIComponent(id)}/versions/${encodeURIComponent(requestedVersionId)}`
      : `/api/content/items/${encodeURIComponent(id)}`;
    const request = fetch(endpoint).then(parseResponse).then(data => {
      if (requestedVersionId && data.version) {
        const current = data.current || {};
        const version = data.version;
        data.versions ||= [];
        data.item = {
          ...(data.item || {}),
          content: String(version.content || ''),
          markdown: String(version.content || ''),
          contentVersionId: version.id,
          revision: version.revision ?? null,
          contentHash: version.contentHash ?? null,
          currentVersionId: current.versionId ?? data.item?.currentVersionId ?? null,
          currentRevision: current.revision ?? data.item?.revision ?? null,
          currentContentHash: current.contentHash ?? data.item?.contentHash ?? null,
          isHistoricalVersion: current.versionId != null && String(current.versionId) !== String(version.id)
        };
        data.evidence ||= {
          documentId: id,
          title: data.item.title,
          contentVersionId: version.id,
          revision: version.revision ?? null,
          contentHash: version.contentHash ?? null,
          currentVersionId: current.versionId ?? null,
          currentRevision: current.revision ?? null,
          currentContentHash: current.contentHash ?? null,
          evidenceStatus: data.item.isHistoricalVersion ? 'stale' : 'current',
          evidenceStatusReason: data.item.isHistoricalVersion ? 'content_version_changed' : null
        };
      }
      return data;
    }).catch(error => {
      documentPreviewCacheRef.current.delete(cacheKey);
      throw error;
    });
    return rememberDocumentRequest(cacheKey, request);
  }

  function prefetchWorkspaceDocument(documentOrId) {
    void preloadWorkspaceSurface('content-reader');
    const id = String(typeof documentOrId === 'string' ? documentOrId : documentOrId?.documentId || documentOrId?.id || '');
    if (!id) return;
    void fetchWorkspaceDocument(id).catch(() => undefined);
  }

  async function loadWorkspaceDocument(documentId, versionId = null) {
    const id = String(documentId || '');
    if (!id) return null;
    setReaderBusy(true);
    setGraphOpen(false);
    try {
      const data = await fetchWorkspaceDocument(id, versionId);
      setReaderDetail(data);
      return data;
    } finally {
      setReaderBusy(false);
    }
  }

  function clearHomeAskResidue() {
    setSelectedDocsState([]);
    for (const item of workspaceSession.aiContextItems) {
      const leftoverDocument = item?.kind === 'document' && String(item.id || '').startsWith('context-document-');
      if (leftoverDocument || item?.kind === 'selection') {
        dispatchWorkspace({ type: 'REMOVE_AI_CONTEXT_ITEM', id: item.id });
      }
    }
  }

  function activateWorkspaceTab(tab) {
    if (!tab) {
      closeKnowledgeOverlays();
      if (activeChatTabIdRef.current) persistChatComposer(activeChatTabIdRef.current);
      activeChatTabIdRef.current = '';
      dispatchWorkspace({ type: 'ACTIVATE_HOME' });
      setActive('home');
      clearHomeAskResidue();
      setQuery('');
      setChatAttachments([]);
      setChatIncludeKnowledgeBase(true);
      return;
    }
    closeKnowledgeOverlays();
    const chatTab = isChatWorkspaceTab(tab);
    if (chatTab && tab.id !== 'module-knowledge') setKnowledgeIntent('chat');
    dispatchWorkspace({ type: 'ACTIVATE_TAB', tabId: tab.id, at: Date.now() });
    if (chatTab) void hydrateChatTab(tab);
    else {
      if (activeChatTabIdRef.current) persistChatComposer(activeChatTabIdRef.current);
      activeChatTabIdRef.current = '';
    }
    const route = tab.route || (tab.kind === 'document' || tab.kind === 'chat' ? 'knowledge' : tab.kind);
    setActive(route || 'knowledge');
  }

  function closeWorkspaceTab(tab) {
    const tabId = String(tab?.id || '');
    if (tabId) {
      chatAbortControllersRef.current.get(tabId)?.abort();
      chatAbortControllersRef.current.delete(tabId);
      chatRuntimeRef.current.delete(tabId);
    }
    dispatchWorkspace({ type: 'CLOSE_TAB', tabId });
    if (tab?.kind === 'document' && readerDetail?.item?.id === tab.resourceId) {
      setReaderDetail(null);
      setReaderEvidence(null);
    }
  }

  function contextDocumentIds(context = workspaceContext) {
    return [...new Set([context.currentDocument, ...(context.resources || [])]
      .map(item => item?.documentId || item?.sourceId || (item?.type === 'document' || item?.type === 'note' || item?.contentType === 'note' ? item?.id : ''))
      .filter(Boolean))];
  }

  function handleWorkspaceAsk(prompt, context = workspaceContext) {
    const onHome = !activeWorkspaceTab;
    const explicitDocumentId = String(context?.currentDocument?.documentId || context?.currentDocument?.id || context?.currentDocument?.sourceId || '').trim();
    const askContext = (onHome && !explicitDocumentId)
      ? { currentDocument: null, selection: null, resources: [] }
      : context;
    setGraphOpen(false);
    const documentIds = contextDocumentIds(askContext);
    const selection = askContext?.selection ? {
      documentId: String(askContext.selection.documentId || askContext.selection.sourceId || askContext.currentDocument?.documentId || askContext.currentDocument?.id || ''),
      quote: String(askContext.selection.quote || askContext.selection.text || '').trim(),
      anchor: askContext.selection.anchor || null,
      startOffset: askContext.selection.startOffset,
      endOffset: askContext.selection.endOffset
    } : null;
    setReaderDetail(null);
    const tab = createChatWorkspaceTab({
      title: String(prompt || askContext.currentDocument?.title || 'AI 问答').slice(0, 26),
      contextDocument: askContext.currentDocument || null,
      scene: { documentIds, selection, agentMode: 'auto' }
    });
    const text = String(prompt || '').trim();
    if (text) void ask(prompt, documentIds, '', null, 'auto', selection, tab.id);
  }

  function readerWorkspaceContext(item, selection = null, { includeWorkspaceResources = false } = {}) {
    const currentDocument = item ? { ...item, id: item.id, documentId: item.id, type: 'document', source: item.sourceType || item.source || '知识库' } : null;
    const resources = includeWorkspaceResources
      ? (workspaceContext.resources || []).filter(resource => String(resource?.documentId || resource?.sourceId || resource?.id || '') !== String(item?.id || ''))
      : [];
    return { currentDocument, selection, resources };
  }

  function readerAskSelection(item, selection = null) {
    if (!selection?.quote && !selection?.text) return null;
    return {
      documentId: String(selection.documentId || selection.sourceId || item?.id || ''),
      quote: String(selection.quote || selection.text || '').trim(),
      anchor: selection.anchor || null,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset
    };
  }

  function handleStopReaderAsk() {
    readerAskAbortRef.current?.abort();
  }

  function handleRetryReaderAsk(item) {
    if (!item?.id || readerChat.streaming) return;
    const failed = [...(readerChat.documentId === item.id ? readerChat.messages : [])].reverse().find(message => message.role === 'assistant' && (message.error || !message.done));
    const prompt = failed?.question || [...(readerChat.documentId === item.id ? readerChat.messages : [])].reverse().find(message => message.role === 'user')?.text || '';
    if (prompt) handleReaderAsk(prompt, item, failed?.selection || null);
  }

  function hasReaderSelection(selection) {
    if (!selection || typeof selection !== 'object') return false;
    return Boolean(String(selection.quote || selection.text || '').trim() || selection.anchor);
  }

  function handleContinueReaderInWorkspace(item, { selection = null, messages = [] } = {}) {
    if (!item?.id) return;
    const documentId = String(item.id);
    const rows = Array.isArray(messages) && messages.length
      ? messages
      : (readerChat.documentId === item.id ? readerChat.messages : []);
    const lastUser = [...rows].reverse().find(message => message.role === 'user');
    const resolvedSelection = readerAskSelection(item, lastUser?.selection || selection);
    toggleReaderQuestionScope(item, true);
    setGraphOpen(false);
    setReaderDetail(null);
    const readerConversationId = readerChat.documentId === item.id ? String(readerChat.conversationId || '') : '';
    const tab = createChatWorkspaceTab({
      title: `继续·${(item.title || '文档').slice(0, 16)}`,
      contextDocument: {
        id: documentId,
        documentId,
        title: item.title || '文档',
        source: item.source || item.sourceType || '知识库',
        type: 'document'
      },
      scene: {
        documentIds: [documentId],
        selection: resolvedSelection,
        agentMode: 'auto',
        conversationId: readerConversationId || null
      }
    });
    if (rows.length) {
      const seeded = rows.map(message => ({
        ...message,
        done: message.role === 'assistant' ? Boolean(message.done ?? message.text) : undefined,
        restored: true
      }));
      const runtime = chatRuntimeForTab(tab.id);
      runtime.messages = seeded;
      if (readerConversationId) runtime.loadedConversationId = readerConversationId;
      if (currentChatTabId() === tab.id) setMessagesState(seeded);
    }
    setQuery('');
  }

  function handleWorkspaceAskAboutNote(note, prompt = '') {
    if (!note?.id) return;
    const noteId = String(note.id);
    const resources = (Array.isArray(note.sourceRefs) ? note.sourceRefs : []).map((ref, index) => ({
      ...ref,
      id: ref.id || `note-source-${index}`,
      type: 'document',
      documentId: ref.documentId || ref.contentItemId || '',
      title: ref.title || '来源文档'
    })).filter(item => item.documentId || item.title);
    handleWorkspaceAsk(prompt, {
      currentDocument: {
        id: noteId,
        documentId: noteId,
        noteId,
        title: note.title || '笔记',
        type: 'note',
        source: '笔记'
      },
      selection: null,
      resources
    });
  }

  function handleReaderAsk(prompt, item, selection = null) {
    const text = String(prompt || '').trim();
    if (!text && !hasReaderSelection(selection)) {
      const documentId = String(item?.id || '');
      if (documentId) toggleReaderQuestionScope(item, true);
      createChatWorkspaceTab({
        title: `问《${item?.title || '文档'}》`,
        contextDocument: {
          id: documentId,
          documentId,
          title: item?.title || '文档',
          source: item?.source || item?.sourceType || '知识库',
          type: 'document'
        },
        scene: { documentIds: documentId ? [documentId] : [], agentMode: 'auto' }
      });
      return;
    }
    
    // 否则在阅读器内部发起对话
    if (!text || !item?.id || readerChat.streaming) return;
    toggleReaderQuestionScope(item, true);
    void streamReaderAsk(text, item, readerAskSelection(item, selection));
  }

  function persistReaderConversation(documentId, conversationId) {
    const id = String(documentId || '');
    const conversation = String(conversationId || '');
    if (!id || !conversation) return;
    dispatchWorkspace({ type: 'UPDATE_TAB', tabId: `document-${id}`, patch: { readerConversationId: conversation } });
  }

  async function streamReaderAsk(text, item, selection = null) {
    const documentIds = contextDocumentIds(readerWorkspaceContext(item, selection));
    const assistantId = `reader-assistant-${Date.now()}`;
    const userMessage = { id: `reader-user-${Date.now()}`, role: 'user', text, documentIds, selection };
    const assistantMessage = { id: assistantId, role: 'assistant', text: '', citations: [], status: '正在检索这篇材料', documentIds, selection, question: text };
    readerAskAbortRef.current?.abort();
    const controller = new AbortController();
    readerAskAbortRef.current = controller;
    const existingConversationId = readerChat.documentId === item.id ? String(readerChat.conversationId || '') : '';
    let streamBatcher = null;
    setReaderChat(current => ({
      documentId: item.id,
      conversationId: current.documentId === item.id ? (current.conversationId || existingConversationId) : existingConversationId,
      streaming: true,
      error: '',
      messages: current.documentId === item.id ? [...current.messages, userMessage, assistantMessage] : [userMessage, assistantMessage]
    }));
    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          query: text,
          question: text,
          mode: 'auto',
          knowledgeBaseId: selectedKb,
          documentIds,
          selection: selection || undefined,
          includeKnowledgeBase: false,
          conversationId: existingConversationId || undefined,
          surface: 'reader',
          readerDocumentId: item.id
        })
      });
      streamBatcher = createStreamEventBatcher({
        onFlush(events) {
          setReaderChat(current => {
            if (current.documentId !== item.id) return current;
            const conversationId = events.reduce((id, event) => event.conversationId || id, current.conversationId || '');
            if (events.some(event => event.type === 'done') && conversationId) persistReaderConversation(item.id, conversationId);
            return {
              ...current,
              conversationId,
              messages: current.messages.map(message => {
                if (message.id !== assistantId) return message;
                return events.reduce((next, event) => applyAssistantStreamEvent(next, event, {
                  startStatus: startEvent => startEvent.fastReply ? '' : (startEvent.executionMode === 'research' ? '正在查证资料' : '正在看这篇')
                }), message);
              })
            };
          });
        }
      });
      await readNdjson(response, event => streamBatcher.push(event), controller.signal);
      streamBatcher.flush();
    } catch (error) {
      streamBatcher?.flush();
      if (error.name === 'AbortError') {
        setReaderChat(current => current.documentId !== item.id ? current : {
          ...current,
          messages: current.messages.map(message => message.id === assistantId ? { ...message, status: '', stopped: true, text: message.text || '已停止生成。' } : message)
        });
      } else {
        const message = formatModelError(error, '模型渠道不可用');
        setReaderChat(current => current.documentId !== item.id ? current : {
          ...current,
          error: message,
          messages: current.messages.map(row => row.id === assistantId ? { ...row, status: '', error: message, errorCode: error?.code || null, errorStatus: error?.status || null, text: row.text } : row)
        });
      }
    } finally {
      if (readerAskAbortRef.current === controller) readerAskAbortRef.current = null;
      setReaderChat(current => current.documentId !== item.id ? current : { ...current, streaming: false });
    }
  }

  async function handleReaderResyncAttachments(item) {
    const id = String(item?.id || readerDetail?.item?.id || '');
    if (!id || readerResyncBusy) return;
    setReaderResyncBusy(true);
    setReaderResyncError('');
    try {
      const data = await fetch(`/api/content/items/${encodeURIComponent(id)}/attachments/resync`, { method: 'POST' }).then(parseResponse);
      setReaderDetail(current => {
        if (current?.item?.id !== id) return current;
        const nextItem = data.item ? { ...current.item, ...data.item } : {
          ...current.item,
          metadata: { ...(current.item?.metadata || {}), assetWarnings: data.warnings || current.item?.metadata?.assetWarnings }
        };
        return { ...current, item: nextItem, attachments: data.attachments || current.attachments || [] };
      });
      if (data.imported) notify(data.message || `已补拉 ${data.imported} 个附件`);
      else if (data.warnings?.length) setReaderResyncError(data.message || data.warnings[0]?.message || '部分附件仍然拉不下来');
      else notify(data.message || '没有需要补拉的附件');
    } catch (error) {
      setReaderResyncError(errText(error, '重新拉取附件失败'));
    } finally {
      setReaderResyncBusy(false);
    }
  }

  function handleReaderCreateWriting(item, selection = null) {
    return handleWorkspaceCreateWriting(readerWorkspaceContext(item, selection));
  }

  function handleKnowledgeObservationAsk(prompt, node, relatedNodes = []) {
    const materialFromNode = item => item && (item.type === 'document' || item.type === 'note')
      ? { ...(item.raw || {}), id: item.sourceId, documentId: item.sourceId, title: item.label, type: item.type, contentType: item.type }
      : null;
    const currentDocument = materialFromNode(node);
    const sourceRefs = Array.isArray(node?.raw?.sourceRefs) ? node.raw.sourceRefs : [];
    const relatedDocuments = relatedNodes.map(materialFromNode).filter(Boolean);
    handleWorkspaceAsk(prompt, { currentDocument, resources: [...sourceRefs, ...relatedDocuments] });
  }
  function handleReaderSelection(selection, source) {
    const existing = workspaceSession.aiContextItems.find(item => item.kind === 'selection');
    if (existing) dispatchWorkspace({ type: 'REMOVE_AI_CONTEXT_ITEM', id: existing.id });
    dispatchWorkspace({ type: 'ADD_AI_CONTEXT_ITEM', item: { id: `selection-${source?.id || 'document'}`, kind: 'selection', type: 'selection', sourceId: source?.id, documentId: source?.id, title: source?.title || '\u5f53\u524d\u9009\u533a', text: selection.text, quote: selection.quote, anchor: selection.anchor, startOffset: selection.startOffset, endOffset: selection.endOffset } });
  }

  function handleReaderPosition(position, source) {
    if (!source?.id) return;
    dispatchWorkspace({ type: 'SET_READING_POSITION', resourceId: source.id, position: { ...position, updatedAt: new Date().toISOString() } });
  }

  async function handleWorkspaceSearch(text) {
    const value = String(text || '').trim();
    if (!value) return;
    const requestId = workspaceSearchRequestRef.current + 1;
    workspaceSearchRequestRef.current = requestId;
    setWorkspaceSearch({ open: true, query: value, results: [], total: 0, limited: false, busy: true, error: '', originTabId: '' });
    try {
      const data = await fetch(`/api/search?q=${encodeURIComponent(value)}&limit=40`).then(parseResponse);
      if (requestId !== workspaceSearchRequestRef.current) return;
      setWorkspaceSearch({ open: true, query: value, results: Array.isArray(data.results) ? data.results : [], total: Number(data.total || 0), limited: Boolean(data.limited), busy: false, error: '', originTabId: '' });
    } catch (error) {
      if (requestId !== workspaceSearchRequestRef.current) return;
      setWorkspaceSearch({ open: true, query: value, results: [], total: 0, limited: false, busy: false, error: errText(error, '搜索失败，请重试'), originTabId: '' });
    }
  }

  function closeWorkspaceSearch() {
    workspaceSearchRequestRef.current += 1;
    setWorkspaceSearch(current => ({ ...current, open: false, busy: false, error: '' }));
  }

  function reopenWorkspaceSearch() {
    if (!workspaceSearch.query || !workspaceSearch.results.length) return;
    setWorkspaceSearch(current => ({ ...current, open: true, busy: false, error: '' }));
  }

  function openWorkspaceSearchPanel(text = '') {
    const value = String(text || '').trim();
    if (value) return handleWorkspaceSearch(value);
    setWorkspaceSearch(current => ({
      open: true,
      query: current.query || '',
      results: Array.isArray(current.results) ? current.results : [],
      total: Number(current.total || 0),
      limited: Boolean(current.limited),
      busy: false,
      error: current.error || '',
      originTabId: current.originTabId || ''
    }));
  }

  function rememberSearchOrigin(tabId) {
    const id = String(tabId || '');
    if (!id) return;
    setWorkspaceSearch(current => current.originTabId === id ? current : { ...current, originTabId: id });
  }

  async function openWorkspaceSearchResult(result) {
    if (!result?.id) return;
    closeWorkspaceSearch();
    const type = searchResultType(result);
    if (type === 'document') {
      await openContentReader({ id: result.id, title: result.title, excerpt: result.excerpt });
      rememberSearchOrigin(`document-${result.id}`);
      return;
    }
    if (type === 'note') {
      handleOpenRecent({ ...result, kind: 'note', type: 'note', noteId: result.id });
      rememberSearchOrigin(`note-${result.id}`);
      return;
    }
    if (type === 'conversation') {
      try {
        const data = await fetch(`/api/conversations/${encodeURIComponent(result.conversationId || result.id)}`).then(parseResponse);
        setReaderDetail(null);
        setGraphOpen(false);
        const tab = createChatWorkspaceTab({
          title: result.title || '历史会话',
          scene: { conversationId: data.conversation?.id || result.conversationId || result.id }
        });
        rememberSearchOrigin(tab.id);
        restoreConversation(data.conversation, tab.id);
      } catch (error) {
        notify(errText(error, '历史会话打开失败'), 'error');
      }
    }
  }

  async function handleWorkspaceCreateNote(context = workspaceContext) {
    const draft = buildWorkspaceContextNote(context);
    try {
      const data = await fetch('/api/notes', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft)
      }).then(parseResponse);
      const note = openCreatedWorkspaceNote(data.note, {
        sourceDocumentId: draft.sourceRefs.find(ref => ref.documentId)?.documentId || '',
        summary: context.selection ? '基于当前选区创建' : '基于当前飞书上下文创建'
      });
      notify(`已创建并打开笔记：${note.title}`);
      return note;
    } catch (error) {
      notify(errText(error, '上下文笔记创建失败'), 'error');
      return null;
    }
  }

  async function handleWorkspaceCreateProblemNote(context = workspaceContext) {
    const selection = String(context?.selection?.quote || context?.selection?.text || '').trim();
    const draft = problemNoteDraft({
      question: selection ? selection.slice(0, 80) : (context?.currentDocument?.title ? `关于「${context.currentDocument.title}」容易忘的点` : ''),
      pitfall: selection ? `选区：${selection.slice(0, 160)}` : ''
    });
    const sourceRefs = [];
    if (context?.currentDocument?.id) {
      sourceRefs.push({
        documentId: context.currentDocument.id,
        title: context.currentDocument.title,
        quote: selection || undefined,
        selection: Boolean(selection),
        ...(context.selection?.anchor ? { anchor: context.selection.anchor } : {})
      });
    }
    try {
      const data = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, sourceRefs })
      }).then(parseResponse);
      const note = openCreatedWorkspaceNote(data.note, {
        sourceDocumentId: sourceRefs[0]?.documentId || '',
        summary: '问题记录'
      });
      notify(`已创建问题记录：${note.title}`);
      return note;
    } catch (error) {
      notify(errText(error, '问题记录创建失败'), 'error');
      return null;
    }
  }

  function handleOpenWeb(rawUrl = '') {
    let href = String(rawUrl || '').trim();
    try {
      if (href) href = normalizeClientBrowseUrl(href).href;
    } catch (error) {
      notify(errText(error, '网址无效'), 'error');
      return null;
    }
    void preloadWorkspaceRoute('web');
    const tab = createWebWorkspaceTab({ url: href, title: href || '网页' });
    dispatchWorkspace({ type: 'OPEN_TAB', tab });
    if (href) dispatchWorkspace({ type: 'TOUCH_RECENT_WORK', item: { id: `recent-web-${href}`, kind: 'web', type: 'web', url: href, title: href, summary: '内嵌网页', updatedAt: new Date().toISOString() } });
    return tab;
  }

  async function handleClipWebToProblemNote(clip) {
    try {
      const href = normalizeClientBrowseUrl(clip?.url).href;
      const payload = { ...clip, url: href };
      const notes = await fetch('/api/notes').then(parseResponse).then(body => body.notes || []);
      const targetNote = pickProblemNoteForWebClip({ tabs: workspaceSession.tabs, notes, preferredId: clip?.targetNoteId });
      if (targetNote) {
        const content = appendWebClipToProblemContent(targetNote.content, payload);
        const sourceRefs = mergeNoteSourceRefs(targetNote.sourceRefs, [webClipSourceRef(payload)].filter(Boolean));
        const data = await fetch(`/api/notes/${targetNote.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content, sourceRefs })
        }).then(parseResponse);
        notify(`已剪进问题记录：${data.note.title}`);
        return data.note;
      }
      const draft = problemNoteFromWebClip(payload);
      const data = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft)
      }).then(parseResponse);
      notify(`已创建问题记录：${data.note.title}`);
      return data.note;
    } catch (error) {
      notify(errText(error, '剪藏到问题记录失败'), 'error');
      return null;
    }
  }

  async function handleSmartSearch(query) {
    if (!query?.trim()) return;
    setSearchHistory(current => {
      const value = query.trim();
      const filtered = current.filter(item => item.query !== value);
      return [{ query: value, timestamp: Date.now(), resultCount: 0 }, ...filtered].slice(0, 20);
    });
    setSmartSearchOpen(false);
    await handleWorkspaceSearch(query);
  }

  async function handleSmartSearchOpenDocument(documentOrSuggestion) {
    const type = searchResultType(documentOrSuggestion);
    if (type === 'note' && (documentOrSuggestion?.noteId || documentOrSuggestion?.id)) {
      setSmartSearchOpen(false);
      handleOpenRecent({ ...documentOrSuggestion, kind: 'note', type: 'note', noteId: documentOrSuggestion.noteId || documentOrSuggestion.id });
      return;
    }
    if (type === 'conversation' && (documentOrSuggestion?.conversationId || documentOrSuggestion?.id)) {
      setSmartSearchOpen(false);
      await openWorkspaceSearchResult({ ...documentOrSuggestion, type: 'conversation' });
      return;
    }
    const documentId = String(documentOrSuggestion?.documentId || documentOrSuggestion?.id || '').trim();
    if (!documentId) return handleSmartSearch(documentOrSuggestion?.text || documentOrSuggestion?.title || '');
    setSmartSearchOpen(false);
    await openContentReader({
      id: documentId,
      documentId,
      title: documentOrSuggestion?.text || documentOrSuggestion?.title || ''
    });
  }

  function handleDeleteSearchHistory(query) {
    fetch(`/api/search/history/${encodeURIComponent(query)}`, { method: 'DELETE' })
      .catch(error => console.warn('[smart-search:delete]', error));
    setSearchHistory(current => current.filter(item => item.query !== query));
  }

  function handleClearSearchHistory() {
    fetch('/api/search/history', { method: 'DELETE' })
      .catch(error => console.warn('[smart-search:clear]', error));
    setSearchHistory([]);
  }

  async function handleWorkspaceCreateWriting(context = workspaceContext) {
    const payload = buildWorkspaceContextWritingDraft(context);
    try {
      const data = await fetch('/api/writing/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).then(parseResponse);
      const draft = data.draft;
      const draftId = String(draft?.id || '');
      if (!draftId) throw new Error('\u5199\u4f5c\u8349\u7a3f\u521b\u5efa\u54cd\u5e94\u7f3a\u5c11 ID');
      void preloadWorkspaceRoute('writing');
      setWritingDeepLinkId(draftId);
      dispatchWorkspace({ type: 'OPEN_TAB', tab: { id: `writing-${draftId}`, kind: 'module', type: 'document', route: 'writing', draftId, title: draft.title || '\u5199\u4f5c\u8349\u7a3f', openedAt: Date.now(), lastActiveAt: Date.now() } });
      dispatchWorkspace({ type: 'TOUCH_RECENT_WORK', item: { id: `writing-${draftId}`, kind: 'writing', type: 'writing', draftId, title: draft.title || '\u5199\u4f5c\u8349\u7a3f', summary: context.selection ? '\u57fa\u4e8e\u5f53\u524d\u9009\u533a\u521b\u5efa' : '\u57fa\u4e8e\u5f53\u524d\u98de\u4e66\u4e0a\u4e0b\u6587\u521b\u5efa', updatedAt: draft.updatedAt || new Date().toISOString() } });
      setActive('writing');
      notify(`\u5df2\u521b\u5efa\u5e76\u6253\u5f00\u5199\u4f5c\u8349\u7a3f\uff1a${draft.title || "\u5199\u4f5c\u8349\u7a3f"}`);
      return draft;
    } catch (error) {
      notify(errText(error, '\u4e0a\u4e0b\u6587\u5199\u4f5c\u8349\u7a3f\u521b\u5efa\u5931\u8d25'), 'error');
      return null;
    }
  }

  async function handleReaderInterpretation(kind, item, selection = null, force = false) {
    const skillId = kind === 'quiz' ? 'quiz' : 'mind-map';
    const existing = !force ? runs.find(run => run.skillId === skillId && (run.documentIds || run.input?.documentIds || []).map(String).includes(String(item?.id || '')) && run.artifact) : null;
    if (existing) return existing;
    const skill = skills.find(entry => entry.id === skillId) || { id: skillId, name: skillId === 'quiz' ? '互动测验' : '思维导图' };
    const localId = `reader-${skillId}-${Date.now()}`;
    const task = { id: localId, type: 'skill', skillId, documentIds: [item.id], title: `${item.title} · ${skill.name}`, detail: '正在解析当前材料', status: 'running', progress: 0.1, createdAt: new Date().toISOString() };
    dispatchWorkspace({ type: 'UPSERT_TASK', task });
    let completed = null;
    try {
      const response = await fetch('/api/skills/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skillId, input: item.title || '', query: item.title || '', documentIds: [item.id], selection }) });
      await readNdjson(response, event => {
        if (event.type === 'done') completed = { id: event.runId, skillId, title: event.result?.artifact?.title || skill.name, startedAt: task.createdAt, completedAt: event.completedAt, status: 'completed', documentIds: event.result?.documentIds || [item.id], artifact: event.result?.artifact, model: event.result?.model, fallbackUsed: event.result?.fallbackUsed };
        if (event.type === 'error') throw Object.assign(new Error(event.error?.message || `${skill.name}生成失败`), { code: event.error?.code });
      });
      if (!completed?.artifact) throw new Error(`${skill.name}生成响应缺少产物`);
      setSkillRuns(current => [completed, ...current.filter(run => run.id !== completed.id)]);
      dispatchWorkspace({ type: 'UPDATE_TASK', taskId: localId, patch: { status: 'completed', progress: 1, detail: `${skill.name}已保留在当前阅读器`, resultId: completed.id, updatedAt: new Date().toISOString() } });
      notify(`${skill.name}已生成`);
      return completed;
    } catch (error) {
      dispatchWorkspace({ type: 'UPDATE_TASK', taskId: localId, patch: { status: 'failed', detail: errText(error, `${skill.name}生成失败`), updatedAt: new Date().toISOString() } });
      notify(errText(error, `${skill.name}生成失败`), 'error');
      throw error;
    }
  }
  function handleWorkspaceRunSkill(skillId, context = workspaceContext) {
    const documentIds = contextDocumentIds(context);
    setSelectedDocs(documentIds);
    openWorkspaceModule('skills');
    runSkill(skillId === 'deep-summary' ? 'summary' : skillId, documentIds);
  }

  function refreshSmartHome() {
    fetch('/api/home').then(parseResponse).then(setSmartHome).catch(() => undefined);
  }

  async function handleFeishuExported(document) {
    refreshSmartHome();
    try { await refreshContentItems(); } catch { /* 列表刷新失败不挡导出结果 */ }
    if (document?.contentItemId) notify('已导出到飞书，并收回知识库');
  }

  function handleSmartHomeAction(action, payload) {
    if (action === 'open-export') {
      const url = typeof payload === 'string' ? payload : payload?.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'open-document') {
      openContentReader({ id: payload, documentId: payload });
      return;
    }
    if (action === 'open-sync') {
      openFeishuExperience();
      return;
    }
    if (action === 'open-collect') {
      void preloadWorkspaceSurface('collection');
      setCollectionOpen(true);
      return;
    }
    if (action === 'continue-skill') {
      const run = runs.find(item => item.id === payload);
      if (run) {
        setSkillRun(run);
        openWorkspaceModule('skills');
      }
      return;
    }
    if (action === 'continue-conversation') {
      const conversation = (state.conversations || []).find(item => item.id === payload);
      createChatWorkspaceTab({
        title: conversation?.question || conversation?.title || '对话',
        scene: { conversationId: payload }
      });
      return;
    }
    if (action === 'run-skill') {
      const skillId = payload?.skillId || payload;
      if (payload?.documentIds?.length) setSelectedDocs(payload.documentIds);
      createChatWorkspaceTab({ title: payload?.title || '新对话' });
      runChatSkill(skillId, '');
    }
  }

  function handleAttachContext() {
    setKnowledgeIntent('chat');
    openWorkspaceModule('knowledge');
    if (selectedDocs.length) {
      let added = 0;
      for (const documentId of selectedDocs) {
        const doc = docs.find(item => item.id === documentId);
        if (!doc) continue;
        const contextId = `context-doc-${documentId}`;
        if (workspaceSession.aiContextItems.some(item => item.id === contextId)) continue;
        dispatchWorkspace({
          type: 'ADD_AI_CONTEXT_ITEM',
          item: {
            id: contextId,
            kind: 'document',
            type: 'document',
            documentId,
            sourceId: documentId,
            title: doc.title || '文档',
            summary: String(doc.excerpt || doc.summary || '').slice(0, 120)
          }
        });
        added += 1;
      }
      if (added) {
        notify(`已把 ${added} 篇资料加入 AI 上下文`, 'success');
        return;
      }
    }
    notify('在左侧勾选文档后，它们会进入问答范围', 'info');
  }

  function handleRemoveContext(item) {
    const id = item?.documentId || item?.sourceId || item?.id;
    if (currentContextDocument && id === currentContextDocument.documentId) {
      setContextExclusion(currentContextDocument.documentId);
      return;
    }
    dispatchWorkspace({ type: 'REMOVE_AI_CONTEXT_ITEM', id: item?.id });
  }

  function touchWorkspaceRecentItem(item, patch = {}) {
    const record = { ...(item || {}) };
    for (const key of ['priorityScore', 'priorityReason', 'prioritySignals', 'homeRank', 'followedLibraryId', 'followedLibraryName', 'relatedTaskId', 'relatedTaskStatus', 'taskStatus']) delete record[key];
    dispatchWorkspace({ type: 'TOUCH_RECENT_WORK', at: Date.now(), item: { ...record, ...patch, updatedAt: patch.updatedAt || new Date().toISOString() } });
  }

  function handleOpenRecent(item) {
    if (item?.type === 'view') { openWorkspaceModule('knowledge'); return; }
    const documentId = item?.documentId || item?.resourceId || (item?.kind === 'document' ? item?.id : '');
    if (documentId) { openContentReader({ id: documentId, title: item.title }); return; }
    if (item?.kind === 'note' || item?.type === 'note') {
      const noteId = String(item.noteId || item.id || '');
      touchWorkspaceRecentItem(item, { id: item.id || `recent-note-${noteId}`, kind: 'note', type: 'note', noteId, title: item.title || '笔记' });
      setNoteDeepLinkId(noteId);
      dispatchWorkspace({ type: 'OPEN_TAB', tab: { id: `note-${noteId}`, kind: 'note', type: 'note', route: 'notes', noteId, title: item.title || '笔记', openedAt: Date.now(), lastActiveAt: Date.now() } });
      setActive('notes');
      return;
    }
    touchWorkspaceRecentItem(item);
    openWorkspaceModule(item?.route || item?.kind || 'knowledge');
  }

  function handleOpenTask(task) {
    const taskType = task?.taskType || task?.type;
    if (taskType === 'skill') {
      if (task?.skillId) setSelectedSkill(task.skillId);
      openWorkspaceModule('skills');
    } else if (taskType === 'recording') openWorkspaceModule('recording');
    else openWorkspaceModule('knowledge');
  }

  function handleRetryTask(task) {
    if (task?.type === 'skill') runSkill(task.skillId || selectedSkill, task.documentIds || null);
    else if (task?.type === 'sync') sync(task.source || 'mock');
    else setCollectionOpen(true);
  }

  async function importRecordedAudio(file, metadata = {}) {
    const taskId = `recording-${metadata.sessionId || Date.now()}`;
    dispatchWorkspace({ type: 'UPSERT_TASK', task: { id: taskId, type: 'recording', title: metadata.title || '录音纪要', detail: '正在上传、转写并建立时间戳索引', status: 'running', progress: 0.05, createdAt: new Date().toISOString() } });
    try {
      const data = await fetch('/api/content/import/file', { method: 'POST', headers: { 'content-type': file.type || 'audio/webm', 'x-file-name': encodeURIComponent(file.name), 'x-file-last-modified': String(file.lastModified || '') }, body: file, signal: metadata.signal }).then(parseResponse);
      metadata.reportProgress?.(86);
      const imported = data.items?.[0]?.item || data.item || null;
      await refreshContentItems();
      dispatchWorkspace({ type: 'UPDATE_TASK', taskId, patch: { status: 'completed', progress: 1, detail: '录音已转写并进入知识库', resultId: imported?.id, updatedAt: new Date().toISOString() } });
      return imported;
    } catch (error) {
      dispatchWorkspace({ type: 'UPDATE_TASK', taskId, patch: { status: 'failed', detail: errText(error, '录音导入失败'), updatedAt: new Date().toISOString() } });
      throw error;
    }
  }
  async function loadKnowledgeLibraries({ refresh = false, notifyErrors = true } = {}) {
    setKnowledgeLibraryBusy(true);
    try {
      const response = await fetch('/api/knowledge/libraries' + (refresh ? '/refresh' : ''), refresh ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } : undefined);
      const data = await parseResponse(response);
      const libraries = Array.isArray(data.libraries) ? data.libraries : [];
      setKnowledgeLibraries(libraries);
      setState(current => ({ ...current, knowledgeBases: libraries.length ? libraries : current.knowledgeBases, knowledgeLibraryState: { ...(current.knowledgeLibraryState || {}), followedIds: data.followedIds || [], refreshedAt: data.refreshedAt || null } }));
      if (libraries.length && !libraries.some(item => item.id === selectedKb)) {
        setSelectedKb(resolveDefaultLibrary(libraries, { documents: state.documents }));
      }
      return data;
    } catch (error) {
      if (notifyErrors) notify(errText(error, refresh ? '共享知识库刷新失败' : '知识库加载失败'), 'error');
      throw error;
    } finally { setKnowledgeLibraryBusy(false); }
  }

  async function activateCopilot(id) {
    const copilotId = String(id || '').trim();
    const copilot = (state.copilots || []).find(item => item.id === copilotId);
    if (!copilotId) return;
    try {
      await fetch('/api/copilots/' + encodeURIComponent(copilotId), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ activate: true }) }).then(parseResponse);
      setState(current => ({
        ...current,
        copilots: (current.copilots || []).map(item => item.id === copilotId ? { ...item, ...(copilot || {}) } : item),
        settings: { ...(current.settings || {}), activeCopilotId: copilotId }
      }));
      if (copilot?.name) notify(`已切换到 ${copilot.name}`);
    } catch (error) {
      notify(errText(error, '切换 Copilot 失败'), 'error');
    }
  }
  function useCopilotInChat(copilot) {
    if (!copilot?.id) return;
    setState(current => ({
      ...current,
      copilots: (current.copilots || []).some(item => item.id === copilot.id)
        ? (current.copilots || []).map(item => item.id === copilot.id ? copilot : item)
        : [...(current.copilots || []), copilot],
      settings: { ...(current.settings || {}), activeCopilotId: copilot.id }
    }));
    openWorkspaceModule('knowledge');
    const activeTab = workspaceSession.tabs.find(tab => tab.id === workspaceSession.activeTabId);
    const tabId = (activeTab && isChatWorkspaceTab(activeTab))
      ? activeTab.id
      : createChatWorkspaceTab({ title: copilot.name || '新对话' }).id;
    startNewConversation(tabId);
    const boundLibraryIds = (Array.isArray(copilot.knowledgeBaseIds) ? copilot.knowledgeBaseIds : []).map(String).filter(Boolean);
    if (boundLibraryIds.length) {
      const preferred = boundLibraryIds.find(id => knowledgeLibraries.some(lib => lib.id === id))
        || boundLibraryIds.find(id => (state.knowledgeBases || []).some(lib => lib.id === id))
        || boundLibraryIds[0];
      const library = knowledgeLibraries.find(item => item.id === preferred) || { id: preferred, name: preferred };
      void selectKnowledgeLibrary(library);
    }
    setKnowledgeIntent('chat');
  }
  async function selectKnowledgeLibrary(library) {
    setSelectedKb(library.id);
    setSelectedDocs([]);
    try {
      await fetch('/api/knowledge/libraries/' + encodeURIComponent(library.id), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: true }) }).then(parseResponse);
      setState(current => ({ ...current, settings: { ...(current.settings || {}), activeKnowledgeBaseId: library.id } }));
    } catch (error) { notify(errText(error, '知识库上下文保存失败'), 'error'); }
  }
  async function followKnowledgeLibrary(library, followed) {
    setKnowledgeLibraryBusy(true);
    try {
      const response = await fetch('/api/knowledge/libraries/' + encodeURIComponent(library.id), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ followed }) });
      const data = await parseResponse(response);
      const libraries = Array.isArray(data.libraries) ? data.libraries : knowledgeLibraries;
      setKnowledgeLibraries(libraries);
      setState(current => ({ ...current, knowledgeBases: libraries, knowledgeLibraryState: { ...(current.knowledgeLibraryState || {}), followedIds: data.followedIds || [], refreshedAt: data.refreshedAt || null }, settings: { ...(current.settings || {}), activeKnowledgeBaseId: library.id } }));
      notify(followed ? `已关注「${library.name}」` : `已取消关注「${library.name}」`);
    } catch (error) { notify(errText(error, '关注状态更新失败'), 'error'); }
    finally { setKnowledgeLibraryBusy(false); }
  }

  async function refreshContentItems() {
    const data = await fetch('/api/content/items?limit=500').then(parseResponse);
    const items = Array.isArray(data.items) ? data.items : [];
    const libraryData = await fetch('/api/knowledge/libraries').then(parseResponse).catch(() => null);
    const libraries = Array.isArray(libraryData?.libraries) ? libraryData.libraries : knowledgeLibraries;
    const libraryBySpaceId = new Map(libraries.filter(item => item.spaceId).map(item => [item.spaceId, item.id]));
    const normalizedItems = items.map(item => ({ ...item, knowledgeBaseId: item.knowledgeBaseId || libraryBySpaceId.get(item.spaceId) || item.spaceId || null }));
    setKnowledgeLibraries(libraries);
    setState(current => ({ ...current, documents: normalizedItems, knowledgeBases: libraries.length ? libraries : current.knowledgeBases, knowledgeLibraryState: libraryData ? { ...(current.knowledgeLibraryState || {}), followedIds: libraryData.followedIds || [], refreshedAt: libraryData.refreshedAt || null } : current.knowledgeLibraryState }));
    return normalizedItems;
  }

  async function enterKnowledgeAfterCollection(message) {
    try {
      const items = await refreshContentItems();
      notify(`${message}，知识库现有 ${items.length} 项内容`);
    } catch (error) {
      notify(`内容已导入，但知识库列表刷新失败：${errText(error)}`, 'error');
    } finally {
      setCollectionOpen(false);
      setActive('knowledge');
    }
  }

  async function importCollectionFiles(fileList) {
    const files = Array.from(fileList || []);
    const items = [];
    for (const [index, file] of files.entries()) {
      const taskId = `import-${Date.now()}-${index}`;
      dispatchWorkspace({ type: 'UPSERT_TASK', task: { id: taskId, type: 'import', title: `导入 ${file.name}`, detail: '正在解析内容与排版', status: 'running', progress: 0.1, createdAt: new Date().toISOString() } });
      try {
        const data = await fetch('/api/content/import/file', {
          method: 'POST',
          headers: {
            'content-type': file.type || 'application/octet-stream',
            'x-file-name': encodeURIComponent(file.name),
            'x-file-last-modified': String(file.lastModified || '')
          },
          body: file
        }).then(parseResponse);
        const warning = data.warnings?.[0]?.message;
        items.push({ name: file.name, status: 'success', message: warning || (data.stats?.duplicates ? '内容已存在，已关联来源' : '已解析并加入知识库'), item: data.items?.[0]?.item });
        dispatchWorkspace({ type: 'UPDATE_TASK', taskId, patch: { status: 'completed', progress: 1, detail: warning || '已解析并加入知识库', resultId: data.items?.[0]?.item?.id, updatedAt: new Date().toISOString() } });
      } catch (error) {
        items.push({ name: file.name, status: 'failed', message: errText(error, '导入失败') });
        dispatchWorkspace({ type: 'UPDATE_TASK', taskId, patch: { status: 'failed', detail: errText(error, '导入失败'), updatedAt: new Date().toISOString() } });
      }
    }
    const imported = items.filter(item => item.status === 'success').length;
    const failed = items.length - imported;
    if (imported > 0) await enterKnowledgeAfterCollection(failed ? `已导入 ${imported} 个文件，${failed} 个失败` : `已导入 ${imported} 个文件`);
    return { ok: imported > 0 && failed === 0, imported, failed, items, message: failed ? '部分文件导入失败，可重新打开收集中心重试。' : '文件已进入知识库。' };
  }

  async function importCollectionText({ title, content }) {
    const taskId = `import-text-${Date.now()}`;
    dispatchWorkspace({ type: 'UPSERT_TASK', task: { id: taskId, type: 'import', title: `导入 ${title}`, detail: '正在保存文本与索引', status: 'running', progress: 0.15, createdAt: new Date().toISOString() } });
    let data;
    try {
      data = await fetch('/api/content/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ title, content, contentType: 'markdown' }] })
      }).then(parseResponse);
      dispatchWorkspace({ type: 'UPDATE_TASK', taskId, patch: { status: 'completed', progress: 1, detail: '已进入知识库', resultId: data.items?.[0]?.item?.id, updatedAt: new Date().toISOString() } });
      await enterKnowledgeAfterCollection(`「${title}」已加入知识库`);
      return { ...data, ok: true, message: '文本已进入知识库，可以立即查看和提问。' };
    } catch (error) {
      dispatchWorkspace({ type: 'UPDATE_TASK', taskId, patch: { status: 'failed', detail: errText(error, '导入失败'), updatedAt: new Date().toISOString() } });
      throw error;
    }
  }

  function openFeishuExperience() {
    void preloadWorkspaceSurface('feishu-sync');
    setCollectionOpen(false);
    setActive('settings');
    setSettingsSection('knowledge');
    setShowSync(true);
  }

  async function sync(source = 'mock') {
    const taskId = `sync-${Date.now()}`;
    dispatchWorkspace({ type: 'UPSERT_TASK', task: { id: taskId, type: 'sync', source, title: '同步飞书内容', detail: '正在发现空间与拉取文档', status: 'running', progress: 0.08, createdAt: new Date().toISOString() } });
    setSyncing(true);
    try {
      const data = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source, mode: source }) }).then(parseResponse);
      const next = data.state || data;
      setState(next); setShowSync(false);
      await refreshContentItems();
      dispatchWorkspace({ type: 'UPDATE_TASK', taskId, patch: { status: 'completed', progress: 1, detail: `已导入 ${data.imported ?? data.stats?.imported ?? next.documents?.length ?? 0} 篇文档`, updatedAt: new Date().toISOString() } });
      notify(`同步完成：导入 ${data.imported ?? data.stats?.imported ?? next.documents?.length ?? 0} 篇文档`);
    } catch (error) {
      dispatchWorkspace({ type: 'UPDATE_TASK', taskId, patch: { status: 'failed', detail: errText(error, '同步失败'), updatedAt: new Date().toISOString() } });
      notify(errText(error, '同步失败'), 'error');
    }
    finally { setSyncing(false); }
  }

  function stopGeneration(tabId = currentChatTabId()) {
    const id = String(tabId || '');
    const controller = id ? chatAbortControllersRef.current.get(id) : abortRef.current;
    controller?.abort();
    if (id) chatAbortControllersRef.current.delete(id);
    if (abortRef.current === controller) abortRef.current = null;
    if (id) setStreamingForChatTab(id, false);
  }

  function updateChatAttachments(updater) {
    setChatAttachments(current => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      chatAttachmentsRef.current = next;
      return next;
    });
  }

  async function deleteTemporaryChatAttachment(temporaryId, keepalive = false) {
    if (!temporaryId) return;
    await fetch(`/api/chat/attachments/${encodeURIComponent(temporaryId)}`, { method: 'DELETE', keepalive }).catch(() => null);
  }

  async function uploadChatAttachmentRecord(record) {
    const response = await fetch('/api/chat/attachments', {
      method: 'POST',
      headers: { 'content-type': attachmentMimeType(record.file), 'x-file-name': encodeURIComponent(record.fileName) },
      body: record.file
    });
    const data = await parseResponse(response);
    const isCurrentSession = record.generation === chatAttachmentGenerationRef.current;
    const isStillAttached = chatAttachmentsRef.current.some(item => item.clientId === record.clientId);
    if (!isCurrentSession || !isStillAttached) {
      await deleteTemporaryChatAttachment(data.temporaryId);
      return { ...data, discarded: true };
    }
    updateChatAttachments(current => current.map(item => item.clientId === record.clientId ? {
      ...item,
      status: 'ready',
      error: '',
      temporaryId: data.temporaryId,
      expiresAt: data.expiresAt,
      attachment: data.attachment,
      citationDocumentId: data.attachment?.citationDocumentId || `chat-attachment:${data.temporaryId}`,
      contentType: data.attachment?.contentType || item.contentType
    } : item));
    return data;
  }

  async function addChatAttachments(fileList) {
    const incoming = Array.from(fileList || []).filter(file => file?.name);
    if (!incoming.length || chatAttachmentBusy) return;

    const limits = chatAttachmentCapabilities?.limits || {};
    const maxCount = Number(limits.maxCount || 8);
    const maxFileBytes = Number(limits.maxFileBytes || 8 * 1024 * 1024);
    const maxTotalBytes = Number(limits.maxTotalBytes || 12 * 1024 * 1024);
    const acceptedExtensions = new Set((chatAttachmentCapabilities?.acceptedExtensions || []).map(value => String(value).toLowerCase()));
    const existingBytes = chatAttachments.reduce((sum, item) => sum + Number(item.byteSize || 0), 0);
    const availableSlots = Math.max(0, maxCount - chatAttachments.length);
    const acceptedFiles = [];
    const rejected = [];
    let nextTotalBytes = existingBytes;

    for (const file of incoming) {
      const extensionMatch = String(file.name).toLowerCase().match(/(\.[^.]+)$/);
      const extension = extensionMatch?.[1] || '';
      if (acceptedFiles.length >= availableSlots) {
        rejected.push(`${file.name}：超过 ${maxCount} 个附件上限`);
      } else if (acceptedExtensions.size && !acceptedExtensions.has(extension)) {
        rejected.push(`${file.name}：暂不支持此格式`);
      } else if (Number(file.size || 0) > maxFileBytes) {
        rejected.push(`${file.name}：超过单文件 ${attachmentSizeLabel(maxFileBytes)} 上限`);
      } else if (nextTotalBytes + Number(file.size || 0) > maxTotalBytes) {
        rejected.push(`${file.name}：本轮附件总大小超过 ${attachmentSizeLabel(maxTotalBytes)}`);
      } else {
        acceptedFiles.push(file);
        nextTotalBytes += Number(file.size || 0);
      }
    }

    if (rejected.length) setChatErrorForTab(currentChatTabId(), `有 ${rejected.length} 个文件未添加：${rejected.slice(0, 2).join('；')}${rejected.length > 2 ? '…' : ''}`);
    else setChatErrorForTab(currentChatTabId(), '');
    if (!acceptedFiles.length) return;

    const generation = chatAttachmentGenerationRef.current;
    const batchId = ++chatAttachmentBatchRef.current;
    const records = acceptedFiles.map((file, index) => ({
      clientId: globalThis.crypto?.randomUUID?.() || `attachment-${Date.now()}-${index}`,
      generation,
      file,
      fileName: file.name,
      mimeType: attachmentMimeType(file),
      byteSize: file.size,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading',
      error: ''
    }));
    if (!chatAttachments.length && !selectedDocs.length) setChatIncludeKnowledgeBase(false);
    setChatAttachmentBusy(true);
    updateChatAttachments(current => [...current, ...records]);
    await Promise.all(records.map(async record => {
      try { await uploadChatAttachmentRecord(record); }
      catch (error) {
        const message = errText(error, '附件解析失败');
        updateChatAttachments(current => current.map(item => item.clientId === record.clientId ? { ...item, status: 'error', error: message } : item));
        setChatErrorForTab(currentChatTabId(), `${record.fileName}：${message}`);
      }
    }));
    if (chatAttachmentBatchRef.current === batchId) setChatAttachmentBusy(false);
  }

  async function retryChatAttachment(record) {
    if (!record?.file || chatAttachmentBusy) return;
    const batchId = ++chatAttachmentBatchRef.current;
    const nextRecord = { ...record, generation: chatAttachmentGenerationRef.current };
    setChatAttachmentBusy(true);
    setChatErrorForTab(currentChatTabId(), '');
    updateChatAttachments(current => current.map(item => item.clientId === record.clientId ? { ...item, generation: nextRecord.generation, status: 'uploading', error: '' } : item));
    try { await uploadChatAttachmentRecord(nextRecord); }
    catch (error) {
      const message = errText(error, '附件解析失败');
      updateChatAttachments(current => current.map(item => item.clientId === record.clientId ? { ...item, status: 'error', error: message } : item));
      setChatErrorForTab(currentChatTabId(), `${record.fileName}：${message}`);
    } finally {
      if (chatAttachmentBatchRef.current === batchId) setChatAttachmentBusy(false);
    }
  }

  async function removeChatAttachment(record) {
    const remaining = chatAttachmentsRef.current.filter(item => item.clientId !== record.clientId);
    updateChatAttachments(remaining);
    if (!remaining.length) setChatIncludeKnowledgeBase(true);
    if (record.previewUrl) URL.revokeObjectURL(record.previewUrl);
    await deleteTemporaryChatAttachment(record.temporaryId);
  }

  async function clearChatAttachments() {
    chatAttachmentGenerationRef.current += 1;
    chatAttachmentBatchRef.current += 1;
    const current = chatAttachmentsRef.current;
    updateChatAttachments([]);
    setChatIncludeKnowledgeBase(true);
    setChatAttachmentBusy(false);
    await Promise.all(current.map(async item => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      await deleteTemporaryChatAttachment(item.temporaryId);
    }));
  }

  async function askAgent(prompt = query, scopeDocumentIds = null, targetAssistantId = '', attachmentOverride = null, modeOverride = agentMode, selectionOverride = null, conversationIdOverride, tabIdOverride, scopeExplicitOverride = null) {
    const chatTabId = String(tabIdOverride || currentChatTabId());
    const tabScene = getChatTabScene(workspaceSession.tabs.find(tab => tab.id === chatTabId) || { chat: {} });
    const scopeExplicit = scopeExplicitOverride === null
      ? (scopeDocumentIds !== null ? true : Boolean(tabScene.scopeExplicit || (chatTabId === currentChatTabId() && chatScopeExplicitRef.current)))
      : scopeExplicitOverride === true;
    const mode = agentModeOption(modeOverride).id;
    const requestedSelection = selectionOverride;
    const requestedDocumentIds = normalizedDocumentIds(scopeDocumentIds ?? selectedDocs);
    const conversationId = conversationIdOverride !== undefined
      ? (String(conversationIdOverride || '').trim() || undefined)
      : (chatConversationId || undefined);
    const activeAttachments = (Array.isArray(attachmentOverride) ? attachmentOverride : chatAttachments).filter(item => item.temporaryId && item.status !== 'error');
    const text = String(prompt || '').trim() || (activeAttachments.length ? '请解读这些附件，提炼关键内容、重要细节和可执行结论。' : '');
    if (!chatTabId || !text || chatRuntimeForTab(chatTabId)?.streaming || chatAttachmentBusy) return;
    setQuery(''); setStreamingForChatTab(chatTabId, true); setChatErrorForTab(chatTabId, '');
    const controller = new AbortController();
    chatAbortControllersRef.current.set(chatTabId, controller);
    abortRef.current = controller;
    const assistantId = targetAssistantId || `assistant-${Date.now()}`;
    const attachmentSnapshot = activeAttachments.map(item => ({ ...item, file: undefined }));
    const pendingStatus = requestedSelection?.quote ? '正在看你划的那段' : activeAttachments.length ? `正在解析 ${activeAttachments.length} 个附件` : '正在理解问题';
    let streamBatcher = null;
    if (targetAssistantId) {
      setMessagesForChatTab(chatTabId, current => current.map(message => message.id === targetAssistantId ? { ...message, attachments: attachmentSnapshot, versions: message.done && message.text ? [...(message.versions || []), { text: message.text, citations: message.citations || [], relations: message.relations || null, createdAt: new Date().toISOString() }] : (message.versions || []), text: '', citations: [], relations: null, knowledgeWork: {}, agent: { mode, plan: [], tools: [], observations: [] }, status: '正在重新生成', error: '' } : message));
    } else {
      setMessagesForChatTab(chatTabId, current => [...current, {
        id: `user-${Date.now()}`, role: 'user', text, chatTabId, attachments: attachmentSnapshot, documentIds: requestedDocumentIds, scopeExplicit, mode, selection: requestedSelection || null
      }, { id: assistantId, role: 'assistant', chatTabId, text: '', citations: [], attachments: attachmentSnapshot, documentIds: requestedDocumentIds, scopeExplicit, mode, selection: requestedSelection || null, versions: [], agent: { mode, plan: [], tools: [], observations: [] }, status: pendingStatus }]);
    }
    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({
          question: text,
          query: text,
          mode,
          ...(scopeExplicit ? { documentIds: requestedDocumentIds } : {}),
          selection: requestedSelection, conversationId,
          knowledgeBaseId: selectedKb,
          copilotId: state.settings?.activeCopilotId || undefined,
          includeKnowledgeBase: activeAttachments.length ? chatIncludeKnowledgeBase : true,
          attachments: activeAttachments.map(item => ({ temporaryId: item.temporaryId }))
        })
      });
      streamBatcher = createStreamEventBatcher({
        onFlush(events) {
          for (const event of events) {
            if ((event.type === 'start' || event.type === 'done') && event.conversationId) setChatConversationIdForTab(chatTabId, event.conversationId);
          }
          setMessagesForChatTab(chatTabId, current => current.map(message => {
            if (message.id !== assistantId) return message;
            return events.reduce((next, event) => {
              const patched = applyAssistantStreamEvent(next, event, {
                mode,
                mergeKnowledgeWork,
                sanitizeAnswer: sanitizeAssistantText,
                startStatus: startEvent => startEvent.fastReply ? '' : startEvent.executionMode === 'research' ? '正在查证资料' : startEvent.executionMode === 'change' ? '正在准备写入提案' : '我先查看知识库里的资料'
              });
              if (event.type !== 'done') return patched;
              return {
                ...patched,
                question: text,
                documentIds: requestedDocumentIds,
                scopeExplicit,
                mode,
                selection: requestedSelection || null,
                done: Boolean(event.result?.answer || patched.text)
              };
            }, message);
          }));
        }
      });
      await readNdjson(response, event => streamBatcher.push(event), controller.signal);
      streamBatcher.flush();
    } catch (error) {
      streamBatcher?.flush();
      if (error.name === 'AbortError') {
        setMessagesForChatTab(chatTabId, current => current.map(message => message.id === assistantId ? { ...message, status: '', stopped: true, text: message.text || '生成已停止。' } : message));
      } else {
        const message = formatModelError(error, '模型渠道不可用');
        setChatErrorForTab(chatTabId, message);
        setMessagesForChatTab(chatTabId, current => current.map(item => item.id === assistantId ? { ...item, status: '', error: message, errorCode: error?.code || null, errorStatus: error?.status || null, text: item.text } : item));
      }
    } finally {
      chatAbortControllersRef.current.delete(chatTabId);
      if (abortRef.current === controller) abortRef.current = null;
      setStreamingForChatTab(chatTabId, false);
    }
  }

  async function ask(prompt = query, scopeDocumentIds = null, targetAssistantId = '', attachmentOverride = null, requestedMode = agentMode, selectionOverride = currentChatSelection, requestedTabId = '') {
    setKnowledgeIntent('chat');
    const chatTabId = String(requestedTabId || currentChatTabId());
    const tabScene = getChatTabScene(workspaceSession.tabs.find(tab => tab.id === chatTabId) || { chat: {} });
    const requestedScopeExplicit = scopeDocumentIds !== null
      ? true
      : Boolean(tabScene.scopeExplicit || (chatTabId === currentChatTabId() && chatScopeExplicitRef.current));
    if (chatTabId === 'module-knowledge') dispatchWorkspace({ type: 'UPDATE_TAB', tabId: chatTabId, patch: { title: '知识问答' } });
    const mode = agentModeOption(requestedMode).id;
    const requestedSelection = selectionOverride;
    const requestedDocumentIds = normalizedDocumentIds(scopeDocumentIds ?? selectedDocs);
    const scopedConversationId = chatTabId
      ? getChatTabScene(workspaceSession.tabs.find(tab => tab.id === chatTabId) || { chat: {} }).conversationId
      : chatConversationId;
    if (chatTabId) setChatTabScene(chatTabId, { documentIds: requestedDocumentIds, scopeExplicit: requestedScopeExplicit, selection: requestedSelection || null, agentMode: mode });
    const conversationForRun = chatTabId ? (scopedConversationId || '') : undefined;
    return askAgent(prompt, scopeDocumentIds, targetAssistantId, attachmentOverride, mode, selectionOverride, conversationForRun, chatTabId, requestedScopeExplicit);
  }

  async function runChatSkill(skillId, inputText = '') {
    const skill = skills.find(item => item.id === skillId);
    if (!skill || chatRuntimeForTab(currentChatTabId())?.streaming) return;
    const input = String(inputText || '').trim();
    const taskDocumentIds = [...new Set([...selectedDocs, ...contextDocumentIds(workspaceContext)])];
    const userText = `/${skill.name}${input ? ` ${input}` : ''}`;
    const chatTabId = currentChatTabId();
    const assistantId = `assistant-skill-${Date.now()}`;
    const taskId = `chat-skill-${Date.now()}`;
    const controller = new AbortController();
    chatAbortControllersRef.current.set(chatTabId, controller);
    abortRef.current = controller;
    setQuery('');
    queryRef.current = '';
    setStreamingForChatTab(chatTabId, true);
    setChatErrorForTab(chatTabId, '');
    setMessagesForChatTab(chatTabId, current => [...current, { role: 'user', text: userText, chatTabId, skillCommand: { id: skill.id, name: skill.name } }, { id: assistantId, role: 'assistant', chatTabId, text: '', citations: [], skill: { id: skill.id, name: skill.name, category: skill.category }, status: '正在理解任务与准备材料', reasoningSteps: applySkillReasoningEvent([], { type: 'start' }, skill) }]);
    dispatchWorkspace({ type: 'UPSERT_TASK', task: { id: taskId, type: 'skill', skillId: skill.id, documentIds: taskDocumentIds, title: `${skill.name} · 对话运行`, detail: input || '基于当前上下文执行', status: 'running', progress: 0.08, createdAt: new Date().toISOString() } });
    let skillBatcher = null;
    try {
      const response = await fetch('/api/skills/run', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ skillId: skill.id, input, query: input, knowledgeBaseId: selectedKb, documentIds: taskDocumentIds, selection: workspaceContext.selection || null }) });
      let completedRun = null;
      skillBatcher = createStreamEventBatcher({
        onFlush(events) {
          for (const event of events) {
            if (event.type === 'start') setChatTabScene(chatTabId, { skillRun: { id: event.runId || taskId, skillId: skill.id, title: skill.name, status: 'running', startedAt: new Date().toISOString() } });
            if (event.type === 'done') setChatTabScene(chatTabId, { skillRun: { id: event.runId || completedRun?.id || taskId, skillId: skill.id, title: skill.name, status: 'completed', completedAt: event.completedAt || new Date().toISOString() } });
          }
          setMessagesForChatTab(chatTabId, current => current.map(message => {
            if (message.id !== assistantId) return message;
            return events.reduce((next, event) => {
              if (event.type === 'start') return { ...next, runId: event.runId || next.runId, status: '已启动 Skill 工作流', reasoningSteps: applySkillReasoningEvent(next.reasoningSteps, event, skill) };
              if (event.type === 'step') return { ...next, status: event.detail || event.name || event.label || `正在执行步骤 ${event.step || ''}`, reasoningSteps: applySkillReasoningEvent(next.reasoningSteps, event, skill) };
              if (event.type === 'model') return { ...next, status: `正在调用 ${event.model || event.provider || '默认模型'}`, reasoningSteps: applySkillReasoningEvent(next.reasoningSteps, event, skill) };
              if (event.type === 'model-delta' || event.type === 'delta') return { ...next, status: '正在生成产物', text: next.text + (event.delta || ''), reasoningSteps: applySkillReasoningEvent(next.reasoningSteps, event, skill) };
              if (event.type === 'model-fallback') return { ...next, status: '远端模型波动，已继续使用本地工作流' };
              if (event.type === 'artifact') {
                const artifact = event.artifact || {};
                const citations = (artifact.sourceRefs || []).map((ref, index) => ({ id: `skill-ref-${index}`, documentId: ref.documentId || ref.sourceId, title: ref.title || '来源文档', anchor: ref.anchor || null, snippet: ref.snippet || ref.excerpt || '' })).filter(item => item.documentId || item.title);
                return { ...next, status: '', text: artifact.content || event.content || next.text, citations, artifact, reasoningSteps: applySkillReasoningEvent(next.reasoningSteps, event, skill) };
              }
              if (event.type === 'done') {
                completedRun = event.result ? { id: event.runId, ...event.result } : completedRun;
                const artifact = event.result?.artifact || next.artifact || {};
                const citations = next.citations?.length ? next.citations : (artifact.sourceRefs || []).map((ref, index) => ({ id: `skill-ref-${index}`, documentId: ref.documentId || ref.sourceId, title: ref.title || '来源文档', anchor: ref.anchor || null, snippet: ref.snippet || ref.excerpt || '' }));
                return { ...next, status: '', text: artifact.content || next.text || '工作流已完成。', citations, artifact, done: true, completedAt: event.completedAt || new Date().toISOString(), reasoningSteps: applySkillReasoningEvent(next.reasoningSteps, event, skill) };
              }
              if (event.type === 'error') return { ...next, status: '', error: errText(event.error, 'Skill 执行失败'), text: next.text || '本次 Skill 运行失败。', reasoningSteps: applySkillReasoningEvent(next.reasoningSteps, event, skill) };
              return next;
            }, message);
          }));
        }
      });
      await readNdjson(response, event => skillBatcher.push(event), controller.signal);
      skillBatcher.flush();
      if (completedRun) {
        setSkillRuns(current => [{ ...completedRun, skillId: skill.id, title: skill.name }, ...current.filter(item => item.id !== completedRun.id)]);
        setChatTabScene(chatTabId, { skillRun: { id: completedRun.id || taskId, skillId: skill.id, title: skill.name, status: 'completed', completedAt: completedRun.completedAt || new Date().toISOString() } });
      }
      dispatchWorkspace({ type: 'UPDATE_TASK', taskId, patch: { status: 'completed', progress: 1, detail: '产物已保留在对话与 Skill 记录', updatedAt: new Date().toISOString() } });
    } catch (error) {
      skillBatcher?.flush();
      const message = errText(error, 'Skill 执行失败');
      if (error.name === 'AbortError') setMessagesForChatTab(chatTabId, current => current.map(item => item.id === assistantId ? { ...item, status: '', stopped: true, text: item.text || '已停止 Skill 运行。', reasoningSteps: applySkillReasoningEvent(item.reasoningSteps, { type: 'stopped' }, skill) } : item));
      else {
        setChatErrorForTab(chatTabId, message);
        setMessagesForChatTab(chatTabId, current => current.map(item => item.id === assistantId ? { ...item, status: '', error: message, text: item.text || '本次 Skill 运行失败。', reasoningSteps: applySkillReasoningEvent(item.reasoningSteps, { type: 'error', error: { message } }, skill) } : item));
      }
      setChatTabScene(chatTabId, { skillRun: { id: taskId, skillId: skill.id, title: skill.name, status: error.name === 'AbortError' ? 'cancelled' : 'failed', recoverable: error.name !== 'AbortError', completedAt: new Date().toISOString(), error: error.name === 'AbortError' ? '' : message } });
      dispatchWorkspace({ type: 'UPDATE_TASK', taskId, patch: { status: 'failed', detail: message, updatedAt: new Date().toISOString() } });
    } finally {
      chatAbortControllersRef.current.delete(chatTabId);
      if (abortRef.current === controller) abortRef.current = null;
      setStreamingForChatTab(chatTabId, false);
    }
  }

  function retryRecoverableChatSkill(run = skillRun) {
    const target = run || skillRun;
    if (!target?.skillId) return;
    runChatSkill(target.skillId, query);
  }

  function regenerateAnswer(message) {
    const chatTabId = resolveChatTabIdForMessage(message);
    const runtime = chatRuntimeForTab(chatTabId);
    const tabMessages = runtime?.messages?.length ? runtime.messages : messages;
    const prompt = message?.question || [...tabMessages].reverse().find(item => item.role === 'user')?.text || '';
    const mode = agentModeOption(message?.mode || message?.agent?.mode || 'auto').id;
    const tab = workspaceSession.tabs.find(item => item.id === chatTabId);
    const tabScene = getChatTabScene(tab || { chat: {} });
    const selection = message?.selection || tabScene.selection || null;
    const docIds = normalizedDocumentIds(message?.documentIds?.length ? message.documentIds : tabScene.documentIds || selectedDocs);
    if (prompt && message?.id) ask(prompt, docIds, message.id, message.attachments || [], mode, selection, chatTabId);
  }

  function openWrittenArtifact(artifact) {
    const written = artifact && typeof artifact === 'object' ? artifact : null;
    if (!written?.id && !written?.url) return;
    if (written.kind === 'draft' || written.workspace === 'writing') {
      setWritingDeepLinkId(written.id);
      dispatchWorkspace({ type: 'OPEN_TAB', tab: { id: `writing-${written.id}`, kind: 'module', type: 'document', route: 'writing', draftId: written.id, title: written.title || '写作草稿', openedAt: Date.now(), lastActiveAt: Date.now() } });
      setActive('writing');
      return;
    }
    if (written.kind === 'feishu') {
      if (written.contentItemId) {
        openContentReader({ id: written.contentItemId, documentId: written.contentItemId, title: written.title || '飞书文档', url: written.url });
        return;
      }
      if (written.url && !String(written.url).startsWith('file:')) {
        window.open(written.url, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    openCreatedWorkspaceNote({ id: written.id, title: written.title || '笔记' }, { summary: '对话写入知识库' });
  }

  async function confirmAgent(message, approved) {
    const confirmationId = message?.agent?.confirmation?.id || message?.confirmation?.id;
    if (!confirmationId) return;
    const chatTabId = resolveChatTabIdForMessage(message);
    try {
      const data = await fetch(`/api/agent/confirmations/${encodeURIComponent(confirmationId)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved: approved === true })
      }).then(parseResponse);
      const artifact = data.artifact || (data.result?.artifactKind === 'feishu'
        ? { kind: 'feishu', id: data.result.contentItemId || data.result.id, title: data.result.title, url: data.result.url, contentItemId: data.result.contentItemId || '' }
        : (data.result?.id ? { kind: data.result.template === 'agent' ? 'draft' : (data.result.artifactKind === 'task' ? 'task' : 'note'), id: data.result.id, title: data.result.title, workspace: data.result.template === 'agent' ? 'writing' : 'notes' } : null));
      const confirmation = data.confirmation || { ...message.agent?.confirmation, status: approved ? 'confirmed' : 'rejected' };
      const followUp = String(data.confirmation?.status === 'confirmed' && artifact?.title
        ? (artifact.kind === 'draft'
          ? `已写入写作草稿《${artifact.title}》。下一句可以直接继续改这篇草稿，或让我基于它继续做事。`
          : artifact.kind === 'feishu'
            ? `已创建飞书文档《${artifact.title}》${artifact.url ? `：${artifact.url}` : ''}。${artifact.contentItemId ? '已收回知识库，下一句可以继续问这篇文档。' : '下一句可以说要改哪里，或再导出一版。'}`
          : `已写入知识库${artifact.kind === 'task' ? '任务' : '笔记'}《${artifact.title}》。下一句可以直接继续问这篇内容，或让我基于它继续做事。`)
        : '');
      setMessagesForChatTab(chatTabId, current => current.map(item => item.id === message.id ? {
        ...item,
        text: followUp ? (item.text && !item.text.includes(followUp) ? `${item.text}\n\n${followUp}` : followUp) : item.text,
        done: true,
        agent: {
          ...item.agent,
          status: confirmation.status,
          confirmation,
          confirmationResult: data.result || null,
          writtenArtifact: artifact
        }
      } : item));
      if (approved && (artifact?.kind === 'note' || artifact?.kind === 'draft' || artifact?.kind === 'feishu') && artifact.id) {
        const followUpId = artifact.kind === 'feishu' ? String(artifact.contentItemId || '') : (artifact.kind === 'note' ? String(artifact.id) : '');
        if (followUpId) setSelectedDocs(current => current.includes(followUpId) ? current : current.length ? [...current, followUpId] : current);
        invalidateGraphData();
        fetch('/api/state').then(parseResponse).then(next => {
          if (next) setState(current => ({ ...current, notes: next.notes || current.notes, writingDrafts: next.writingDrafts || current.writingDrafts, conversations: next.conversations || current.conversations }));
        }).catch(() => {});
      }
      if (approved && artifact?.kind === 'feishu') {
        handleFeishuExported({ contentItemId: artifact.contentItemId, url: artifact.url, title: artifact.title });
      }
      notify(approved ? (artifact?.kind === 'feishu' ? (artifact.title ? `已创建飞书文档：${artifact.title}` : '已创建飞书文档') : (artifact?.title ? `已写入：${artifact.title}` : '已确认写入')) : '已拒绝提案');
    } catch (error) {
      notify(errText(error, '确认失败'), 'error');
    }
  }

  function retryLast(failedMessage = null) {
    const retry = retryChatRequest(messages, failedMessage, { documentIds: selectedDocs, attachments: chatAttachments, mode: agentMode });
    if (retry) ask(retry.prompt, retry.documentIds, retry.targetAssistantId, retry.attachments, retry.mode, retry.selection);
  }

  function startNewConversation(tabId = null) {
    setKnowledgeIntent('chat');
    const activeTab = workspaceSession.tabs.find(tab => tab.id === workspaceSession.activeTabId);
    const id = String(tabId || (activeTab && isChatWorkspaceTab(activeTab) ? activeTab.id : currentChatTabId()) || '');
    if (id === 'module-knowledge') dispatchWorkspace({ type: 'UPDATE_TAB', tabId: id, patch: { title: '知识问答' } });
    if (!id) return;
    stopGeneration(id);
    chatRestoreRequestRef.current += 1;
    void clearChatAttachments();
    const runtime = chatRuntimeForTab(id);
    runtime.messages = [];
    runtime.error = '';
    runtime.historyOpen = false;
    runtime.loadedConversationId = '';
    const keptDocumentIds = currentChatTabId() === id ? selectedDocs : getChatTabScene(workspaceSession.tabs.find(tab => tab.id === id) || { chat: {} }).documentIds;
    const keptScopeExplicit = currentChatTabId() === id
      ? chatScopeExplicitRef.current
      : getChatTabScene(workspaceSession.tabs.find(tab => tab.id === id) || { chat: {} }).scopeExplicit;
    setChatTabScene(id, { conversationId: null, documentIds: keptDocumentIds, scopeExplicit: keptScopeExplicit, selection: null, agentMode: 'auto', skillRun: null });
    if (currentChatTabId() === id) {
      setChatConversationIdState('');
      setSelectedDocsState(keptDocumentIds);
      setChatScopeExplicit(keptScopeExplicit);
      setAgentModeState('auto');
      setSkillRunState(null);
      setMessagesState([]);
      setHistoryOpenState(false);
      setChatErrorState('');
    }
  }

  function restoreConversation(conversation, tabId = currentChatTabId()) {
    const id = String(tabId || '');
    if (!id || !conversation) return;
    if (conversation.id && !Array.isArray(conversation.messages)) {
      setChatTabScene(id, { conversationId: conversation.id });
      void hydrateChatTab({ id, kind: 'chat', chat: createChatTabScene({ conversationId: conversation.id }) });
      return;
    }
    setKnowledgeIntent('chat');
    if (id === 'module-knowledge') dispatchWorkspace({ type: 'UPDATE_TAB', tabId: id, patch: { title: '知识问答' } });
    if (currentChatTabId() === id) void clearChatAttachments();
    let lastQuestion = '';
    let restoredSelection = null;
    const knownDocumentIds = new Set(conversationMaterials.map(item => String(item.id)));
    const requestedScope = normalizedDocumentIds(conversation?.lastScope?.documentIds);
    const restoredScopeExplicit = conversation?.lastScope?.origin === 'request-cleared'
      || conversation?.lastScope?.requested === true
      || requestedScope.length > 0;
    const restoredScope = knownDocumentIds.size ? requestedScope.filter(documentId => knownDocumentIds.has(documentId)) : requestedScope;
    const suggestionStatuses = graphSuggestionStatusMap(graphData);
    const restored = applyGraphSuggestionStatuses((conversation?.messages || []).map((item, index) => {
      const mode = agentModeOption(item.mode || item.agent?.mode || 'auto').id;
      const documentIds = normalizedDocumentIds(item.documentIds);
      const selection = item.selection && typeof item.selection === 'object' ? {
        documentId: String(item.selection.documentId || item.selection.sourceId || '').trim() || null,
        quote: String(item.selection.quote || item.selection.text || '').trim().slice(0, 1600),
        anchor: item.selection.anchor || null,
        startOffset: item.selection.startOffset,
        endOffset: item.selection.endOffset
      } : null;
      if (selection?.documentId || selection?.quote || selection?.anchor) restoredSelection = selection;
      if (item.role === 'user') {
        lastQuestion = item.content || item.text || '';
        return { id: item.id || `user-${index}`, role: 'user', text: lastQuestion, mode, documentIds, selection };
      }
      return {
        id: item.id || `assistant-${index}`,
        role: 'assistant',
        text: item.content || item.text || '',
        mode,
        citations: item.citations || [],
        relations: item.relations,
        documentIds,
        selection,
        agent: item.agent || (item.agentRunId ? { runId: item.agentRunId, mode, status: 'completed' } : null),
        artifact: item.artifact || null,
        question: lastQuestion,
        conversationId: conversation.id,
        done: true
      };
    }), suggestionStatuses);
    const restoredMode = agentModeOption(conversation?.lastMode || restored.at(-1)?.mode || 'auto').id;
    const runtime = chatRuntimeForTab(id);
    runtime.messages = restored;
    runtime.loadedConversationId = conversation.id || '';
    runtime.error = '';
    setMessagesForChatTab(id, restored);
    setChatTabScene(id, {
      conversationId: conversation.id || null,
      documentIds: restoredScope,
      scopeExplicit: restoredScopeExplicit,
      selection: restoredSelection || getChatTabScene(workspaceSession.tabs.find(tab => tab.id === id)).selection,
      agentMode: restoredMode
    });
    if (currentChatTabId() === id) {
      setChatConversationIdState(conversation.id || '');
      setSelectedDocsState(restoredScope);
      setChatScopeExplicit(restoredScopeExplicit);
      setAgentModeState(restoredMode);
      setHistoryOpenState(false);
      setChatErrorState('');
    }
  }
  function openEvidenceWorkbench(documentIds = selectedDocs, question = '') {
    setReaderDetail(null);
    setGraphOpen(false);
    const ids = normalizedDocumentIds(documentIds);
    dispatchWorkspace({ type: 'OPEN_TAB', tab: { id: `evidence-${Date.now()}`, kind: 'module', type: 'document', route: 'evidence', documentIds: ids, question: String(question || ''), title: '证据工作台', openedAt: Date.now(), lastActiveAt: Date.now() } });
    setActive('evidence');
  }

  function invalidateGraphData() {
    graphLoadRef.current = null;
    graphRequestVersionRef.current += 1;
    setGraphData(null);
  }

  async function requestGraphSnapshot() {
    const version = ++graphRequestVersionRef.current;
    if (graphLoadRef.current) return graphLoadRef.current;
    setGraphLoading(true);
    const request = fetch('/api/graph?suggestions=true', { cache: 'no-store' })
      .then(parseResponse)
      .then(data => {
        if (version !== graphRequestVersionRef.current) return data.graph || EMPTY_INDEXED_GRAPH;
        const graph = data.graph || EMPTY_INDEXED_GRAPH;
        setGraphData(graph);
        return graph;
      })
      .finally(() => {
        if (graphLoadRef.current === request) graphLoadRef.current = null;
        if (version === graphRequestVersionRef.current) setGraphLoading(false);
      });
    graphLoadRef.current = request;
    return request;
  }

  function applyGraphSuggestionStatusToChatRuntimes(suggestionId, status) {
    const nextMessagesByTab = new Map();
    for (const [tabId, runtime] of chatRuntimeRef.current.entries()) {
      const next = withGraphSuggestionStatus(runtime.messages, suggestionId, status);
      runtime.messages = next;
      nextMessagesByTab.set(tabId, next);
    }
    const activeTabId = currentChatTabId();
    if (activeTabId && nextMessagesByTab.has(activeTabId)) setMessagesState(nextMessagesByTab.get(activeTabId));
  }

  async function confirmGraphSuggestion(suggestionId, approved = true, message = null) {
    try {
      const data = await fetch(`/api/graph/suggestions/${encodeURIComponent(suggestionId)}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved: approved === true }) }).then(parseResponse);
      const nextStatus = data.suggestion?.status || (approved ? 'approved' : 'rejected');
      applyGraphSuggestionStatusToChatRuntimes(suggestionId, nextStatus);
      invalidateGraphData();
      await requestGraphSnapshot();
      notify(approved ? (data.applied ? '已确认建议，关系已写入图谱' : '已记录确认，关系会在下次索引重建后出现') : '已忽略这条建议');
      return data;
    } catch (error) {
      notify(errText(error, '确认关系失败'), 'error');
    }
  }

  async function openKnowledgeGraph(options = {}) {
    void preloadWorkspaceSurface('knowledge-graph');
    const documentId = String(options.documentId || options.id || '');
    setGraphFocus(documentId ? { documentId } : null);
    if (!documentId) setReaderDetail(null);
    setActive('knowledge');
    try {
      const data = await fetch('/api/notes').then(parseResponse);
      setGraphNotes(Array.isArray(data.notes) ? data.notes.filter(note => !note.deletedAt) : []);
      if (!graphData) await requestGraphSnapshot();
      setGraphOpen(true);
    } catch (error) { notify(errText(error, '知识图谱加载失败'), 'error'); }
  }

  function openGraphNote(note) {
    const noteId = String(note?.id || '');
    setNoteDeepLinkId(noteId);
    setGraphOpen(false);
    if (noteId) {
      void preloadWorkspaceRoute('notes');
      dispatchWorkspace({
        type: 'OPEN_TAB',
        tab: {
          id: `note-${noteId}`,
          kind: 'note',
          type: 'note',
          route: 'notes',
          noteId,
          title: note?.title || '笔记',
          openedAt: Date.now(),
          lastActiveAt: Date.now()
        }
      });
    }
    setActive('notes');
  }
  async function openContentReader(documentOrId) {
    void preloadWorkspaceSurface('content-reader');
    const hint = typeof documentOrId === 'object' ? documentOrId : null;
    setReaderAnchor(String(hint?.anchor || hint?.sourceAnchor || hint?.location?.anchor || hint?.sourceRefs?.[0]?.anchor || ''));
    setReaderExcerpt(String(hint?.excerpt || hint?.snippet || hint?.quote || hint?.text || ''));
    const documentId = String(typeof documentOrId === 'string' ? documentOrId : documentOrId?.documentId || documentOrId?.id || '');
    if (!documentId) return;
    if (readerChat.documentId && readerChat.documentId !== documentId) readerAskAbortRef.current?.abort();
    setGraphOpen(false);
    setGraphFocus(null);
    setActive('knowledge');
    try {
      const data = await loadWorkspaceDocument(documentId);
      const item = data?.item || hint || { id: documentId };
      const existingTab = workspaceSession.tabs.find(tab => tab.id === `document-${documentId}` || tab.resourceId === documentId);
      dispatchWorkspace({ type: 'OPEN_TAB', tab: { id: `document-${documentId}`, kind: 'document', type: 'document', route: 'knowledge', resourceId: documentId, title: item.title || hint?.title || '文档', source: item.sourceType || item.source || item.metadata?.source || '知识库', openedAt: Date.now(), lastActiveAt: Date.now(), ...(existingTab?.readerConversationId ? { readerConversationId: existingTab.readerConversationId } : {}) } });
      dispatchWorkspace({ type: 'TOUCH_RECENT_WORK', item: { id: `recent-document-${documentId}`, kind: 'document', type: 'document', resourceId: documentId, documentId, title: item.title || '文档', summary: String(item.content || '').slice(0, 80), updatedAt: new Date().toISOString() } });
    } catch (error) {
      notify(errText(error, '文档打开失败'), 'error');
    }
  }

  async function openCurrentReaderVersion(item) {
    const id = String(item?.id || readerDetail?.item?.id || '');
    if (!id) return;
    const currentVersionId = item?.currentVersionId ?? readerDetail?.item?.currentVersionId ?? null;
    dispatchWorkspace({
      type: 'UPDATE_TAB',
      tabId: `document-${id}`,
      patch: {
        contentVersionId: currentVersionId,
        isHistoricalVersion: false,
        evidenceStatus: 'current',
        evidenceStatusReason: null
      }
    });
    await openContentReader(id);
  }

  function toggleReaderQuestionScope(item, enabled) {
    const documentId = String(item?.id || '');
    if (!documentId) return;
    setSelectedDocs(current => enabled ? [...new Set([...current, documentId])] : current.filter(id => id !== documentId));
  }

  function openCreatedWorkspaceNote(note, { sourceDocumentId = '', summary = '来源笔记' } = {}) {
    const noteId = String(note?.id || '');
    if (!noteId) throw new Error('笔记创建响应缺少 ID');
    void preloadWorkspaceRoute('notes');
    setReaderDetail(null);
    setGraphOpen(false);
    setNoteDeepLinkId(noteId);
    dispatchWorkspace({ type: 'OPEN_TAB', tab: { id: `note-${noteId}`, kind: 'note', type: 'note', route: 'notes', noteId, sourceDocumentId, title: note?.title || '来源笔记', openedAt: Date.now(), lastActiveAt: Date.now() } });
    setActive('notes');
    dispatchWorkspace({ type: 'TOUCH_RECENT_WORK', item: { id: `recent-note-${noteId}`, kind: 'note', type: 'note', noteId, title: note?.title || '来源笔记', summary, updatedAt: note?.updatedAt || new Date().toISOString() } });
    return note;
  }
  async function writeSourceNote(item, selection = null) {
    try {
      const sourceUrl = item?.sourceUrl || item?.url || '';
      const quote = String(selection?.quote || selection?.text || '').trim();
      const sourceVersionId = item?.contentVersionId ?? item?.currentVersionId ?? null;
      const sourceRef = { documentId: item?.id, title: item?.title, url: sourceUrl,
        ...(sourceVersionId !== null ? { contentVersionId: sourceVersionId } : {}),
        ...(item?.revision ? { revision: item.revision } : {}),
        ...(item?.contentHash ? { contentHash: item.contentHash } : {}),
        ...(selection?.anchor ? { anchor: selection.anchor } : {}),
        ...(quote ? { quote, selection: true, startOffset: selection?.startOffset, endOffset: selection?.endOffset } : {})
      };
      const data = await fetch('/api/notes', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: buildSourceNoteTitle(item, { selection }),
          content: buildSourceNoteContent(item, { quote }),
          tags: quote ? ['来源笔记', '选区笔记'] : ['来源笔记'],
          sourceRefs: [sourceRef]
        })
      }).then(parseResponse);
      invalidateGraphData();
      const note = openCreatedWorkspaceNote(data.note, { sourceDocumentId: item?.id, summary: quote ? '基于阅读选区创建' : '来源笔记' });
      notify(`已创建来源笔记：${note.title || item?.title || ''}`);
    } catch (error) { notify(errText(error, '来源笔记创建失败'), 'error'); }
  }

  async function openRelatedDocument(document) {
    const documentId = String(document?.documentId || document?.id || '');
    const title = String(document?.title || '').trim();
    const notes = state.notes || [];
    const isNote = document?.type === 'note' || document?.contentType === 'note' || notes.some(note => String(note.id) === documentId);
    if (isNote || (!documentId && title)) {
      const byId = notes.find(note => String(note.id) === documentId);
      const byTitle = title ? notes.find(note => String(note.title || '').trim().toLowerCase() === title.toLowerCase()) : null;
      const note = byId || byTitle;
      if (note?.id) {
        openGraphNote({ id: note.id, title: note.title || title });
        return;
      }
      if (isNote && documentId && documentId !== title) {
        openGraphNote({ id: documentId, title: title || documentId });
        return;
      }
      if (isNote) return;
    }
    if (documentId) {
      await openContentReader(document);
      return;
    }
    const url = document?.url || document?.sourceUrl || document?.sourceRefs?.find((source) => source.url || source.sourceUrl)?.url || document?.sourceRefs?.find((source) => source.url || source.sourceUrl)?.sourceUrl;
    if (url && !String(url).startsWith('file:')) window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function createAnswerArtifact(kind, message) {
    const normalizedKind = kind === 'draft' ? 'writing' : kind;
    const busyKey = `${message.id || message.conversationId || 'answer'}:${normalizedKind}`;
    setArtifactBusy(busyKey);
    try {
      const data = await fetch('/api/answers/artifacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: normalizedKind,
          question: message.relations?.rewrittenQuestion || message.question || '',
          answer: message.text || '',
          citations: message.citations || [],
          relations: message.relations || {},
          conversationId: message.conversationId || '',
          messageId: message.id || ''
        })
      }).then(parseResponse);
      if (normalizedKind === 'writing') {
        openWrittenArtifact({ kind: 'draft', id: data.artifact?.id, title: data.artifact?.title, workspace: 'writing' });
        notify('写作草稿已创建并打开');
      } else if (normalizedKind === 'problem' && data.artifact?.id) {
        const artifact = { kind: 'problem', id: data.artifact.id, title: data.artifact.title, appended: Boolean(data.appended), workspace: 'notes' };
        setMessages(current => current.map(item => (item.id === message.id ? { ...item, artifact } : item)));
        dispatchWorkspace({ type: 'TOUCH_RECENT_WORK', item: { id: `recent-note-${artifact.id}`, kind: 'note', type: 'note', noteId: artifact.id, title: artifact.title || '问题记录', summary: artifact.appended ? '又记下一点' : '问题记录', updatedAt: data.artifact.updatedAt || new Date().toISOString() } });
        notify(artifact.appended ? `已补进问题记录：${artifact.title}` : `已记下：${artifact.title}`);
      } else if (data.artifact?.id) {
        openWrittenArtifact({ kind: normalizedKind === 'task' ? 'task' : 'note', id: data.artifact.id, title: data.artifact.title, workspace: 'notes' });
        notify(normalizedKind === 'task' ? '任务已创建并打开' : '知识笔记已创建并打开');
      } else {
        openWorkspaceModule(data.workspace === 'writing' ? 'writing' : 'notes');
        notify(normalizedKind === 'task' ? '任务已创建并打开' : '知识笔记已创建并打开');
      }
    } catch (error) {
      notify(errText(error, '工作产物创建失败'), 'error');
    } finally { setArtifactBusy(''); }
  }

  async function runSkill(skillId = selectedSkill, scopeDocumentIds = null) {
    if (skillRun?.running) return;
    const skill = skills.find(item => item.id === skillId) || activeSkill;
    const topic = skillTopic.trim();
    const localId = `skill-${Date.now()}`;
    setSelectedSkill(skill.id); openWorkspaceModule('skills', { title: skill.name });
    dispatchWorkspace({ type: 'UPSERT_TASK', task: { id: localId, type: 'skill', skillId: skill.id, documentIds: Array.isArray(scopeDocumentIds) ? scopeDocumentIds : selectedDocs, title: skill.name, detail: '正在准备材料与执行步骤', status: 'running', progress: 0.08, createdAt: new Date().toISOString() } });
    setSkillRun({ id: localId, skillId: skill.id, title: skill.name, topic, steps: [], output: '', running: true, startedAt: new Date().toISOString() });
    try {
      const response = await fetch('/api/skills/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skillId: skill.id, input: topic, query: topic, knowledgeBaseId: selectedKb, documentIds: Array.isArray(scopeDocumentIds) ? scopeDocumentIds : selectedDocs, selection: workspaceContext.selection || null }) });
      await readNdjson(response, event => setSkillRun(current => {
        if (!current) return current;
        if (event.type === 'start') return { ...current, id: event.runId || current.id };
        if (event.type === 'step') return { ...current, steps: [...current.steps, { label: event.name || event.label || `步骤 ${event.step}`, detail: event.detail || event.status }] };
        if (event.type === 'model') return { ...current, model: { provider: event.provider, id: event.model }, modelStatus: `正在调用 ${event.model || event.provider}` };
        if (event.type === 'model-delta') return { ...current, modelStatus: `模型已生成 ${(current.modelPreview || '').length + String(event.delta || '').length} 字`, modelPreview: (current.modelPreview || '') + (event.delta || '') };
        if (event.type === 'model-fallback') return { ...current, fallbackUsed: true, modelStatus: '远端模型不可用，已切换本地工作流' };
        if (event.type === 'artifact') return { ...current, output: event.artifact?.content || event.content || '', artifact: event.artifact, model: event.model || current.model, fallbackUsed: event.fallbackUsed || current.fallbackUsed };
        if (event.type === 'done') return { ...current, running: false, completedAt: event.completedAt || new Date().toISOString(), output: event.result?.artifact?.content || current.output, artifact: event.result?.artifact || current.artifact, model: event.result?.model || current.model, fallbackUsed: event.result?.fallbackUsed || current.fallbackUsed, modelStatus: '' };
        return current;
      }));
      setSkillRun(current => {
        if (!current) return current;
        const done = { ...current, running: false, completedAt: current.completedAt || new Date().toISOString() };
        setSkillRuns(items => [done, ...items.filter(item => item.id !== done.id)]);
        return done;
      });
      dispatchWorkspace({ type: 'UPDATE_TASK', taskId: localId, patch: { status: 'completed', progress: 1, detail: '产物已保存到 Skill 工作台', updatedAt: new Date().toISOString() } });
      dispatchWorkspace({ type: 'TOUCH_RECENT_WORK', item: { id: `recent-${localId}`, kind: 'skill', type: 'skill', route: 'skills', title: skill.name, summary: topic || '基于当前知识范围运行', updatedAt: new Date().toISOString() } });
      notify(`${skill.name}已生成产物`);
    } catch (error) {
      const message = errText(error, 'Skill 执行失败');
      setSkillRun(current => current ? { ...current, running: false, error: message, completedAt: new Date().toISOString() } : current);
      dispatchWorkspace({ type: 'UPDATE_TASK', taskId: localId, patch: { status: 'failed', detail: message, updatedAt: new Date().toISOString() } });
      notify(message, 'error');
    }
  }

  function openModelDrawer() {
    setModelForm({ ...modelSettings, apiKey: '' }); setModelDrawerOpen(true); setShowApiKey(false);
  }
  function updateProvider(provider) {
    const definition = providerById(provider);
    setModelForm(current => ({ ...current, provider, baseUrl: current.provider === provider ? current.baseUrl : definition.url, model: '', defaultModel: '' }));
    setModelOptions([]);
  }
  function buildModelPayload(includeKey = true) {
    let extraHeaders;
    try { extraHeaders = modelForm.extraHeadersText.trim() ? JSON.parse(modelForm.extraHeadersText) : {}; }
    catch { throw new Error('额外 Header 必须是有效的 JSON 对象'); }
    if (!extraHeaders || Array.isArray(extraHeaders) || typeof extraHeaders !== 'object') throw new Error('额外 Header 必须是 JSON 对象');
    const provider = modelForm.provider;
    const authMode = provider === 'anthropic' || provider === 'azure-openai' ? 'header'
      : provider === 'gemini' ? 'query'
        : provider === 'ollama' || provider === 'local' ? 'none'
          : provider === 'custom-http' ? (modelForm.customAuthType === 'x-api-key' ? 'header' : modelForm.customAuthType)
            : 'bearer';
    const apiKeyHeader = provider === 'anthropic' ? 'x-api-key'
      : provider === 'azure-openai' ? 'api-key'
        : provider === 'gemini' ? 'key'
          : provider === 'custom-http' && modelForm.customAuthType === 'x-api-key' ? 'x-api-key'
            : provider === 'custom-http' && modelForm.customAuthType === 'query' ? 'key'
              : 'Authorization';
    const payload = {
      provider: modelForm.provider, baseUrl: modelForm.baseUrl.trim(), model: modelForm.provider === 'azure-openai' ? (modelForm.azureDeployment || modelForm.defaultModel || modelForm.model) : (modelForm.defaultModel || modelForm.model),
      defaultModel: modelForm.provider === 'azure-openai' ? (modelForm.azureDeployment || modelForm.defaultModel || modelForm.model) : (modelForm.defaultModel || modelForm.model), timeoutMs: Math.max(5000, Number(modelForm.timeoutMs) || 120000), retries: Math.max(0, Math.min(5, Number(modelForm.retries) || 0)), retryDelayMs: Math.max(100, Number(modelForm.retryDelayMs) || 500), temperature: Math.max(0, Math.min(2, Number(modelForm.temperature) || 0)), maxTokens: Math.max(128, Number(modelForm.maxTokens) || 4096), fallbackToLocal: false, extraHeaders,
      azureDeployment: modelForm.azureDeployment.trim(), azureApiVersion: modelForm.azureApiVersion.trim(), apiVersion: modelForm.azureApiVersion.trim(),
      customChatPath: modelForm.customChatPath.trim(), chatPath: modelForm.customChatPath.trim(), customModelsPath: modelForm.customModelsPath.trim(), modelsPath: modelForm.customModelsPath.trim(),
      customAuthType: modelForm.customAuthType, authMode,
      apiKeyHeader,
      customRequestFormat: modelForm.customRequestFormat, requestFormat: modelForm.provider === 'custom-http' ? modelForm.customRequestFormat : modelForm.provider,
      customResponseFormat: modelForm.customResponseFormat, responseFormat: modelForm.customResponseFormat
    };
    if (includeKey && modelForm.apiKey) payload.apiKey = modelForm.apiKey;
    return payload;
  }
  async function refreshModels() {
    setModelBusy('models');
    try {
      const data = await fetch('/api/models/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...buildModelPayload(true), chatProbe: false }) }).then(parseResponse);
      const raw = data.models || data.data || [];
      const list = [...new Set(raw.map(item => typeof item === 'string' ? item : item.id || item.name || item.model).filter(Boolean))];
      setModelOptions(list);
      notify(list.length ? `已加载 ${list.length} 个模型` : '服务端未返回模型列表，可手动输入模型名称', list.length ? 'success' : 'info');
      setModelForm(current => ({ ...current, apiKey: '', hasApiKey: Boolean(current.apiKey || current.hasApiKey) }));
    } catch (error) { notify(errText(error, '模型列表刷新失败'), 'error'); }
    finally { setModelBusy(''); }
  }
  async function testModel() {
    setModelBusy('test');
    try {
      const hadKey = Boolean(modelForm.apiKey || modelForm.hasApiKey);
      const data = await fetch('/api/models/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildModelPayload(true)) }).then(parseResponse);
      notify(data.message || `连通成功${data.latencyMs ? ` · ${data.latencyMs}ms` : ''}`);
      setModelForm(current => ({ ...current, apiKey: '', hasApiKey: hadKey }));
    } catch (error) { notify(errText(error, '模型连通性测试失败'), 'error'); }
    finally { setModelBusy(''); }
  }
  async function saveModel() {
    setModelBusy('save');
    try {
      const payload = buildModelPayload(true);
      const hadKey = Boolean(modelForm.apiKey || modelForm.hasApiKey);
      const data = await fetch('/api/settings/model', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).then(parseResponse);
      const normalized = normalizeModel(data.settings || data.modelSettings || { ...payload, hasApiKey: hadKey, configured: true });
      normalized.apiKey = ''; normalized.hasApiKey = normalized.hasApiKey || hadKey;
      setModelSettings(normalized); setModelForm(normalized); setModelDrawerOpen(false);
      notify(`默认模型已切换为 ${modelLabel(normalized)}`);
    } catch (error) { notify(errText(error, '模型配置保存失败'), 'error'); }
    finally { setModelBusy(''); }
  }
  function selectNavigation(id) {
    if (id === 'evidence') {
      openEvidenceWorkbench();
      return;
    }
    if (id === 'graph') {
      openKnowledgeGraph();
      return;
    }
    if (['home', 'knowledge', 'analysis', 'skills', 'notes', 'writing', 'recording', 'copilots', 'settings'].includes(id)) openWorkspaceModule(id);
    else notify('该模块将在后续工作台版本中开放', 'info');
  }

  function renderWorkspaceTab(tab) {
    const route = tab?.route || (tab?.kind === 'document' || tab?.kind === 'chat' ? 'knowledge' : tab?.kind);
    if (route === 'knowledge') {
      const showDocument = tab?.kind === 'document';
      const libraryBrowse = knowledgeIntent === 'browse' && !graphOpen && !showDocument;
      const chatCanvas = tab?.kind === 'chat' && tab.id !== 'module-knowledge' && !showDocument && !graphOpen;
      return <div className={`workspace-tab-frame${libraryBrowse ? ' is-library-browse' : ''}${showDocument ? ' is-document-reader workspace-tab-frame-single' : chatCanvas ? ' is-chat-canvas workspace-tab-frame-single' : ''}`} data-library-browse={libraryBrowse ? 'true' : undefined} data-document-reader={showDocument ? 'true' : undefined} data-chat-canvas={chatCanvas ? 'true' : undefined}>
        <KnowledgeSidebar state={state} selectedKb={selectedKb} setSelectedKb={setSelectedKb} docs={docs} selectedDocs={selectedDocs} setSelectedDocs={setSelectedDocs} setShowSync={setShowSync} onOpenDocument={openContentReader} onPrefetchDocument={prefetchWorkspaceDocument} onOpenGraph={openKnowledgeGraph} libraries={knowledgeLibraries} libraryFilter={knowledgeLibraryFilter} setLibraryFilter={setKnowledgeLibraryFilter} libraryBusy={knowledgeLibraryBusy} onRefreshLibraries={() => loadKnowledgeLibraries({ refresh: true })} onFollowLibrary={followKnowledgeLibrary} onSelectLibrary={selectKnowledgeLibrary} onCollect={() => { void preloadWorkspaceSurface('collection'); setCollectionOpen(true); }}/>
        {graphOpen ? <Suspense fallback={<WorkspaceRouteFallback label="知识图谱"/>}><KnowledgeGraph documents={state.documents || []} notes={graphNotes} graph={graphData || EMPTY_INDEXED_GRAPH} loading={graphLoading} initialRootId={graphFocus?.documentId || ''} initialLocalMode={Boolean(graphFocus?.documentId)} onOpenDocument={openContentReader} onOpenNote={openGraphNote} onAskNode={handleKnowledgeObservationAsk} onCreateNote={node => writeSourceNote(node.raw || { id: node.sourceId, title: node.label })} onOpenEvidenceWorkbench={documentIds => openEvidenceWorkbench(Array.isArray(documentIds) && documentIds.length ? documentIds : selectedDocs)} onConfirmSuggestion={confirmGraphSuggestion} onRefreshGraph={async () => { invalidateGraphData(); await requestGraphSnapshot(); }} onClose={() => { setGraphOpen(false); setGraphFocus(null); }}/></Suspense> : showDocument && readerBusy ? <main className="workspace reader-loading"><LoaderCircle className="spin" size={26}/><span>正在恢复文档…</span></main> : showDocument && readerDetail?.item ? <Suspense fallback={<WorkspaceRouteFallback label="文档"/>}><ContentReader item={readerDetail.item} attachments={readerDetail.attachments || []} inQuestionScope={selectedDocs.includes(readerDetail.item.id)} onToggleQuestionScope={toggleReaderQuestionScope} onAsk={(prompt, selection) => handleReaderAsk(prompt, readerDetail.item, selection)} onContinueInWorkspace={(item, payload) => handleContinueReaderInWorkspace(item, payload)} onOpenEvidenceWorkbench={() => openEvidenceWorkbench([readerDetail.item.id, ...selectedDocs.filter(id => id !== readerDetail.item.id)])} conversation={readerChat.documentId === readerDetail.item.id ? readerChat : null} onStopConversation={handleStopReaderAsk} onRetryConversation={() => handleRetryReaderAsk(readerDetail.item)} onCreateWriting={selection => handleReaderCreateWriting(readerDetail.item, selection)} onRunInterpretation={(kind, selection, force) => handleReaderInterpretation(kind, readerDetail.item, selection, force)} interpretationRuns={runs.filter(run => ["mind-map", "quiz"].includes(run.skillId) && (run.documentIds || run.input?.documentIds || []).map(String).includes(String(readerDetail.item.id)))} onWriteSourceNote={writeSourceNote} onSaveAnswer={message => createAnswerArtifact('note', message)} onOpenGraph={() => openKnowledgeGraph({ documentId: readerDetail.item.id })} onOpenDocument={openRelatedDocument} onSelectionChange={handleReaderSelection} onReadingPositionChange={position => handleReaderPosition(position, readerDetail.item)} onAnchorChange={anchor => setReaderAnchor(anchor)} initialAnchor={readerAnchor} initialExcerpt={readerExcerpt} initialReadingPosition={workspaceSession.readingPositions[readerDetail.item.id]} onResyncAttachments={handleReaderResyncAttachments} resyncBusy={readerResyncBusy} resyncError={readerResyncError} userLoggedIn={Boolean(feishuUser.loggedIn)} onLoginFeishu={handleFeishuUserLogin} onClose={() => closeWorkspaceTab(tab)}/></Suspense> : <ChatWorkspace kb={kb} selectedDocs={selectedDocs} setSelectedDocs={setSelectedDocs} messages={messages} setMessages={setMessages} query={query} setQuery={setQuery} ask={ask} streaming={streaming} stopGeneration={stopGeneration} retryLast={retryLast} onRegenerate={regenerateAnswer} chatError={chatError} modelSettings={modelSettings} openModelDrawer={openModelDrawer} skills={skills} runSkill={runSkill} runChatSkill={runChatSkill} skillRun={skillRun} onRetrySkillRun={retryRecoverableChatSkill} historyOpen={historyOpen} setHistoryOpen={setHistoryOpen} conversations={(state.conversations || []).filter(item => item.surface !== 'reader')} onNewConversation={startNewConversation} onRestoreConversation={restoreConversation} onOpenDocument={openRelatedDocument} onCreateArtifact={createAnswerArtifact} artifactBusy={artifactBusy} endRef={endRef} attachments={chatAttachments} attachmentBusy={chatAttachmentBusy} attachmentCapabilities={chatAttachmentCapabilities} onAddAttachments={addChatAttachments} onRemoveAttachment={removeChatAttachment} onRetryAttachment={retryChatAttachment} documents={conversationMaterials} workspaceContext={workspaceContext} onOpenModule={selectNavigation} includeKnowledgeBase={chatIncludeKnowledgeBase} onIncludeKnowledgeBaseChange={setChatIncludeKnowledgeBase} browseMode={libraryBrowse} agentMode={agentMode} setAgentMode={setAgentMode} onOpenEvidence={documentIds => openEvidenceWorkbench(documentIds)} onConfirmAgent={confirmAgent} onConfirmSuggestion={confirmGraphSuggestion} onOpenWrittenArtifact={openWrittenArtifact} smartHome={smartHome} exportDialog={exportDialog} setExportDialog={setExportDialog} onContinueSkillRun={runId => { const run = skillRuns.find(item => item.id === runId); if (run) { setSkillRun(run); openWorkspaceModule('skills'); } }} onConnectFeishu={openFeishuExperience} onSmartHomeAction={handleSmartHomeAction} onFeishuExported={handleFeishuExported} copilots={state.copilots || []} activeCopilotId={state.settings?.activeCopilotId || ''} onSelectCopilot={activateCopilot} onOpenCopilots={() => openWorkspaceModule('copilots')} onCreateWriting={() => handleWorkspaceCreateWriting()} onOpenGraph={() => openKnowledgeGraph()} onPrefetchDocument={prefetchWorkspaceDocument} onCollect={() => { void preloadWorkspaceSurface('collection'); setCollectionOpen(true); }}/>}
      </div>;
    }
    if (route === 'evidence') return <div className="workspace-tab-frame workspace-tab-frame-single"><Suspense fallback={<WorkspaceRouteFallback label="证据工作台"/>}><EvidenceWorkbench documents={conversationMaterials} initialDocumentIds={tab?.documentIds?.length ? tab.documentIds : selectedDocs} initialQuestion={tab?.question || ''} onOpenDocument={openContentReader} onClose={() => closeWorkspaceTab(tab)}/></Suspense></div>;
    if (route === 'analysis') return <div className="workspace-tab-frame"><Suspense fallback={<WorkspaceRouteFallback label="文档分析"/>}><DocumentAnalysisModule onToast={notify}/></Suspense></div>;
    if (route === 'skills') return <div className="workspace-tab-frame"><SkillSidebar skills={skills} selectedSkill={selectedSkill} setSelectedSkill={setSelectedSkill} runs={runs} onSelectRun={setSkillRun}/><SkillWorkspace skill={activeSkill} topic={skillTopic} setTopic={setSkillTopic} runSkill={runSkill} run={skillRun} selectedCount={selectedDocs.length} documentCount={docs.length} libraryName={kb?.name || ''} runs={runs} onSelectRun={setSkillRun} onOpenDocument={openContentReader} onOpenGraph={() => openKnowledgeGraph()} onKeepWriting={run => createAnswerArtifact('writing', { id: run?.id, text: run?.output || run?.artifact?.content || '', question: run?.topic || run?.title || skillTopic, citations: run?.artifact?.sourceRefs || [] })} onSaveNote={run => createAnswerArtifact('note', { id: run?.id, text: run?.output || run?.artifact?.content || '', question: run?.topic || run?.title || skillTopic, citations: run?.artifact?.sourceRefs || [] })}/></div>;
    if (route === 'notes') return <div className="workspace-tab-frame"><Suspense fallback={<WorkspaceRouteFallback label="笔记"/>}><NotesModule onToast={notify} onOpenDocument={openRelatedDocument} onGraphChange={invalidateGraphData} onOpenNote={openGraphNote} onAskAboutNote={handleWorkspaceAskAboutNote} onOpenWeb={handleOpenWeb} initialNoteId={tab?.noteId || noteDeepLinkId} linkCandidates={conversationMaterials}/></Suspense></div>;
    if (route === 'web') return <div className="workspace-tab-frame workspace-tab-frame-single"><Suspense fallback={<WorkspaceRouteFallback label="网页"/>}><EmbeddedBrowser initialUrl={tab?.url || ''} onUrlChange={(url, meta) => dispatchWorkspace({ type: 'UPDATE_TAB', tabId: tab.id, patch: { url, resourceId: url, title: meta?.title || url || tab.title || '网页' } })} onClip={handleClipWebToProblemNote} onOpenNote={note => openCreatedWorkspaceNote(note, { summary: '网页剪藏' })}/></Suspense></div>;
    if (route === 'writing') return <div className="workspace-tab-frame"><Suspense fallback={<WorkspaceRouteFallback label="写作台"/>}><WritingModule onToast={notify} initialDraftId={tab?.draftId || writingDeepLinkId} onOpenDocument={openContentReader}/></Suspense></div>;
    if (route === 'recording') return <div className="workspace-tab-frame workspace-tab-frame-single"><Suspense fallback={<WorkspaceRouteFallback label="录音纪要"/>}><RecordingWorkspace initialSession={recordingSession} onSessionChange={setRecordingSession} onImportAudio={importRecordedAudio} onOpenDocument={openContentReader}/></Suspense></div>;
    if (route === 'copilots') return <div className="workspace-tab-frame"><Suspense fallback={<WorkspaceRouteFallback label="Copilot"/>}><CopilotModule skills={skills} knowledgeBases={knowledgeLibraries.length ? knowledgeLibraries : (state.knowledgeBases || [])} onToast={notify} onUseInChat={useCopilotInChat}/></Suspense></div>;
    if (route === 'settings') return <div className="workspace-tab-frame"><Suspense fallback={<WorkspaceRouteFallback label="设置"/>}><SettingsExperienceSidebar activeSection={settingsSection} onSectionChange={setSettingsSection} modelSettings={modelSettings}/><SettingsExperienceWorkspace activeSection={settingsSection} modelSettings={modelSettings} provider={providerById(modelSettings.provider)} onManageModels={openModelDrawer} onOpenFeishuWizard={openFeishuExperience} onToast={notify} workspaceSession={workspaceSession} onWorkspaceSessionChange={session => dispatchWorkspace({ type: 'HYDRATE', session })} compact={workspaceCompact} onToggleCompact={setWorkspaceCompact}/></Suspense></div>;
    return null;
  }

  return <div className="app-shell app-shell-v3" data-skin="friday">
    <UnifiedWorkspace
      compact={workspaceCompact}
      activeSection={active}
      recentItems={workspaceRecentItems}

      tabs={shellWorkspaceTabs}
      activeTabId={workspaceSession.activeTabId}
      tasks={[...visibleWorkspaceTasks].reverse()}
      context={workspaceContext}
      renderActiveTab={tab => <WorkspaceSurfaceErrorBoundary resetKey={tab?.id || String(active || '')}>{renderWorkspaceTab(tab)}</WorkspaceSurfaceErrorBoundary>}
      onPrefetch={route => { void preloadWorkspaceRoute(route); }}
      onOpenRecent={handleOpenRecent}
      onActivateTab={activateWorkspaceTab}
      onCloseTab={closeWorkspaceTab}
      onNewTab={() => { createChatWorkspaceTab({ title: '新对话' }); }}
      onSearch={handleWorkspaceSearch}
      onOpenSearch={openWorkspaceSearchPanel}
      search={workspaceSearch}
      onCloseSearch={closeWorkspaceSearch}
      onOpenSearchResult={openWorkspaceSearchResult}
      onReopenSearch={reopenWorkspaceSearch}
      onAsk={handleWorkspaceAsk}
      onCollect={() => { void preloadWorkspaceSurface('collection'); setCollectionOpen(true); }}
      onCreateNote={handleWorkspaceCreateNote}
      onCreateProblemNote={handleWorkspaceCreateProblemNote}
      onOpenWeb={handleOpenWeb}
      onCreateWriting={handleWorkspaceCreateWriting}
      onRunSkill={handleWorkspaceRunSkill}
      onNavigate={selectNavigation}
      onOpenTask={handleOpenTask}
      onRetryTask={handleRetryTask}
      onAttachContext={handleAttachContext}
      onRemoveContext={handleRemoveContext}
      onClearSelection={() => { const selection = workspaceSession.aiContextItems.find(item => item.kind === 'selection'); if (selection) dispatchWorkspace({ type: 'REMOVE_AI_CONTEXT_ITEM', id: selection.id }); }}
      onToggleCompact={setWorkspaceCompact}
      smartHome={smartHome}
      onSmartHomeAction={handleSmartHomeAction}
      libraryName={kb?.name || ''}
    />

    <SmartSearch
      open={smartSearchOpen}
      searchHistory={searchHistory}
      trendingTopics={trendingTopics}
      documents={state.documents || []}
      onSearch={handleSmartSearch}
      onOpenDocument={handleSmartSearchOpenDocument}
      onDeleteHistory={handleDeleteSearchHistory}
      onClearHistory={handleClearSearchHistory}
      onClose={() => setSmartSearchOpen(false)}
    />
    <button className="smart-search-fab" onClick={() => setSmartSearchOpen(true)} title="智能搜索">
      <Search size={20} />
    </button>

    {collectionOpen && <Suspense fallback={<WorkspaceRouteFallback label="收集中心" overlay/>}><CollectionCenter open={collectionOpen} onClose={() => setCollectionOpen(false)} onOpenFeishu={openFeishuExperience} onImportFiles={importCollectionFiles} onImportText={importCollectionText} onOpenWeb={url => { const tab = handleOpenWeb(url); if (tab) setCollectionOpen(false); }} onOpenLibrary={() => { setCollectionOpen(false); openWorkspaceModule('knowledge'); }}/></Suspense>}
    {showSync && <Suspense fallback={<WorkspaceRouteFallback label="飞书同步" overlay/>}><FeishuSyncWizard onClose={() => setShowSync(false)} onState={next => { setState(next); refreshContentItems().catch(error => notify(errText(error, '同步完成但内容列表刷新失败'), 'error') || []).then(items => setSelectedKb(resolveLibraryAfterSync(next, items))); }} onToast={notify} currentSync={state.sync}/></Suspense>}
    {modelDrawerOpen && <ModelDrawer form={modelForm} setForm={setModelForm} provider={providerById(modelForm.provider)} updateProvider={updateProvider} models={modelOptions} busy={modelBusy} showApiKey={showApiKey} setShowApiKey={setShowApiKey} refreshModels={refreshModels} testModel={testModel} saveModel={saveModel} close={() => setModelDrawerOpen(false)}/>}
    {toast && <div className={`toast ${toast.kind || ''}`} role={toast.kind === 'error' ? 'alert' : 'status'} aria-live={toast.kind === 'error' ? 'assertive' : 'polite'} aria-atomic="true">{toast.kind === 'error' ? <AlertCircle size={16}/> : <CircleCheck size={16}/>}<span>{toast.message}</span></div>}
  </div>;

}

function SourceScopeSheet({ open, documents = [], selectedDocs = [], setSelectedDocs, onClose, onOpenEvidence, libraryName = '' }) {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(selectedDocs);
  const sheetRef = useRef(null);
  const searchRef = useRef(null);
  useModalFocus(open, sheetRef, onClose, searchRef);
  useEffect(() => { if (open) { setDraft(selectedDocs); setSearch(''); } }, [open, selectedDocs]);
  if (!open) return null;
  const visible = documents.filter(doc => !search || `${doc.title} ${doc.content || ''}`.toLowerCase().includes(search.toLowerCase()));
  function toggle(id) {
    setDraft(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }
  return <div className="source-scope-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}>
    <section ref={sheetRef} className="source-scope-sheet" role="dialog" aria-modal="true" aria-label="筛选资料范围">
      <header><div><span>资料范围</span><h2>选择这次要问的资料</h2></div><button type="button" onClick={onClose} aria-label="关闭资料范围"><X size={16}/></button></header>
      <div className="source-scope-summary"><Tags size={14}/><span>{draft.length ? `已选 ${draft.length} 篇` : `当前是「${libraryName || '当前知识库'}」`}</span></div>
      <div className="source-scope-search"><Search size={15}/><input ref={searchRef} value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索资料标题" aria-label="搜索资料"/><span>{visible.length}</span></div>
      <div className="source-scope-actions"><button type="button" onClick={() => setDraft(visible.map(doc => doc.id))}>加入筛选项</button><button type="button" onClick={() => setDraft([])}>不限篇目</button></div>
      <div className="source-scope-list">{visible.length ? visible.map(doc => <label key={doc.id} className={draft.includes(doc.id) ? 'is-selected' : ''}><input type="checkbox" checked={draft.includes(doc.id)} onChange={() => toggle(doc.id)}/><span><b>{doc.title}</b><small>{doc.contentType === 'note' || doc.type === 'note' ? '笔记' : humanizeSourceLabel(doc.source || doc.sourceType || '知识库')}</small></span><Check size={15}/></label>) : <div className="source-scope-empty">没有匹配的资料</div>}</div>
      <footer><button type="button" onClick={onClose}>取消</button><button type="button" className="is-primary" onClick={() => { setSelectedDocs(draft); onClose?.(); }}>应用范围</button><button type="button" onClick={() => onOpenEvidence?.(draft)}>分析证据</button></footer>
    </section>
  </div>;
}

function KnowledgeEmptyGuide({ title, hint, steps = [], onCollect, onConnectFeishu, onConfigureModel, onSwitchLibrary, switchLabel }) {
  return (
    <div className="library-browse-empty" data-onboarding="knowledge">
      <b>{title}</b>
      {hint ? <p>{hint}</p> : null}
      {steps.length ? <ol className="library-browse-steps">{steps.map(step => <li key={step}>{step}</li>)}</ol> : null}
      {(onCollect || onConnectFeishu || onConfigureModel || onSwitchLibrary) ? <div className="library-browse-actions">
        {onCollect ? <button type="button" onClick={onCollect}>导入文件</button> : null}
        {onConnectFeishu ? <button type="button" onClick={onConnectFeishu}>连接飞书</button> : null}
        {onConfigureModel ? <button type="button" onClick={onConfigureModel}>配置模型</button> : null}
        {onSwitchLibrary ? <button type="button" className="empty-side-switch" onClick={onSwitchLibrary}>{switchLabel}</button> : null}
      </div> : null}
    </div>
  );
}

function KnowledgeSidebar({ state, selectedKb, setSelectedKb, docs, selectedDocs, setSelectedDocs, setShowSync, onOpenDocument, onPrefetchDocument, onOpenGraph, libraries, libraryFilter, setLibraryFilter, libraryBusy, onRefreshLibraries, onFollowLibrary, onSelectLibrary, onCollect }) {
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const allDocuments = Array.isArray(state?.documents) ? state.documents : (docs || []);
  const allTags = [...new Set(allDocuments.flatMap(doc => (doc.tags || []).map(tag => typeof tag === 'string' ? tag : tag?.name).filter(Boolean)))];
  const allLibraries = Array.isArray(libraries) && libraries.length ? libraries : (state.knowledgeBases || []);
  const visibleLibraries = allLibraries.filter(item => {
    if (isNotesLibrary(item)) return false;
    if (libraryFilter === 'followed') return item.followed;
    if (libraryFilter === 'shared') return item.shared;
    return true;
  });
  const visibleDocs = docs.filter(doc => {
    const haystack = `${doc.title} ${doc.excerpt || ''} ${(doc.tags || []).map(tag => typeof tag === 'string' ? tag : tag?.name).filter(Boolean).join(' ')}`.toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (!activeTag) return true;
    const tags = (doc.tags || []).map(tag => typeof tag === 'string' ? tag : tag?.name).filter(Boolean);
    return tags.includes(activeTag);
  });
  const visibilityLabel = item => item.visibility === 'tenant' ? '组织内共享' : item.shared ? '共享空间' : '本地';
  const showLibraryFilters = libraryFilter !== 'all' || allLibraries.some(item => item.followed || item.shared);
  return <aside className="side-panel" data-all-docs={allDocuments.length} data-visible-docs={visibleDocs.length} data-tags={allTags.length}>
    <div className="side-head"><div><span>工作空间</span><h2>知识库</h2></div><div className="side-head-actions"><button onClick={() => onRefreshLibraries?.()} disabled={libraryBusy} title="刷新共享库"><RefreshCw className={libraryBusy ? 'spin' : ''} size={17}/></button></div></div>
    <div className="search-box"><Search size={15}/><input name="knowledge-document-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索文档"/></div>
    {allTags.length ? <div className="tag-filter" role="list" aria-label="按标签筛选">{allTags.slice(0, 16).map(tag => <button type="button" key={tag} role="listitem" className={activeTag === tag ? 'active' : ''} aria-pressed={activeTag === tag} onClick={() => setActiveTag(current => current === tag ? '' : tag)}>{tag}</button>)}</div> : null}
    <section className="side-section library-section">
      <div className="section-label"><span>知识空间</span><div className="section-actions"><button onClick={() => onRefreshLibraries?.()} disabled={libraryBusy} title="刷新共享库"><RefreshCw className={libraryBusy ? 'spin' : ''} size={13}/></button><button onClick={() => setShowSync(true)} title="同步内容"><Plus size={14}/></button></div></div>
      {showLibraryFilters ? <div className="library-filter" role="tablist" aria-label="知识库筛选">{[['all','全部'],['followed','已关注'],['shared','共享']].map(([id,label]) => <button key={id} role="tab" aria-selected={libraryFilter === id} className={libraryFilter === id ? 'active' : ''} onClick={() => setLibraryFilter(id)}>{label}</button>)}</div> : null}
      <div className="library-list">{visibleLibraries.length ? visibleLibraries.map(item => <div key={item.id} className={`kb-row ${selectedKb === item.id ? 'active' : ''}`}>
        <button type="button" className="kb-select" onClick={() => onSelectLibrary?.(item)}><span className="kb-icon">{item.shared ? <Globe2 size={16}/> : <BookOpen size={16}/>}</span><span><b>{item.name}</b><small>{item.documentCount ?? 0} 篇文档 · {visibilityLabel(item)}</small></span></button>
        <button type="button" className={`kb-follow ${item.followed ? 'active' : ''}`} aria-label={item.followed ? `取消关注：${item.name}` : `关注：${item.name}`} aria-pressed={item.followed} disabled={libraryBusy} onClick={() => onFollowLibrary?.(item, !item.followed)}><Bookmark size={15} fill={item.followed ? 'currentColor' : 'none'}/></button>
      </div>) : <KnowledgeEmptyGuide title={libraryFilter === 'followed' ? '还没有关注的知识库' : libraryFilter === 'shared' ? '还没有发现共享知识库' : '还没有知识库'} hint={libraryFilter === 'all' ? '导入文件会自动建库；飞书同步也会出现在这里。' : '换到「全部」查看已有资料，或导入新内容。'} onCollect={libraryFilter === 'all' ? onCollect : undefined} onConnectFeishu={libraryFilter === 'all' ? () => setShowSync(true) : undefined} />}</div>
    </section>
    <section className="side-section document-section"><div className="section-label"><span>文档</span><em>{selectedDocs.length ? `已选 ${selectedDocs.length}` : visibleDocs.length}</em></div><div className="document-list">
      {visibleDocs.length ? visibleDocs.map(doc => <div key={doc.id} className={`doc-row ${selectedDocs.includes(doc.id) ? 'selected' : ''}`}><button type="button" className="doc-open" onPointerEnter={() => onPrefetchDocument?.(doc)} onFocus={() => onPrefetchDocument?.(doc)} onClick={() => onOpenDocument?.(doc)}><FileText size={16}/><span><b>{doc.title}</b><small>{doc.updatedAt ? formatDate(doc.updatedAt) : '已同步'}</small></span></button><button type="button" className="doc-scope-toggle" aria-label={selectedDocs.includes(doc.id) ? `移出问答范围：${doc.title}` : `加入问答范围：${doc.title}`} aria-pressed={selectedDocs.includes(doc.id)} onClick={() => setSelectedDocs(current => current.includes(doc.id) ? current.filter(id => id !== doc.id) : [...current, doc.id])}>{selectedDocs.includes(doc.id) ? <CircleCheck className="checked" size={17}/> : <Plus size={15}/>}</button></div>) : (() => {
        const populatedLibrary = allLibraries.find(item => item.id !== selectedKb && libraryDocumentCount(item, allDocuments) > 0);
        return <div className="empty-side"><KnowledgeEmptyGuide title={populatedLibrary ? '这个空间还没有文档' : '还没有文档'} hint={populatedLibrary ? `当前库是空的，可切换到「${populatedLibrary.name}」看已有资料` : '导入文件或连接飞书后，文档会出现在这里。'} onCollect={populatedLibrary ? undefined : onCollect} onConnectFeishu={populatedLibrary ? undefined : () => setShowSync(true)} onSwitchLibrary={populatedLibrary ? () => onSelectLibrary?.(populatedLibrary) : undefined} switchLabel={populatedLibrary ? `查看「${populatedLibrary.name}」` : undefined} /></div>;
      })()}
    </div></section>
  </aside>;
}

function mergeKnowledgeWork(current = {}, event = {}) {
  const work = event.work && typeof event.work === 'object' ? event.work : {};
  const refs = [
    ...(Array.isArray(work.documents) ? work.documents : []),
    ...(Array.isArray(event.evidence) ? event.evidence : []),
    ...(Array.isArray(event.observation?.sourceRefs) ? event.observation.sourceRefs : [])
  ];
  const documents = [...(current.documents || [])];
  const seen = new Set(documents.map(item => String(item.documentId || '')));
  for (const ref of refs) {
    const documentId = String(ref?.documentId || ref?.id || '').trim();
    if (!documentId || seen.has(documentId)) continue;
    seen.add(documentId);
    documents.push({ documentId, title: String(ref.title || '未命名文档').slice(0, 80) });
  }
  return {
    query: String(work.query || event.observation?.query || current.query || '').replace(/\s+/g, ' ').trim().slice(0, 72),
    quote: String(work.quote || current.quote || '').replace(/\s+/g, ' ').trim().slice(0, 72),
    documents: documents.slice(0, 5)
  };
}

function hasKnowledgeWork(work) {
  return Boolean(work?.query || work?.quote || work?.documents?.length);
}

function KnowledgeWorkStrip({ work, onOpenDocument }) {
  if (!hasKnowledgeWork(work)) return null;
  return (
    <div className="knowledge-work-strip" aria-label="查阅资料">
      {work.quote ? <div className="knowledge-work-card"><span>已选中</span><b>{work.quote}</b></div> : null}
      {work.query ? <div className="knowledge-work-card"><span>知识库搜索</span><b>{work.query}</b></div> : null}
      {(work.documents || []).map(doc => (
        <button type="button" key={doc.documentId} className="knowledge-work-file" onClick={() => onOpenDocument?.(doc)}>
          已浏览 {doc.title || '未命名文档'}
        </button>
      ))}
    </div>
  );
}

function citationEvidenceList(citations = []) {
  return (Array.isArray(citations) ? citations : []).map(citation => ({
    ...citation,
    title: citation?.title || citation?.document?.title || '',
    excerpt: citation?.excerpt || citation?.snippet || citation?.quote || '',
    document: citation?.document || citation
  }));
}

function citationMarkdownComponents(citations, onOpen) {
  const list = citationEvidenceList(citations);
  const wrap = Tag => ({ children, node, ...props }) => <Tag {...props}>{injectCitationNodes(children, list, onOpen)}</Tag>;
  return { p: wrap('p'), li: wrap('li'), td: wrap('td'), blockquote: wrap('blockquote') };
}

async function copyAnswerText(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement('textarea');
    input.value = value;
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    input.remove();
    return ok;
  }
}

function ChatWorkspace({ kb, selectedDocs, setSelectedDocs, messages, setMessages, query, setQuery, ask, streaming, stopGeneration, retryLast, onRegenerate, chatError, modelSettings, openModelDrawer, skills, runSkill, runChatSkill, skillRun, onRetrySkillRun, historyOpen, setHistoryOpen, conversations, onNewConversation, onRestoreConversation, onOpenDocument, onCreateArtifact, artifactBusy, endRef, attachments, attachmentBusy, attachmentCapabilities, onAddAttachments, onRemoveAttachment, onRetryAttachment, documents, workspaceContext, onOpenModule, includeKnowledgeBase, onIncludeKnowledgeBaseChange, browseMode = false, agentMode = 'auto', setAgentMode, onOpenEvidence, onConfirmAgent, onConfirmSuggestion, onOpenWrittenArtifact, smartHome, exportDialog, setExportDialog, onContinueSkillRun, onConnectFeishu, onSmartHomeAction, onFeishuExported, copilots = [], activeCopilotId = '', onSelectCopilot, onOpenCopilots, onCreateWriting, onOpenGraph, onPrefetchDocument, onCollect }) {
  const fileInputRef = useRef(null);
  const composerInputRef = useRef(null);
  const previewRef = useRef(null);
  const [composerCaret, setComposerCaret] = useState(0);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [activeComposerSkill, setActiveComposerSkill] = useState(null);
  const [composerMentions, setComposerMentions] = useState([]);
  const [preview, setPreview] = useState(null);
  const [openMessageMenu, setOpenMessageMenu] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const [chatMoreOpen, setChatMoreOpen] = useState(false);
  useModalFocus(Boolean(preview), previewRef, () => setPreview(null));
  const accepted = (attachmentCapabilities?.acceptedExtensions || []).map(extension => `.${String(extension).replace(/^\./, '')}`).join(',');
  const readyCount = attachments.filter(item => item.status === 'ready').length;
  const canSend = Boolean(query.trim() || readyCount || activeComposerSkill) && !attachmentBusy;
  const activeCopilot = copilots.find(item => item.id === activeCopilotId) || copilots[0] || null;
  const boundSkillIds = Array.isArray(activeCopilot?.skillIds) ? activeCopilot.skillIds.map(String) : [];
  const boundSkills = boundSkillIds.length ? skills.filter(skill => boundSkillIds.includes(String(skill.id))) : [];
  const slashSkills = boundSkills.length ? boundSkills : skills;
  const composerTrigger = detectComposerTrigger(query, composerCaret);
  const composerMenuOpen = Boolean(composerTrigger) && !menuDismissed && !streaming;
  const composerGroups = useMemo(() => {
    if (composerTrigger?.mode === 'slash') return [
      { id: 'skills', kind: 'skills', label: boundSkills.length ? '这个 Copilot 的 Skills' : '可用 Skills', items: slashSkills.map(skill => ({ id: `skill-${skill.id}`, type: 'skill', skill, label: skill.name, description: skill.description, badge: 'Skill', keywords: [skill.id, ...(skill.steps || [])], icon: 'skill' })) },
      { id: 'actions', kind: 'actions', label: '常用动作', items: [
        { id: 'action-add-file', type: 'action', action: 'add-file', label: '添加文件或截图', description: '上传后直接问答、总结或写入笔记', icon: 'attachment' },
        { id: 'action-analysis', type: 'action', action: 'analysis', label: '文档解读', description: '进入文档分析工作台', icon: 'document' },
        { id: 'action-evidence', type: 'action', action: 'evidence', label: '证据工作台', description: '比较来源、冲突、缺口和可确认决策', icon: 'context' },
        { id: 'action-writing', type: 'action', action: 'writing', label: '智能写作', description: '基于当前材料继续创作', icon: 'note' },
        { id: 'action-recording', type: 'action', action: 'recording', label: '开始录音纪要', description: '录音、转写并生成可编辑纪要', icon: 'chat' },
        { id: 'action-new-chat', type: 'action', action: 'new-chat', label: '新对话', description: '清空临时上下文并开始新任务', icon: 'sparkles' }
      ] }
    ];
    const currentItems = [];
    if (workspaceContext?.selection?.text) currentItems.push({ id: 'context-selection', type: 'selection', label: '当前选中的文字', description: String(workspaceContext.selection.text).slice(0, 90), context: workspaceContext.selection, badge: '选区', icon: 'context' });
    if (workspaceContext?.currentDocument) currentItems.push({ id: `context-doc-${workspaceContext.currentDocument.documentId || workspaceContext.currentDocument.id}`, type: 'document', label: workspaceContext.currentDocument.title || '当前文档', description: '当前正在阅读的文档', document: workspaceContext.currentDocument, badge: '当前', icon: 'context' });
    for (const resource of workspaceContext?.resources || []) currentItems.push({ id: `context-resource-${resource.documentId || resource.id}`, type: 'document', label: resource.title || '上下文资料', description: resource.summary || resource.source || '已添加到 AI 上下文', document: resource, badge: '上下文', icon: 'context' });
    const noteDocuments = (browseMode ? [] : (documents || [])).filter(document => document.contentType === 'note' || document.type === 'note');
    const libraryDocuments = (browseMode ? [] : (documents || [])).filter(document => document.contentType !== 'note' && document.type !== 'note');
    return [
      { id: 'current-context', kind: 'context', label: '当前上下文', items: currentItems },
      { id: 'attachments', kind: 'attachments', label: '已添加附件', items: attachments.map(item => ({ id: `attachment-${item.clientId}`, type: 'attachment', label: item.fileName, description: item.status === 'ready' ? '已解析，可直接提问' : item.status === 'error' ? item.error : '正在解析', attachment: item, badge: '附件', icon: 'attachment', disabled: item.status !== 'ready' })) },
      { id: 'notes', kind: 'notes', label: '笔记（@ 之后会读全文、附件和网页）', items: noteDocuments.slice(0, 40).map(document => ({ id: `document-${document.id}`, type: 'document', label: document.title, description: '对话里选中后，AI 会读这篇笔记和里面的文件', document, badge: selectedDocs.includes(document.id) ? '已选' : '笔记', icon: 'note', keywords: [document.title, ...(document.tags || [])] })) },
      { id: 'documents', kind: 'documents', label: '知识库资料', items: libraryDocuments.slice(0, 80).map(document => ({ id: `document-${document.id}`, type: 'document', label: document.title, description: document.excerpt || humanizeSourceLabel(document.source || document.contentType || '知识库文档'), document, badge: selectedDocs.includes(document.id) ? '已选' : '', icon: 'document', keywords: [document.title, ...(document.tags || [])] })) }
    ];
  }, [attachments, boundSkills.length, browseMode, composerTrigger?.mode, documents, selectedDocs, slashSkills, skills, workspaceContext]);
  function clearComposerSelections() { setActiveComposerSkill(null); setComposerMentions([]); setMenuDismissed(true); }
  function startFreshConversation() { clearComposerSelections(); onNewConversation(); }
  function restoreFromHistory(conversation) { clearComposerSelections(); onRestoreConversation(conversation); }
  function closeComposerMenu() { setMenuDismissed(true); }
  function updateComposerValue(nextValue) {
    setQuery(nextValue);
    setComposerCaret(nextValue.length);
    setMenuDismissed(false);
    requestAnimationFrame(() => { composerInputRef.current?.focus(); composerInputRef.current?.setSelectionRange(nextValue.length, nextValue.length); });
  }
  function addDocumentMention(document) {
    const documentId = document?.documentId || document?.id;
    if (!documentId) return;
    setSelectedDocs(current => current.includes(documentId) ? current : [...current, documentId]);
    setComposerMentions(current => current.some(item => item.documentId === documentId) ? current : [...current, { documentId, title: document.title || '未命名文档' }]);
  }
  function removeComposerMention(mention) {
    setComposerMentions(current => current.filter(item => item.documentId !== mention.documentId));
    setSelectedDocs(current => current.filter(id => id !== mention.documentId));
  }
  function applyComposerMenuItem(item) {
    const nextValue = replaceComposerTrigger(query, composerTrigger, '').replace(/\s{2,}/g, ' ');
    if (item.type === 'skill') { setActiveComposerSkill(item.skill); updateComposerValue(nextValue); return; }
    if (item.type === 'document') { addDocumentMention(item.document); updateComposerValue(nextValue); return; }
    if (item.type === 'selection') {
      const text = String(item.context?.text || '').trim();
      if (text) { const file = new File([`# 当前选区\n\n${text}`], `当前选区-${Date.now()}.md`, { type: 'text/markdown' }); onAddAttachments([file]); }
      updateComposerValue(nextValue); return;
    }
    if (item.type === 'attachment') { updateComposerValue(nextValue); return; }
    if (item.type === 'action') { updateComposerValue(nextValue); if (item.action === 'add-file') fileInputRef.current?.click(); else if (item.action === 'new-chat') startFreshConversation(); else onOpenModule?.(item.action); }
  }
  function submitComposer() {
    if (activeComposerSkill) { const skill = activeComposerSkill; setActiveComposerSkill(null); runChatSkill?.(skill.id, query); requestAnimationFrame(() => composerInputRef.current?.focus()); return; }
    const taskSkillId = composerTaskSkillId(query);
    if (taskSkillId && skills.some(skill => skill.id === taskSkillId)) { runChatSkill?.(taskSkillId, query); requestAnimationFrame(() => composerInputRef.current?.focus()); return; }
    ask();
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }
  const openCitation = citation => {
    const attachment = attachments.find(item => item.citationDocumentId === citation.documentId || item.attachment?.citationDocumentId === citation.documentId);
    if (attachment) setPreview({ attachment, citation });
    else if (citation.documentId || citation.id) onOpenDocument?.(citation);
    else if (citation.url) window.open(citation.url, '_blank', 'noopener,noreferrer');
  };
  const pickFiles = event => {
    const files = event.target.files;
    if (files?.length) onAddAttachments(files);
    event.target.value = '';
  };
  const handlePaste = event => {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    onAddAttachments(files);
  };
  const handleDrop = event => {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files?.length) onAddAttachments(files);
  };
  const region = preview?.citation?.region;
  const regionStyle = region ? {
    left: `${Math.max(0, Math.min(1, Number(region.x || 0))) * 100}%`,
    top: `${Math.max(0, Math.min(1, Number(region.y || 0))) * 100}%`,
    width: `${Math.max(0.01, Math.min(1, Number(region.width || 0.01))) * 100}%`,
    height: `${Math.max(0.01, Math.min(1, Number(region.height || 0.01))) * 100}%`
  } : null;

  const showBrowseGuide = browseMode && !messages.some(message => message.role === 'user');
  const starterButtons = (activeCopilot?.starterPrompts || []).filter(item => item?.prompt).slice(0, 6);
  const browseDocuments = (Array.isArray(documents) ? documents : []).filter(doc => !isLibraryNote(doc) && String(doc.title || '').trim()).slice(0, 60);
  const showScopeStrip = !showBrowseGuide && (selectedDocs.length > 0 || (readyCount > 0 && !includeKnowledgeBase));

  return <main className={`workspace chat-workspace${browseMode ? ' is-browse-mode' : ''}`} data-browse-mode={browseMode ? 'true' : undefined}>
    {showBrowseGuide ? null : <header className="workspace-head"><div className="workspace-title"><div><strong>{activeCopilot?.name || '对话'}</strong></div></div><div className="head-actions"><button type="button" onClick={() => onNewConversation?.()} aria-label="新会话"><Plus size={16}/>新会话</button><div className={`message-more ${chatMoreOpen ? 'is-open' : ''}`}><button type="button" className="message-more-toggle" aria-label="更多对话设置" aria-expanded={chatMoreOpen} onClick={() => setChatMoreOpen(current => !current)}><MoreHorizontal size={16}/></button>{chatMoreOpen ? <div className="message-more-menu" role="menu">{copilots.length ? <label className="copilot-chip"><span aria-hidden="true">{activeCopilot?.avatar || '✨'}</span><select value={activeCopilot?.id || ''} onChange={event => onSelectCopilot?.(event.target.value)} aria-label="当前 Copilot">{copilots.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" onClick={() => { onOpenCopilots?.(); setChatMoreOpen(false); }} aria-label="配置 Copilot"><Settings size={14}/></button></label> : null}<button type="button" role="menuitem" onClick={() => { openModelDrawer(); setChatMoreOpen(false); }}><Bot size={16}/><span className={`status-dot ${modelSettings.configured ? 'ok' : ''}`}/>{modelLabel(modelSettings)}</button><button type="button" role="menuitem" onClick={() => { setHistoryOpen(!historyOpen); setChatMoreOpen(false); }}>历史</button></div> : null}</div></div></header>}
    <div className="context-strip" hidden={!showScopeStrip}><Tags size={15}/><span>这次问的范围</span><b>{selectedDocs.length ? `已选 ${selectedDocs.length} 篇资料` : readyCount > 0 && !includeKnowledgeBase ? '仅当前附件' : `「${kb?.name || '当前知识库'}」`}</b>{readyCount > 0 && <em>+ {readyCount} 个临时附件</em>}{readyCount > 0 && !selectedDocs.length && <button type="button" className="attachment-scope-toggle" aria-pressed={includeKnowledgeBase} onClick={() => onIncludeKnowledgeBaseChange(!includeKnowledgeBase)}>{includeKnowledgeBase ? '附件 + 全库' : '仅附件'}</button>}{selectedDocs.length > 0 && <button onClick={() => setSelectedDocs([])}>恢复全部</button>}<button type="button" className="context-scope-manager" aria-label="管理资料范围" onClick={() => setScopeOpen(true)}><LibraryBig size={13}/><span>管理范围</span></button></div>
    <div className="workspace-body"><div className="messages">
      {showBrowseGuide ? (
        <section className="library-browse-stage" data-library-browse-guide="true">
          <div>
            <h2>{kb?.name || '当前知识库'}</h2>
          </div>
          {browseDocuments.length ? <><div className="library-doc-grid">{browseDocuments.map(doc => {
            const kind = libraryFileKind(doc);
            const indexed = Boolean(doc.indexed || doc.contentHash || doc.excerpt);
            const updated = doc.updatedAt ? formatDate(doc.updatedAt) : '';
            return <button type="button" key={doc.id} className={`library-doc-card is-${kind}${indexed ? ' is-indexed' : ''}`} onPointerEnter={() => onPrefetchDocument?.(doc)} onFocus={() => onPrefetchDocument?.(doc)} onClick={() => onOpenDocument?.(doc)}>
              <i className={`library-index-dot${indexed ? ' is-ready' : ''}`} aria-label={indexed ? '已索引' : '未索引'} />
              <span className={`library-file-badge is-${kind}`}>{libraryFileLabel(kind)}</span>
              <b>{doc.title || '未命名文档'}</b>
              <small>{[libraryFileLabel(kind), updated].filter(Boolean).join(' · ') || '打开这篇继续读'}</small>
            </button>;
          })}</div>{documents.length > browseDocuments.length ? <p className="library-browse-more">左侧还能看到另外 {documents.length - browseDocuments.length} 篇</p> : null}</> : <KnowledgeEmptyGuide title="这个库还是空的" hint="导入文件或连接飞书后，就能在这里打开、搜索和提问。" steps={['导入 PDF、Word 或粘贴文本', '或按向导开通飞书只读权限', modelSettings?.configured ? '回首页提问，或打开一篇继续读' : '问答前在设置里填模型 Key']} onCollect={onCollect} onConnectFeishu={onConnectFeishu} onConfigureModel={modelSettings?.configured ? undefined : openModelDrawer} />}
        </section>
      ) : !messages.some(message => message.role === 'user') ? (
          <section className="task-starters"><div><h2>直接问</h2></div>{starterButtons.length ? <div className="chat-starters">{starterButtons.map(item => <button type="button" key={item.prompt} onClick={() => ask(item.prompt)}>{item.label || item.prompt}</button>)}</div> : null}</section>
      ) : null}
      {messages.map((message, index) => <article key={message.id || index} className={`message ${message.role} ${message.relations ? 'deep-answer-message' : ''}`}>
        {message.role === 'assistant' && <div className="message-avatar"><Sparkles size={15}/></div>}
        <div className={`bubble ${message.error ? 'has-error' : ''} ${message.relations ? 'has-deep-answer' : ''}`}>
          {message.attachments?.length > 0 && message.role === 'user' && <div className="message-attachments">{message.attachments.map(item => <button key={item.clientId || item.temporaryId} type="button" onClick={() => item.previewUrl && setPreview({ attachment: item })}><Paperclip size={12}/>{item.fileName}</button>)}</div>}
          {message.skill && <div className="message-skill-pill"><Workflow size={13}/><b>{message.skill.name}</b><span>Skill</span></div>}{shouldShowReasoningChain(message) ? <ReasoningChain steps={message.reasoningSteps} /> : null}{message.status && <div className="thinking"><LoaderCircle size={14}/>{message.status}</div>}{message.role === 'assistant' ? <KnowledgeWorkStrip work={message.knowledgeWork} onOpenDocument={onOpenDocument} /> : null}<div className={`message-text ${message.role === 'assistant' ? 'markdown-answer' : ''}${message.role === 'assistant' && message.text && !message.done && !message.error ? ' is-streaming' : ''}`}>{message.role === 'assistant' && message.text ? (message.done || message.error ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={citationMarkdownComponents(message.citations, cite => openCitation(cite.document || cite))}>{sanitizeAssistantText(message.text)}</ReactMarkdown> : sanitizeAssistantText(message.text)) : message.text || (message.status || message.error ? '' : '…')}</div>{(message.agent?.confirmation || message.agent?.writtenArtifact || (!hasKnowledgeWork(message.knowledgeWork) && ((message.agent?.tools || []).length > 0 || (message.agent?.observations || []).length > 0 || (message.agent?.plan || []).length > 0))) && <AgentExecutionPanel agent={message.agent} busy={streaming} done={Boolean(message.done || message.text)} onConfirm={approved => onConfirmAgent?.(message, approved)} onOpenDocument={onOpenDocument} onOpenWrittenArtifact={onOpenWrittenArtifact} />}
          {message.artifact?.files?.length > 0 && <div className="message-artifact-files">{message.artifact.files.some(file => file.kind === 'audio') && <audio controls preload="metadata" src={message.artifact.files.find(file => file.kind === 'audio')?.downloadUrl}/>}<div>{message.artifact.files.map(file => <a key={file.downloadUrl} href={file.downloadUrl} download={file.fileName}><Download size={14}/><span>{artifactFileLabel(file)}</span><small>{file.fileName}</small></a>)}</div></div>}
          {message.stopped && <div className="message-state">已由你停止生成</div>}
          {message.error && <div className="message-error"><AlertCircle size={14}/><span>{message.error}</span><button onClick={() => retryLast(message)}><RotateCcw size={13}/>重试</button></div>}
          {message.artifact?.kind === 'problem' && message.artifact?.id ? <button type="button" className="answer-saved-note" onClick={() => onOpenWrittenArtifact?.(message.artifact)}><ListChecks size={13}/><span><small>{message.artifact.appended ? '已补进' : '已记下'}</small><b>{message.artifact.title || '问题记录'}</b></span></button> : null}
          {message.done && message.role === 'assistant' && message.text ? <div className="answer-version-actions">
            <button type="button" disabled={streaming || Boolean(artifactBusy)} aria-label={message.artifact?.kind === 'problem' ? '再把这次容易忘的点补进同一篇' : '把这次容易忘的点记下来'} onClick={() => onCreateArtifact?.('problem', message)}><ListChecks size={13}/>{message.artifact?.kind === 'problem' ? '再记一点' : '记这个问题'}</button>
            <button type="button" disabled={streaming} aria-label="复制回答" onClick={() => { void copyAnswerText(message.text).then(ok => { if (ok) { setCopiedMessageId(message.id || String(index)); window.setTimeout(() => setCopiedMessageId(current => current === (message.id || String(index)) ? '' : current), 1600); } }); }}>{copiedMessageId === (message.id || String(index)) ? '已复制' : '复制'}</button>
            <div className={`message-more ${openMessageMenu === (message.id || String(index)) ? 'is-open' : ''}`}>
              <button type="button" className="message-more-toggle" aria-label="更多操作" aria-expanded={openMessageMenu === (message.id || String(index))} onClick={() => setOpenMessageMenu(current => current === (message.id || String(index)) ? '' : (message.id || String(index)))}><MoreHorizontal size={14}/></button>
              {openMessageMenu === (message.id || String(index)) ? <div className="message-more-menu" role="menu">
                {!message.relations ? <><button type="button" role="menuitem" disabled={streaming} onClick={() => { ask('精简一下'); setOpenMessageMenu(''); }}>精简</button><button type="button" role="menuitem" disabled={streaming} onClick={() => { ask('展开说说'); setOpenMessageMenu(''); }}>展开</button>{message.knowledgeWork?.documents?.length === 1 ? <button type="button" role="menuitem" disabled={streaming} onClick={() => { ask(`《${message.knowledgeWork.documents[0].title}》里还有哪些值得注意的？`); setOpenMessageMenu(''); }}>这篇还要注意什么</button> : null}{message.knowledgeWork?.documents?.length > 1 ? <button type="button" role="menuitem" disabled={streaming} onClick={() => { ask('这几篇有没有互相打架的地方？'); setOpenMessageMenu(''); }}>有没有分歧</button> : null}</> : null}
                <button type="button" role="menuitem" disabled={streaming} onClick={() => { onRegenerate?.(message); setOpenMessageMenu(''); }}>重新生成</button>
                <button type="button" role="menuitem" disabled={streaming || Boolean(artifactBusy)} aria-label="将回答转为笔记" onClick={() => { onCreateArtifact?.('note', message); setOpenMessageMenu(''); }}>转笔记</button>
                <button type="button" role="menuitem" disabled={streaming || Boolean(artifactBusy)} aria-label="将回答转为写作草稿" onClick={() => { onCreateArtifact?.('writing', message); setOpenMessageMenu(''); }}>接着写</button>
                <button type="button" role="menuitem" disabled={streaming} onClick={() => { setExportDialog({ content: message.text, messageId: message.id }); setOpenMessageMenu(''); }}>输出到飞书</button>
              </div> : null}
            </div>
          </div> : null}
          {message.versions?.length > 0 && <details className="answer-versions"><summary>查看 {message.versions.length} 个历史版本</summary>{message.versions.map((version, versionIndex) => <article key={versionIndex}><b>版本 {versionIndex + 1}</b><p>{version.text}</p></article>)}</details>}
          {message.relations ? <Suspense fallback={<WorkspaceRouteFallback label="深度答案"/>}><DeepAnswerPanel message={{ ...message.relations, plan: message.relations?.plan?.steps || message.relations?.plan, question: message.question, citations: uniqueCitationSources(message.citations), citationIntegrity: message.citationIntegrity || message.relations?.citationIntegrity, showProcessDetails: hasSubstantiveEvidenceAnalysis(message.relations) }} busy={artifactBusy.startsWith(`${message.id || message.conversationId || 'answer'}:`) ? '创建工作产物' : false} onFollowUp={suggestion => ask(suggestion)} onOpenDocument={(document, panelMessage) => document?.snippet || document?.excerpt || document?.anchor ? openCitation(document) : onOpenDocument?.(document, panelMessage || message)} onCreateArtifact={kind => onCreateArtifact(kind, message)} onConfirmSuggestion={onConfirmSuggestion}/></Suspense> : message.citations?.length > 0 && !hasKnowledgeWork(message.knowledgeWork) ? <details className="answer-sources"><summary>依据 {uniqueCitationSources(message.citations).length} 篇资料</summary><div className="citations"><span>出处</span>{uniqueCitationSources(message.citations).map((citation, idx) => <button key={citation.id || citation.documentId || idx} onClick={() => openCitation(citation)} title={citation.snippet || citation.excerpt || ''}><Link2 size={13}/><b>[{idx + 1}]</b><span>{citation.title}</span></button>)}</div></details> : null}
        </div>
      </article>)}
      {skillRun?.recoverable && <div className="inline-error"><AlertCircle size={15}/>{skillRun.error || '上次 Skill 未完成'}<button type="button" onClick={() => onRetrySkillRun?.(skillRun)}>重新运行</button></div>}
      {chatError && !messages.at(-1)?.error && <div className="inline-error"><AlertCircle size={15}/>{chatError}<button onClick={retryLast}>重试</button></div>}<div ref={endRef}/>
    </div>{historyOpen && <aside className="history-panel"><div className="history-head"><b>会话历史</b><button onClick={() => setHistoryOpen(false)}><X size={15}/></button></div>{conversations.length ? [...conversations].reverse().slice(0, 30).map(item => <button key={item.id} onClick={() => restoreFromHistory(item)}><MessageSquareText size={15}/><span><b>{item.question}</b><small>{formatDate(item.createdAt)}</small></span></button>) : <div className="history-empty"><History size={25}/><span>暂无历史会话</span></div>}</aside>}</div>
    <div className="composer-area" hidden={showBrowseGuide}>
      <div className={`composer ${attachmentBusy ? 'is-processing' : ''}`} onDragOver={event => event.preventDefault()} onDrop={handleDrop}>
        {composerMenuOpen && <Suspense fallback={<WorkspaceRouteFallback label="Skill 菜单"/>}><ComposerCommandMenu open={composerMenuOpen} mode={composerTrigger?.mode || 'slash'} query={composerTrigger?.query || ''} groups={composerGroups} inputRef={composerInputRef} onSelect={applyComposerMenuItem} onClose={closeComposerMenu} placement="above" maxHeight={390}/></Suspense>}
        {(activeComposerSkill || composerMentions.length > 0) && <div className="composer-context-chips">{activeComposerSkill && <span className="composer-context-chip skill"><Workflow size={13}/><b>{activeComposerSkill.name}</b><button type="button" aria-label="移除 Skill" onClick={() => setActiveComposerSkill(null)}><X size={12}/></button></span>}{composerMentions.map(mention => <span className="composer-context-chip" key={mention.documentId}><AtSign size={13}/><b>{mention.title}</b><button type="button" aria-label={`移除 ${mention.title}`} onClick={() => removeComposerMention(mention)}><X size={12}/></button></span>)}</div>}
        {attachments.length > 0 && <div className="attachment-tray" aria-label="已添加附件">{attachments.map(item => <div key={item.clientId} className={`attachment-chip ${item.status}`}><button type="button" className="attachment-open" onClick={() => item.previewUrl && setPreview({ attachment: item })}><span className="attachment-icon">{item.status === 'uploading' ? <LoaderCircle className="spin" size={15}/> : item.status === 'error' ? <AlertCircle size={15}/> : <Paperclip size={15}/>}</span><span><b>{item.fileName}</b><small>{item.status === 'uploading' ? '正在上传并解析…' : item.status === 'error' ? item.error : `${item.attachment?.searchable === false ? '已上传' : '可问答'} · ${attachmentSizeLabel(item.byteSize)}`}</small></span></button>{item.status === 'error' && <button type="button" className="attachment-retry" onClick={() => onRetryAttachment(item)}>重试</button>}<button type="button" className="attachment-remove" aria-label={`移除 ${item.fileName}`} onClick={() => onRemoveAttachment(item)}><X size={13}/></button></div>)}</div>}
        <textarea ref={composerInputRef} value={query} onChange={event => { setQuery(event.target.value); setComposerCaret(event.target.selectionStart || event.target.value.length); setMenuDismissed(false); }} onSelect={event => setComposerCaret(event.currentTarget.selectionStart || 0)} onKeyUp={event => setComposerCaret(event.currentTarget.selectionStart || 0)} onPaste={handlePaste} onKeyDown={event => { if (event.defaultPrevented) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitComposer(); } }} placeholder={activeComposerSkill ? `告诉 ${activeComposerSkill.name} 你想完成什么；留空则基于当前材料执行` : attachments.length ? '针对附件提问，或输入 @ 补文档' : browseMode ? '基于这个知识库提问…' : '直接说要做什么；需要指定文档时输入 @'}/>
        <div className="composer-bottom"><div><input ref={fileInputRef} className="chat-file-input" type="file" multiple accept={accepted || undefined} onChange={pickFiles}/><button type="button" title="添加文件或截图" disabled={attachmentBusy || streaming} onClick={() => fileInputRef.current?.click()}><Plus size={17}/></button><button type="button" className="context-scope-manager" aria-label="管理资料范围" onClick={() => setScopeOpen(true)}><LibraryBig size={13}/><span>{selectedDocs.length ? `${selectedDocs.length} 篇` : (kb?.name || '当前库')}</span></button></div>{streaming ? <button className="stop" onClick={stopGeneration}><Square size={15}/>停止</button> : <button className="send" disabled={!canSend} onClick={submitComposer}><Send size={17}/></button>}</div>
      </div>
    </div>
    {preview && <div className="attachment-preview-backdrop" onMouseDown={() => setPreview(null)}><section ref={previewRef} className="attachment-preview" role="dialog" aria-modal="true" aria-labelledby="attachment-preview-title" onMouseDown={event => event.stopPropagation()}><header><div><Paperclip size={17}/><span><b id="attachment-preview-title">{preview.attachment.fileName}</b><small>{preview.citation?.anchor || preview.attachment.attachment?.contentType || preview.attachment.mimeType}</small></span></div><button type="button" onClick={() => setPreview(null)}><X size={17}/></button></header><div className="attachment-preview-body">{preview.attachment.mimeType?.startsWith('image/') ? <div className="attachment-image-stage"><img src={preview.attachment.previewUrl} alt={preview.attachment.fileName}/>{regionStyle && <span className="citation-region" style={regionStyle}/>}</div> : preview.attachment.mimeType === 'application/pdf' ? <iframe src={preview.attachment.previewUrl} title={preview.attachment.fileName}/> : <div className="attachment-preview-info"><FileText size={34}/><b>{preview.attachment.fileName}</b><span>文件内容已经完成解析，可继续在当前对话中追问、总结或转为笔记。</span></div>}</div>{preview.citation && <footer><b>引用片段</b><p>{preview.citation.snippet || preview.citation.excerpt || '已定位到附件中的相关内容。'}</p></footer>}</section></div>}
    <SourceScopeSheet open={scopeOpen} documents={documents} selectedDocs={selectedDocs} setSelectedDocs={setSelectedDocs} onClose={() => setScopeOpen(false)} onOpenEvidence={onOpenEvidence} libraryName={kb?.name || ''} />
    {exportDialog && <FeishuExportDialog content={exportDialog.content} defaultTitle={exportDialog.title || messages.find(message => message.role === 'user')?.text || ''} onClose={() => setExportDialog(null)} onConnect={onConnectFeishu} onOpenDocument={onOpenDocument} onExport={document => onFeishuExported?.(document)} />}
  </main>;
}

function ScopeEvidenceSummary({ scopeContext }) {
  const documents = Array.isArray(scopeContext?.selectedDocuments) ? scopeContext.selectedDocuments : [];
  if (!documents.length) return null;
  const totalChars = Number(scopeContext.totalChars) || documents.reduce((sum, document) => sum + (Number(document.totalChars) || 0), 0);
  const includedChars = Number(scopeContext.includedChars) || documents.reduce((sum, document) => sum + (Number(document.includedChars) || 0), 0);
  const truncatedCount = Number(scopeContext.truncatedDocumentCount) || documents.filter(document => document.truncated).length;
  return <div className="scope-evidence-summary" aria-label="已加载的选中资料">
    <FileText size={14}/>
    <div><b>已在本地全文索引 {documents.length} 篇资料，共 {formatEvidenceChars(totalChars)} 字</b><small>本次按问题加载 {formatEvidenceChars(includedChars)} 字相关片段{truncatedCount ? `；${truncatedCount} 篇资料按上下文预算分段提供` : '，内容已完整带入'}</small></div>
  </div>;
}

function humanToolLabel(name) {
  const key = String(name || '').trim();
  if (key === 'knowledge.search') return '查阅知识库';
  if (key === 'notes.search') return '搜索笔记';
  if (key === 'notes.read') return '阅读笔记';
  if (key === 'note.update') return '更新笔记';
  if (key === 'knowledge.read' || key === 'knowledge.open') return '阅读资料';
  if (key === 'knowledge.compare') return '对比资料';
  if (key === 'knowledge.timeline') return '梳理时间线';
  if (key === 'knowledge.extract') return '提取要点';
  if (key === 'writing.draft') return '起草大纲';
  if (key === 'analyze.keywords') return '提取关键词';
  if (key === 'task.breakdown') return '拆解任务';
  if (key === 'graph.append-link') return '补充知识链接';
  if (key === 'notes.write' || key === 'note.write' || key === 'note.create' || key === 'decision.note.create') return '写入笔记';
  if (key === 'draft.write' || key === 'draft.create') return '写入草稿';
  if (key === 'task.write' || key === 'task.create') return '写入任务';
  if (key === 'feishu.document.create' || key === 'feishu.export') return '创建飞书文档';
  return key.replace(/^[a-z]+\./, '') || '处理资料';
}

function AgentExecutionPanel({ agent, busy, done = false, onConfirm, onOpenDocument, onOpenWrittenArtifact }) {
  const plan = Array.isArray(agent?.plan) ? agent.plan : [];
  const tools = Array.isArray(agent?.tools) ? agent.tools : [];
  const observations = Array.isArray(agent?.observations) ? agent.observations : [];
  const confirmation = agent?.confirmation;
  const proposal = confirmation?.proposal || {};
  const diff = proposal.diff || agent?.diff || {};
  const before = diff.before || diff.current || '';
  const after = diff.after || diff.next || proposal.payload?.content || '';
  const sourceRefs = Array.isArray(proposal.sourceRefs) ? proposal.sourceRefs : (Array.isArray(agent?.sourceRefs) ? agent.sourceRefs : []);
  const expiresAt = confirmation?.expiresAt ? new Date(confirmation.expiresAt) : null;
  const expired = Boolean(expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= Date.now());
  const expiryLabel = expired ? '已过期，请重新运行' : (expiresAt ? `有效至 ${expiresAt.toLocaleString('zh-CN', { hour12: false })}` : '查看将写入的内容与依据');
  const scopedDocuments = Array.isArray(agent?.scope?.documents) ? agent.scope.documents : [];
  const written = agent?.writtenArtifact;
  const writtenLabel = written?.kind === 'draft' ? '打开草稿' : written?.kind === 'task' ? '打开任务' : written?.kind === 'feishu' ? (written.contentItemId ? '打开收回的文档' : '打开飞书文档') : '打开笔记';
  const pendingWrite = confirmation?.status === 'pending';
  const running = tools.some(tool => tool.status === 'running' || tool.status === 'confirmation_required');
  const collapse = done && !pendingWrite && !running && !busy;
  const summary = observations.length
    ? `已查阅 ${observations.length} 处资料`
    : tools.length
      ? `已完成 ${tools.filter(tool => tool.status === 'completed').length} 步查阅`
      : '查阅过程';
  const body = <>
    {scopedDocuments.length > 0 && <div className="agent-execution-scope"><Tags size={12}/><span><b>已带入 {scopedDocuments.length} 篇资料</b><small title={scopedDocuments.map(document => document.title).join('、')}>{scopedDocuments.map(document => document.title).join('、')}</small><small className="agent-execution-scope-meta">本地全文索引 {formatEvidenceChars(scopedDocuments.reduce((sum, document) => sum + (Number(document.contentChars) || 0), 0))} 字</small></span></div>}
    {plan.length > 0 && <ol>{plan.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}</ol>}
    {tools.length > 0 && <div className="agent-execution-tools">{tools.map((tool, index) => <span key={`${tool.tool}-${index}`} className={`is-${tool.status || 'queued'}`}>{tool.status === 'completed' ? <Check size={12}/> : tool.status === 'failed' ? <AlertCircle size={12}/> : <LoaderCircle size={12}/>} {humanToolLabel(tool.tool)}</span>)}</div>}
    {observations.length > 0 && <small className="agent-execution-evidence">已记下 {observations.length} 处可回查的出处</small>}
    {pendingWrite && <div className="agent-confirmation" aria-live="polite"><div className="agent-confirmation-heading"><b>写入提案待确认</b><small>{expiryLabel}</small></div><details className="agent-proposal-review" open><summary>查看将写入的内容与依据</summary><code>{diff.path || '受控工作区'}</code>{before && <div><small>当前内容</small><pre>{before}</pre></div>}<div><small>确认后写入</small><pre>{after || '服务端未提供可预览内容；确认时仍会重新校验提案。'}</pre></div></details>{sourceRefs.length > 0 ? <div className="agent-proposal-sources"><small>服务器已观测的依据</small>{sourceRefs.map((source, index) => <button type="button" key={source.evidenceId || source.documentId || index} onClick={() => onOpenDocument?.(source)}><Link2 size={12}/><span>[{index + 1}] {source.title || source.documentId || '来源证据'}{source.anchor ? ` · ${source.anchor}` : ''}</span></button>)}</div> : <small className="agent-proposal-no-sources">当前提案没有可回查来源，服务端可能拒绝确认。</small>}<p className="agent-proposal-note">确认不会跳过服务端的证据、范围、目标版本和提案哈希重验</p><div><button type="button" disabled={busy || expired} onClick={() => onConfirm?.(true)}><Check size={13}/>确认写入</button><button type="button" disabled={busy || expired} onClick={() => onConfirm?.(false)}><X size={13}/>拒绝</button></div></div>}
    {written?.id && !pendingWrite && <div className="agent-written-artifact"><NotebookPen size={13}/><span><b>{written.title || '已写入知识库'}</b><small>{written.kind === 'draft' ? '写作草稿已保留，可继续改' : written.kind === 'feishu' ? (written.contentItemId ? '已创建飞书文档并收回知识库' : '已创建飞书文档') : written.linked ? '已追加知识库链接' : '已写入知识库，下一句可继续用'}</small></span><button type="button" onClick={() => onOpenWrittenArtifact?.(written)}>{writtenLabel}</button></div>}
  </>;
  if (collapse) {
    const process = (plan.length || tools.length || observations.length || scopedDocuments.length)
      ? <details className="agent-execution-panel is-collapsed">
        <summary><span><Bot size={14}/>{summary}</span></summary>
        {scopedDocuments.length > 0 && <div className="agent-execution-scope"><Tags size={12}/><span><b>已带入 {scopedDocuments.length} 篇资料</b><small title={scopedDocuments.map(document => document.title).join('、')}>{scopedDocuments.map(document => document.title).join('、')}</small></span></div>}
        {plan.length > 0 && <ol>{plan.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}</ol>}
        {tools.length > 0 && <div className="agent-execution-tools">{tools.map((tool, index) => <span key={`${tool.tool}-${index}`} className={`is-${tool.status || 'queued'}`}>{tool.status === 'completed' ? <Check size={12}/> : tool.status === 'failed' ? <AlertCircle size={12}/> : <LoaderCircle size={12}/>} {humanToolLabel(tool.tool)}</span>)}</div>}
        {observations.length > 0 && <small className="agent-execution-evidence">已记下 {observations.length} 处可回查的出处</small>}
      </details>
      : null;
    if (written?.id) {
      return <>
        {process}
        <div className="agent-written-artifact"><NotebookPen size={13}/><span><b>{written.title || '已写入知识库'}</b><small>{written.kind === 'draft' ? '写作草稿已保留，可继续改' : written.kind === 'feishu' ? (written.contentItemId ? '已创建飞书文档并收回知识库' : '已创建飞书文档') : written.linked ? '已追加知识库链接' : '已写入知识库，下一句可继续用'}</small></span><button type="button" onClick={() => onOpenWrittenArtifact?.(written)}>{writtenLabel}</button></div>
      </>;
    }
    return process;
  }
  return <section className="agent-execution-panel" aria-label="查阅过程">
    <header><span><Bot size={14}/>{running ? '正在查阅资料' : '查阅过程'}</span></header>
    {body}
  </section>;
}

function SkillSidebar({ skills, selectedSkill, setSelectedSkill, runs, onSelectRun }) {
  return <aside className="side-panel skill-side"><div className="side-head"><div><span>自动化工作台</span><h2>Skills</h2></div><Sparkles size={18}/></div>
    <section className="side-section"><div className="section-label"><span>工作流</span><em>{skills.length}</em></div>{skills.map(skill => { const Icon = SKILL_ICONS[skill.id] || Workflow; return <button key={skill.id} className={`skill-nav-row ${selectedSkill === skill.id ? 'active' : ''}`} onClick={() => setSelectedSkill(skill.id)}><span><Icon size={16}/></span><div><b>{skill.name}</b><small>{skill.description}</small></div></button>; })}</section>
    <section className="side-section recent-runs"><div className="section-label"><span>最近运行</span><em>{runs.length}</em></div>{runs.slice(0, 8).map(run => <button key={run.id} onClick={() => onSelectRun(run)}><span className={`run-dot ${run.status === 'failed' || run.error ? 'failed' : ''}`}/><div><b>{run.title || skills.find(skill => skill.id === run.skillId)?.name || run.skillId}</b><small>{run.input?.query || run.topic || formatDate(run.startedAt)}</small></div></button>)}</section>
  </aside>;
}

function SkillWorkspace({ skill, topic, setTopic, runSkill, run, selectedCount, documentCount, libraryName = '', runs, onSelectRun, onOpenDocument, onOpenGraph, onKeepWriting, onSaveNote }) {
  const Icon = SKILL_ICONS[skill?.id] || Workflow;
  return <main className="workspace skill-workspace"><header className="workspace-head"><div className="workspace-title"><span className="ai-avatar"><Workflow size={19}/></span><div><strong>Skill 工作台</strong><small>{libraryName ? `基于「${libraryName}」检索与生成` : '组合知识检索与模型生成，产物自动保留'}</small></div></div><div className="head-actions">{onOpenGraph ? <button type="button" onClick={onOpenGraph}><Network size={16}/>图谱</button> : null}<button type="button" disabled={!runs.length} onClick={() => runs[0] && onSelectRun?.(runs[0])}><History size={16}/>{runs.length} 次运行</button></div></header>
    <div className="skill-canvas"><section className="skill-hero"><div className="skill-hero-icon"><Icon size={27}/></div><div><span className="eyebrow">当前工作流</span><h1>{skill?.name}</h1><p>{skill?.description}</p></div></section>
      <section className="skill-launch-card"><label>任务主题</label><textarea value={topic} onChange={event => setTopic(event.target.value)} placeholder={skill?.inputHint || '输入需要研究、总结或对比的主题；留空则基于当前文档自动执行。'}/><div className="skill-scope"><Tags size={15}/><span>{selectedCount ? `使用已选 ${selectedCount} 篇文档` : `使用「${libraryName || '当前知识库'}」${documentCount} 篇文档`}</span></div>
        <div className="planned-steps">{(skill?.steps || []).map((step, index) => <div key={step}><span>{index + 1}</span><b>{step}</b>{index < skill.steps.length - 1 && <i/>}</div>)}</div>
        <button className="primary-action" disabled={run?.running} onClick={() => runSkill(skill.id)}>{run?.running ? <LoaderCircle className="spin" size={17}/> : <Play size={17}/>} {run?.running ? '正在执行' : '运行 Skill'}</button>
      </section>{run && <SkillRunCard run={run} onOpenDocument={onOpenDocument} onKeepWriting={onKeepWriting} onSaveNote={onSaveNote}/>}<section className="run-records-panel"><div className="panel-title"><div><span className="eyebrow">History</span><h3>运行记录</h3></div><small>点击记录查看产物</small></div>{runs.length ? <div className="run-record-grid">{runs.slice(0, 12).map(item => <button key={item.id} onClick={() => onSelectRun(item)}><span className={`record-icon ${item.error ? 'failed' : ''}`}>{item.error ? <AlertCircle size={16}/> : <Check size={16}/>}</span><span><b>{item.title || item.artifact?.title || item.skillId}</b><small>{item.input?.query || item.topic || '未填写主题'}</small></span><time>{formatDate(item.completedAt || item.startedAt)}</time></button>)}</div> : <div className="empty-records"><History size={28}/><p>运行记录会显示在这里</p></div>}</section>
    </div>
  </main>;
}

function SkillRunCard({ run, onOpenDocument, onKeepWriting, onSaveNote }) {
  const steps = run.steps || [];
  const artifact = run.artifact || run.result?.artifact || {};
  const output = run.output || artifact.content;
  const files = artifact.files || [];
  const sources = artifact.sourceRefs || artifact.references || [];
  return <section className={`skill-run-card ${run.error ? 'failed' : ''}`}><div className="run-title"><Workflow size={18}/><div><b>{run.title || artifact.title || run.skillId}</b><span>{run.running ? '正在执行工作流' : run.error ? '执行失败' : '工作流已完成'} · {formatDate(run.startedAt)}</span></div>{run.running && <LoaderCircle className="spin" size={17}/>}</div>{steps.length > 0 && <div className="run-steps">{steps.map((step, index) => <div key={`${step.label || step.name}-${index}`}><CircleCheck size={15}/><span><b>{step.label || step.name}</b>{step.detail && <small>{step.detail}</small>}</span></div>)}</div>}{run.error && <div className="run-error"><AlertCircle size={15}/>{errText(run.error)}</div>}{files.length > 0 && <div className="skill-artifact-files">{files.some(file => file.kind === 'audio') && <audio controls preload="metadata" src={files.find(file => file.kind === 'audio')?.downloadUrl}/>}<div>{files.map(file => <a key={file.downloadUrl} href={file.downloadUrl} download={file.fileName}><Download size={14}/><span>{artifactFileLabel(file)}</span><small>{file.fileName}</small></a>)}</div></div>}{output && <div className="run-output markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{output}</ReactMarkdown></div>}{output && !run.running ? <div className="skill-run-actions"><button type="button" onClick={() => onKeepWriting?.(run)}><FilePenLine size={13}/>打开写作</button><button type="button" onClick={() => onSaveNote?.(run)}><NotebookPen size={13}/>存成笔记</button></div> : null}{sources.length > 0 && <div className="skill-artifact-sources"><span>来源材料</span>{sources.map((source, index) => <button key={source.evidenceId || source.documentId || index} type="button" onClick={() => onOpenDocument?.(source)}><Link2 size={13}/><b>[{index + 1}]</b><span>{source.title || '来源文档'}</span><EvidenceStatusBadge evidence={source} compact /></button>)}</div>}</section>;
}
function ModelDrawer({ form, setForm, provider, updateProvider, models, busy, showApiKey, setShowApiKey, refreshModels, testModel, saveModel, close }) {
  const custom = form.provider === 'custom-http';
  const azure = form.provider === 'azure-openai';
  const dialogRef = useRef(null);
  useModalFocus(true, dialogRef, close);
  return <div className="drawer-backdrop" onMouseDown={close}><aside ref={dialogRef} className="model-drawer" role="dialog" aria-modal="true" aria-labelledby="model-drawer-title" onMouseDown={event => event.stopPropagation()}><header><div><span className="eyebrow">Model Gateway</span><h2 id="model-drawer-title">模型管理</h2><p>兼容官方接口、第三方中转站与本地模型。</p></div><button onClick={close}><X size={20}/></button></header><div className="drawer-scroll">
    <FormSection number="1" title="Provider 类型" note="选择服务端采用的协议格式"><label className="field"><span>Provider</span><select value={form.provider} onChange={event => updateProvider(event.target.value)}>{PROVIDERS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{provider.hint}</small></label></FormSection>
    <FormSection number="2" title="连接信息" note="自定义中转地址与鉴权"><label className="field"><span>Base URL</span><input value={form.baseUrl} onChange={event => setForm(current => ({ ...current, baseUrl: event.target.value }))} placeholder={provider.url || 'https://your-gateway.example.com/v1'}/><small>可填写官方地址或第三方中转站 URL。</small></label>
      {provider.key && <label className="field"><span>API Key {form.hasApiKey && <em><Check size={12}/>服务端已有密钥</em>}</span><div className="password-input"><input type={showApiKey ? 'text' : 'password'} autoComplete="new-password" value={form.apiKey} onChange={event => setForm(current => ({ ...current, apiKey: event.target.value }))} placeholder={form.hasApiKey ? '留空则继续使用已保存的密钥' : '输入 API Key'}/><button type="button" onClick={() => setShowApiKey(!showApiKey)}>{showApiKey ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div><small>提交后输入框立即清空，页面不会回显服务端密钥。</small></label>}
      {azure && <div className="field-grid"><label className="field"><span>Deployment</span><input value={form.azureDeployment} onChange={event => setForm(current => ({ ...current, azureDeployment: event.target.value }))} placeholder="my-gpt-deployment"/></label><label className="field"><span>API Version</span><input value={form.azureApiVersion} onChange={event => setForm(current => ({ ...current, azureApiVersion: event.target.value }))}/></label></div>}
    </FormSection>
    <FormSection number="3" title="模型与默认项" note="刷新远端列表或手动输入"><label className="field"><span>默认模型</span><div className="model-picker"><input list="model-options" value={form.defaultModel || form.model} onChange={event => setForm(current => ({ ...current, model: event.target.value, defaultModel: event.target.value }))} placeholder="例如 gpt-4.1 / claude-sonnet / qwen-plus"/><datalist id="model-options">{models.map(model => <option key={model} value={model}/>)}</datalist><button type="button" onClick={refreshModels} disabled={Boolean(busy)}>{busy === 'models' ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>}刷新</button></div><small>{models.length ? `已发现 ${models.length} 个可用模型` : '支持手动输入中转站提供的模型 ID。'}</small></label><div className="field-grid"><label className="field"><span>请求超时（毫秒）</span><input type="number" min="5000" step="1000" value={form.timeoutMs} onChange={event => setForm(current => ({ ...current, timeoutMs: event.target.value }))}/></label><label className="field"><span>失败重试次数</span><input type="number" min="0" max="5" value={form.retries} onChange={event => setForm(current => ({ ...current, retries: event.target.value }))}/></label><label className="field"><span>重试基础间隔（毫秒）</span><input type="number" min="100" step="100" value={form.retryDelayMs} onChange={event => setForm(current => ({ ...current, retryDelayMs: event.target.value }))}/><small>仅对超时、限流和 5xx 错误执行指数退避重试。</small></label><label className="field"><span>Temperature</span><input type="number" min="0" max="2" step="0.1" value={form.temperature} onChange={event => setForm(current => ({ ...current, temperature: event.target.value }))}/></label><label className="field"><span>最大输出 Token</span><input type="number" min="128" step="128" value={form.maxTokens} onChange={event => setForm(current => ({ ...current, maxTokens: event.target.value }))}/></label></div></FormSection>
    {custom && <FormSection number="4" title="自定义协议映射" note="描述模型网关的端点与响应格式"><div className="field-grid"><label className="field"><span>Chat Path</span><input value={form.customChatPath} onChange={event => setForm(current => ({ ...current, customChatPath: event.target.value }))} placeholder="/chat/completions"/></label><label className="field"><span>Models Path</span><input value={form.customModelsPath} onChange={event => setForm(current => ({ ...current, customModelsPath: event.target.value }))} placeholder="/models"/></label><label className="field"><span>鉴权方式</span><select value={form.customAuthType} onChange={event => setForm(current => ({ ...current, customAuthType: event.target.value }))}><option value="bearer">Authorization: Bearer</option><option value="x-api-key">x-api-key</option><option value="query">Query 参数</option><option value="none">无鉴权</option></select></label><label className="field"><span>请求格式</span><select value={form.customRequestFormat} onChange={event => setForm(current => ({ ...current, customRequestFormat: event.target.value }))}><option value="openai">OpenAI Chat</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option><option value="ollama">Ollama</option></select></label><label className="field"><span>响应流格式</span><select value={form.customResponseFormat} onChange={event => setForm(current => ({ ...current, customResponseFormat: event.target.value }))}><option value="auto">自动识别</option><option value="sse">SSE</option><option value="ndjson">NDJSON</option><option value="json">JSON</option></select></label></div></FormSection>}
    <FormSection number={custom ? '5' : '4'} title="高级 Header" note="合并到模型请求的附加请求头"><label className="field"><span>额外 Header JSON</span><textarea className="code-input" value={form.extraHeadersText} onChange={event => setForm(current => ({ ...current, extraHeadersText: event.target.value }))} spellCheck="false" placeholder={'{\n  "X-Organization": "your-org"\n}'}/><small>必须是 JSON 对象。不要在这里填写需要隐藏的密钥。</small></label></FormSection>
  </div><footer><button className="secondary-action" onClick={testModel} disabled={Boolean(busy)}>{busy === 'test' ? <LoaderCircle className="spin" size={16}/> : <TestTube2 size={16}/>}测试连接</button><button className="primary-action" onClick={saveModel} disabled={Boolean(busy)}>{busy === 'save' ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>}保存并设为默认</button></footer></aside></div>;
}

function FormSection({ number, title, note, children }) {
  return <section className="form-section"><div className="form-section-title"><span>{number}</span><div><b>{title}</b><small>{note}</small></div></div>{children}</section>;
}
createRoot(document.getElementById('root')).render(<App/>);
