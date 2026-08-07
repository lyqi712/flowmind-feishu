import React, { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle, AtSign, BarChart3, Bot, BookOpen, Bookmark, BrainCircuit, Check, ChevronDown, CircleCheck, CircleHelp, Clock3, Compass,
  Database, Download, Eye, EyeOff, FileAudio, FileText, FolderKanban, Globe2, History,
  LibraryBig, Link2, LoaderCircle, MessageSquareText, Mic, MicOff, Network, NotebookPen, PanelLeftClose,
  Paperclip, Play, Plus, RefreshCw, RotateCcw, Save, Search, Send, Settings,
  Sparkles, Square, Tags, TestTube2, Workflow, X
} from 'lucide-react';
import UnifiedWorkspace from './components/UnifiedWorkspace.jsx';
import { loadWorkspaceSurface, preloadWorkspaceRoute, preloadWorkspaceSurface } from './workspace/workspace-route-loading.js';
import { createWorkspaceStorageAdapter, workspaceSessionReducer } from './workspace/workspace-session.js';
import { buildWorkspaceContextNote, buildWorkspaceContextWritingDraft, deriveWorkspaceContext, deriveWorkspaceRecentItems } from './workspace/workspace-integrations.js';
import './styles.css';
import './components/UnifiedWorkspaceIma.css';

const lazyDefaultSurface = surface => lazy(() => loadWorkspaceSurface(surface).then(module => ({ default: module.default })));
const lazyNamedSurface = (surface, exportName) => lazy(() => loadWorkspaceSurface(surface).then(module => ({ default: module[exportName] })));

