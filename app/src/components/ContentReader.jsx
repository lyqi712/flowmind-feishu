import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { ArrowLeft, BrainCircuit, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Copy, Download, ExternalLink, File, FileArchive, FileImage, FilePenLine, FileText, Highlighter, Layers3, Link2, List, LoaderCircle, MessageSquarePlus, MoreHorizontal, Network, Paperclip, RefreshCw, RotateCcw, Search, Sparkles, X, XCircle } from 'lucide-react';
import './ContentReader.css';
import './ContentReaderBubble.css';
import './CitationTooltip.css';
import './MessageFeedback.css';
import { EvidenceStatusBadge, EvidenceStatusNotice } from './EvidenceStatus.jsx';
import { annotationHighlightQuery, readerAnnotationPayload, unwrapMarkedNodes, wrapTextMatches } from '../workspace/reader-text-layer.js';
import { hasSubstantiveEvidenceAnalysis } from '../../shared/answer-text.mjs';
import { renderContentWithCitations } from './CitationTooltip.jsx';
import { MessageFeedback } from './MessageFeedback.jsx';

function safeMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  try { return JSON.parse(metadata); } catch { return {}; }
}

function cleanToken(value) {
  const raw = String(value || '').trim().replace(/^feishu-asset:\/\//i, '').replace(/^feishu:(?:image|file):/i, '');
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function attachmentKeys(value = {}) {
  const metadata = safeMetadata(value.metadata);
  const raw = [value.id, value.attachmentId, value.externalId, value.token, value.fileToken, value.file_token,
    metadata.token, metadata.fileToken, metadata.file_token, metadata.feishuToken, metadata.externalId];
  const keys = raw.map(cleanToken).filter(Boolean);
  // 真实飞书 externalId 形如 feishu:image:TOKEN，markdown 里是裸 TOKEN，需同时匹配最后一段。
  for (const key of [...keys]) {
    const last = String(key).split(':').pop();
    if (last && last !== key) keys.push(last);
  }
  return [...new Set(keys)];
}

function apiAttachmentUrl(id, download = false) {
  return id ? `/api/content/attachments/${encodeURIComponent(String(id))}${download ? '/download' : ''}` : '';
}

export function resolveFeishuAsset(tokenOrUrl, item = {}, attachments = []) {
  const token = cleanToken(tokenOrUrl);
  if (!token) return null;
  const metadata = safeMetadata(item?.metadata);
  const manifest = Array.isArray(metadata.attachmentManifest) ? metadata.attachmentManifest : [];
  const stored = Array.isArray(attachments) ? attachments : [];
  const manifestEntry = manifest.find(entry => attachmentKeys(entry).includes(token));
  const keys = new Set(manifestEntry ? [...attachmentKeys(manifestEntry), token] : [token]);
  const attachment = stored.find(entry => attachmentKeys(entry).some(key => keys.has(key)));
  const id = attachment?.id || manifestEntry?.attachmentId || manifestEntry?.id;
  if (!id) return null;
  return {
    token,
    id: String(id),
    fileName: attachment?.fileName || manifestEntry?.fileName || token,
    mimeType: attachment?.mimeType || manifestEntry?.mimeType || 'application/octet-stream',
    byteSize: Number(attachment?.byteSize ?? manifestEntry?.byteSize ?? 0) || 0,
    url: apiAttachmentUrl(id),
    downloadUrl: apiAttachmentUrl(id, true),
    manifest: manifestEntry || null,
    attachment: attachment || null
  };
}

export function rewriteFeishuAssetUrls(markdown = '', item = {}, attachments = []) {
  let output = String(markdown || '');
  // 图片：附件可用时指向真实 API URL；缺失时给出一行短提示（含 token 可诊断），避免悬空链接污染正文。
  output = output.replace(/!\[([^\]]*)\]\(feishu-asset:\/\/([^\s)\]}>"']+)\)/gi, (source, alt, token) => {
    const resolved = resolveFeishuAsset(token, item, attachments);
    return resolved?.url ? `![${alt}](${resolved.url})` : `> ⚠️ 图片附件未同步（${alt || 'image'} · ${cleanToken(token)}）`;
  });
  // 文件：附件可用时指向真实 API URL；缺失时保留文件名文本。
  output = output.replace(/\[([^\]]*)\]\(feishu-asset:\/\/([^\s)\]}>"']+)\)/gi, (source, label, token) => {
    const resolved = resolveFeishuAsset(token, item, attachments);
    return resolved?.url ? `[${label}](${resolved.url})` : `📎 ${label}`;
  });
  // 兜底：其他形式的 feishu-asset:// 引用一律不再产生悬空链接。
  output = output.replace(/feishu-asset:\/\/([^\s)\]}>"']+)/gi, (source, token) => {
    const resolved = resolveFeishuAsset(token, item, attachments);
    return resolved?.url || '';
  });
  return output;
}

export function rewriteWikiLinks(markdown = '') {
  return String(markdown || '').replace(/(!)?\[\[([^\]\n]+)\]\]/g, (raw, _embed, payload) => {
    const [targetAndAnchor, ...aliasParts] = String(payload || '').split('|');
    const hash = targetAndAnchor.indexOf('#');
    const target = String(hash >= 0 ? targetAndAnchor.slice(0, hash) : targetAndAnchor).trim();
    const label = String(aliasParts.join('|') || target).trim();
    if (!target) return raw;
    return `[${label}](#wiki:${encodeURIComponent(target)})`;
  });
}