const FeishuSyncWizard = lazyDefaultSurface('feishu-sync');
const CollectionCenter = lazyNamedSurface('collection', 'CollectionCenter');
const ContentReader = lazyNamedSurface('content-reader', 'ContentReader');
const KnowledgeGraph = lazyNamedSurface('knowledge-graph', 'KnowledgeGraph');
const SettingsExperienceSidebar = lazyNamedSurface('settings', 'SettingsSidebar');
const SettingsExperienceWorkspace = lazyNamedSurface('settings', 'SettingsWorkspace');
const DeepAnswerPanel = lazyNamedSurface('deep-answer', 'DeepAnswerPanel');
const CopilotModule = lazyNamedSurface('copilot', 'CopilotModule');
const DocumentAnalysisModule = lazyNamedSurface('analysis', 'DocumentAnalysisModule');
const NotesModule = lazyNamedSurface('notes', 'NotesModule');
const WritingModule = lazyNamedSurface('writing', 'WritingModule');
const RecordingWorkspace = lazyNamedSurface('recording', 'RecordingWorkspace');
const ComposerCommandMenu = lazyDefaultSurface('composer-menu');

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
const SKILL_ICONS = { summary: FileText, compare: FolderKanban, 'research-report': Workflow, 'mind-map': BrainCircuit, quiz: CircleHelp, podcast: FileAudio };
const DEFAULT_STATE = {
  mode: 'mock', knowledgeBases: [{ id: 'feishu-space', name: '飞书知识库', source: 'mock', documentCount: 0 }],
  documents: [], conversations: [], skillRuns: [], sync: { status: 'idle', stats: { imported: 0 } }
};
const EMPTY_INDEXED_GRAPH = Object.freeze({
  nodes: Object.freeze([]), edges: Object.freeze([]), unresolved: Object.freeze([]), suggestions: Object.freeze([]),
  stats: Object.freeze({ nodes: 0, edges: 0, unresolved: 0, suggestions: 0, explicitEdges: 0 })
});
const EMPTY_MODEL = {
  provider: 'openai-chat', baseUrl: '', apiKey: '', model: '', defaultModel: '', timeoutMs: 120000, retries: 2, retryDelayMs: 500, temperature: 0.2, maxTokens: 4096, fallbackToLocal: true,
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
        if (event.type === 'error') throw new Error(errText(event.error, '流式任务失败'));
        onEvent(event);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = JSON.parse(buffer);
      if (event.type === 'error') throw new Error(errText(event.error, '流式任务失败'));
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
    timeoutMs: Number(source.timeoutMs || source.timeout || EMPTY_MODEL.timeoutMs), retries: Number(source.retries ?? EMPTY_MODEL.retries), retryDelayMs: Number(source.retryDelayMs ?? EMPTY_MODEL.retryDelayMs), temperature: Number(source.temperature ?? EMPTY_MODEL.temperature), maxTokens: Number(source.maxTokens ?? EMPTY_MODEL.maxTokens), fallbackToLocal: source.fallbackToLocal !== false,
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

function hasSubstantiveEvidenceAnalysis(relations) {
  if (!relations) return false;
  const documentIds = new Set((relations.relatedDocuments || []).map(item => String(item?.documentId || '')).filter(Boolean));
  return documentIds.size > 1 || (relations.conflicts || []).length > 0;
}

function formatEvidenceChars(value) {
  const chars = Number(value) || 0;
  return chars.toLocaleString('zh-CN');
}

function App() {
  const [active, setActive] = useState('home');
  const [state, setState] = useState(DEFAULT_STATE);
  const [selectedKb, setSelectedKb] = useState('feishu-space');
  const [knowledgeLibraries, setKnowledgeLibraries] = useState([]);
  const [knowledgeLibraryFilter, setKnowledgeLibraryFilter] = useState('all');
  const [knowledgeLibraryBusy, setKnowledgeLibraryBusy] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState([]);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([{ role: 'assistant', text: '把材料和目标交给我就好。你可以直接提问，也可以用 / 调用 Skill、用 @ 选择文档。' }]);
  const [streaming, setStreaming] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [readerDetail, setReaderDetail] = useState(null);
  const [readerAnchor, setReaderAnchor] = useState('');
  const [readerBusy, setReaderBusy] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [graphNotes, setGraphNotes] = useState([]);
  const [graphData, setGraphData] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [noteDeepLinkId, setNoteDeepLinkId] = useState('');
  const [writingDeepLinkId, setWritingDeepLinkId] = useState('');
  const [settingsSection, setSettingsSection] = useState('model');
  const [toast, setToast] = useState(null);
  const [chatError, setChatError] = useState('');
  const [modelSettings, setModelSettings] = useState(EMPTY_MODEL);
  const [modelDrawerOpen, setModelDrawerOpen] = useState(false);
  const [modelForm, setModelForm] = useState(EMPTY_MODEL);
  const [modelOptions, setModelOptions] = useState([]);
  const [modelBusy, setModelBusy] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [skills, setSkills] = useState(FALLBACK_SKILLS);
  const [selectedSkill, setSelectedSkill] = useState('summary');
  const [skillTopic, setSkillTopic] = useState('');
  const [skillRun, setSkillRun] = useState(null);
  const [skillRuns, setSkillRuns] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatConversationId, setChatConversationId] = useState('');
  const [chatAttachments, setChatAttachments] = useState([]);
  const [chatAttachmentBusy, setChatAttachmentBusy] = useState(false);
  const [chatAttachmentCapabilities, setChatAttachmentCapabilities] = useState(null);
  const [chatIncludeKnowledgeBase, setChatIncludeKnowledgeBase] = useState(true);
  const [artifactBusy, setArtifactBusy] = useState('');
  const [agentMode, setAgentMode] = useState('chat');
  const [recordingSession, setRecordingSession] = useState(() => { try { return JSON.parse(globalThis.localStorage?.getItem('flowmind.recording.session') || 'null'); } catch { return null; } });
  const endRef = useRef(null);
  const abortRef = useRef(null);
  const chatAttachmentsRef = useRef([]);
  const chatAttachmentGenerationRef = useRef(0);
  const chatAttachmentBatchRef = useRef(0);
  const graphLoadRef = useRef(null);
  const workspaceStorageRef = useRef(null);
  if (!workspaceStorageRef.current) {
    workspaceStorageRef.current = createWorkspaceStorageAdapter({ onError: (error, operation) => console.warn(`[workspace:${operation}]`, error) });
  }
  const [workspaceSession, dispatchWorkspace] = useReducer(workspaceSessionReducer, null, () => workspaceStorageRef.current.load());
  const [workspaceCompact, setWorkspaceCompact] = useState(() => {
    try { return globalThis.localStorage?.getItem('flowmind.workspace.compact') === 'true'; } catch { return false; }
  });
  const [contextExclusion, setContextExclusion] = useState('');

  const kb = state.knowledgeBases?.find(item => item.id === selectedKb) || state.knowledgeBases?.[0];
  const docs = useMemo(() => (state.documents || []).filter(doc => {
    if (!selectedKb) return true;
    const documentLibraryId = doc.knowledgeBaseId || doc.spaceId;
    return documentLibraryId ? documentLibraryId === selectedKb : selectedKb === 'feishu-space' || selectedKb === 'local-content';
  }), [state.documents, selectedKb]);
  const activeSkill = skills.find(item => item.id === selectedSkill) || skills[0];
  const runs = skillRuns.length ? skillRuns : (state.skillRuns || []);
  const activeWorkspaceTab = useMemo(() => workspaceSession.tabs.find(tab => tab.id === workspaceSession.activeTabId) || null, [workspaceSession.tabs, workspaceSession.activeTabId]);
  const currentContextDocument = activeWorkspaceTab?.kind === 'document' && contextExclusion !== activeWorkspaceTab.resourceId
    ? { id: activeWorkspaceTab.resourceId, documentId: activeWorkspaceTab.resourceId, title: activeWorkspaceTab.title, source: activeWorkspaceTab.source || '知识库', type: 'document' }
    : activeWorkspaceTab?.contextDocument && contextExclusion !== activeWorkspaceTab.contextDocument.id
      ? activeWorkspaceTab.contextDocument
      : null;
  const workspaceContext = useMemo(() => deriveWorkspaceContext({
    currentDocument: currentContextDocument,
    aiContextItems: workspaceSession.aiContextItems,
    selectedDocumentIds: selectedDocs,
    documents: docs,
    activeRoute: active,
    knowledgeBase: kb,
    excludedDocumentId: contextExclusion
  }), [currentContextDocument, workspaceSession.aiContextItems, selectedDocs, docs, active, kb, contextExclusion]);
  const workspaceRecentItems = useMemo(() => deriveWorkspaceRecentItems({
    recentWork: workspaceSession.recentWork,
    documents: state.documents,
    limit: 8
  }), [workspaceSession.recentWork, state.documents]);
  const visibleWorkspaceTasks = useMemo(() => workspaceSession.tasks.map(task => ({ ...task, progress: Number(task.progress || 0) <= 1 ? Math.round(Number(task.progress || 0) * 100) : Number(task.progress || 0) })), [workspaceSession.tasks]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      fetch('/api/state').then(parseResponse),
      fetch('/api/settings/model').then(parseResponse),
      fetch('/api/skills').then(parseResponse),
      fetch('/api/content/items?limit=500').then(parseResponse),
      fetch('/api/knowledge/libraries').then(parseResponse)
    ]).then(([stateResult, modelResult, skillResult, contentResult, libraryResult]) => {
      if (cancelled) return;
      const rawContentItems = contentResult.status === 'fulfilled' && Array.isArray(contentResult.value.items) ? contentResult.value.items : null;
      const loadedLibraries = libraryResult.status === 'fulfilled' && Array.isArray(libraryResult.value.libraries) ? libraryResult.value.libraries : [];
      const libraryBySpaceId = new Map(loadedLibraries.filter(item => item.spaceId).map(item => [item.spaceId, item.id]));
      const contentItems = rawContentItems?.map(item => ({ ...item, knowledgeBaseId: item.knowledgeBaseId || libraryBySpaceId.get(item.spaceId) || item.spaceId || null })) || null;
      if (stateResult.status === 'fulfilled') {
        const next = stateResult.value;
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
        setSelectedKb((requestedKb && libraries.some(item => item.id === requestedKb)) ? requestedKb : libraries[0]?.id || 'local-content');
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
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, skillRun]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => () => abortRef.current?.abort(), []);
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
    if (!tab) { setActive('home'); return; }
    const route = tab.route || (tab.kind === 'document' || tab.kind === 'chat' ? 'knowledge' : tab.kind);
    setActive(route || 'knowledge');
    setContextExclusion('');
    if (route === 'graph' && !graphData) {
      void requestGraphSnapshot().catch(error => notify(errText(error, '知识图谱加载失败'), 'error'));
    }
    if (tab.kind === 'document' && tab.resourceId && readerDetail?.item?.id !== tab.resourceId) {
      loadWorkspaceDocument(tab.resourceId).catch(error => notify(errText(error, '文档恢复失败'), 'error'));
    }
  }, [workspaceSession.activeTabId, readerDetail?.item?.id, graphData]);

  const notify = (message, kind = 'success') => setToast({ message, kind });

  function moduleTab(id, overrides = {}) {
    const definitions = {
      knowledge: { title: '知识问答', type: 'chat' },
      graph: { title: '知识图谱', type: 'graph' },
      analysis: { title: '文档解读', type: 'document' },
      skills: { title: 'Skill 工作台', type: 'skill' },
      notes: { title: '笔记', type: 'note' },
      writing: { title: '写作', type: 'document' },
      copilots: { title: 'Copilot', type: 'chat' },
      settings: { title: '设置', type: 'document' },
      recording: { title: '录音纪要', type: 'document' }
    };
    const definition = definitions[id] || { title: id, type: 'document' };
    return { id: `module-${id}`, kind: 'module', route: id, closable: true, ...definition, ...overrides, openedAt: Date.now(), lastActiveAt: Date.now() };
  }

  function openWorkspaceModule(id, overrides = {}) {
    void preloadWorkspaceRoute(id);
    if (id === 'home') {
      dispatchWorkspace({ type: 'ACTIVATE_HOME' });
      setActive('home');
      return;
    }
    if (id === 'knowledge') { setReaderDetail(null); setGraphOpen(false); }
    if (id === 'graph') { setReaderDetail(null); setGraphOpen(false); }
    dispatchWorkspace({ type: 'OPEN_TAB', tab: moduleTab(id, overrides) });
    setActive(id);
  }

  async function loadWorkspaceDocument(documentId) {
    const id = String(documentId || '');
    if (!id) return null;
    setReaderBusy(true);
    setGraphOpen(false);
    try {
      const data = await fetch(`/api/content/items/${encodeURIComponent(id)}`).then(parseResponse);
      setReaderDetail(data);
      return data;
    } finally {
      setReaderBusy(false);
    }
  }

  function activateWorkspaceTab(tab) {
    if (!tab) {
      dispatchWorkspace({ type: 'ACTIVATE_HOME' });
      setActive('home');
      return;
    }
    dispatchWorkspace({ type: 'ACTIVATE_TAB', tabId: tab.id, at: Date.now() });
    const route = tab.route || (tab.kind === 'document' || tab.kind === 'chat' ? 'knowledge' : tab.kind);
    setActive(route || 'knowledge');
  }

  function closeWorkspaceTab(tab) {
    dispatchWorkspace({ type: 'CLOSE_TAB', tabId: tab?.id });
    if (tab?.kind === 'document' && readerDetail?.item?.id === tab.resourceId) setReaderDetail(null);
  }

  function contextDocumentIds(context = workspaceContext) {
    return [...new Set([context.currentDocument, ...(context.resources || [])]
      .map(item => item?.documentId || item?.sourceId || (item?.type === 'document' ? item?.id : ''))
      .filter(Boolean))];
  }

  function handleWorkspaceAsk(prompt, context = workspaceContext) {
    setGraphOpen(false);
    const documentIds = contextDocumentIds(context);
    setSelectedDocs(documentIds);
    setReaderDetail(null);
    dispatchWorkspace({ type: 'OPEN_TAB', tab: { id: 'chat-current', kind: 'chat', type: 'chat', route: 'knowledge', title: String(prompt || 'AI 问答').slice(0, 26), contextDocument: context.currentDocument || null, openedAt: Date.now(), lastActiveAt: Date.now() } });
    setActive('knowledge');
    ask(prompt, documentIds);
  }

  function readerWorkspaceContext(item, selection = null) {
    const currentDocument = item ? { ...item, id: item.id, documentId: item.id, type: 'document', source: item.sourceType || item.source || '知识库' } : null;
    const resources = (workspaceContext.resources || []).filter(resource => String(resource?.documentId || resource?.sourceId || resource?.id || '') !== String(item?.id || ''));
    return { currentDocument, selection, resources };
  }

  function handleReaderAsk(prompt, item, selection = null) {
    handleWorkspaceAsk(prompt, readerWorkspaceContext(item, selection));
  }

  function handleReaderCreateWriting(item, selection = null) {
    return handleWorkspaceCreateWriting(readerWorkspaceContext(item, selection));
  }

  function handleKnowledgeObservationAsk(prompt, node, relatedNodes = []) {
    const currentDocument = node?.type === 'document' ? { ...(node.raw || {}), id: node.sourceId, documentId: node.sourceId, title: node.label, type: 'document' } : null;
    const sourceRefs = Array.isArray(node?.raw?.sourceRefs) ? node.raw.sourceRefs : [];
    const relatedDocuments = relatedNodes.filter(item => item?.type === 'document').map(item => ({ ...(item.raw || {}), id: item.sourceId, documentId: item.sourceId, title: item.label, type: 'document' }));
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

  function handleWorkspaceSearch(text) {
    setQuery(String(text || ''));
    openWorkspaceModule('knowledge', { title: `搜索：${String(text || '').slice(0, 20)}` });
    notify('已进入知识工作区，可继续筛选文档或直接提问', 'info');
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

  function handleAttachContext() {
    openWorkspaceModule('knowledge');
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

  function handleOpenRecent(item) {
    if (item?.type === 'view') { openWorkspaceModule('knowledge'); return; }
    const documentId = item?.documentId || item?.resourceId || (item?.kind === 'document' ? item?.id : '');
    if (documentId) { openContentReader({ id: documentId, title: item.title }); return; }
    if (item?.kind === 'note' || item?.type === 'note') {
      const noteId = String(item.noteId || item.id || '');
      setNoteDeepLinkId(noteId);
      dispatchWorkspace({ type: 'OPEN_TAB', tab: { id: `note-${noteId}`, kind: 'note', type: 'note', route: 'notes', noteId, title: item.title || '笔记', openedAt: Date.now(), lastActiveAt: Date.now() } });
      setActive('notes');
      return;
    }
    openWorkspaceModule(item?.route || item?.kind || 'knowledge');
  }

  function handleOpenTask(task) {
    if (task?.type === 'skill') openWorkspaceModule('skills');
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
      if (libraries.length && !libraries.some(item => item.id === selectedKb)) setSelectedKb(libraries[0].id);
      return data;
    } catch (error) {
      if (notifyErrors) notify(errText(error, refresh ? '共享知识库刷新失败' : '知识库加载失败'), 'error');
      throw error;
    } finally { setKnowledgeLibraryBusy(false); }
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

  function stopGeneration() { abortRef.current?.abort(); abortRef.current = null; }

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

    if (rejected.length) setChatError(`有 ${rejected.length} 个文件未添加：${rejected.slice(0, 2).join('；')}${rejected.length > 2 ? '…' : ''}`);
    else setChatError('');
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
        setChatError(`${record.fileName}：${message}`);
      }
    }));
    if (chatAttachmentBatchRef.current === batchId) setChatAttachmentBusy(false);
  }

  async function retryChatAttachment(record) {
    if (!record?.file || chatAttachmentBusy) return;
    const batchId = ++chatAttachmentBatchRef.current;
    const nextRecord = { ...record, generation: chatAttachmentGenerationRef.current };
    setChatAttachmentBusy(true);
    setChatError('');
    updateChatAttachments(current => current.map(item => item.clientId === record.clientId ? { ...item, generation: nextRecord.generation, status: 'uploading', error: '' } : item));
    try { await uploadChatAttachmentRecord(nextRecord); }
    catch (error) {
      const message = errText(error, '附件解析失败');
      updateChatAttachments(current => current.map(item => item.clientId === record.clientId ? { ...item, status: 'error', error: message } : item));
      setChatError(`${record.fileName}：${message}`);
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

  async function askAgent(prompt = query, scopeDocumentIds = null, targetAssistantId = '', attachmentOverride = null) {
    const activeAttachments = (Array.isArray(attachmentOverride) ? attachmentOverride : chatAttachments).filter(item => item.temporaryId && item.status !== 'error');
    const text = String(prompt || '').trim();
    const requestedDocumentIds = normalizedDocumentIds(Array.isArray(scopeDocumentIds) ? scopeDocumentIds : selectedDocs);
    if (!text || streaming || chatAttachmentBusy) return;
    if (activeAttachments.length) {
      notify('Agent 工具模式暂不读取临时附件；请先将附件导入知识库或切回普通问答。', 'info');
      return;
    }
    setQuery(''); setStreaming(true); setChatError('');
    const controller = new AbortController();
    abortRef.current = controller;
    const assistantId = targetAssistantId || `agent-${Date.now()}`;
    const initialAgent = { mode: agentMode, plan: [], tools: [], observations: [], confirmation: null, audit: null };
    if (targetAssistantId) {
      setMessages(current => current.map(message => message.id === targetAssistantId ? { ...message, text: '', citations: [], relations: null, agent: initialAgent, documentIds: requestedDocumentIds, status: '正在启动 Agent', error: '', done: false } : message));
    } else {
      setMessages(current => [...current, { role: 'user', text, documentIds: requestedDocumentIds }, { id: assistantId, role: 'assistant', text: '', citations: [], versions: [], documentIds: requestedDocumentIds, agent: initialAgent, status: '正在启动 Agent' }]);
    }
    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ question: text, mode: agentMode, documentIds: requestedDocumentIds })
      });
      if (!response.ok) throw new Error(`Agent 请求失败（HTTP ${response.status}）`);
      let streamError = null;
      await readNdjson(response, event => {
        if (event.type === 'error') streamError = new Error(errText(event.error, 'Agent 执行失败'));
        setMessages(current => current.map(message => {
          if (message.id !== assistantId) return message;
          const currentAgent = message.agent || initialAgent;
          if (event.type === 'start') return { ...message, status: event.scope?.documents?.length ? `已带入 ${event.scope.documents.length} 篇资料，正在建立执行计划` : '正在建立执行计划', agent: { ...currentAgent, plan: event.plan || [], scope: event.scope || currentAgent.scope || null, model: event.model || null, runId: event.runId } };
          if (event.type === 'status') return { ...message, status: event.status === 'scope' && currentAgent.scope?.documents?.length ? `正在读取已选的 ${currentAgent.scope.documents.length} 篇资料` : event.detail || 'Agent 正在执行', agent: { ...currentAgent, status: event.status } };
          if (event.type === 'tool') return { ...message, status: `正在调用 ${event.tool}`, agent: { ...currentAgent, tools: [...(currentAgent.tools || []), { tool: event.tool, arguments: event.arguments, status: 'running' }] } };
          if (event.type === 'observation') {
            const knownTools = currentAgent.tools || [];
            const tools = event.scopeBootstrap && !knownTools.some(tool => tool.tool === event.tool)
              ? [...knownTools, { tool: event.tool, arguments: {}, status: event.status, scopeBootstrap: true }]
              : knownTools.map(tool => tool.tool === event.tool && tool.status === 'running' ? { ...tool, status: event.status } : tool);
            return { ...message, status: '', agent: { ...currentAgent, observations: [...(currentAgent.observations || []), { tool: event.tool, status: event.status, observation: event.observation, scopeBootstrap: Boolean(event.scopeBootstrap) }], tools } };
          }
          if (event.type === 'confirmation-required') return { ...message, status: '等待你的确认', agent: { ...currentAgent, confirmation: event.confirmation, diff: event.diff, sourceRefs: event.sourceRefs || [] } };
          if (event.type === 'done') return { ...message, status: event.result ? '' : message.status, text: event.result?.answer || message.text, citations: event.result?.sourceRefs || message.citations, done: Boolean(event.result), agent: { ...currentAgent, audit: event.audit || null } };
          if (event.type === 'error') return { ...message, status: '', error: errText(event.error, 'Agent 执行失败'), text: message.text || '本次 Agent 执行失败。' };
          return message;
        }));
      }, controller.signal);
      if (streamError) throw streamError;
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Agent 已停止。' : errText(error, 'Agent 执行失败，请重试');
      setChatError(message);
      setMessages(current => current.map(item => item.id === assistantId ? { ...item, status: '', stopped: error.name === 'AbortError', error: error.name === 'AbortError' ? '' : message, text: item.text || message } : item));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
    }
  }

  async function confirmAgentWrite(message, approved) {
    const confirmation = message?.agent?.confirmation;
    if (!confirmation?.id) return;
    setArtifactBusy(`agent:${confirmation.id}`);
    try {
      const data = await fetch(`/api/agent/confirmations/${encodeURIComponent(confirmation.id)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved })
      }).then(parseResponse);
      const result = data.result || null;
      setMessages(current => current.map(item => item.id === message.id ? {
        ...item,
        status: '',
        text: approved ? (result?.title ? `已确认写入：${result.title}` : '已确认并完成写入。') : '已拒绝写入提案。',
        done: true,
        agent: { ...(item.agent || {}), confirmation: { ...confirmation, status: approved ? 'confirmed' : 'rejected' }, result }
      } : item));
      if (approved) await refreshGraphData().catch(() => null);
    } catch (error) {
      notify(errText(error, '确认 Agent 写入失败'), 'error');
    } finally { setArtifactBusy(''); }
  }

  async function ask(prompt = query, scopeDocumentIds = null, targetAssistantId = '', attachmentOverride = null) {
    if (agentMode !== 'chat') return askAgent(prompt, scopeDocumentIds, targetAssistantId, attachmentOverride);
    const activeAttachments = (Array.isArray(attachmentOverride) ? attachmentOverride : chatAttachments).filter(item => item.temporaryId && item.status !== 'error');
    const text = String(prompt || '').trim() || (activeAttachments.length ? '请解读这些附件，提炼关键内容、重要细节和可执行结论。' : '');
    const requestedDocumentIds = normalizedDocumentIds(Array.isArray(scopeDocumentIds) ? scopeDocumentIds : selectedDocs);
    if (!text || streaming || chatAttachmentBusy) return;
    setQuery(''); setStreaming(true); setChatError('');
    const controller = new AbortController();
    abortRef.current = controller;
    const assistantId = targetAssistantId || `assistant-${Date.now()}`;
    const attachmentSnapshot = activeAttachments.map(item => ({ ...item, file: undefined }));
    if (targetAssistantId) {
      setMessages(current => current.map(message => message.id === targetAssistantId ? { ...message, attachments: attachmentSnapshot, documentIds: requestedDocumentIds, versions: [...(message.versions || []), { text: message.text, citations: message.citations || [], relations: message.relations || null, createdAt: new Date().toISOString() }], text: '', citations: [], relations: null, status: '正在重新生成', error: '' } : message));
    } else {
      setMessages(current => [...current, { role: 'user', text, documentIds: requestedDocumentIds, attachments: attachmentSnapshot }, { id: assistantId, role: 'assistant', text: '', citations: [], documentIds: requestedDocumentIds, attachments: attachmentSnapshot, versions: [], status: activeAttachments.length ? `正在解析 ${activeAttachments.length} 个附件` : '正在准备回答' }]);
    }
    let timedOut = false;
    try {
      const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(15000, Number(modelSettings.timeoutMs) || 120000) + 10000);
      try {
        const response = await fetch('/api/chat/stream', {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({
            query: text,
            question: text,
            conversationId: chatConversationId || undefined,
            knowledgeBaseId: selectedKb,
            documentIds: requestedDocumentIds,
            attachments: activeAttachments.map(item => ({ temporaryId: item.temporaryId })),
            includeKnowledgeBase: activeAttachments.length ? chatIncludeKnowledgeBase : true,
            model: modelSettings.defaultModel || modelSettings.model || undefined,
            provider: modelSettings.provider
          })
        });
        if (!response.ok) throw new Error(`请求模型失败（HTTP ${response.status}）`);
        let completedConversationId = '';
        let streamError = null;
        let streamDone = false;
        await readNdjson(response, event => {
          if (event.type === 'done') { completedConversationId = event.conversationId || ''; setChatConversationId(completedConversationId); streamDone = true; }
          if (event.type === 'error') streamError = new Error(errText(event.error, '模型生成失败，请检查模型连接设置'));
          setMessages(current => current.map(message => {
            if (message.id !== assistantId) return message;
            if (event.type === 'start') return { ...message, status: event.attachmentCount ? `正在读取 ${event.attachmentCount} 个附件` : '正在连接模型' };
            if (event.type === 'retrieval') {
              const selectedCount = Number(event.scope?.documents?.length || 0);
              const status = selectedCount
                ? event.matchCount ? `已读取选中的 ${selectedCount} 篇资料，找到 ${event.matchCount} 条相关内容` : `已读取选中的 ${selectedCount} 篇资料，未找到直接匹配片段`
                : event.mode === 'conversation' ? '正在直接交给模型' : event.matchCount ? `找到 ${event.matchCount} 条相关内容，正在交给模型` : '没有匹配资料，正在由模型直接回答';
              return { ...message, status, citations: event.citations || message.citations, scopeContext: event.scopeContext || message.scopeContext };
            }
            if (event.type === 'model') return { ...message, status: event.model ? `正在调用 ${event.model}` : '模型正在生成答案' };
            if (event.type === 'model-required') return { ...message, status: '', needsModelSetup: true, text: event.message || message.text };
            if (event.type === 'delta') return { ...message, status: '', text: message.text + (event.delta || '') };
            if (event.type === 'error') return { ...message, status: '', error: errText(event.error, '模型生成失败，请检查模型连接设置'), text: message.text };
            if (event.type === 'done') return { ...message, status: '', text: event.answer || message.text, citations: event.citations || message.citations, relations: event.relations || message.relations, scopeContext: event.scopeContext || message.scopeContext, conversationId: event.conversationId || '', question: event.question || text, done: true };
            return message;
          }));
        }, controller.signal);
        if (streamError) throw streamError;
        if (!streamDone) throw new Error('模型响应中断，请重试');
        if (completedConversationId) {
          const conversationData = await fetch('/api/conversations').then(parseResponse).catch(() => null);
          if (conversationData?.conversations) setState(current => ({ ...current, conversations: conversationData.conversations }));
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      if (error.name === 'AbortError' && !timedOut) {
        setMessages(current => current.map(message => message.id === assistantId ? { ...message, status: '', stopped: true, text: message.text || '生成已停止。' } : message));
      } else {
        const message = timedOut ? '模型响应超时，请检查模型连接或降低上下文范围后重试' : errText(error, '生成失败，请重试');
        setChatError(message);
        setMessages(current => current.map(item => item.id === assistantId ? { ...item, status: '', error: message, text: item.text || '本次回答生成失败。' } : item));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
    }
  }

  async function runChatSkill(skillId, inputText = '') {
    const skill = skills.find(item => item.id === skillId);
    if (!skill || streaming) return;
    const input = String(inputText || '').trim();
    const taskDocumentIds = [...new Set([...selectedDocs, ...contextDocumentIds(workspaceContext)])];
    const userText = `/${skill.name}${input ? ` ${input}` : ''}`;
    const assistantId = `assistant-skill-${Date.now()}`;
    const taskId = `chat-skill-${Date.now()}`;
    const controller = new AbortController();
    abortRef.current = controller;
    setQuery('');
    setStreaming(true);
    setChatError('');
    setMessages(current => [...current, { role: 'user', text: userText, skillCommand: { id: skill.id, name: skill.name } }, { id: assistantId, role: 'assistant', text: '', citations: [], skill: { id: skill.id, name: skill.name }, status: '正在理解任务与准备材料' }]);
    dispatchWorkspace({ type: 'UPSERT_TASK', task: { id: taskId, type: 'skill', skillId: skill.id, documentIds: taskDocumentIds, title: `${skill.name} · 对话运行`, detail: input || '基于当前上下文执行', status: 'running', progress: 0.08, createdAt: new Date().toISOString() } });
    try {
      const response = await fetch('/api/skills/run', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ skillId: skill.id, input, query: input, knowledgeBaseId: selectedKb, documentIds: taskDocumentIds, selection: workspaceContext.selection || null }) });
      let completedRun = null;
      await readNdjson(response, event => {
        setMessages(current => current.map(message => {
          if (message.id !== assistantId) return message;
          if (event.type === 'start') return { ...message, runId: event.runId || message.runId, status: '已启动 Skill 工作流' };
          if (event.type === 'step') return { ...message, status: event.detail || event.name || event.label || `正在执行步骤 ${event.step || ''}` };
          if (event.type === 'model') return { ...message, status: `正在调用 ${event.model || event.provider || '默认模型'}` };
          if (event.type === 'model-delta') return { ...message, status: '正在生成产物', text: message.text + (event.delta || '') };
          if (event.type === 'model-fallback') return { ...message, status: '远端模型波动，已继续使用本地工作流' };
          if (event.type === 'artifact') {
            const artifact = event.artifact || {};
            const citations = (artifact.sourceRefs || []).map((ref, index) => ({ id: `skill-ref-${index}`, documentId: ref.documentId || ref.sourceId, title: ref.title || '来源文档', anchor: ref.anchor || null, snippet: ref.snippet || ref.excerpt || '' })).filter(item => item.documentId || item.title);
            return { ...message, status: '', text: artifact.content || event.content || message.text, citations, artifact };
          }
          if (event.type === 'done') {
            completedRun = event.result ? { id: event.runId, ...event.result } : completedRun;
            const artifact = event.result?.artifact || message.artifact || {};
            const citations = message.citations?.length ? message.citations : (artifact.sourceRefs || []).map((ref, index) => ({ id: `skill-ref-${index}`, documentId: ref.documentId || ref.sourceId, title: ref.title || '来源文档', anchor: ref.anchor || null, snippet: ref.snippet || ref.excerpt || '' }));
            return { ...message, status: '', text: artifact.content || message.text || '工作流已完成。', citations, artifact, done: true, completedAt: event.completedAt || new Date().toISOString() };
          }
          if (event.type === 'error') return { ...message, status: '', error: errText(event.error, 'Skill 执行失败'), text: message.text || '本次 Skill 运行失败。' };
          return message;
        }));
      }, controller.signal);
      if (completedRun) setSkillRuns(current => [{ ...completedRun, skillId: skill.id, title: skill.name }, ...current.filter(item => item.id !== completedRun.id)]);
      dispatchWorkspace({ type: 'UPDATE_TASK', taskId, patch: { status: 'completed', progress: 1, detail: '产物已保留在对话与 Skill 记录', updatedAt: new Date().toISOString() } });
    } catch (error) {
      const message = errText(error, 'Skill 执行失败');
      if (error.name === 'AbortError') setMessages(current => current.map(item => item.id === assistantId ? { ...item, status: '', stopped: true, text: item.text || '已停止 Skill 运行。' } : item));
      else {
        setChatError(message);
        setMessages(current => current.map(item => item.id === assistantId ? { ...item, status: '', error: message, text: item.text || '本次 Skill 运行失败。' } : item));
      }
      dispatchWorkspace({ type: 'UPDATE_TASK', taskId, patch: { status: 'failed', detail: message, updatedAt: new Date().toISOString() } });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
    }
  }

  function regenerateAnswer(message) {
    const prompt = message?.question || [...messages].reverse().find(item => item.role === 'user')?.text || '';
    if (prompt && message?.id) ask(prompt, message.documentIds || selectedDocs, message.id, message.attachments || chatAttachments);
  }

  function retryLast() {
    const last = [...messages].reverse().find(message => message.role === 'user');
    if (last) ask(last.text, last.documentIds || selectedDocs, '', last.attachments || chatAttachments);
  }

  function startNewConversation() {
    stopGeneration();
    void clearChatAttachments();
    setChatConversationId('');
    setSelectedDocs([]);
    setMessages([{ role: 'assistant', text: '新对话已就绪。把你正在做的事说给我听，我会帮你找材料、理思路并落到可继续编辑的结果。' }]);
    setHistoryOpen(false);
    setChatError('');
  }

  function restoreConversation(conversation) {
    void clearChatAttachments();
    let lastQuestion = '';
    const restored = (conversation?.messages || []).map((item, index) => {
      if (item.role === 'user') {
        lastQuestion = item.content || item.text || '';
        return { id: item.id || `user-${index}`, role: 'user', text: lastQuestion };
      }
      return { id: item.id || `assistant-${index}`, role: 'assistant', text: item.content || item.text || '', citations: item.citations || [], relations: item.relations, question: lastQuestion, conversationId: conversation.id, done: true };
    });
    setMessages(restored.length ? restored : [{ role: 'assistant', text: conversation.answer || '该会话暂无可恢复的消息。', citations: conversation.citations || [], relations: conversation.relations, question: conversation.question, done: true }]);
    setChatConversationId(conversation.id || '');
    setHistoryOpen(false);
  }
  async function requestGraphSnapshot({ reuseInFlight = true } = {}) {
    if (reuseInFlight && graphLoadRef.current) return graphLoadRef.current;
    setGraphLoading(true);
    const request = Promise.all([
      fetch('/api/notes').then(parseResponse),
      fetch('/api/graph?suggestions=true').then(parseResponse)
    ]).then(([notesData, graphResponse]) => {
      setGraphNotes(Array.isArray(notesData.notes) ? notesData.notes.filter(note => !note.deletedAt) : []);
      const graph = graphResponse.graph || EMPTY_INDEXED_GRAPH;
      setGraphData(graph);
      return graph;
    }).finally(() => {
      if (graphLoadRef.current === request) {
        graphLoadRef.current = null;
        setGraphLoading(false);
      }
    });
    graphLoadRef.current = request;
    return request;
  }

  async function openKnowledgeGraph() {
    void preloadWorkspaceSurface('knowledge-graph');
    setReaderDetail(null);
    setActive('knowledge');
    try {
      await requestGraphSnapshot();
      setGraphOpen(false);
      openWorkspaceModule('graph');
    } catch (error) { notify(errText(error, '知识图谱加载失败'), 'error'); }
  }

  async function refreshGraphData() {
    return requestGraphSnapshot({ reuseInFlight: false });
  }

  async function confirmGraphSuggestion(suggestion) {
    if (!suggestion?.id) return;
    try {
      const data = await fetch(`/api/graph/suggestions/${encodeURIComponent(suggestion.id)}/decision`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved: true })
      }).then(parseResponse);
      const graphResponse = await fetch('/api/graph?suggestions=true').then(parseResponse);
      setGraphData(graphResponse.graph || null);
      notify(data.requiresExplicitWrite ? '建议已确认；请通过确认写入将显式链接加入笔记' : '建议已确认');
    } catch (error) { notify(errText(error, '确认图谱建议失败'), 'error'); }
  }

  function openGraphNote(note) {
    setGraphOpen(false);
    openCreatedWorkspaceNote({ id: String(note?.id || note?.sourceId || ''), title: note?.title || note?.label || '笔记', updatedAt: new Date().toISOString() }, { summary: '从知识图谱打开' });
  }
  async function openContentReader(documentOrId) {
    void preloadWorkspaceSurface('content-reader');
    const hint = typeof documentOrId === 'object' ? documentOrId : null;
    setReaderAnchor(String(hint?.anchor || hint?.sourceAnchor || hint?.location?.anchor || hint?.sourceRefs?.[0]?.anchor || ''));
    const documentId = String(typeof documentOrId === 'string' ? documentOrId : documentOrId?.documentId || documentOrId?.id || '');
    if (!documentId) return;
    setGraphOpen(false);
    setActive('knowledge');
    try {
      const data = await loadWorkspaceDocument(documentId);
      const item = data?.item || hint || { id: documentId };
      dispatchWorkspace({ type: 'OPEN_TAB', tab: { id: `document-${documentId}`, kind: 'document', type: 'document', route: 'knowledge', resourceId: documentId, title: item.title || hint?.title || '文档', source: item.sourceType || item.source || item.metadata?.source || '知识库', openedAt: Date.now(), lastActiveAt: Date.now() } });
      dispatchWorkspace({ type: 'TOUCH_RECENT_WORK', item: { id: `recent-document-${documentId}`, kind: 'document', type: 'document', resourceId: documentId, documentId, title: item.title || '文档', summary: String(item.content || '').slice(0, 80), updatedAt: new Date().toISOString() } });
      dispatchWorkspace({ type: 'ADD_AI_CONTEXT_ITEM', item: { id: `context-document-${documentId}`, kind: 'document', type: 'document', sourceId: documentId, documentId, title: item.title || '文档', source: item.sourceType || item.source || '知识库' } });
    } catch (error) {
      notify(errText(error, '文档打开失败'), 'error');
    }
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
      const sourceRef = { documentId: item?.id, title: item?.title, url: sourceUrl, ...(selection?.anchor ? { anchor: selection.anchor } : {}), ...(quote ? { quote, selection: true, startOffset: selection?.startOffset, endOffset: selection?.endOffset } : {}) };
      const data = await fetch('/api/notes', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: `${item?.title || '来源文档'} · ${quote ? '选区笔记' : '阅读笔记'}`,
          content: quote ? `# ${item?.title || '来源文档'}\n\n## 当前选区\n\n> ${quote.replace(/\n/g, '\n> ')}\n\n## 我的理解\n\n\n\n## 行动项\n\n- [ ] \n` : `# ${item?.title || '来源文档'}\n\n## 摘要\n\n\n\n## 关键观点\n\n- \n\n## 行动项\n\n- [ ] \n`,
          tags: quote ? ['来源笔记', '选区笔记'] : ['来源笔记'],
          sourceRefs: [sourceRef]
        })
      }).then(parseResponse);
      const note = openCreatedWorkspaceNote(data.note, { sourceDocumentId: item?.id, summary: quote ? '基于阅读选区创建' : '来源笔记' });
      notify(`已创建来源笔记：${note.title || item?.title || ''}`);
    } catch (error) { notify(errText(error, '来源笔记创建失败'), 'error'); }
  }

  async function openRelatedDocument(document) {
    const documentId = String(document?.documentId || document?.id || '');
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
          relations: message.relations || {}
        })
      }).then(parseResponse);
      if (normalizedKind === 'chart' && data.artifact) {
        setMessages(current => {
          let matched = false;
          const next = current.map(item => {
            const sameMessage = (message.id && item.id === message.id) || (message.question && item.question === message.question && item.role === 'assistant') || (message.text && item.text === message.text && item.role === 'assistant');
            if (!sameMessage) return item;
            matched = true;
            return { ...item, chartArtifact: data.artifact };
          });
          if (!matched) {
            const index = next.map(item => item.role).lastIndexOf('assistant');
            if (index >= 0) next[index] = { ...next[index], chartArtifact: data.artifact };
          }
          return next;
        });
        notify('\u8bc1\u636e\u56fe\u8868\u5df2\u751f\u6210\uff0c\u6765\u6e90\u951a\u70b9\u5df2\u4fdd\u7559');
      } else {
        openWorkspaceModule(data.workspace === 'writing' ? 'writing' : 'notes');
        notify(normalizedKind === 'writing' ? '写作草稿已创建并打开' : normalizedKind === 'task' ? '任务已创建并打开' : '知识笔记已创建并打开');
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
      defaultModel: modelForm.provider === 'azure-openai' ? (modelForm.azureDeployment || modelForm.defaultModel || modelForm.model) : (modelForm.defaultModel || modelForm.model), timeoutMs: Math.max(5000, Number(modelForm.timeoutMs) || 120000), retries: Math.max(0, Math.min(5, Number(modelForm.retries) || 0)), retryDelayMs: Math.max(100, Number(modelForm.retryDelayMs) || 500), temperature: Math.max(0, Math.min(2, Number(modelForm.temperature) || 0)), maxTokens: Math.max(128, Number(modelForm.maxTokens) || 4096), fallbackToLocal: modelForm.fallbackToLocal !== false, extraHeaders,
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
    if (['home', 'knowledge', 'graph', 'analysis', 'skills', 'notes', 'writing', 'recording', 'copilots', 'settings'].includes(id)) openWorkspaceModule(id);
    else notify('该模块将在后续工作台版本中开放', 'info');
  }

  function renderWorkspaceTab(tab) {
    const route = tab?.route || (tab?.kind === 'document' || tab?.kind === 'chat' ? 'knowledge' : tab?.kind);
    if (route === 'graph') return <div className="workspace-tab-frame workspace-tab-frame-single"><Suspense fallback={<WorkspaceRouteFallback label="知识图谱"/>}><KnowledgeGraph documents={state.documents || []} notes={graphNotes} graph={graphData || EMPTY_INDEXED_GRAPH} loading={graphLoading} onOpenDocument={openContentReader} onOpenNote={openGraphNote} onAskNode={handleKnowledgeObservationAsk} onCreateNote={node => writeSourceNote(node.raw || { id: node.sourceId, title: node.label })} onConfirmSuggestion={confirmGraphSuggestion} onRefreshGraph={refreshGraphData} onClose={() => closeWorkspaceTab(tab)}/></Suspense></div>;
    if (route === 'knowledge') {
      const showDocument = tab?.kind === 'document';
      return <div className="workspace-tab-frame">
        <KnowledgeSidebar state={state} selectedKb={selectedKb} setSelectedKb={setSelectedKb} docs={docs} selectedDocs={selectedDocs} setSelectedDocs={setSelectedDocs} setShowSync={setShowSync} onOpenDocument={openContentReader} onOpenGraph={openKnowledgeGraph} libraries={knowledgeLibraries} libraryFilter={knowledgeLibraryFilter} setLibraryFilter={setKnowledgeLibraryFilter} libraryBusy={knowledgeLibraryBusy} onRefreshLibraries={() => loadKnowledgeLibraries({ refresh: true })} onFollowLibrary={followKnowledgeLibrary} onSelectLibrary={selectKnowledgeLibrary}/>
        {graphOpen ? <Suspense fallback={<WorkspaceRouteFallback label="知识图谱"/>}><KnowledgeGraph documents={state.documents || []} notes={graphNotes} graph={graphData || EMPTY_INDEXED_GRAPH} loading={graphLoading} onOpenDocument={openContentReader} onOpenNote={openGraphNote} onAskNode={handleKnowledgeObservationAsk} onCreateNote={node => writeSourceNote(node.raw || { id: node.sourceId, title: node.label })} onConfirmSuggestion={confirmGraphSuggestion} onRefreshGraph={refreshGraphData} onClose={() => setGraphOpen(false)}/></Suspense> : showDocument && readerBusy ? <main className="workspace reader-loading"><LoaderCircle className="spin" size={26}/><span>正在恢复文档…</span></main> : showDocument && readerDetail?.item ? <Suspense fallback={<WorkspaceRouteFallback label="文档"/>}><ContentReader item={readerDetail.item} attachments={readerDetail.attachments || []} inQuestionScope={selectedDocs.includes(readerDetail.item.id)} onToggleQuestionScope={toggleReaderQuestionScope} onAsk={(prompt, selection) => handleReaderAsk(prompt, readerDetail.item, selection)} onCreateWriting={selection => handleReaderCreateWriting(readerDetail.item, selection)} onRunInterpretation={(kind, selection, force) => handleReaderInterpretation(kind, readerDetail.item, selection, force)} interpretationRuns={runs.filter(run => ["mind-map", "quiz"].includes(run.skillId) && (run.documentIds || run.input?.documentIds || []).map(String).includes(String(readerDetail.item.id)))} onWriteSourceNote={writeSourceNote} onSelectionChange={handleReaderSelection} onReadingPositionChange={position => handleReaderPosition(position, readerDetail.item)} onAnchorChange={anchor => setReaderAnchor(anchor)} initialAnchor={readerAnchor} initialReadingPosition={workspaceSession.readingPositions[readerDetail.item.id]} onClose={() => closeWorkspaceTab(tab)}/></Suspense> : <ChatWorkspace kb={kb} selectedDocs={selectedDocs} setSelectedDocs={setSelectedDocs} messages={messages} setMessages={setMessages} query={query} setQuery={setQuery} ask={ask} streaming={streaming} stopGeneration={stopGeneration} retryLast={retryLast} onRegenerate={regenerateAnswer} chatError={chatError} modelSettings={modelSettings} openModelDrawer={openModelDrawer} skills={skills} runSkill={runSkill} runChatSkill={runChatSkill} historyOpen={historyOpen} setHistoryOpen={setHistoryOpen} conversations={state.conversations || []} onNewConversation={startNewConversation} onRestoreConversation={restoreConversation} onOpenDocument={openRelatedDocument} onCreateArtifact={createAnswerArtifact} artifactBusy={artifactBusy} endRef={endRef} attachments={chatAttachments} attachmentBusy={chatAttachmentBusy} attachmentCapabilities={chatAttachmentCapabilities} onAddAttachments={addChatAttachments} onRemoveAttachment={removeChatAttachment} onRetryAttachment={retryChatAttachment} documents={docs} workspaceContext={workspaceContext} onOpenModule={selectNavigation} includeKnowledgeBase={chatIncludeKnowledgeBase} onIncludeKnowledgeBaseChange={setChatIncludeKnowledgeBase} onToast={notify} agentMode={agentMode} setAgentMode={setAgentMode} onConfirmAgentWrite={confirmAgentWrite}/>}
      </div>;
    }
    if (route === 'analysis') return <div className="workspace-tab-frame"><Suspense fallback={<WorkspaceRouteFallback label="文档分析"/>}><DocumentAnalysisModule onToast={notify}/></Suspense></div>;
    if (route === 'skills') return <div className="workspace-tab-frame"><SkillSidebar skills={skills} selectedSkill={selectedSkill} setSelectedSkill={setSelectedSkill} runs={runs} onSelectRun={setSkillRun}/><SkillWorkspace skill={activeSkill} topic={skillTopic} setTopic={setSkillTopic} runSkill={runSkill} run={skillRun} selectedCount={selectedDocs.length} documentCount={docs.length} runs={runs} onSelectRun={setSkillRun} onOpenDocument={openContentReader}/></div>;
    if (route === 'notes') return <div className="workspace-tab-frame"><Suspense fallback={<WorkspaceRouteFallback label="笔记"/>}><NotesModule onToast={notify} onOpenDocument={openContentReader} initialNoteId={tab?.noteId || noteDeepLinkId}/></Suspense></div>;
    if (route === 'writing') return <div className="workspace-tab-frame"><Suspense fallback={<WorkspaceRouteFallback label="写作台"/>}><WritingModule onToast={notify} initialDraftId={tab?.draftId || writingDeepLinkId} onOpenDocument={openContentReader}/></Suspense></div>;
    if (route === 'recording') return <div className="workspace-tab-frame workspace-tab-frame-single"><Suspense fallback={<WorkspaceRouteFallback label="录音纪要"/>}><RecordingWorkspace initialSession={recordingSession} onSessionChange={setRecordingSession} onImportAudio={importRecordedAudio} onOpenDocument={openContentReader}/></Suspense></div>;
    if (route === 'copilots') return <div className="workspace-tab-frame"><Suspense fallback={<WorkspaceRouteFallback label="Copilot"/>}><CopilotModule skills={skills} onToast={notify}/></Suspense></div>;
    if (route === 'settings') return <div className="workspace-tab-frame"><Suspense fallback={<WorkspaceRouteFallback label="设置"/>}><SettingsExperienceSidebar activeSection={settingsSection} onSectionChange={setSettingsSection} modelSettings={modelSettings}/><SettingsExperienceWorkspace activeSection={settingsSection} modelSettings={modelSettings} provider={providerById(modelSettings.provider)} onManageModels={openModelDrawer} onOpenFeishuWizard={openFeishuExperience} onToast={notify}/></Suspense></div>;
    return null;
  }

  return <div className="app-shell app-shell-v3">
    <UnifiedWorkspace
      compact={workspaceCompact}
      activeSection={active}
      recentItems={workspaceRecentItems}

      tabs={workspaceSession.tabs.map(tab => ({ ...tab, type: tab.type || tab.kind }))}
      activeTabId={workspaceSession.activeTabId}
      tasks={[...visibleWorkspaceTasks].reverse()}
      context={workspaceContext}
      renderActiveTab={renderWorkspaceTab}
      onPrefetch={route => { void preloadWorkspaceRoute(route); }}
      onOpenRecent={handleOpenRecent}
      onActivateTab={activateWorkspaceTab}
      onCloseTab={closeWorkspaceTab}
      onNewTab={() => { startNewConversation(); dispatchWorkspace({ type: 'OPEN_TAB', tab: { id: `chat-${Date.now()}`, kind: 'chat', type: 'chat', route: 'knowledge', title: '新对话', openedAt: Date.now(), lastActiveAt: Date.now() } }); }}
      onSearch={handleWorkspaceSearch}
      onAsk={handleWorkspaceAsk}
      onCollect={() => { void preloadWorkspaceSurface('collection'); setCollectionOpen(true); }}
      onCreateNote={handleWorkspaceCreateNote}
      onCreateWriting={handleWorkspaceCreateWriting}
      onRunSkill={handleWorkspaceRunSkill}
      onNavigate={selectNavigation}
      onOpenTask={handleOpenTask}
      onRetryTask={handleRetryTask}
      onAttachContext={handleAttachContext}
      onRemoveContext={handleRemoveContext}
      onClearSelection={() => { const selection = workspaceSession.aiContextItems.find(item => item.kind === 'selection'); if (selection) dispatchWorkspace({ type: 'REMOVE_AI_CONTEXT_ITEM', id: selection.id }); }}
      onToggleCompact={setWorkspaceCompact}
    />

    {collectionOpen && <Suspense fallback={<WorkspaceRouteFallback label="收集中心" overlay/>}><CollectionCenter open={collectionOpen} onClose={() => setCollectionOpen(false)} onOpenFeishu={openFeishuExperience} onImportFiles={importCollectionFiles} onImportText={importCollectionText} onOpenLibrary={() => { setCollectionOpen(false); openWorkspaceModule('knowledge'); }}/></Suspense>}
    {showSync && <Suspense fallback={<WorkspaceRouteFallback label="飞书同步" overlay/>}><FeishuSyncWizard onClose={() => setShowSync(false)} onState={next => { setState(next); setSelectedKb(next.settings?.activeKnowledgeBaseId || next.knowledgeBases?.[0]?.id || 'feishu-space'); refreshContentItems().catch(error => notify(errText(error, '同步完成但内容列表刷新失败'), 'error')); }} onToast={notify} currentSync={state.sync}/></Suspense>}
    {modelDrawerOpen && <ModelDrawer form={modelForm} setForm={setModelForm} provider={providerById(modelForm.provider)} updateProvider={updateProvider} models={modelOptions} busy={modelBusy} showApiKey={showApiKey} setShowApiKey={setShowApiKey} refreshModels={refreshModels} testModel={testModel} saveModel={saveModel} close={() => setModelDrawerOpen(false)}/>}
    {toast && <div className={`toast ${toast.kind || ''}`}>{toast.kind === 'error' ? <AlertCircle size={16}/> : <CircleCheck size={16}/>}<span>{toast.message}</span></div>}
  </div>;

}

function KnowledgeSidebar({ state, selectedKb, setSelectedKb, docs, selectedDocs, setSelectedDocs, setShowSync, onOpenDocument, onOpenGraph, libraries, libraryFilter, setLibraryFilter, libraryBusy, onRefreshLibraries, onFollowLibrary, onSelectLibrary }) {
  const [search, setSearch] = useState('');
  const allLibraries = Array.isArray(libraries) && libraries.length ? libraries : (state.knowledgeBases || []);
  const visibleLibraries = allLibraries.filter(item => libraryFilter === 'followed' ? item.followed : libraryFilter === 'shared' ? item.shared : true);
  const visibleDocs = docs.filter(doc => !search || `${doc.title} ${doc.content || ''}`.toLowerCase().includes(search.toLowerCase()));
  const visibilityLabel = item => item.visibility === 'tenant' ? '组织内共享' : item.shared ? '共享空间' : '本地';
  return <aside className="side-panel">
    <div className="side-head"><div><span>工作空间</span><h2>知识库</h2></div><div className="side-head-actions"><button onClick={onOpenGraph} title="打开知识观察"><Network size={17}/></button><button onClick={() => onRefreshLibraries?.()} disabled={libraryBusy} title="刷新共享库"><RefreshCw className={libraryBusy ? 'spin' : ''} size={17}/></button></div></div>
    <div className="search-box"><Search size={15}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索文档"/></div>
    <section className="side-section library-section">
      <div className="section-label"><span>知识空间</span><div className="section-actions"><button onClick={() => onRefreshLibraries?.()} disabled={libraryBusy} title="刷新共享库"><RefreshCw className={libraryBusy ? 'spin' : ''} size={13}/></button><button onClick={() => setShowSync(true)} title="同步内容"><Plus size={14}/></button></div></div>
      <div className="library-filter" role="tablist" aria-label="知识库筛选">{[['all','全部'],['followed','已关注'],['shared','共享']].map(([id,label]) => <button key={id} role="tab" aria-selected={libraryFilter === id} className={libraryFilter === id ? 'active' : ''} onClick={() => setLibraryFilter(id)}>{label}</button>)}</div>
      <div className="library-list">{visibleLibraries.length ? visibleLibraries.map(item => <div key={item.id} className={`kb-row ${selectedKb === item.id ? 'active' : ''}`}>
        <button type="button" className="kb-select" onClick={() => onSelectLibrary?.(item)}><span className="kb-icon">{item.shared ? <Globe2 size={16}/> : <BookOpen size={16}/>}</span><span><b>{item.name}</b><small>{item.documentCount ?? 0} 篇文档 · {visibilityLabel(item)}</small></span></button>
        <button type="button" className={`kb-follow ${item.followed ? 'active' : ''}`} aria-label={item.followed ? `取消关注：${item.name}` : `关注：${item.name}`} aria-pressed={item.followed} disabled={libraryBusy} onClick={() => onFollowLibrary?.(item, !item.followed)}><Bookmark size={15} fill={item.followed ? 'currentColor' : 'none'}/></button>
      </div>) : <div className="library-empty"><p>{libraryFilter === 'followed' ? '还没有关注的知识库' : libraryFilter === 'shared' ? '还没有发现共享知识库' : '还没有知识库'}</p><small>点击刷新共享库，或同步飞书内容</small></div>}</div>
    </section>
    <section className="side-section document-section"><div className="section-label"><span>文档</span><em>{selectedDocs.length ? `已选 ${selectedDocs.length}` : visibleDocs.length}</em></div><div className="document-list">
      {visibleDocs.length ? visibleDocs.map(doc => <div key={doc.id} className={`doc-row ${selectedDocs.includes(doc.id) ? 'selected' : ''}`}><button type="button" className="doc-open" onClick={() => onOpenDocument?.(doc)}><FileText size={16}/><span><b>{doc.title}</b><small>{doc.updatedAt ? formatDate(doc.updatedAt) : '已同步'}</small></span></button><button type="button" className="doc-scope-toggle" aria-label={selectedDocs.includes(doc.id) ? `移出问答范围：${doc.title}` : `加入问答范围：${doc.title}`} aria-pressed={selectedDocs.includes(doc.id)} onClick={() => setSelectedDocs(current => current.includes(doc.id) ? current.filter(id => id !== doc.id) : [...current, doc.id])}>{selectedDocs.includes(doc.id) ? <CircleCheck className="checked" size={17}/> : <Plus size={15}/>}</button></div>) : <div className="empty-side"><Database size={24}/><p>还没有文档</p><small>同步飞书或从收集中心导入内容</small></div>}
    </div></section>
  </aside>;
}