export function softenOcrNoise(markdown = '') {
  return String(markdown || '').replace(
    /(?:^|\n)(?:#{1,6}\s*)?\[图片 OCR 提取[^\]]*\]\n([\s\S]*?)(?=\n#{1,6}\s|\n> \[!|\n\[📎 |\n!\[[^\]]*\]\(|$)/g,
    (_full, body) => `\n\n> 图片里识别出的文字（自动提取，可能不准）\n>\n${String(body || '').trim().split('\n').map(line => `> ${line}`).join('\n')}\n`
  );
}

export function isPreviewableHtmlUrl(href = '', attachments = []) {
  const raw = String(href || '');
  const match = raw.match(/\/api\/content\/attachments\/([^/?#]+)/i);
  if (!match) return /\.html?(?:$|[?#])/i.test(raw);
  let id = match[1];
  try { id = decodeURIComponent(id); } catch {}
  const row = (Array.isArray(attachments) ? attachments : []).find(item => String(item?.id || item?.attachmentId || '') === id);
  return /html/i.test(row?.mimeType || '') || /\.html?$/i.test(row?.fileName || raw);
}

export function countUnsyncedAssets(item = {}, attachments = []) {
  const metadata = safeMetadata(item.metadata);
  const stored = Array.isArray(attachments) ? attachments.filter(entry => entry?.id) : [];
  const warningCount = Array.isArray(metadata.assetWarnings) ? metadata.assetWarnings.length : 0;
  const expected = Number(metadata.assetCount || 0);
  return Math.max(warningCount, Math.max(0, expected - stored.length));
}

export function describeReaderMediaStatus(item = {}, attachments = [], { userLoggedIn = false } = {}) {
  const metadata = safeMetadata(item.metadata);
  const warnings = Array.isArray(metadata.assetWarnings) ? metadata.assetWarnings : [];
  const missing = countUnsyncedAssets(item, attachments);
  const isForbidden = (row = {}) => row?.code === 'FEISHU_MEDIA_FORBIDDEN' || /HTTP 403|没有素材权限/.test(String(row?.message || ''));
  const forbidden = warnings.filter(isForbidden).length;
  const timeout = warnings.filter(row => row?.code === 'FEISHU_MEDIA_TIMEOUT' || /超时/.test(String(row?.message || ''))).length;
  const sourceUrl = String(item.sourceUrl || metadata.url || '').trim();
  const parts = [];
  if (forbidden) parts.push(userLoggedIn
    ? `飞书拒绝下载 ${forbidden} 个图或附件（你的账号也没有下载权限）`
    : `飞书拒绝下载 ${forbidden} 个图或附件（应用没有素材权限）`);
  if (timeout) parts.push(`${timeout} 个下载超时，可以再试一次`);
  if (!parts.length && missing) parts.push(`${missing} 个图片或附件还没同步下来，正文里会先显示占位`);
  else if (missing > warnings.length) parts.push(`还有 ${missing - warnings.length} 个还没入库`);
  if (forbidden && !userLoggedIn) parts.push('登录飞书账号后可以按你的权限再拉一次');
  if (forbidden && userLoggedIn) parts.push('让文档管理员允许下载，或把文档分享给这个应用');
  if (forbidden && sourceUrl) parts.push('可在飞书打开原文查看');
  return {
    count: missing,
    forbidden,
    timeout,
    sourceUrl,
    needsLogin: forbidden > 0 && !userLoggedIn,
    message: parts.join('。') + (parts.length ? '。' : ''),
    canRetry: missing > 0
  };
}

export function listReaderAttachments(item = {}, attachments = []) {
  const metadata = safeMetadata(item.metadata);
  const manifest = Array.isArray(metadata.attachmentManifest) ? metadata.attachmentManifest : [];
  const stored = Array.isArray(attachments) ? attachments : [];
  const rows = [];
  const used = new Set();
  const push = (entry, match = null) => {
    const id = match?.id || entry?.attachmentId || entry?.id || '';
    const identity = id ? `id:${id}` : `key:${attachmentKeys(entry)[0] || entry?.fileName || rows.length}`;
    if (used.has(identity)) return;
    used.add(identity);
    rows.push({
      id: id ? String(id) : '',
      externalId: match?.externalId || entry?.externalId || '',
      fileName: match?.fileName || entry?.fileName || '未命名附件',
      mimeType: match?.mimeType || entry?.mimeType || 'application/octet-stream',
      byteSize: Number(match?.byteSize ?? entry?.byteSize ?? 0) || 0,
      url: apiAttachmentUrl(id),
      downloadUrl: apiAttachmentUrl(id, true),
      available: Boolean(id)
    });
  };
  for (const entry of manifest) {
    const keys = attachmentKeys(entry);
    push(entry, stored.find(candidate => attachmentKeys(candidate).some(key => keys.includes(key))));
  }
  for (const entry of stored) push(entry, entry);
  return rows;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '大小未知';
  const units = ['B', 'KB', 'MB', 'GB'];
  const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / (1024 ** order);
  return `${amount >= 10 || order === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[order]}`;
}

function titleFromChildren(children) {
  return React.Children.toArray(children).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return child?.props ? titleFromChildren(child.props.children) : '';
  }).join('').trim();
}

function slugify(value) {
  return String(value || 'section').trim().toLowerCase().replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .replace(/[\s_]+/g, '-').replace(/-+/g, '-') || 'section';
}

function normalizeAnchor(anchor) { return String(anchor || '').trim().replace(/^#/, ''); }

export function normalizedReaderText(value = '') {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

export function readerExcerptNeedles(excerpt = '') {
  const normalized = normalizedReaderText(excerpt);
  if (!normalized) return [];
  const prefix = normalized.slice(0, Math.min(120, normalized.length));
  const suffix = normalized.length > 120 ? normalized.slice(-120) : '';
  return [...new Set([normalized, prefix, suffix].filter(value => value.length >= 6))];
}

function findExcerptTarget(reader, excerpt) {
  const needles = readerExcerptNeedles(excerpt);
  if (!reader || !needles.length) return null;
  const candidates = [...reader.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th,pre')];
  return candidates.find(candidate => {
    const copy = normalizedReaderText(candidate.textContent);
    return needles.some(needle => copy.includes(needle));
  }) || null;
}

export function readingPositionFromElement(element, anchor = '') {
  if (!element) return { scrollTop: 0, progress: 0, anchor: normalizeAnchor(anchor) };
  const maximum = Math.max(0, Number(element.scrollHeight || 0) - Number(element.clientHeight || 0));
  const scrollTop = Math.max(0, Number(element.scrollTop || 0));
  return { scrollTop, progress: maximum ? Math.min(1, scrollTop / maximum) : 0, anchor: normalizeAnchor(anchor) };
}

export function selectionPayload(selection, container, documentId = '') {
  const text = String(selection?.toString?.() || '').trim();
  if (!text || !container || !selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const node = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  const anchorNode = node?.closest?.('[id]');
  return { documentId: String(documentId || ''), text, quote: text, anchor: normalizeAnchor(anchorNode?.id), startOffset: range.startOffset, endOffset: range.endOffset };
}

function attachmentIcon(mimeType = '') {
  const value = String(mimeType).toLowerCase();
  if (value.startsWith('image/')) return FileImage;
  if (value.includes('zip') || value.includes('archive') || value.includes('compressed')) return FileArchive;
  if (value.startsWith('text/') || value.includes('pdf') || value.includes('document')) return FileText;
  return File;
}

function sourceLabel(item) {
  const type = String(item?.contentType || safeMetadata(item?.metadata).sourceType || '').toLowerCase();
  if (type.includes('feishu') || item?.sourceUrl?.includes('feishu.cn')) return '飞书文档';
  if (type === 'note') return '知识笔记';
  if (type === 'markdown' || type === 'md') return 'Markdown';
  return type ? type.toUpperCase() : '知识库内容';
}
export function buildReaderQuickQuestions(item = {}, selection = null) {
  const title = String(item?.title || '当前材料').trim();
  if (selection?.quote || selection?.text) return [
    { id: 'explain-selection', label: '解释这段', prompt: `用大白话解释这段在《${title}》里是什么意思。` },
    { id: 'shorten-selection', label: '精简这段', prompt: `把这段话精简成更短的几句，保留原意。` },
    { id: 'rewrite-selection', label: '改写这段', prompt: `把这段改写得更清楚，不要加新事实。` }
  ];
  return [
    { id: 'summary', label: '这篇在讲什么', prompt: `《${title}》这篇主要在讲什么？用几句话说清楚。` },
    { id: 'actions', label: '有哪些要点', prompt: `从《${title}》里抽出真正重要的几点。` },
    { id: 'relations', label: '和其他材料的关系', prompt: `《${title}》和知识库里其他材料有没有共识或冲突？` }
  ];
}

const INTERPRETATION_LABELS = {
  'mind-map': { title: '思维导图', description: '沿着文档结构展开，点击节点回到原文', Icon: BrainCircuit },
  quiz: { title: '互动测验', description: '逐题作答，用来源解释巩固理解', Icon: CircleHelp }
};

function runDocumentIds(run = {}) {
  return (run.documentIds || run.input?.documentIds || []).map(String);
}

export function RelatedDocuments({ items = [], onOpen } = {}) {
  const rows = Array.isArray(items) ? items.filter((row) => row?.documentId) : [];
  if (!rows.length) return null;
  return (
    <aside className="content-reader-related" aria-label="相关文档">
      <header>
        <Network size={14} />
        <b>相关 {rows.length} 篇</b>
        <small>有依据才出现</small>
      </header>
      <div>
        {rows.map((row) => (
          <button type="button" key={row.documentId} onClick={() => onOpen?.(row.documentId, row)}>
            <strong>{row.title || '未命名文档'}</strong>
            <small>{row.reason}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

function readDockSectionState() {
  const fallback = { outline: true, outgoing: true, incoming: true, related: false };
  if (typeof sessionStorage === 'undefined') return fallback;
  try {
    const parsed = JSON.parse(sessionStorage.getItem('flowmind.reader.dock-sections') || 'null');
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      outline: parsed.outline !== false,
      outgoing: parsed.outgoing !== false,
      incoming: parsed.incoming !== false,
      related: parsed.related === true
    };
  } catch {
    return fallback;
  }
}

function writeDockSectionState(next) {
  if (typeof sessionStorage === 'undefined') return;
  try { sessionStorage.setItem('flowmind.reader.dock-sections', JSON.stringify(next)); } catch { /* ignore quota */ }
}

function dockEdgeLabel(row = {}) {
  if (row.edgeType === 'source') return '来源';
  if (row.edgeType === 'embed') return '嵌入';
  return '链接';
}

function DocumentLinksDock({ outline = [], outgoing = [], incoming = [], related = [], activeAnchor = '', onJump, onOpen, onClose } = {}) {
  const relatedRows = Array.isArray(related) ? related.filter(row => row?.documentId || row?.contentItemId || row?.id) : [];
  const [query, setQuery] = useState('');
  const [openSections, setOpenSections] = useState(readDockSectionState);
  const needle = query.trim().toLowerCase();
  const match = (title) => !needle || String(title || '').toLowerCase().includes(needle);
  const outlineRows = outline.filter(entry => match(entry.title));
  const outgoingRows = outgoing.filter(row => match(row.title)).slice(0, 80);
  const incomingRows = incoming.filter(row => match(row.title)).slice(0, 80);
  const relatedVisible = relatedRows.filter(row => match(row.title)).slice(0, 24);
  const total = outline.length + outgoing.length + incoming.length + relatedRows.length;
  if (!total) return null;

  const toggleSection = (key) => {
    setOpenSections(current => {
      const next = { ...current, [key]: !current[key] };
      writeDockSectionState(next);
      return next;
    });
  };

  const renderSection = (key, Icon, title, count, body) => {
    if (!count) return null;
    const open = Boolean(needle) || openSections[key] !== false;
    return <section data-dock-section={key}>
      <h3>
        <button type="button" className="content-reader-dock-toggle" aria-expanded={open} onClick={() => toggleSection(key)}>
          <Icon size={14}/>{title}<span>{count}</span>{open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
        </button>
      </h3>
      {open ? body : null}
    </section>;
  };

  return (
    <aside className="content-reader-links-dock" aria-label="文档关系">
      <header className="content-reader-dock-head">
        <b>关系</b>
        <small>{total} 条</small>
        {onClose ? <button type="button" className="content-reader-dock-close" onClick={onClose} aria-label="收起关系"><X size={14}/></button> : null}
      </header>
      {total > 5 ? <label className="content-reader-dock-filter">
        <Search size={13}/>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="筛选关系…" aria-label="筛选关系"/>
      </label> : null}
      {needle && !outlineRows.length && !outgoingRows.length && !incomingRows.length && !relatedVisible.length
        ? <p className="content-reader-dock-empty">没有匹配“{query.trim()}”的关系</p>
        : null}
      {renderSection('outline', FileText, '大纲', outlineRows.length, <nav>{outlineRows.map((entry, index) => <button type="button" key={`${entry.anchor || entry.title}-${index}`} className={`content-reader-dock-outline${activeAnchor && activeAnchor === entry.anchor ? ' is-active' : ''}`} style={{ '--outline-depth': Math.max(0, (entry.level || 1) - 1) }} onClick={() => onJump?.(entry.anchor)}>{entry.title}</button>)}</nav>)}
      {renderSection('outgoing', Link2, '出链', outgoingRows.length, outgoingRows.map((row, index) => <button type="button" key={`${row.contentItemId || row.title}:${index}`} onClick={() => onOpen?.(row)}>
        <strong>{row.title}</strong>
        <small>{dockEdgeLabel(row)}{row.type === 'note' ? ' · 笔记' : ''}{row.anchor ? ` · ${row.anchor}` : ''}</small>
      </button>))}
      {renderSection('incoming', Layers3, '反链', incomingRows.length, incomingRows.map((row, index) => <button type="button" key={`${row.contentItemId || row.title}:in:${index}`} onClick={() => onOpen?.(row)}>
        <strong>{row.title}</strong>
        <small>{row.type === 'note' ? '笔记' : '文档'}{row.edgeType === 'source' ? ' · 来源' : ''}{row.anchor ? ` · ${row.anchor}` : ''}</small>
      </button>))}
      {renderSection('related', Network, '相关', relatedVisible.length, relatedVisible.map((row) => <button type="button" key={row.documentId || row.contentItemId || row.id} onClick={() => onOpen?.(row)}>
        <strong>{row.title || '未命名文档'}</strong>
        <small>{row.reason || '有依据的相关材料'}</small>
      </button>))}
    </aside>
  );
}

function ReaderAnswerCoverage({ message }) {
  const relations = message?.relations;
  const substantive = hasSubstantiveEvidenceAnalysis(relations);
  const coverage = relations?.citationCoverage || message?.citationCoverage;
  const integrity = message?.citationIntegrity || relations?.citationIntegrity;
  const uncovered = Array.isArray(coverage?.uncoveredClaims) ? coverage.uncoveredClaims.filter(Boolean) : [];
  const score = Number(coverage?.score);
  const percent = Number.isFinite(score) ? Math.round(score <= 1 ? score * 100 : score) : null;
  const notice = integrity?.status === 'downgraded'
    ? '部分引用无法对应到来源，已降级为未覆盖结论。'
    : integrity?.status === 'empty'
      ? '这篇里没有找到可引用证据，因此没有给出事实结论。'
      : '';
  if (!substantive && !notice) return null;
  if (!substantive) {
    return <div className="content-reader-conversation-coverage" data-integrity={integrity?.status || ''}>
      {notice ? <p>{notice}</p> : null}
    </div>;
  }
  if (percent == null && !notice && !uncovered.length) return null;
  return <div className="content-reader-conversation-coverage" data-integrity={integrity?.status || ''}>
    {percent != null ? <small>引用覆盖率 {percent}%</small> : null}
    {notice ? <p>{notice}</p> : null}
    {uncovered.length ? <ul aria-label="未被引用覆盖的结论">{uncovered.map((claim, index) => <li key={`uncovered-${index}`}>{claim}</li>)}</ul> : null}
  </div>;
}

export function ContentReader({ item, attachments = [], inQuestionScope = false, onToggleQuestionScope,
  onAsk, onContinueInWorkspace, onOpenEvidenceWorkbench, conversation = null, onStopConversation, onRetryConversation, onCreateWriting, onRunInterpretation, interpretationRuns = [], onWriteSourceNote, onSaveAnswer, onOpenGraph, onOpenDocument, onClose, onSelectionChange,
  onReadingPositionChange, onAnchorChange, initialReadingPosition = null, initialAnchor = '', initialExcerpt = '', evidenceRef = null,
  versions = [], onOpenCurrentVersion, onOpenVersion, onResyncAttachments, resyncBusy = false, resyncError = '', userLoggedIn = false, onLoginFeishu, className = '' }) {
  const readerRef = useRef(null);
  const highlightedCitationRef = useRef(null);
  const citationHighlightTimerRef = useRef(null);
  const [selectionContext, setSelectionContext] = useState(null);
  const [activeInterpretation, setActiveInterpretation] = useState('');
  const [interpretationRun, setInterpretationRun] = useState(null);
  const [interpretationBusy, setInterpretationBusy] = useState(false);
  const [interpretationError, setInterpretationError] = useState('');
  const [expandedNodes, setExpandedNodes] = useState(() => new Set());
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [locationStatus, setLocationStatus] = useState(null);
  const [askDraft, setAskDraft] = useState('');
  const [conversationOpen, setConversationOpen] = useState(() => Boolean(conversation?.messages?.length || conversation?.streaming || conversation?.error));
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchCount, setSearchCount] = useState(0);
  const [selectionMenu, setSelectionMenu] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [relatedDocuments, setRelatedDocuments] = useState([]);
  const [documentLinks, setDocumentLinks] = useState({ outline: [], outgoing: [], incoming: [] });
  const [linksDockOpen, setLinksDockOpen] = useState(false);
  const [activeOutlineAnchor, setActiveOutlineAnchor] = useState('');
  const [assistantOpen, setAssistantOpen] = useState(() => {
    if (typeof sessionStorage === 'undefined') return false;
    try { return sessionStorage.getItem('flowmind.reader.assistant') === '1'; } catch { return false; }
  });
  const [outlineOpen, setOutlineOpen] = useState(() => {
    if (typeof sessionStorage === 'undefined') return false;
    try { return sessionStorage.getItem('flowmind.reader.outline') === '1'; } catch { return false; }
  });
  const [annotationBusy, setAnnotationBusy] = useState(false);
  const [copiedAnswerId, setCopiedAnswerId] = useState('');
  const [copiedWiki, setCopiedWiki] = useState(false);
  const [copiedSelection, setCopiedSelection] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const conversationEndRef = useRef(null);
  const askInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const markdownRef = useRef(null);
  const sourceItem = item || {};
  const metadata = useMemo(() => safeMetadata(sourceItem.metadata), [sourceItem.metadata]);
  const outline = useMemo(() => {
    const rows = Array.isArray(metadata.outline) ? metadata.outline : [];
    return rows.map((entry, index) => ({
      title: String(entry?.title || `章节 ${index + 1}`),
      level: Math.max(1, Math.min(6, Number(entry?.level) || 1)),
      anchor: normalizeAnchor(entry?.anchor || entry?.blockId || `section-${index + 1}`)
    }));
  }, [metadata]);
  const attachmentRows = useMemo(() => listReaderAttachments(sourceItem, attachments), [sourceItem, attachments]);
  const markdown = useMemo(
    () => rewriteWikiLinks(softenOcrNoise(rewriteFeishuAssetUrls(sourceItem.content || sourceItem.markdown || '', sourceItem, attachments))),
    [sourceItem, attachments]
  );
  const unsyncedCount = useMemo(() => countUnsyncedAssets(sourceItem, attachments), [sourceItem, attachments]);
  const mediaStatus = useMemo(() => describeReaderMediaStatus(sourceItem, attachments, { userLoggedIn }), [sourceItem, attachments, userLoggedIn]);
  const quickQuestions = useMemo(() => buildReaderQuickQuestions(sourceItem, selectionContext), [sourceItem, selectionContext]);
  const currentRuns = useMemo(() => interpretationRuns.filter(run => ['mind-map', 'quiz'].includes(run.skillId)
    && runDocumentIds(run).includes(String(sourceItem.id || '')) && run.artifact), [interpretationRuns, sourceItem.id]);

  useEffect(() => {
    if (outline.length < 2) return undefined;
    try {
      if (sessionStorage.getItem('flowmind.reader.outline') == null) setOutlineOpen(true);
    } catch { /* ignore quota */ }
    return undefined;
  }, [sourceItem.id, outline.length]);

  useEffect(() => {
    setSelectionContext(null);
    setActiveInterpretation('');
    setInterpretationRun(null);
    setInterpretationError('');
    setQuizIndex(0);
    setQuizAnswers({});
    setLocationStatus(null);
    setConversationOpen(false);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchIndex(0);
    setSearchCount(0);
    setSelectionMenu(null);
    setAnnotations([]);
    setDocumentLinks({ outline: [], outgoing: [], incoming: [] });
    setLinksDockOpen(false);
    setActiveOutlineAnchor('');
    setCopiedAnswerId('');
    setMoreOpen(false);
    setCopiedWiki(false);
    setCopiedSelection('');
    unwrapMarkedNodes(markdownRef.current, 'is-reader-search');
    unwrapMarkedNodes(markdownRef.current, 'is-reader-highlight');
    citationHighlightTimerRef.current && window.clearTimeout(citationHighlightTimerRef.current);
    highlightedCitationRef.current?.classList.remove('is-citation-target');
    highlightedCitationRef.current = null;
  }, [item?.id]);

  useEffect(() => () => {
    citationHighlightTimerRef.current && window.clearTimeout(citationHighlightTimerRef.current);
  }, []);

  useEffect(() => {
    if (!activeInterpretation) return;
    setInterpretationRun(current => {
      if (current?.skillId === activeInterpretation && currentRuns.some(run => run.id === current.id)) return current;
      return currentRuns.find(run => run.skillId === activeInterpretation) || current;
    });
  }, [activeInterpretation, currentRuns]);

  useEffect(() => {
    const tree = interpretationRun?.artifact?.tree;
    if (!tree) return;
    setExpandedNodes(new Set([tree.id, ...(tree.children || []).map(node => node.id)]));
  }, [interpretationRun?.id]);

  useEffect(() => {
    if (!(conversation?.messages?.length || conversation?.streaming)) return;
    setConversationOpen(true);
    setActiveInterpretation('');
  }, [conversation?.messages?.length, conversation?.streaming, conversation?.documentId]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [conversation?.messages, conversation?.streaming]);

  useEffect(() => {
    const id = String(item?.id || '');
    if (!id) return undefined;
    let cancelled = false;
    setRelatedDocuments([]);
    setDocumentLinks({ outline: [], outgoing: [], incoming: [] });
    fetch(`/api/content/items/${encodeURIComponent(id)}/related`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : { items: [] })
      .then(data => {
        if (!cancelled) setRelatedDocuments(Array.isArray(data.items) ? data.items.slice(0, 3) : []);
      })
      .catch(() => {
        if (!cancelled) setRelatedDocuments([]);
      });
    fetch(`/api/content/items/${encodeURIComponent(id)}/links`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : { outline: [], outgoing: [], incoming: [] })
      .then(data => {
        if (!cancelled) setDocumentLinks({
          outline: Array.isArray(data.outline) ? data.outline : [],
          outgoing: Array.isArray(data.outgoing) ? data.outgoing : [],
          incoming: Array.isArray(data.incoming) ? data.incoming : []
        });
      })
      .catch(() => {
        if (!cancelled) setDocumentLinks({ outline: [], outgoing: [], incoming: [] });
      });
    fetch(`/api/content/items/${encodeURIComponent(id)}/annotations`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : { annotations: [] })
      .then(data => {
        if (!cancelled) setAnnotations(Array.isArray(data.annotations) ? data.annotations : []);
      })
      .catch(() => {
        if (!cancelled) setAnnotations([]);
      });
    return () => { cancelled = true; };
  }, [item?.id]);

  useEffect(() => {
    const root = markdownRef.current;
    if (!root) return undefined;
    unwrapMarkedNodes(root, 'is-reader-highlight');
    for (const annotation of annotations) {
      const quote = annotationHighlightQuery(annotation);
      if (quote) wrapTextMatches(root, quote, 'is-reader-highlight', { limit: 8 });
    }
    return () => unwrapMarkedNodes(root, 'is-reader-highlight');
  }, [annotations, markdown]);

  useEffect(() => {
    const root = markdownRef.current;
    if (!root) return undefined;
    const hits = searchQuery.trim() ? wrapTextMatches(root, searchQuery.trim(), 'is-reader-search') : (unwrapMarkedNodes(root, 'is-reader-search'), []);
    setSearchCount(hits.length);
    setSearchIndex(0);
    hits[0]?.classList.add('is-reader-search-active');
    hits[0]?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    return () => unwrapMarkedNodes(root, 'is-reader-search');
  }, [searchQuery, markdown]);

  useEffect(() => {
    if (!searchOpen) return undefined;
    searchInputRef.current?.focus?.();
    return undefined;
  }, [searchOpen]);

  useEffect(() => {
    const onKeyDown = event => {
      const key = String(event.key || '').toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'f') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (key === 'escape') {
        if (searchOpen) {
          event.preventDefault();
          setSearchOpen(false);
          setSearchQuery('');
          return;
        }
        if (selectionMenu || selectionContext) {
          event.preventDefault();
          setSelectionMenu(null);
          setSelectionContext(null);
          return;
        }
        if (conversationOpen) {
          event.preventDefault();
          setConversationOpen(false);
          return;
        }
        if (activeInterpretation) {
          event.preventDefault();
          setActiveInterpretation('');
          return;
        }
        if (moreOpen) {
          event.preventDefault();
          setMoreOpen(false);
          return;
        }
        if (linksDockOpen) {
          event.preventDefault();
          setLinksDockOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen, selectionMenu, selectionContext, conversationOpen, activeInterpretation, linksDockOpen, moreOpen]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onPointer = event => {
      if (!moreRef.current?.contains(event.target)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [moreOpen]);

  function clearCitationHighlight() {
    citationHighlightTimerRef.current && window.clearTimeout(citationHighlightTimerRef.current);
    highlightedCitationRef.current?.classList.remove('is-citation-target');
    highlightedCitationRef.current = null;
  }

  function highlightCitationTarget(target) {
    clearCitationHighlight();
    target.classList.add('is-citation-target');
    highlightedCitationRef.current = target;
    citationHighlightTimerRef.current = window.setTimeout(() => {
      target.classList.remove('is-citation-target');
      if (highlightedCitationRef.current === target) highlightedCitationRef.current = null;
    }, 5200);
  }

  const jumpTo = (anchor, smooth = true, excerpt = '', announce = false) => {
    const reader = readerRef.current;
    if (!reader) return { kind: 'unavailable' };
    const normalized = normalizeAnchor(anchor || 'root');
    const target = normalized === 'root' ? null : [...reader.querySelectorAll('[id]')]
      .find(element => normalizeAnchor(element.id) === normalized) || null;
    const fallback = target || findExcerptTarget(reader, excerpt);
    if (!fallback) {
      reader.scrollTo?.({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
      reader.focus({ preventScroll: true });
      onAnchorChange?.('root');
      onReadingPositionChange?.(readingPositionFromElement(reader, 'root'));
      if (announce && (normalized !== 'root' || normalizedReaderText(excerpt))) {
        setLocationStatus({ kind: 'unresolved', message: '未能在当前版本中定位引用，已打开文档开头。' });
      }
      return { kind: 'unresolved' };
    }
    fallback.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    if (!fallback.hasAttribute('tabindex')) fallback.tabIndex = -1;
    fallback.focus({ preventScroll: true });
    const locatedAnchor = normalizeAnchor(fallback.closest?.('[id]')?.id || fallback.id || normalized);
    setActiveOutlineAnchor(locatedAnchor);
    onAnchorChange?.(locatedAnchor);
    onReadingPositionChange?.(readingPositionFromElement(reader, locatedAnchor));
    if (announce) {
      highlightCitationTarget(fallback);
      setLocationStatus(target
        ? { kind: 'anchor', message: '已按引用锚点定位到当前版本中的对应位置。' }
        : { kind: 'excerpt', message: '原始锚点不可用，已按引用片段定位到最接近的位置。' });
    }
    return { kind: target ? 'anchor' : 'excerpt', anchor: locatedAnchor };
  };

  useEffect(() => {
    const reader = readerRef.current;
    if (!reader || !item) return;
    const anchor = normalizeAnchor(initialAnchor || initialReadingPosition?.anchor);
    const excerpt = normalizedReaderText(initialExcerpt);
    if (initialReadingPosition?.scrollTop && !anchor && !excerpt) reader.scrollTop = Number(initialReadingPosition.scrollTop) || 0;
    if (anchor || excerpt) requestAnimationFrame(() => jumpTo(anchor || 'root', false, excerpt, true));
  }, [item?.id, initialAnchor, initialExcerpt]);

  useEffect(() => {
    if (conversation?.streaming || conversation?.error || conversation?.messages?.length) setConversationOpen(true);
  }, [conversation?.documentId, conversation?.streaming, conversation?.error, conversation?.messages?.length]);

  if (!item) return null;

  const headingUse = new Map();
  const headingComponent = level => function ReaderHeading({ children, node, ...props }) {
    const title = titleFromChildren(children);
    const key = `${level}:${title}`;
    const occurrence = headingUse.get(key) || 0;
    headingUse.set(key, occurrence + 1);
    const matches = outline.filter(entry => entry.level === level && entry.title.trim() === title);
    const id = matches[occurrence]?.anchor || `${slugify(title)}${occurrence ? `-${occurrence + 1}` : ''}`;
    const Tag = `h${level}`;
    return <Tag {...props} id={id} tabIndex="-1" className="content-reader-heading">{children}</Tag>;
  };

  const openInterpretation = async (kind, force = false) => {
    setActiveInterpretation(kind);
    setInterpretationError('');
    if (!force) {
      const stored = currentRuns.find(run => run.skillId === kind);
      if (stored) {
        setInterpretationRun(stored);
        if (kind === 'quiz') { setQuizIndex(0); setQuizAnswers({}); }
        return;
      }
    }
    if (!onRunInterpretation) return;
    setInterpretationBusy(true);
    try {
      const nextRun = await onRunInterpretation(kind, selectionContext, force);
      if (nextRun?.artifact) {
        setInterpretationRun(nextRun);
        if (kind === 'quiz') { setQuizIndex(0); setQuizAnswers({}); }
      }
    } catch (error) {
      setInterpretationError(error?.message || `生成${INTERPRETATION_LABELS[kind]?.title || '解读'}失败`);
    } finally {
      setInterpretationBusy(false);
    }
  };

  const closeInterpretation = () => {
    setActiveInterpretation('');
    setInterpretationError('');
  };

  const chooseHistoryRun = (runId) => {
    const nextRun = currentRuns.find(run => String(run.id) === String(runId));
    if (!nextRun) return;
    setInterpretationRun(nextRun);
    setActiveInterpretation(nextRun.skillId);
    setQuizIndex(0);
    setQuizAnswers({});
  };

  const focusSearchHit = (index) => {
    const root = markdownRef.current;
    if (!root) return;
    const hits = [...root.querySelectorAll('mark.is-reader-search')];
    if (!hits.length) return;
    const next = ((index % hits.length) + hits.length) % hits.length;
    hits.forEach(hit => hit.classList.toggle('is-reader-search-active', false));
    hits[next].classList.add('is-reader-search-active');
    hits[next].scrollIntoView({ block: 'center', behavior: 'smooth' });
    setSearchIndex(next);
  };

  const captureSelection = (event) => {
    const payload = selectionPayload(globalThis.getSelection?.(), readerRef.current, item.id);
    if (!payload) {
      if (!event?.target?.closest?.('.content-reader-selection-menu')) setSelectionMenu(null);
      return;
    }
    setSelectionContext(payload);
    onSelectionChange?.(payload, item);
    const range = globalThis.getSelection?.()?.rangeCount ? globalThis.getSelection().getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect?.();
    if (rect && (rect.width || rect.height)) {
      setSelectionMenu({
        left: Math.max(12, Math.min(globalThis.innerWidth - 280, rect.left + rect.width / 2 - 130)),
        top: Math.max(12, rect.top - 46)
      });
    }
  };

  const openAskComposer = () => {
    setConversationOpen(true);
    setActiveInterpretation('');
    setLinksDockOpen(false);
    setSelectionMenu(null);
    requestAnimationFrame(() => askInputRef.current?.focus?.());
  };

  const askSelection = (prompt) => {
    const text = String(prompt || '').trim();
    if (!text) {
      openAskComposer();
      return;
    }
    setConversationOpen(true);
    setActiveInterpretation('');
    onAsk?.(text, selectionContext);
    setSelectionMenu(null);
  };

  const copyText = async (value) => {
    const text = String(value || '').trim();
    if (!text) return false;
    const fallbackCopy = () => {
      const input = document.createElement('textarea');
      input.value = text;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand('copy');
      input.remove();
      return ok;
    };
    try {
      if (!navigator?.clipboard?.writeText) return fallbackCopy();
      const wrote = await Promise.race([
        navigator.clipboard.writeText(text).then(() => true, () => false),
        new Promise(resolve => window.setTimeout(() => resolve(false), 400))
      ]);
      if (wrote) return true;
      return fallbackCopy();
    } catch {
      try {
        return fallbackCopy();
      } catch {
        return false;
      }
    }
  };

  const highlightSelection = async () => {
    const payload = readerAnnotationPayload(selectionContext);
    if (!payload || !item?.id || annotationBusy) return;
    setAnnotationBusy(true);
    try {
      const response = await fetch(`/api/content/items/${encodeURIComponent(item.id)}/annotations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || '标注保存失败');
      if (data.annotation) setAnnotations(current => [data.annotation, ...current.filter(row => row.id !== data.annotation.id)]);
      setSelectionMenu(null);
    } catch {
      setSelectionMenu(null);
    } finally {
      setAnnotationBusy(false);
    }
  };

  const saveAnswer = (message) => {
    if (!message?.text) return;
    onSaveAnswer?.(message);
  };

  const copyAnswer = async (message) => {
    if (!message?.text) return;
    const ok = await copyText(message.text);
    if (ok) {
      setCopiedAnswerId(message.id);
      window.setTimeout(() => setCopiedAnswerId(current => current === message.id ? '' : current), 1600);
    }
  };

  const copyWikiLink = async () => {
    const title = String(item?.title || '').trim();
    if (!title) return;
    const ok = await copyText(`[[${title}]]`);
    if (!ok) return;
    setCopiedWiki(true);
    window.setTimeout(() => setCopiedWiki(false), 1600);
  };

  const copySelection = async () => {
    try {
      const ok = await copyText(selectionContext?.quote);
      setCopiedSelection(ok ? 'copied' : 'failed');
    } catch {
      setCopiedSelection('failed');
    }
    window.setTimeout(() => setCopiedSelection(current => current ? '' : current), 1600);
  };

  const toggleAssistant = () => {
    setAssistantOpen(current => {
      const next = !current;
      try { sessionStorage.setItem('flowmind.reader.assistant', next ? '1' : '0'); } catch { /* ignore quota */ }
      return next;
    });
  };

  const toggleOutline = () => {
    setOutlineOpen(current => {
      const next = !current;
      try { sessionStorage.setItem('flowmind.reader.outline', next ? '1' : '0'); } catch { /* ignore quota */ }
      return next;
    });
  };

  const openSource = (sourceRef = {}) => {
    if (sourceRef.documentId && String(sourceRef.documentId) !== String(item.id)) return;
    jumpTo(sourceRef.anchor || 'root', true, sourceRef.excerpt || sourceRef.quote || '', true);
  };

  const openLinkedContent = (row = {}) => {
    const contentItemId = String(row.contentItemId || row.documentId || row.id || '').trim();
    const title = String(row.title || '').trim();
    if (!contentItemId && !title) return;
    onOpenDocument?.({
      id: contentItemId || title,
      documentId: contentItemId || title,
      title: title || contentItemId,
      type: row.type,
      contentType: row.type === 'note' ? 'note' : row.contentType,
      anchor: row.anchor || row.targetAnchor || null
    });
  };

  const openWikiLink = (title) => {
    const label = String(title || '').trim();
    if (!label) return;
    const match = [...documentLinks.outgoing, ...documentLinks.incoming].find(row => String(row.title || '').trim().toLowerCase() === label.toLowerCase());
    if (match) {
      openLinkedContent(match);
      return;
    }
    openLinkedContent({ title: label, type: 'note' });
  };

  const showOutline = outline.length > 0 && outlineOpen;
  const dockOutline = showOutline ? [] : (outline.length ? outline : documentLinks.outline);
  const dockAvailable = Boolean(dockOutline.length || documentLinks.outgoing.length || documentLinks.incoming.length || relatedDocuments.length);
  const dockCount = dockOutline.length + documentLinks.outgoing.length + documentLinks.incoming.length + relatedDocuments.length;
  const showLinksDock = linksDockOpen && !conversationOpen && !activeInterpretation && dockAvailable;

  const toggleMapNode = (nodeId) => setExpandedNodes(current => {
    const next = new Set(current);
    if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
    return next;
  });

  const renderMapNode = (node, level = 0) => {
    const children = Array.isArray(node?.children) ? node.children : [];
    const expanded = expandedNodes.has(node.id);
    const canOpenSource = level > 0 && (!node.documentId || String(node.documentId) === String(item.id));
    return <li key={node.id || `map-node-${level}-${node.label}`} className="content-reader-map-node" style={{ '--map-depth': level }}>
      <div className={`content-reader-map-row ${level === 0 ? 'is-root' : ''}`}>
        {children.length ? <button type="button" className="content-reader-map-toggle" onClick={() => toggleMapNode(node.id)} aria-label={`${expanded ? '收起' : '展开'}${node.label}`}>{expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</button> : <span className="content-reader-map-dot"/>}
        <button type="button" className="content-reader-map-label" onClick={() => canOpenSource ? openSource(node) : children.length && toggleMapNode(node.id)}>
          <b>{node.label}</b>{node.summary && <small>{node.summary}</small>}
        </button>
      </div>
      {children.length > 0 && expanded && <ul>{children.map(child => renderMapNode(child, level + 1))}</ul>}
    </li>;
  };

  const activeArtifact = interpretationRun?.skillId === activeInterpretation ? interpretationRun.artifact : null;
  const quizQuestions = activeInterpretation === 'quiz' && Array.isArray(activeArtifact?.questions) ? activeArtifact.questions : [];
  const currentQuestion = quizQuestions[quizIndex] || null;
  const currentAnswer = currentQuestion ? quizAnswers[currentQuestion.id] : undefined;
  const answeredCount = quizQuestions.filter(question => Number.isInteger(quizAnswers[question.id])).length;
  const score = quizQuestions.filter(question => quizAnswers[question.id] === question.correctIndex).length;
  const activeMeta = INTERPRETATION_LABELS[activeInterpretation] || INTERPRETATION_LABELS['mind-map'];
  const ActiveIcon = activeMeta.Icon;
  const historyForKind = currentRuns.filter(run => run.skillId === activeInterpretation);
  const historicalVersion = Boolean(sourceItem.isHistoricalVersion || (evidenceRef?.contentVersionId != null && sourceItem.currentVersionId != null
    && String(evidenceRef.contentVersionId) !== String(sourceItem.currentVersionId)));

  return (
    <section className={`content-reader ${className}`.trim()} aria-label={`${item.title || '未命名文档'}阅读器`} data-attachments-count={attachments.length} data-manifest-count={(metadata.attachmentManifest || []).length}>
      <header className="content-reader-toolbar">
        <div className="content-reader-title-group">
          <button type="button" className="content-reader-icon-button content-reader-back" onClick={onClose} aria-label="关闭阅读器"><ArrowLeft size={18} /></button>
          <div><span className="content-reader-source">{sourceLabel(item)}{evidenceRef && <EvidenceStatusBadge evidence={evidenceRef} compact />}</span><h1>{item.title || '未命名文档'}</h1></div>
        </div>
        <div className="content-reader-actions">
          <button type="button" className="content-reader-icon-button" onClick={() => setSearchOpen(current => !current)} aria-label="文内搜索" aria-pressed={searchOpen}><Search size={16} /></button>
          <button type="button" className="content-reader-action content-reader-ask" onClick={openAskComposer}><Sparkles size={16} />{selectionContext ? '问这段' : '问这篇'}</button>
          <div className={`content-reader-more ${moreOpen ? 'is-open' : ''}`} ref={moreRef}>
            <button type="button" className={`content-reader-icon-button ${moreOpen ? 'is-active' : ''}`} onClick={() => setMoreOpen(current => !current)} aria-label="更多操作" aria-expanded={moreOpen}><MoreHorizontal size={16} /></button>
            <div className="content-reader-more-menu" role="menu">
              {outline.length ? <button type="button" role="menuitem" onClick={() => { toggleOutline(); setMoreOpen(false); }}>{outlineOpen ? '收起目录' : '目录'}</button> : null}
              {dockAvailable ? <button type="button" role="menuitem" onClick={() => { setLinksDockOpen(current => !current); setConversationOpen(false); setActiveInterpretation(''); setMoreOpen(false); }}>{linksDockOpen ? '收起关系' : `关系${dockCount ? ` ${dockCount}` : ''}`}</button> : null}
              {item?.title ? <button type="button" role="menuitem" onClick={() => { void copyWikiLink(); setMoreOpen(false); }}>{copiedWiki ? '已复制双链' : '复制双链'}</button> : null}
              <button type="button" role="menuitem" onClick={() => { toggleAssistant(); setMoreOpen(false); }}>{assistantOpen ? '收起助手' : 'AI助手'}</button>
              {onOpenGraph ? <button type="button" role="menuitem" onClick={() => { onOpenGraph(); setMoreOpen(false); }}>关联图谱</button> : null}
              {onOpenEvidenceWorkbench ? <button type="button" role="menuitem" onClick={() => { onOpenEvidenceWorkbench?.(); setMoreOpen(false); }}>证据工作台</button> : null}
              <button type="button" role="menuitem" aria-pressed={inQuestionScope} onClick={() => { onToggleQuestionScope?.(item, !inQuestionScope); setMoreOpen(false); }}>{inQuestionScope ? '移出问答范围' : '加入问答范围'}</button>
              <button type="button" role="menuitem" onClick={() => { onWriteSourceNote?.(item, selectionContext); setMoreOpen(false); }}>{selectionContext ? '记下选区' : '写来源笔记'}</button>
              <hr />
              <button type="button" role="menuitem" onClick={() => { onCreateWriting?.(selectionContext); setMoreOpen(false); }}>{selectionContext ? '用选区写作' : '创建写作'}</button>
              <button type="button" role="menuitem" onClick={() => { openInterpretation('mind-map'); setMoreOpen(false); }}>思维导图</button>
              <button type="button" role="menuitem" onClick={() => { openInterpretation('quiz'); setMoreOpen(false); }}>测验</button>
            </div>
          </div>
          <button type="button" className="content-reader-icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
      </header>

      {searchOpen && <form className="content-reader-search" role="search" onSubmit={event => { event.preventDefault(); focusSearchHit(searchIndex + 1); }}>
        <Search size={14} />
        <input ref={searchInputRef} value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="在这篇里找…" aria-label="在当前文档中搜索" />
        <small>{searchQuery.trim() ? `${searchCount ? searchIndex + 1 : 0}/${searchCount}` : 'Ctrl+F'}</small>
        <button type="button" onClick={() => focusSearchHit(searchIndex - 1)} disabled={!searchCount} aria-label="上一个匹配">上一个</button>
        <button type="button" onClick={() => focusSearchHit(searchIndex + 1)} disabled={!searchCount} aria-label="下一个匹配">下一个</button>
        <button type="button" onClick={() => { setSearchOpen(false); setSearchQuery(''); }} aria-label="关闭搜索"><X size={14} /></button>
      </form>}

      <EvidenceStatusNotice evidence={evidenceRef} versions={versions} selectedVersionId={sourceItem.contentVersionId ?? sourceItem.currentVersionId ?? null} historical={historicalVersion}
        onOpenCurrent={onOpenCurrentVersion} onOpenVersion={onOpenVersion}/>

      <section className={`content-reader-ai-bar ${selectionContext ? 'has-selection' : ''}${assistantOpen || selectionContext ? '' : ' is-collapsed'}`} aria-label="AI 阅读助手" hidden={!(assistantOpen || selectionContext)}>
        <div className="content-reader-ai-intro"><span><Sparkles size={15}/></span><div><b>{selectionContext ? '已选中一段内容' : 'AI 阅读助手'}</b><small>{selectionContext ? String(selectionContext.quote || selectionContext.text).slice(0, 76) : '直接围绕当前飞书材料继续提问'}</small></div></div>
        <div className="content-reader-ai-prompts">
          {quickQuestions.map(question => <button type="button" key={question.id} onClick={() => askSelection(question.prompt)}>{question.label}</button>)}
          <button type="button" className="content-reader-create-writing" onClick={() => onCreateWriting?.(selectionContext)}><FilePenLine size={13}/>{selectionContext ? '用选区写作' : '创建写作草稿'}</button>
          <button type="button" className={`content-reader-interpretation-trigger ${activeInterpretation === 'mind-map' ? 'is-active' : ''}`} aria-pressed={activeInterpretation === 'mind-map'} onClick={() => openInterpretation('mind-map')}><BrainCircuit size={13}/>思维导图</button>
          <button type="button" className={`content-reader-interpretation-trigger ${activeInterpretation === 'quiz' ? 'is-active' : ''}`} aria-pressed={activeInterpretation === 'quiz'} onClick={() => openInterpretation('quiz')}><CircleHelp size={13}/>测验</button>
        </div>
        {selectionContext && <button type="button" className="content-reader-selection-clear" onClick={() => { setSelectionContext(null); setSelectionMenu(null); }}>清除选区</button>}
        <form className="content-reader-ask-form" onSubmit={event => {
          event.preventDefault();
          const text = askDraft.trim();
          if (!text) return;
          askSelection(text);
          setAskDraft('');
        }}>
          <input ref={askInputRef} value={askDraft} onChange={event => setAskDraft(event.target.value)} onFocus={() => { setConversationOpen(true); setActiveInterpretation(''); }} placeholder={selectionContext ? '针对这段接着问…' : '针对这篇接着问…'} aria-label={selectionContext ? '针对选区提问' : '针对当前文档提问'} />
          <button type="submit" disabled={!askDraft.trim()}>提问</button>
        </form>
      </section>
      {unsyncedCount > 0 && <div className="content-reader-media-status" role="status">
        <span>{mediaStatus.message || `${unsyncedCount} 个图片或附件还没同步下来，正文里会先显示占位。`}</span>
        {mediaStatus.needsLogin && onLoginFeishu && <button type="button" onClick={() => onLoginFeishu(sourceItem)}>登录飞书拉图</button>}
        {onResyncAttachments && mediaStatus.canRetry && <button type="button" onClick={() => onResyncAttachments(sourceItem)} disabled={resyncBusy}>{resyncBusy ? '正在拉取…' : '重新拉取附件'}</button>}
        {mediaStatus.sourceUrl && <a href={mediaStatus.sourceUrl} target="_blank" rel="noreferrer">在飞书中打开</a>}
        {resyncError && <small>{resyncError}</small>}
      </div>}

      {locationStatus && <div className={`content-reader-location-status is-${locationStatus.kind}`} role="status" data-location-kind={locationStatus.kind}><Link2 size={14}/><span>{locationStatus.message}</span><button type="button" aria-label="关闭来源定位提示" onClick={() => setLocationStatus(null)}><X size={14}/></button></div>}

      <div className={`content-reader-layout ${showOutline ? 'has-outline' : ''} ${activeInterpretation ? 'has-interpretation' : ''} ${conversationOpen ? 'has-conversation' : ''} ${showLinksDock ? 'has-links-dock' : ''}`.trim()}>
        {outline.length > 0 ? <aside className="content-reader-outline" aria-label="文档目录" hidden={!outlineOpen}>
          <div className="content-reader-outline-title">文档目录</div>
          <nav>{outline.map((entry, index) => <button type="button" key={`${entry.anchor}-${index}`} className={`content-reader-outline-link${activeOutlineAnchor === entry.anchor ? ' is-active' : ''}`}
            style={{ '--outline-depth': entry.level - 1 }} onClick={() => jumpTo(entry.anchor)}><ChevronRight size={13} /><span>{entry.title}</span></button>)}</nav>
        </aside> : null}

        {selectionMenu && selectionContext ? <div className="content-reader-selection-menu" style={{ left: selectionMenu.left, top: selectionMenu.top }} role="toolbar" aria-label="选区操作" onMouseDown={event => event.preventDefault()}>
          <button type="button" onClick={openAskComposer}>问这段</button>
          <button type="button" onClick={() => askSelection(`用大白话解释这段在《${item.title || '当前材料'}》里是什么意思。`)}>解释</button>
          <button type="button" onClick={() => askSelection('把这段话精简成更短的几句，保留原意。')}>精简</button>
          <button type="button" onClick={highlightSelection} disabled={annotationBusy}><Highlighter size={13}/>高亮</button>
          <button type="button" onClick={() => { onWriteSourceNote?.(item, selectionContext); setSelectionMenu(null); }}><MessageSquarePlus size={13}/>记笔记</button>
          <button type="button" onClick={() => { void copySelection(); }}><Copy size={13}/>{copiedSelection === 'copied' ? '已复制' : copiedSelection === 'failed' ? '复制失败' : '复制'}</button>
        </div> : null}
        <main className="content-reader-scroll" ref={readerRef} tabIndex="0" onMouseUp={captureSelection} onScroll={event => { const reader = event.currentTarget; setSelectionMenu(null); const headings = [...reader.querySelectorAll('.content-reader-heading')]; const activeHeading = headings.filter(heading => heading.offsetTop <= reader.scrollTop + 32).at(-1); const nextAnchor = activeHeading?.id || ''; if (nextAnchor !== activeOutlineAnchor) setActiveOutlineAnchor(nextAnchor); onReadingPositionChange?.(readingPositionFromElement(reader, nextAnchor)); }}>
          <article className="content-reader-markdown" ref={markdownRef}>
            {markdown.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} urlTransform={url => defaultUrlTransform(url)} components={{
              h1: headingComponent(1), h2: headingComponent(2), h3: headingComponent(3), h4: headingComponent(4), h5: headingComponent(5), h6: headingComponent(6),
              a({ href = '', children, node, ...props }) {
                if (String(href || '').startsWith('#wiki:')) {
                  let title = '';
                  try { title = decodeURIComponent(href.slice(6)); } catch { title = href.slice(6); }
                  return <button type="button" className="content-reader-wiki-link" onClick={() => openWikiLink(title)}>{children}</button>;
                }
                if (isPreviewableHtmlUrl(href, attachmentRows)) {
                  const title = titleFromChildren(children) || 'HTML 预览';
                  return <figure className="content-reader-html-embed">
                    <iframe title={title} src={href} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" loading="lazy" />
                    <figcaption><a {...props} href={href} target="_blank" rel="noreferrer noopener">{title}<ExternalLink size={12} /></a></figcaption>
                  </figure>;
                }
                const external = /^https?:\/\//i.test(href);
                return <a {...props} href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer noopener' : undefined}>{children}{external && <ExternalLink size={12} />}</a>;
              },
              img({ src = '', alt = '', node, ...props }) {
                return <span className="content-reader-image">
                  <img {...props} src={src} alt={alt} loading="eager" referrerPolicy="no-referrer" />
                  <span className="content-reader-image-caption">{alt || '文档图片'}</span>
                </span>;
              },
              table({ children, node, ...props }) { return <div className="content-reader-table-wrap"><table {...props}>{children}</table></div>; },
              pre({ children, node, ...props }) { return <div className="content-reader-code-wrap"><pre {...props}>{children}</pre></div>; },
              blockquote({ children, node, ...props }) { return <blockquote {...props}><span className="content-reader-quote-mark">“</span>{children}</blockquote>; }
            }}>{markdown}</ReactMarkdown> : <div className="content-reader-empty"><FileText size={32} /><p>这篇内容暂时没有可阅读的正文。</p></div>}
          </article>

          {attachmentRows.length > 0 && <section className="content-reader-attachments" aria-labelledby="content-reader-attachments-title">
            <div className="content-reader-section-heading"><Paperclip size={17} /><h2 id="content-reader-attachments-title">附件</h2><span>{attachmentRows.length}</span></div>
            <div className="content-reader-attachment-grid">{attachmentRows.map((attachment, index) => {
              const Icon = attachmentIcon(attachment.mimeType);
              return <article className="content-reader-attachment" key={attachment.id || `${attachment.externalId}-${index}`}>
                <span className="content-reader-attachment-icon"><Icon size={20} /></span><div>
                  {attachment.available ? <a href={attachment.url} target="_blank" rel="noreferrer noopener">{attachment.fileName}</a> : <strong>{attachment.fileName}</strong>}
                  <small>{attachment.mimeType} · {formatBytes(attachment.byteSize)}</small>
                </div>{attachment.available ? <a className="content-reader-download" href={attachment.downloadUrl} download aria-label={`下载 ${attachment.fileName}`}><Download size={17} /></a> : <span className="content-reader-unavailable">待同步</span>}
              </article>;
            })}</div>
          </section>}
        </main>

        {activeInterpretation && <aside className="content-reader-interpretation" aria-label={activeMeta.title}>
          <header className="content-reader-interpretation-head">
            <div className="content-reader-interpretation-title"><span><ActiveIcon size={17}/></span><div><b>{activeMeta.title}</b><small>{activeMeta.description}</small></div></div>
            <div className="content-reader-interpretation-actions">
              <button type="button" onClick={() => openInterpretation(activeInterpretation, true)} disabled={interpretationBusy} aria-label={`重新生成${activeMeta.title}`}><RefreshCw className={interpretationBusy ? 'spin' : ''} size={15}/></button>
              <button type="button" onClick={closeInterpretation} aria-label={`关闭${activeMeta.title}`}><X size={16}/></button>
            </div>
          </header>

          {historyForKind.length > 1 && <label className="content-reader-interpretation-history"><span>历史结果</span><select value={interpretationRun?.id || ''} onChange={event => chooseHistoryRun(event.target.value)}>{historyForKind.map((run, index) => <option key={run.id} value={run.id}>{index === 0 ? '最近生成' : `历史 ${index + 1}`} · {new Date(run.completedAt || run.startedAt || Date.now()).toLocaleString('zh-CN')}</option>)}</select></label>}

          <div className="content-reader-interpretation-body">
            {interpretationBusy && <div className="content-reader-interpretation-state"><LoaderCircle className="spin" size={24}/><b>正在读取当前材料</b><small>会保留文档、选区与来源定位</small></div>}
            {!interpretationBusy && interpretationError && <div className="content-reader-interpretation-state is-error"><XCircle size={24}/><b>{interpretationError}</b><button type="button" onClick={() => openInterpretation(activeInterpretation, true)}>重试</button></div>}
            {!interpretationBusy && !interpretationError && activeInterpretation === 'mind-map' && activeArtifact?.tree && <div className="content-reader-mind-map"><div className="content-reader-map-caption"><span>{activeArtifact.tree.children?.length || 0} 个主题分支</span><small>点击节点即可回到对应原文</small></div><ul className="content-reader-map-tree">{renderMapNode(activeArtifact.tree)}</ul></div>}
            {!interpretationBusy && !interpretationError && activeInterpretation === 'quiz' && currentQuestion && <div className="content-reader-quiz">
              <div className="content-reader-quiz-status"><div><span>第 {quizIndex + 1} / {quizQuestions.length} 题</span><b>{answeredCount ? `已答 ${answeredCount} · 得分 ${score}` : '开始作答'}</b></div><div className="content-reader-quiz-progress"><i style={{ width: `${((quizIndex + 1) / quizQuestions.length) * 100}%` }}/></div></div>
              <h3>{currentQuestion.prompt}</h3>
              <div className="content-reader-quiz-choices">{currentQuestion.choices.map((choice, choiceIndex) => {
                const chosen = currentAnswer === choiceIndex;
                const correct = currentQuestion.correctIndex === choiceIndex;
                const revealed = Number.isInteger(currentAnswer);
                return <button type="button" key={`choice-${choiceIndex}`} className={`${chosen ? 'is-chosen ' : ''}${revealed && correct ? 'is-correct ' : ''}${revealed && chosen && !correct ? 'is-wrong' : ''}`.trim()} disabled={revealed} onClick={() => setQuizAnswers(current => ({ ...current, [currentQuestion.id]: choiceIndex }))}><span>{String.fromCharCode(65 + choiceIndex)}</span><b>{choice}</b>{revealed && correct && <CheckCircle2 size={16}/>} {revealed && chosen && !correct && <XCircle size={16}/>}</button>;
              })}</div>
              {Number.isInteger(currentAnswer) && <div className={`content-reader-quiz-explanation ${currentAnswer === currentQuestion.correctIndex ? 'is-correct' : 'is-wrong'}`}><b>{currentAnswer === currentQuestion.correctIndex ? '回答正确' : '再看一下原文'}</b><p>{currentQuestion.explanation}</p><button type="button" onClick={() => openSource(currentQuestion.sourceRef)}><Link2 size={13}/>回到来源</button></div>}
              <footer className="content-reader-quiz-footer"><button type="button" onClick={() => setQuizIndex(index => Math.max(0, index - 1))} disabled={quizIndex === 0}><ChevronLeft size={15}/>上一题</button>{quizIndex < quizQuestions.length - 1 ? <button type="button" className="is-primary" onClick={() => setQuizIndex(index => Math.min(quizQuestions.length - 1, index + 1))}>下一题<ChevronRight size={15}/></button> : <button type="button" className="is-primary" onClick={() => { setQuizIndex(0); setQuizAnswers({}); }}><RotateCcw size={14}/>重新开始</button>}</footer>
            </div>}
            {!interpretationBusy && !interpretationError && !activeArtifact && <div className="content-reader-interpretation-state"><ActiveIcon size={25}/><b>生成{activeMeta.title}</b><small>结果会保留在当前阅读器，下次可直接继续</small><button type="button" onClick={() => openInterpretation(activeInterpretation, true)}>立即生成</button></div>}
          </div>
        </aside>}

        {showLinksDock ? <DocumentLinksDock outline={dockOutline} outgoing={documentLinks.outgoing} incoming={documentLinks.incoming} related={relatedDocuments} activeAnchor={activeOutlineAnchor} onJump={jumpTo} onOpen={openLinkedContent} onClose={() => setLinksDockOpen(false)} /> : null}

        {conversationOpen ? <aside className="content-reader-interpretation content-reader-conversation" aria-label="针对这篇的问答" data-reader-conversation="true">
          <header className="content-reader-interpretation-head">
            <div className="content-reader-interpretation-title"><span><Sparkles size={17}/></span><div><b>针对这篇</b><small>回答只使用当前文档，读完可以继续问</small></div></div>
            <div className="content-reader-interpretation-actions">
              {conversation?.streaming ? <button type="button" onClick={onStopConversation} aria-label="停止生成"><X size={16}/></button> : null}
              {onContinueInWorkspace ? <button type="button" className="content-reader-workspace-continue" onClick={() => onContinueInWorkspace(item, { selection: selectionContext, messages: conversation?.messages || [] })}>在工作区继续</button> : null}
              <button type="button" onClick={() => setConversationOpen(false)} aria-label="收起问答"><X size={16}/></button>
            </div>
          </header>
          <div className="content-reader-conversation-list">
            {!(conversation?.messages?.length || conversation?.streaming || conversation?.error) ? <div className="content-reader-conversation-empty">针对这篇提问，回答只会用当前文档。</div> : null}
            {(conversation?.messages || []).map(message => <article key={message.id} className={`content-reader-conversation-bubble is-${message.role}`}>
              {message.role === 'assistant' && <div className="message-avatar"><Sparkles size={16} /></div>}
              <div className="message-content">
                <div className="message-header">
                  <b>{message.role === 'user' ? '你' : 'AI'}</b>
                  {message.status ? <small>{message.status}</small> : null}
                </div>
                {message.text ? (message.role === 'assistant' ? <div className="content-reader-conversation-markdown">{renderContentWithCitations(message.text, message.citations || [], (cite) => openSource(cite))}</div> : <p className="message-text">{message.text}</p>) : null}
                {message.role === 'assistant' && message.citations?.length ? <div className="content-reader-conversation-cites">{message.citations.map((cite, index) => <button type="button" key={cite.id || `${cite.documentId || 'cite'}-${index}`} onClick={() => openSource(cite)}>[{index + 1}] {cite.title || '来源'}</button>)}</div> : null}
                {message.role === 'assistant' && (message.relations?.citationCoverage || message.citationIntegrity) ? <ReaderAnswerCoverage message={message} /> : null}
                {message.role === 'assistant' && message.done && message.text ? <div className="content-reader-conversation-actions">
                  <button type="button" onClick={() => askSelection('精简一下')}>精简</button>
                  <button type="button" onClick={() => askSelection('展开说说')}>展开</button>
                  {onContinueInWorkspace ? <button type="button" onClick={() => onContinueInWorkspace(item, { selection: message.selection || selectionContext, messages: conversation?.messages || [] })}>跨文档追问</button> : null}
                  <button type="button" onClick={() => copyAnswer(message)}>{copiedAnswerId === message.id ? '已复制' : '复制'}</button>
                  {onSaveAnswer ? <button type="button" onClick={() => saveAnswer(message)}>存成笔记</button> : null}
                </div> : null}
                {message.role === 'assistant' && message.done && message.text ? <MessageFeedback conversationId={conversation.id || 'reader'} messageId={message.id} /> : null}
                {message.error ? <div className="content-reader-conversation-error" role="alert"><span>{message.error}</span>{onRetryConversation ? <button type="button" onClick={onRetryConversation}>重试</button> : null}</div> : null}
              </div>
            </article>)}
            <div ref={conversationEndRef} />
          </div>
          <form className="content-reader-ask-form content-reader-conversation-composer" onSubmit={event => {
            event.preventDefault();
            const text = askDraft.trim();
            if (!text) return;
            askSelection(text);
            setAskDraft('');
          }}>
            <input ref={askInputRef} value={askDraft} onChange={event => setAskDraft(event.target.value)} placeholder={selectionContext ? '针对这段接着问…' : '向这篇提问…'} aria-label={selectionContext ? '针对选区提问' : '针对当前文档提问'} />
            <button type="submit" disabled={!askDraft.trim() || conversation?.streaming}>提问</button>
          </form>
        </aside> : null}
      </div>
    </section>
  );
}
export default ContentReader;