function ChatWorkspace({ kb, selectedDocs, setSelectedDocs, messages, setMessages, query, setQuery, ask, streaming, stopGeneration, retryLast, onRegenerate, chatError, modelSettings, openModelDrawer, skills, runSkill, runChatSkill, historyOpen, setHistoryOpen, conversations, onNewConversation, onRestoreConversation, onOpenDocument, onCreateArtifact, artifactBusy, endRef, attachments, attachmentBusy, attachmentCapabilities, onAddAttachments, onRemoveAttachment, onRetryAttachment, documents, workspaceContext, onOpenModule, includeKnowledgeBase, onIncludeKnowledgeBaseChange, onToast, agentMode = 'chat', setAgentMode, onConfirmAgentWrite }) {
  const fileInputRef = useRef(null);
  const composerInputRef = useRef(null);
  const [composerCaret, setComposerCaret] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [activeComposerSkill, setActiveComposerSkill] = useState(null);
  const [composerMentions, setComposerMentions] = useState([]);
  const [preview, setPreview] = useState(null);
  const [voiceState, setVoiceState] = useState('idle');
  const voiceRecognitionRef = useRef(null);
  useEffect(() => () => { voiceRecognitionRef.current?.abort?.(); }, []);
  const accepted = (attachmentCapabilities?.acceptedExtensions || []).map(extension => `.${String(extension).replace(/^\./, '')}`).join(',');
  const readyCount = attachments.filter(item => item.status === 'ready').length;
  const canSend = Boolean(query.trim() || readyCount || activeComposerSkill) && !attachmentBusy;
  const composerTrigger = detectComposerTrigger(query, composerCaret);
  const composerMenuOpen = Boolean(composerTrigger) && !menuDismissed && !streaming;
  const composerGroups = useMemo(() => {
    if (composerTrigger?.mode === 'slash') return [
      { id: 'skills', kind: 'skills', label: '可用 Skills', items: skills.map(skill => ({ id: `skill-${skill.id}`, type: 'skill', skill, label: skill.name, description: skill.description, badge: 'Skill', keywords: [skill.id, ...(skill.steps || [])], icon: 'skill' })) },
      { id: 'actions', kind: 'actions', label: '常用动作', items: [
        { id: 'action-add-file', type: 'action', action: 'add-file', label: '添加文件或截图', description: '上传后直接问答、总结或写入笔记', icon: 'attachment' },
        { id: 'action-analysis', type: 'action', action: 'analysis', label: '文档解读', description: '进入文档分析工作台', icon: 'document' },
        { id: 'action-writing', type: 'action', action: 'writing', label: '智能写作', description: '基于当前材料继续创作', icon: 'note' },
        { id: 'action-recording', type: 'action', action: 'recording', label: '开始录音纪要', description: '录音、转写并生成可编辑纪要', icon: 'chat' },
        { id: 'action-new-chat', type: 'action', action: 'new-chat', label: '新对话', description: '清空临时上下文并开始新任务', icon: 'sparkles' }
      ] }
    ];
    const currentItems = [];
    if (workspaceContext?.selection?.text) currentItems.push({ id: 'context-selection', type: 'selection', label: '当前选中的文字', description: String(workspaceContext.selection.text).slice(0, 90), context: workspaceContext.selection, badge: '选区', icon: 'context' });
    if (workspaceContext?.currentDocument) currentItems.push({ id: `context-doc-${workspaceContext.currentDocument.documentId || workspaceContext.currentDocument.id}`, type: 'document', label: workspaceContext.currentDocument.title || '当前文档', description: '当前正在阅读的文档', document: workspaceContext.currentDocument, badge: '当前', icon: 'context' });
    for (const resource of workspaceContext?.resources || []) currentItems.push({ id: `context-resource-${resource.documentId || resource.id}`, type: 'document', label: resource.title || '上下文资料', description: resource.summary || resource.source || '已添加到 AI 上下文', document: resource, badge: '上下文', icon: 'context' });
    return [
      { id: 'current-context', kind: 'context', label: '当前上下文', items: currentItems },
      { id: 'attachments', kind: 'attachments', label: '已添加附件', items: attachments.map(item => ({ id: `attachment-${item.clientId}`, type: 'attachment', label: item.fileName, description: item.status === 'ready' ? '已解析，可直接提问' : item.status === 'error' ? item.error : '正在解析', attachment: item, badge: '附件', icon: 'attachment', disabled: item.status !== 'ready' })) },
      { id: 'documents', kind: 'documents', label: '知识库文档', items: (documents || []).slice(0, 160).map(document => ({ id: `document-${document.id}`, type: 'document', label: document.title, description: document.excerpt || document.source || document.contentType || '知识库文档', document, badge: selectedDocs.includes(document.id) ? '已选' : '', icon: 'document', keywords: [document.title, ...(document.tags || [])] })) }
    ];
  }, [attachments, composerTrigger?.mode, documents, selectedDocs, skills, workspaceContext]);
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
  function toggleComposerVoice() {
    if (voiceState === 'listening') {
      voiceRecognitionRef.current?.stop?.();
      return;
    }
    const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!Recognition) {
      onToast?.('\u5f53\u524d\u73af\u5883\u6ca1\u6709\u8bed\u97f3\u8bc6\u522b\u80fd\u529b\uff1b\u53ef\u4ece / \u83dc\u5355\u6253\u5f00\u5f55\u97f3\u7eaa\u8981\u540e\u5bfc\u5165\u97f3\u9891\u3002', 'info');
      onOpenModule?.('recording');
      return;
    }
    const recognition = new Recognition();
    const baseText = query.trim();
    let finalText = '';
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => setVoiceState('listening');
    recognition.onresult = event => {
      let interimText = '';
      for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
        const transcript = String(event.results[index][0]?.transcript || '').trim();
        if (event.results[index].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      const next = [baseText, finalText, interimText].filter(Boolean).join(baseText ? ' ' : '');
      setQuery(next);
      setComposerCaret(next.length);
    };
    recognition.onerror = event => {
      setVoiceState('error');
      onToast?.('\u8bed\u97f3\u8f93\u5165\u5931\u8d25\uff1a' + (event.error || '\u8bf7\u68c0\u67e5\u9ea6\u514b\u98ce\u6743\u9650\u540e\u91cd\u8bd5'), 'error');
    };
    recognition.onend = () => {
      setVoiceState('idle');
      voiceRecognitionRef.current = null;
      requestAnimationFrame(() => composerInputRef.current?.focus());
    };
    voiceRecognitionRef.current = recognition;
    try { recognition.start(); } catch (error) {
      voiceRecognitionRef.current = null;
      setVoiceState('error');
      onToast?.('\u8bed\u97f3\u8f93\u5165\u65e0\u6cd5\u542f\u52a8\uff1a' + (error.message || '\u8bf7\u91cd\u8bd5'), 'error');
    }
  }
  function submitComposer() {
    if (activeComposerSkill) { const skill = activeComposerSkill; setActiveComposerSkill(null); runChatSkill?.(skill.id, query); return; }
    const taskSkillId = composerTaskSkillId(query);
    if (taskSkillId && skills.some(skill => skill.id === taskSkillId)) { runChatSkill?.(taskSkillId, query); return; }
    ask();
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
  const openSkillPicker = () => {
    setQuery('/');
    setComposerCaret(1);
    setMenuDismissed(false);
    requestAnimationFrame(() => { composerInputRef.current?.focus(); composerInputRef.current?.setSelectionRange(1, 1); });
  };
  const region = preview?.citation?.region;
  const regionStyle = region ? {
    left: `${Math.max(0, Math.min(1, Number(region.x || 0))) * 100}%`,
    top: `${Math.max(0, Math.min(1, Number(region.y || 0))) * 100}%`,
    width: `${Math.max(0.01, Math.min(1, Number(region.width || 0.01))) * 100}%`,
    height: `${Math.max(0.01, Math.min(1, Number(region.height || 0.01))) * 100}%`
  } : null;

  return <main className="workspace chat-workspace">
    <header className="workspace-head"><div className="workspace-title"><span className="ai-avatar"><Sparkles size={19}/></span><div><strong>FlowMind AI</strong><small>{kb?.name || '当前知识库'} · 支持截图、文件与多文档连续问答</small></div></div><div className="head-actions"><button onClick={openModelDrawer}><Bot size={16}/><span className={`status-dot ${modelSettings.configured ? 'ok' : ''}`}/>{modelLabel(modelSettings)}<ChevronDown size={14}/></button><button onClick={onNewConversation}><Plus size={16}/>新会话</button><button onClick={() => setHistoryOpen(!historyOpen)} className={historyOpen ? 'active' : ''}><Clock3 size={16}/>历史</button></div></header>
    <div className="context-strip"><Tags size={15}/><span>上下文范围</span><b>{selectedDocs.length ? `已选 ${selectedDocs.length} 篇文档` : readyCount > 0 && !includeKnowledgeBase ? '仅当前附件' : '整个知识库'}</b>{readyCount > 0 && <em>+ {readyCount} 个临时附件</em>}{readyCount > 0 && !selectedDocs.length && <button type="button" className="attachment-scope-toggle" aria-pressed={includeKnowledgeBase} onClick={() => onIncludeKnowledgeBaseChange(!includeKnowledgeBase)}>{includeKnowledgeBase ? '附件 + 全库' : '仅附件'}</button>}{selectedDocs.length > 0 && <button onClick={() => setSelectedDocs([])}>恢复全部</button>}</div>
    <div className="workspace-body"><div className="messages">
      {!messages.some(message => message.role === 'user') && <section className="chat-welcome"><span className="chat-welcome-mark"><Sparkles size={22}/></span><div><h2>想先处理哪件事？</h2><p>不用先想好该用哪个功能。把材料、截图或目标放进来，我们一起往下做。</p></div><div className="chat-starters"><button type="button" onClick={() => setQuery('帮我读懂这份材料，先说结论，再说依据')}>读懂一份材料</button><button type="button" onClick={() => setQuery('把这些资料整理成清晰的方案和下一步')}>整理成可执行方案</button><button type="button" onClick={() => setQuery('找出这些文档之间的共识、冲突和关联')}>找知识之间的关联</button></div></section>}
      {messages.map((message, index) => <article key={message.id || index} className={`message ${message.role} ${message.relations ? 'deep-answer-message' : ''}`}>
        {message.role === 'assistant' && <div className="message-avatar"><Sparkles size={15}/></div>}
        <div className={`bubble ${message.error ? 'has-error' : ''} ${message.relations ? 'has-deep-answer' : ''}`}>
          {message.attachments?.length > 0 && message.role === 'user' && <div className="message-attachments">{message.attachments.map(item => <button key={item.clientId || item.temporaryId} type="button" onClick={() => item.previewUrl && setPreview({ attachment: item })}><Paperclip size={12}/>{item.fileName}</button>)}</div>}
          {message.skill && <div className="message-skill-pill"><Workflow size={13}/><b>{message.skill.name}</b><span>Skill</span></div>}
          {message.agent && <AgentExecutionPanel agent={message.agent} busy={artifactBusy.startsWith('agent:')} onConfirm={approved => onConfirmAgentWrite?.(message, approved)}/>} {message.status && <div className="thinking"><LoaderCircle size={14}/>{message.status}</div>}<div className={`message-text ${message.role === 'assistant' ? 'markdown-answer' : ''}`}>{message.role === 'assistant' && message.text ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{message.text}</ReactMarkdown> : message.text || (message.status ? '' : '…')}</div>
          {message.scopeContext?.selectedDocuments?.length > 0 && <ScopeEvidenceSummary scopeContext={message.scopeContext}/>}
          {message.artifact?.files?.length > 0 && <div className="message-artifact-files">{message.artifact.files.some(file => file.kind === 'audio') && <audio controls preload="metadata" src={message.artifact.files.find(file => file.kind === 'audio')?.downloadUrl}/>}<div>{message.artifact.files.map(file => <a key={file.downloadUrl} href={file.downloadUrl} download={file.fileName}><Download size={14}/><span>{artifactFileLabel(file)}</span><small>{file.fileName}</small></a>)}</div></div>}
          {message.stopped && <div className="message-state">已由你停止生成</div>}
          {message.error && <div className="message-error"><AlertCircle size={14}/><span>{message.error}</span><button onClick={retryLast}><RotateCcw size={13}/>重试</button></div>}
          {message.citations?.length > 0 && <div className="citations"><span>引用来源</span>{message.citations.map((citation, idx) => <button key={citation.id || citation.documentId || idx} onClick={() => openCitation(citation)}><Link2 size={13}/><b>[{idx + 1}]</b><span>{citation.title}</span>{(citation.snippet || citation.excerpt) && <small>{citation.snippet || citation.excerpt}</small>}</button>)}</div>}
          {message.done && <div className="answer-version-actions"><button type="button" disabled={streaming} onClick={() => onRegenerate?.(message)}><RotateCcw size={13}/>重新生成</button><span>版本 {(message.versions?.length || 0) + 1}</span></div>}
          {message.versions?.length > 0 && <details className="answer-versions"><summary>查看 {message.versions.length} 个历史版本</summary>{message.versions.map((version, versionIndex) => <article key={versionIndex}><b>版本 {versionIndex + 1}</b><p>{version.text}</p></article>)}</details>}
          {hasSubstantiveEvidenceAnalysis(message.relations) && <Suspense fallback={<WorkspaceRouteFallback label="深度答案"/>}><DeepAnswerPanel message={{ ...message.relations, plan: message.relations?.plan?.steps || message.relations?.plan, question: message.question, chartArtifact: message.chartArtifact }} busy={artifactBusy.startsWith(`${message.id || message.conversationId || 'answer'}:`) ? '创建工作产物' : false} onFollowUp={suggestion => ask(suggestion)} onOpenDocument={onOpenDocument} onCreateArtifact={kind => onCreateArtifact(kind, message)}/></Suspense>}
        </div>
      </article>)}
      {chatError && !messages.at(-1)?.error && <div className="inline-error"><AlertCircle size={15}/>{chatError}<button onClick={retryLast}>重试</button></div>}<div ref={endRef}/>
    </div>{historyOpen && <aside className="history-panel"><div className="history-head"><b>会话历史</b><button onClick={() => setHistoryOpen(false)}><X size={15}/></button></div>{conversations.length ? [...conversations].reverse().slice(0, 30).map(item => <button key={item.id} onClick={() => restoreFromHistory(item)}><MessageSquareText size={15}/><span><b>{item.question}</b><small>{formatDate(item.createdAt)}</small></span></button>) : <div className="history-empty"><History size={25}/><span>暂无历史会话</span></div>}</aside>}</div>
    <div className="composer-area">
      <div className={`composer ${attachmentBusy ? 'is-processing' : ''}`} onDragOver={event => event.preventDefault()} onDrop={handleDrop}>
        {composerMenuOpen && <Suspense fallback={<WorkspaceRouteFallback label="Skill 菜单"/>}><ComposerCommandMenu open={composerMenuOpen} mode={composerTrigger?.mode || 'slash'} query={composerTrigger?.query || ''} groups={composerGroups} inputRef={composerInputRef} onSelect={applyComposerMenuItem} onClose={closeComposerMenu} placement="above" maxHeight={390}/></Suspense>}
        {(activeComposerSkill || composerMentions.length > 0) && <div className="composer-context-chips">{activeComposerSkill && <span className="composer-context-chip skill"><Workflow size={13}/><b>{activeComposerSkill.name}</b><button type="button" aria-label="移除 Skill" onClick={() => setActiveComposerSkill(null)}><X size={12}/></button></span>}{composerMentions.map(mention => <span className="composer-context-chip" key={mention.documentId}><AtSign size={13}/><b>{mention.title}</b><button type="button" aria-label={`移除 ${mention.title}`} onClick={() => removeComposerMention(mention)}><X size={12}/></button></span>)}</div>}
        {attachments.length > 0 && <div className="attachment-tray" aria-label="已添加附件">{attachments.map(item => <div key={item.clientId} className={`attachment-chip ${item.status}`}><button type="button" className="attachment-open" onClick={() => item.previewUrl && setPreview({ attachment: item })}><span className="attachment-icon">{item.status === 'uploading' ? <LoaderCircle className="spin" size={15}/> : item.status === 'error' ? <AlertCircle size={15}/> : <Paperclip size={15}/>}</span><span><b>{item.fileName}</b><small>{item.status === 'uploading' ? '正在上传并解析…' : item.status === 'error' ? item.error : `${item.attachment?.searchable === false ? '已上传' : '可问答'} · ${attachmentSizeLabel(item.byteSize)}`}</small></span></button>{item.status === 'error' && <button type="button" className="attachment-retry" onClick={() => onRetryAttachment(item)}>重试</button>}<button type="button" className="attachment-remove" aria-label={`移除 ${item.fileName}`} onClick={() => onRemoveAttachment(item)}><X size={13}/></button></div>)}</div>}
        <textarea ref={composerInputRef} value={query} onChange={event => { setQuery(event.target.value); setComposerCaret(event.target.selectionStart || event.target.value.length); setMenuDismissed(false); }} onSelect={event => setComposerCaret(event.currentTarget.selectionStart || 0)} onKeyUp={event => setComposerCaret(event.currentTarget.selectionStart || 0)} onPaste={handlePaste} onKeyDown={event => { if (event.defaultPrevented) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitComposer(); } }} placeholder={activeComposerSkill ? `告诉 ${activeComposerSkill.name} 你想完成什么；留空则基于当前材料执行` : attachments.length ? '针对附件提问；输入 / 调 Skill，输入 @ 选文档' : '说说你想完成什么……输入 / 调 Skill，输入 @ 选文档'}/>
        <div className="agent-mode-control" role="group" aria-label="Agent 执行模式">{[
          ['chat', '问答', MessageSquareText], ['quick', '快答', Bot], ['research', '研究', Compass], ['write', '写入', FileText]
        ].map(([id, label, Icon]) => <button key={id} type="button" className={agentMode === id ? 'is-active' : ''} aria-pressed={agentMode === id} disabled={streaming} onClick={() => setAgentMode?.(id)} title={id === 'chat' ? '普通对话' : `${label} Agent 模式`}><Icon size={13}/><span>{label}</span></button>)}</div>
        <div className="composer-bottom"><div><input ref={fileInputRef} className="chat-file-input" type="file" multiple accept={accepted || undefined} onChange={pickFiles}/><button type="button" title="添加文件或截图" disabled={attachmentBusy || streaming} onClick={() => fileInputRef.current?.click()}><Plus size={17}/></button><button type="button" className="composer-skill-shortcut" onClick={openSkillPicker}><Workflow size={14}/>Skill</button><button type="button" className={`composer-voice-button ${voiceState === 'listening' ? 'is-listening' : ''}`} title={voiceState === 'listening' ? '\u505c\u6b62\u8bed\u97f3\u8f93\u5165' : '\u8bed\u97f3\u8f93\u5165'} aria-label={voiceState === 'listening' ? '\u505c\u6b62\u8bed\u97f3\u8f93\u5165' : '\u8bed\u97f3\u8f93\u5165'} disabled={attachmentBusy || streaming} onClick={toggleComposerVoice}>{voiceState === 'listening' ? <MicOff size={15}/> : <Mic size={15}/>}</button><span>{attachmentBusy ? '正在解析附件' : selectedDocs.length ? `${selectedDocs.length} 篇文档` : attachments.length ? `${readyCount}/${attachments.length} 个附件可用` : '全库'}</span><small className="composer-privacy">临时附件只用于当前会话</small></div>{streaming ? <button className="stop" onClick={stopGeneration}><Square size={15}/>停止</button> : <button className="send" disabled={!canSend} onClick={submitComposer}><Send size={17}/></button>}</div>
      </div>
      <small className="ai-note">拖入文件或粘贴截图 · 输入 / 调用 Skill · 输入 @ 选择文档</small>
    </div>
    {preview && <div className="attachment-preview-backdrop" onMouseDown={() => setPreview(null)}><section className="attachment-preview" onMouseDown={event => event.stopPropagation()}><header><div><Paperclip size={17}/><span><b>{preview.attachment.fileName}</b><small>{preview.citation?.anchor || preview.attachment.attachment?.contentType || preview.attachment.mimeType}</small></span></div><button type="button" onClick={() => setPreview(null)}><X size={17}/></button></header><div className="attachment-preview-body">{preview.attachment.mimeType?.startsWith('image/') ? <div className="attachment-image-stage"><img src={preview.attachment.previewUrl} alt={preview.attachment.fileName}/>{regionStyle && <span className="citation-region" style={regionStyle}/>}</div> : preview.attachment.mimeType === 'application/pdf' ? <iframe src={preview.attachment.previewUrl} title={preview.attachment.fileName}/> : <div className="attachment-preview-info"><FileText size={34}/><b>{preview.attachment.fileName}</b><span>文件内容已经完成解析，可继续在当前对话中追问、总结或转为笔记。</span></div>}</div>{preview.citation && <footer><b>引用片段</b><p>{preview.citation.snippet || preview.citation.excerpt || '已定位到附件中的相关内容。'}</p></footer>}</section></div>}
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

function AgentExecutionPanel({ agent, busy, onConfirm }) {
  const plan = Array.isArray(agent?.plan) ? agent.plan : [];
  const tools = Array.isArray(agent?.tools) ? agent.tools : [];
  const observations = Array.isArray(agent?.observations) ? agent.observations : [];
  const confirmation = agent?.confirmation;
  const scopedDocuments = Array.isArray(agent?.scope?.documents) ? agent.scope.documents : [];
  return <section className="agent-execution-panel" aria-label="Agent 执行记录">
    <header><span><Bot size={14}/>{agent?.mode || 'agent'} Agent</span>{agent?.runId && <small>{agent.runId.slice(-8)}</small>}</header>
    {scopedDocuments.length > 0 && <div className="agent-execution-scope"><Tags size={12}/><span><b>已带入 {scopedDocuments.length} 篇资料</b><small title={scopedDocuments.map(document => document.title).join('、')}>{scopedDocuments.map(document => document.title).join('、')}</small><small className="agent-execution-scope-meta">本地全文索引 {formatEvidenceChars(scopedDocuments.reduce((sum, document) => sum + (Number(document.contentChars) || 0), 0))} 字</small></span></div>}
    {plan.length > 0 && <ol>{plan.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}</ol>}
    {tools.length > 0 && <div className="agent-execution-tools">{tools.map((tool, index) => <span key={`${tool.tool}-${index}`} className={`is-${tool.status || 'queued'}`}>{tool.status === 'completed' ? <Check size={12}/> : tool.status === 'failed' ? <AlertCircle size={12}/> : <LoaderCircle size={12}/>} {tool.tool}</span>)}</div>}
    {observations.length > 0 && <small className="agent-execution-evidence">已记录 {observations.length} 条可核验证据</small>}
    {confirmation?.status === 'pending' && <div className="agent-confirmation"><b>写入提案待确认</b><code>{confirmation.proposal?.diff?.path || agent?.diff?.path || '受控工作区'}</code><div><button type="button" disabled={busy} onClick={() => onConfirm?.(true)}><Check size={13}/>确认写入</button><button type="button" disabled={busy} onClick={() => onConfirm?.(false)}><X size={13}/>拒绝</button></div></div>}
  </section>;
}

function SkillSidebar({ skills, selectedSkill, setSelectedSkill, runs, onSelectRun }) {
  return <aside className="side-panel skill-side"><div className="side-head"><div><span>自动化工作台</span><h2>Skills</h2></div><Sparkles size={18}/></div>
    <section className="side-section"><div className="section-label"><span>工作流</span><em>{skills.length}</em></div>{skills.map(skill => { const Icon = SKILL_ICONS[skill.id] || Workflow; return <button key={skill.id} className={`skill-nav-row ${selectedSkill === skill.id ? 'active' : ''}`} onClick={() => setSelectedSkill(skill.id)}><span><Icon size={16}/></span><div><b>{skill.name}</b><small>{skill.description}</small></div></button>; })}</section>
    <section className="side-section recent-runs"><div className="section-label"><span>最近运行</span><em>{runs.length}</em></div>{runs.slice(0, 8).map(run => <button key={run.id} onClick={() => onSelectRun(run)}><span className={`run-dot ${run.status === 'failed' || run.error ? 'failed' : ''}`}/><div><b>{run.title || skills.find(skill => skill.id === run.skillId)?.name || run.skillId}</b><small>{run.input?.query || run.topic || formatDate(run.startedAt)}</small></div></button>)}</section>
  </aside>;
}

function SkillWorkspace({ skill, topic, setTopic, runSkill, run, selectedCount, documentCount, runs, onSelectRun, onOpenDocument }) {
  const Icon = SKILL_ICONS[skill?.id] || Workflow;
  return <main className="workspace skill-workspace"><header className="workspace-head"><div className="workspace-title"><span className="ai-avatar"><Workflow size={19}/></span><div><strong>Skill 工作台</strong><small>组合知识检索与模型生成，产物自动保留</small></div></div><div className="head-actions"><button><History size={16}/>{runs.length} 次运行</button></div></header>
    <div className="skill-canvas"><section className="skill-hero"><div className="skill-hero-icon"><Icon size={27}/></div><div><span className="eyebrow">当前工作流</span><h1>{skill?.name}</h1><p>{skill?.description}</p></div></section>
      <section className="skill-launch-card"><label>任务主题</label><textarea value={topic} onChange={event => setTopic(event.target.value)} placeholder={skill?.inputHint || '输入需要研究、总结或对比的主题；留空则基于当前文档自动执行。'}/><div className="skill-scope"><Tags size={15}/><span>{selectedCount ? `使用已选 ${selectedCount} 篇文档` : `使用当前知识库 ${documentCount} 篇文档`}</span></div>
        <div className="planned-steps">{(skill?.steps || []).map((step, index) => <div key={step}><span>{index + 1}</span><b>{step}</b>{index < skill.steps.length - 1 && <i/>}</div>)}</div>
        <button className="primary-action" disabled={run?.running} onClick={() => runSkill(skill.id)}>{run?.running ? <LoaderCircle className="spin" size={17}/> : <Play size={17}/>} {run?.running ? '正在执行' : '运行 Skill'}</button>
      </section>{run && <SkillRunCard run={run} onOpenDocument={onOpenDocument}/>}<section className="run-records-panel"><div className="panel-title"><div><span className="eyebrow">History</span><h3>运行记录</h3></div><small>点击记录查看产物</small></div>{runs.length ? <div className="run-record-grid">{runs.slice(0, 12).map(item => <button key={item.id} onClick={() => onSelectRun(item)}><span className={`record-icon ${item.error ? 'failed' : ''}`}>{item.error ? <AlertCircle size={16}/> : <Check size={16}/>}</span><span><b>{item.title || item.artifact?.title || item.skillId}</b><small>{item.input?.query || item.topic || '未填写主题'}</small></span><time>{formatDate(item.completedAt || item.startedAt)}</time></button>)}</div> : <div className="empty-records"><History size={28}/><p>运行记录会显示在这里</p></div>}</section>
    </div>
  </main>;
}

function SkillRunCard({ run, onOpenDocument }) {
  const steps = run.steps || [];
  const artifact = run.artifact || run.result?.artifact || {};
  const output = run.output || artifact.content;
  const files = artifact.files || [];
  const sources = artifact.sourceRefs || artifact.references || [];
  return <section className={`skill-run-card ${run.error ? 'failed' : ''}`}><div className="run-title"><Workflow size={18}/><div><b>{run.title || artifact.title || run.skillId}</b><span>{run.running ? '正在执行工作流' : run.error ? '执行失败' : '工作流已完成'} · {formatDate(run.startedAt)}</span></div>{run.running && <LoaderCircle className="spin" size={17}/>}</div>{steps.length > 0 && <div className="run-steps">{steps.map((step, index) => <div key={`${step.label || step.name}-${index}`}><CircleCheck size={15}/><span><b>{step.label || step.name}</b>{step.detail && <small>{step.detail}</small>}</span></div>)}</div>}{run.error && <div className="run-error"><AlertCircle size={15}/>{errText(run.error)}</div>}{files.length > 0 && <div className="skill-artifact-files">{files.some(file => file.kind === 'audio') && <audio controls preload="metadata" src={files.find(file => file.kind === 'audio')?.downloadUrl}/>}<div>{files.map(file => <a key={file.downloadUrl} href={file.downloadUrl} download={file.fileName}><Download size={14}/><span>{artifactFileLabel(file)}</span><small>{file.fileName}</small></a>)}</div></div>}{output && <div className="run-output markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{output}</ReactMarkdown></div>}{sources.length > 0 && <div className="skill-artifact-sources"><span>来源材料</span>{sources.map((source, index) => <button key={source.documentId || index} type="button" onClick={() => onOpenDocument?.(source)}><Link2 size={13}/><b>[{index + 1}]</b><span>{source.title || '来源文档'}</span></button>)}</div>}</section>;
}
function ModelDrawer({ form, setForm, provider, updateProvider, models, busy, showApiKey, setShowApiKey, refreshModels, testModel, saveModel, close }) {
  const custom = form.provider === 'custom-http';
  const azure = form.provider === 'azure-openai';
  return <div className="drawer-backdrop" onMouseDown={close}><aside className="model-drawer" onMouseDown={event => event.stopPropagation()}><header><div><span className="eyebrow">Model Gateway</span><h2>模型管理</h2><p>兼容官方接口、第三方中转站与本地模型。</p></div><button onClick={close}><X size={20}/></button></header><div className="drawer-scroll">
    <FormSection number="1" title="Provider 类型" note="选择服务端采用的协议格式"><label className="field"><span>Provider</span><select value={form.provider} onChange={event => updateProvider(event.target.value)}>{PROVIDERS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{provider.hint}</small></label></FormSection>
    <FormSection number="2" title="连接信息" note="自定义中转地址与鉴权"><label className="field"><span>Base URL</span><input value={form.baseUrl} onChange={event => setForm(current => ({ ...current, baseUrl: event.target.value }))} placeholder={provider.url || 'https://your-gateway.example.com/v1'}/><small>可填写官方地址或第三方中转站 URL。</small></label>
      {provider.key && <label className="field"><span>API Key {form.hasApiKey && <em><Check size={12}/>服务端已有密钥</em>}</span><div className="password-input"><input type={showApiKey ? 'text' : 'password'} autoComplete="new-password" value={form.apiKey} onChange={event => setForm(current => ({ ...current, apiKey: event.target.value }))} placeholder={form.hasApiKey ? '留空则继续使用已保存的密钥' : '输入 API Key'}/><button type="button" onClick={() => setShowApiKey(!showApiKey)}>{showApiKey ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div><small>提交后输入框立即清空，页面不会回显服务端密钥。</small></label>}
      {azure && <div className="field-grid"><label className="field"><span>Deployment</span><input value={form.azureDeployment} onChange={event => setForm(current => ({ ...current, azureDeployment: event.target.value }))} placeholder="my-gpt-deployment"/></label><label className="field"><span>API Version</span><input value={form.azureApiVersion} onChange={event => setForm(current => ({ ...current, azureApiVersion: event.target.value }))}/></label></div>}
    </FormSection>
    <FormSection number="3" title="模型与默认项" note="刷新远端列表或手动输入"><label className="field"><span>默认模型</span><div className="model-picker"><input list="model-options" value={form.defaultModel || form.model} onChange={event => setForm(current => ({ ...current, model: event.target.value, defaultModel: event.target.value }))} placeholder="例如 gpt-4.1 / claude-sonnet / qwen-plus"/><datalist id="model-options">{models.map(model => <option key={model} value={model}/>)}</datalist><button type="button" onClick={refreshModels} disabled={Boolean(busy)}>{busy === 'models' ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>}刷新</button></div><small>{models.length ? `已发现 ${models.length} 个可用模型` : '支持手动输入中转站提供的模型 ID。'}</small></label><div className="field-grid"><label className="field"><span>请求超时（毫秒）</span><input type="number" min="5000" step="1000" value={form.timeoutMs} onChange={event => setForm(current => ({ ...current, timeoutMs: event.target.value }))}/></label><label className="field"><span>失败重试次数</span><input type="number" min="0" max="5" value={form.retries} onChange={event => setForm(current => ({ ...current, retries: event.target.value }))}/></label><label className="field"><span>重试基础间隔（毫秒）</span><input type="number" min="100" step="100" value={form.retryDelayMs} onChange={event => setForm(current => ({ ...current, retryDelayMs: event.target.value }))}/><small>仅对超时、限流和 5xx 错误执行指数退避重试。</small></label><label className="field"><span>Temperature</span><input type="number" min="0" max="2" step="0.1" value={form.temperature} onChange={event => setForm(current => ({ ...current, temperature: event.target.value }))}/></label><label className="field"><span>最大输出 Token</span><input type="number" min="128" step="128" value={form.maxTokens} onChange={event => setForm(current => ({ ...current, maxTokens: event.target.value }))}/></label><label className="field checkbox-field"><input type="checkbox" checked={form.fallbackToLocal !== false} onChange={event => setForm(current => ({ ...current, fallbackToLocal: event.target.checked }))}/><span>远端失败时自动使用本地检索/Skill 引擎</span></label></div></FormSection>
    {custom && <FormSection number="4" title="自定义协议映射" note="描述模型网关的端点与响应格式"><div className="field-grid"><label className="field"><span>Chat Path</span><input value={form.customChatPath} onChange={event => setForm(current => ({ ...current, customChatPath: event.target.value }))} placeholder="/chat/completions"/></label><label className="field"><span>Models Path</span><input value={form.customModelsPath} onChange={event => setForm(current => ({ ...current, customModelsPath: event.target.value }))} placeholder="/models"/></label><label className="field"><span>鉴权方式</span><select value={form.customAuthType} onChange={event => setForm(current => ({ ...current, customAuthType: event.target.value }))}><option value="bearer">Authorization: Bearer</option><option value="x-api-key">x-api-key</option><option value="query">Query 参数</option><option value="none">无鉴权</option></select></label><label className="field"><span>请求格式</span><select value={form.customRequestFormat} onChange={event => setForm(current => ({ ...current, customRequestFormat: event.target.value }))}><option value="openai">OpenAI Chat</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option><option value="ollama">Ollama</option></select></label><label className="field"><span>响应流格式</span><select value={form.customResponseFormat} onChange={event => setForm(current => ({ ...current, customResponseFormat: event.target.value }))}><option value="auto">自动识别</option><option value="sse">SSE</option><option value="ndjson">NDJSON</option><option value="json">JSON</option></select></label></div></FormSection>}
    <FormSection number={custom ? '5' : '4'} title="高级 Header" note="合并到模型请求的附加请求头"><label className="field"><span>额外 Header JSON</span><textarea className="code-input" value={form.extraHeadersText} onChange={event => setForm(current => ({ ...current, extraHeadersText: event.target.value }))} spellCheck="false" placeholder={'{\n  "X-Organization": "your-org"\n}'}/><small>必须是 JSON 对象。不要在这里填写需要隐藏的密钥。</small></label></FormSection>
  </div><footer><button className="secondary-action" onClick={testModel} disabled={Boolean(busy)}>{busy === 'test' ? <LoaderCircle className="spin" size={16}/> : <TestTube2 size={16}/>}测试连接</button><button className="primary-action" onClick={saveModel} disabled={Boolean(busy)}>{busy === 'save' ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>}保存并设为默认</button></footer></aside></div>;
}

function FormSection({ number, title, note, children }) {
  return <section className="form-section"><div className="form-section-title"><span>{number}</span><div><b>{title}</b><small>{note}</small></div></div>{children}</section>;
}
function SyncModal({ syncing, close, sync }) {
  return <div className="modal-backdrop" onMouseDown={close}><section className="sync-modal" onMouseDown={event => event.stopPropagation()}><button className="modal-x" onClick={close}><X/></button><div className="sync-mark"><RefreshCw/></div><h2>同步飞书知识库</h2><p>将飞书知识空间页面同步到本地检索索引。真实连接凭据由服务端环境变量管理，不会展示在前端。</p><div className="sync-options"><button onClick={() => sync('mock')} disabled={syncing}><Database/><span><b>载入演示知识库</b><small>无需配置，立即体验问答与 Skill</small></span></button><button onClick={() => sync('feishu')} disabled={syncing}><Globe2/><span><b>从飞书开放平台同步</b><small>使用服务端配置的飞书应用凭据</small></span></button></div>{syncing && <div className="syncing"><LoaderCircle className="spin"/>正在拉取、切分并建立索引…</div>}</section></div>;
}

createRoot(document.getElementById('root')).render(<App/>);
