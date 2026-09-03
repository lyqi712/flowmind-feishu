import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import {
  AlertCircle, Archive, ArchiveRestore, Check, FileText, Eye, FileDown, Globe, ImagePlus, Layers3, Link2, ListChecks,
  LoaderCircle, MoreHorizontal, NotebookPen, Paperclip, PencilLine, Plus, Search, Send, Sparkles, Trash2
} from 'lucide-react';
import './WorkspaceModules.css';
import { downloadExport, formatTime, jsonOptions, ModuleWelcome, request } from './WorkspaceModuleShared.jsx';
import { EvidenceStatusBadge } from './EvidenceStatus.jsx';
import { appendAssistantAnswerToNote, applyAssistantAnswerToProblemNote, extraQaCards, isProblemNote, noteHasVisibleRelations, noteListAnswerPreview, noteListPreview, noteListQuestion, parseQaNote, pickOpenNote, problemNoteDraft, replaceQaSection, serializeQaNote } from '../workspace/note-capture.js';
import { mergeNoteSourceRefs, webSourceHostname } from '../workspace/web-browse.js';
import { createStreamEventBatcher } from '../workspace/stream-events.js';

export const NOTES_AI_ACTIONS = Object.freeze([
  { id: 'polish', label: '润色', description: '优化表达、语法和节奏，不改变事实与结构' },
  { id: 'continue', label: '续写', description: '沿用当前上下文继续写下一段内容' },
  { id: 'summarize', label: '总结', description: '提炼重点，生成可直接放入笔记的摘要' },
  { id: 'tone', label: '改写语气', description: '按选定语气改写，同时保留原意和引用' }
]);

export const NOTES_AI_TONES = Object.freeze(['专业简洁', '自然友好', '正式严谨', '清晰有力', '轻松口语']);
const initialNotesAiWriter = () => ({
  open: false, action: 'polish', tone: NOTES_AI_TONES[0], scope: '全文', status: 'idle',
  result: '', error: '', original: '', baseContent: '', range: { start: 0, end: 0 }, citations: [], model: null, appliedMode: ''
});

export function buildNotesAiWritingPrompt({ action = 'polish', tone = NOTES_AI_TONES[0], title = '', original = '', scope = '全文', sourceRefs = [], workspace = '笔记' } = {}) {
  const meta = NOTES_AI_ACTIONS.find(item => item.id === action) || NOTES_AI_ACTIONS[0];
  const sourceLines = (Array.isArray(sourceRefs) ? sourceRefs : []).map((ref, index) => {
    const location = ref?.pageNumber ? `第 ${ref.pageNumber} 页` : ref?.anchor || '';
    return `[${index + 1}] ${ref?.title || '来源文档'}${location ? `（${location}）` : ''}`;
  });
  const operation = action === 'continue'
    ? '只输出自然衔接在原文之后的新内容，不要重复原文。'
    : action === 'summarize'
      ? '输出结构清楚、信息密度高的摘要；不得补充原文没有的事实。'
      : action === 'tone'
        ? `将文字改写为“${tone}”语气，保留原意、事实、数字、专有名词和引用。`
        : '修正语病、冗余和不自然表达，使文字更清楚流畅；保留原意、结构、事实和引用。';
  return [
    `你正在执行${workspace} AI 帮写：${meta.label}。`,
    `笔记标题：${title || '无标题笔记'}`,
    `处理范围：${scope}`,
    `目标语气：${tone}`,
    operation,
    '严格要求：只输出可直接写回笔记的 Markdown 正文，不解释生成过程；不要使用 Markdown 代码围栏，不要在正文首尾添加 --- 分隔线；保留原文中的 [数字] 来源标记、URL、[[双向链接]]、代码和待办状态；不得编造事实或来源。',
    sourceLines.length ? `已绑定来源（仅用于保持引用关系）：\n${sourceLines.join('\n')}` : '已绑定来源：无；仅依据下方原文处理。',
    `原文开始\n---\n${String(original || '')}\n---\n原文结束`
  ].join('\n\n');
}

export function normalizeNotesAiWritingResult(value = '') {
  let text = String(value || '').trim();
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1].trim();
  const lines = text.split('\n');
  if (lines.length >= 3 && /^\s*---+\s*$/.test(lines[0]) && /^\s*---+\s*$/.test(lines.at(-1))) {
    text = lines.slice(1, -1).join('\n').trim();
  }
  return text;
}

export function applyNotesAiWritingResult({ content = '', result = '', range = {}, mode = 'replace', action = 'polish' } = {}) {
  const source = String(content || '');
  const generated = normalizeNotesAiWritingResult(result);
  if (!generated) throw new Error('AI 结果为空，暂时没有可写入的内容');
  const start = Math.max(0, Math.min(source.length, Number(range?.start) || 0));
  const end = Math.max(start, Math.min(source.length, Number(range?.end) || start));
  if (mode === 'replace') {
    return { content: `${source.slice(0, start)}${generated}${source.slice(end)}`, selection: { start, end: start + generated.length } };
  }
  if (mode !== 'insert') throw new Error(`未知写入方式：${mode}`);
  const insertAt = end;
  const before = source.slice(0, insertAt);
  const after = source.slice(insertAt);
  const prefix = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = !after ? '' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const inserted = `${prefix}${generated}${suffix}`;
  return { content: `${before}${inserted}${after}`, selection: { start: insertAt + prefix.length, end: insertAt + prefix.length + generated.length } };
}

export function insertNoteAttachmentMarkdown({ content = '', markdown = '', selection = {} } = {}) {
  const source = String(content || '');
  const value = String(markdown || '').trim();
  if (!value) throw new Error('附件 Markdown 为空');
  const rawStart = Number(selection?.start);
  const rawEnd = Number(selection?.end);
  const start = Math.max(0, Math.min(source.length, Number.isFinite(rawStart) ? rawStart : source.length));
  const end = Math.max(start, Math.min(source.length, Number.isFinite(rawEnd) ? rawEnd : start));
  const insertAt = end;
  const before = source.slice(0, insertAt);
  const after = source.slice(insertAt);
  const prefix = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const inserted = `${prefix}${value}${suffix}`;
  const cursor = insertAt + prefix.length + value.length;
  return { content: `${before}${inserted}${after}`, selection: { start: cursor, end: cursor } };
}

export { mergeNoteSourceRefs } from '../workspace/web-browse.js';

function mergeAppliedFields(current, next) {
  if (!next) return current || '';
  if (!current || current === next) return next;
  if (current === 'both' || next === 'both') return 'both';
  if ((current === 'pitfall' && next === 'resolution') || (current === 'resolution' && next === 'pitfall')) return 'both';
  return next;
}

export function formatNoteAttachmentSize(byteSize = 0) {
  const bytes = Math.max(0, Number(byteSize) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function noteSaveSnapshot(note = {}) {
  return {
    id: String(note?.id || ''),
    title: String(note?.title || ''),
    content: String(note?.content || ''),
    tagsText: String(note?.tagsText || ''),
    sourceRefs: Array.isArray(note?.sourceRefs) ? note.sourceRefs : []
  };
}
export async function readNotesAiWritingStream(response, { onDelta } = {}) {
  if (!response?.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message || payload?.message || `AI 帮写请求失败（HTTP ${response?.status || 0}）`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamed = '';
  let artifact = null;
  let done = null;
  const consume = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event?.error?.message || 'AI 帮写失败');
    if (event.type === 'model-delta' || event.type === 'delta') {
      streamed += String(event.delta || '');
      onDelta?.(streamed, event);
    }
    if (event.type === 'artifact') artifact = event.artifact || artifact;
    if (event.type === 'done') done = event;
  };
  try {
    while (true) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) consume(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
  } finally { reader.releaseLock(); }
  const finalArtifact = done?.result?.artifact || artifact || {};
  const result = normalizeNotesAiWritingResult(finalArtifact.content || done?.answer || streamed || '');
  if (!response.ok) throw new Error(`AI 帮写请求失败（HTTP ${response.status}）`);
  if (!result) throw new Error('模型没有返回可预览的写作结果');
  return {
    result,
    citations: finalArtifact.references || finalArtifact.citations || done?.citations || [],
    model: done?.result?.model || done?.model || finalArtifact.generatedBy || null
  };
}

export async function readNoteAssistantStream(response, { onDelta, onEvent } = {}) {
  if (!response?.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message || payload?.message || `提问失败（HTTP ${response?.status || 0}）`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamed = '';
  let answer = '';
  const consume = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event?.error?.message || '提问失败');
    onEvent?.(event);
    if (event.type === 'delta') {
      streamed += String(event.delta || '');
      onDelta?.(streamed);
    }
    if (event.type === 'done') answer = String(event.result?.answer || event.answer || streamed || '');
  };
  try {
    while (true) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) consume(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
  } finally { reader.releaseLock(); }
  if (!response.ok) throw new Error(`提问失败（HTTP ${response.status}）`);
  const result = String(answer || streamed || '').trim();
  if (!result) throw new Error('模型没有返回可读的回答');
  return result;
}

export function NotesAiWritingPanel({ writer, sourceRefs = [], onAction, onToneChange, onApply, onClose, onOpenSource, title = '笔记 AI 帮写', helperText = '结果先预览，不会直接覆盖笔记' }) {
  const references = writer.citations?.length ? writer.citations : sourceRefs;
  const panelStyle = { marginTop: 14, border: '1px solid #f1e8e3', borderRadius: 14, background: '#fdfbfa', padding: 14, display: 'grid', gap: 12 };
  const buttonRowStyle = { display: 'flex', gap: 8, flexWrap: 'wrap' };
  const previewStyle = { margin: 0, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', font: 'inherit', lineHeight: 1.65, padding: 12, borderRadius: 10, background: '#fff', border: '1px solid #efede8' };
  const sourceButtonStyle = { display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', border: 0, padding: '3px 0', background: 'transparent', color: '#ba6b4f', cursor: 'pointer', textAlign: 'left' };
  return <section aria-label={title} data-notes-ai-writing="true" style={panelStyle}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Sparkles size={17}/><div style={{ flex: 1 }}><b>{title}</b><small style={{ display: 'block', color: '#978f77', marginTop: 2 }}>当前范围：{writer.scope} · {helperText}</small></div><button type="button" onClick={onClose}>关闭</button></div>
    <div style={buttonRowStyle} aria-label="AI 帮写操作">{NOTES_AI_ACTIONS.map(item => <button type="button" key={item.id} aria-pressed={writer.action === item.id} disabled={writer.status === 'loading'} onClick={() => onAction(item.id)} title={item.description}>{item.label}</button>)}</div>
    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>改写语气</span><select value={writer.tone} disabled={writer.status === 'loading'} onChange={event => onToneChange(event.target.value)}>{NOTES_AI_TONES.map(tone => <option key={tone}>{tone}</option>)}</select></label>
    {writer.status === 'loading' ? <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><LoaderCircle className="spin" size={17}/>AI 正在处理，原文保持不变…</div> : null}
    {writer.error ? <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#b42318' }}><AlertCircle size={17}/><span>{writer.error}</span></div> : null}
    {writer.original ? <details><summary>查看原文快照（{writer.original.length} 字）</summary><pre style={previewStyle}>{writer.original}</pre></details> : null}
    {writer.result ? <div><b>结果预览</b><pre aria-label="AI 帮写结果预览" style={{ ...previewStyle, marginTop: 7 }}>{writer.result}</pre></div> : null}
    {references?.length ? <details><summary>来源与引用（{references.length}）</summary><ul>{references.map((ref, index) => {
      const documentId = ref.documentId || ref.contentItemId;
      const label = `${ref.title || ref.label || `来源 ${index + 1}`}${ref.pageNumber ? ` · 第 ${ref.pageNumber} 页` : ref.anchor ? ` · ${ref.anchor}` : ''}`;
      return <li key={`${ref.id || documentId || 'source'}:${ref.anchor || index}`}>
        {(documentId || ref.url) && onOpenSource ? <button type="button" style={sourceButtonStyle} onClick={() => onOpenSource(ref)}><Link2 size={13}/>{label}</button> : label}
      </li>;
    })}</ul></details> : null}
    {writer.status === 'preview' && writer.result ? <div style={buttonRowStyle}><button type="button" onClick={() => onApply('insert')}><Plus size={15}/>插入到原文后</button><button type="button" onClick={() => onApply('replace')}><Check size={15}/>替换{writer.scope}</button></div> : null}
    {writer.status === 'applied' && writer.appliedMode ? <small style={{ color: '#2f7d32' }}>已{writer.appliedMode === 'insert' ? '插入' : '替换'}，原来源引用仍保留</small> : null}
  </section>;
}

function noteHeadingOutline(content = '') {
  const outline = [];
  const source = String(content || '').replace(/\r\n?/g, '\n');
  const occurrences = new Map();
  for (const match of source.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gmu)) {
    const title = String(match[2] || '').trim();
    if (!title) continue;
    const base = title.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
    const occurrence = (occurrences.get(base) || 0) + 1;
    occurrences.set(base, occurrence);
    outline.push({
      id: `note-heading-${base}${occurrence > 1 ? `-${occurrence}` : ''}`,
      title,
      level: match[1].length
    });
  }
  return outline;
}

function notePreviewHeadingComponents(outline = []) {
  let cursor = 0;
  const heading = Tag => function NotePreviewHeading({ children }) {
    const entry = outline[cursor++];
    return <Tag id={entry?.id}>{children}</Tag>;
  };
  return { h1: heading('h1'), h2: heading('h2'), h3: heading('h3'), h4: heading('h4'), h5: heading('h5'), h6: heading('h6') };
}

export function NotesModule({ onToast, onOpenDocument, onOpenNote, onAskAboutNote, onGraphChange, onOpenWeb, initialNoteId = '', linkCandidates = [] }) {
  const [notes, setNotes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [kindFilter, setKindFilter] = useState('all');
  const [busy, setBusy] = useState('loading');
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [mode, setMode] = useState('edit');
  const [editorSelection, setEditorSelection] = useState({ start: 0, end: 0 });
  const [aiWriter, setAiWriter] = useState(initialNotesAiWriter);
  const [attachmentBusy, setAttachmentBusy] = useState('');
  const [indexedRelations, setIndexedRelations] = useState({ incoming: [], outgoing: [], loading: false, error: '' });
  const [wikiSuggest, setWikiSuggest] = useState(null);
  const [wikiSuggestIndex, setWikiSuggestIndex] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantQuery, setAssistantQuery] = useState('');
  const [assistantThread, setAssistantThread] = useState([]);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [copiedWiki, setCopiedWiki] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const assistantAbortRef = useRef(null);
  const saveTimer = useRef(null);
  const editRevisionRef = useRef(0);
  const saveRequestRef = useRef(0);
  const editorRef = useRef(null);
  const searchRef = useRef(null);
  const previewRef = useRef(null);
  const imageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachmentSelectionRef = useRef({ start: 0, end: 0 });
  const visible = useMemo(() => notes.filter(note => {
    if (kindFilter === 'problem' && !isProblemNote(note)) return false;
    if (kindFilter === 'note' && isProblemNote(note)) return false;
    if (!query) return true;
    return `${note.title} ${note.content} ${(note.tags || []).join(' ')}`.toLowerCase().includes(query.toLowerCase());
  }), [notes, query, kindFilter]);
  const outgoingTitles = useMemo(() => [...new Set([...String(draft?.content || '').matchAll(/\[\[([^\]]+)\]\]/g)].map(match => match[1].trim()).filter(Boolean))], [draft?.content]);
  const backlinks = useMemo(() => draft?.title ? notes.filter(note => note.id !== draft.id && String(note.content || '').includes(`[[${draft.title}]]`)) : [], [draft?.id, draft?.title, notes]);
  const renderedMarkdown = useMemo(() => String(draft?.content || '').replace(/\[\[([^\]]+)\]\]/g, (_, title) => `[${title}](#wiki:${encodeURIComponent(title)})`), [draft?.content]);
  const headingOutline = useMemo(() => noteHeadingOutline(draft?.content || ''), [draft?.content]);
  const wikiTitleOptions = useMemo(() => {
    const rows = [];
    const seen = new Set();
    const push = (title, kind) => {
      const label = String(title || '').trim();
      const key = label.toLowerCase();
      if (!label || seen.has(key) || key === String(draft?.title || '').trim().toLowerCase()) return;
      seen.add(key);
      rows.push({ title: label, kind });
    };
    for (const note of notes) push(note.title, 'note');
    for (const item of Array.isArray(linkCandidates) ? linkCandidates : []) {
      if (item?.type === 'note' || item?.contentType === 'note') continue;
      push(item?.title, 'document');
    }
    return rows;
  }, [notes, linkCandidates, draft?.title]);

  async function load(nextArchived = archived) {
    setBusy('loading');
    try {
      const data = await request(`/api/notes${nextArchived ? '?archived=true' : ''}`);
      const list = nextArchived ? data.notes.filter(note => note.archived) : data.notes.filter(note => !note.archived);
      setNotes(list);
      const next = pickOpenNote(list, { preferredId: initialNoteId, selectedId });
      setSelectedId(next?.id || null);
      editRevisionRef.current += 1;
      setDraft(next ? { ...next, tagsText: (next.tags || []).join('，') } : null);
      setDirty(false);
      setSaveError('');
    } catch (error) { onToast?.(error.message, 'error'); }
    finally { setBusy(''); }
  }
  useEffect(() => { load(archived); }, [archived]);
  useEffect(() => {
    assistantAbortRef.current?.abort();
    setAssistantThread([]);
    setAssistantQuery('');
    setAssistantBusy(false);
  }, [draft?.id]);
  useEffect(() => {
    const linked = notes.find(note => note.id === initialNoteId);
    if (linked && linked.id !== selectedId) select(linked);
  }, [initialNoteId]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  useEffect(() => {
    const noteId = String(draft?.id || '');
    if (!noteId) {
      setIndexedRelations({ incoming: [], outgoing: [], loading: false, error: '' });
      return undefined;
    }
    let cancelled = false;
    setIndexedRelations(current => ({ ...current, loading: true, error: '' }));
    fetch(`/api/graph/nodes/${encodeURIComponent(`content:${noteId}`)}`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
        return data;
      })
      .then(data => {
        if (!cancelled) setIndexedRelations({
          incoming: Array.isArray(data.relations?.incoming) ? data.relations.incoming : [],
          outgoing: Array.isArray(data.relations?.outgoing) ? data.relations.outgoing : [],
          loading: false,
          error: ''
        });
      })
      .catch(error => {
        if (!cancelled) setIndexedRelations({ incoming: [], outgoing: [], loading: false, error: error.message || '关系索引读取失败' });
      });
    return () => { cancelled = true; };
  }, [draft?.id, draft?.updatedAt]);
  useEffect(() => {
    if (!dirty || !draft?.id || saveError) return undefined;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveNote(true), 650);
    return () => clearTimeout(saveTimer.current);
  }, [draft?.title, draft?.content, draft?.tagsText, dirty]);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onPointer = event => {
      if (!moreRef.current?.contains(event.target)) setMoreOpen(false);
    };
    const onKey = event => {
      if (String(event.key || '').toLowerCase() === 'escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  function select(note) {
    clearTimeout(saveTimer.current);
    editRevisionRef.current += 1;
    setSelectedId(note.id);
    setDraft({ ...note, tagsText: (note.tags || []).join('，') });
    setDirty(false);
    setSaveError('');
    setEditorSelection({ start: 0, end: 0 });
    setAiWriter(initialNotesAiWriter());
    setRelationsOpen(false);
    setWikiSuggest(null);
    setWikiSuggestIndex(0);
    setCopiedWiki(false);
    setMoreOpen(false);
  }
  function update(patch) {
    editRevisionRef.current += 1;
    setDraft(current => ({ ...current, ...patch }));
    setDirty(true);
    setSaveError('');
  }
  function openLinkedNote(title) {
    const label = String(title || '').trim();
    const linked = notes.find(note => String(note.title || '').trim().toLowerCase() === label.toLowerCase());
    if (linked) {
      select(linked);
      return;
    }
    const document = (Array.isArray(linkCandidates) ? linkCandidates : []).find(item => String(item?.title || '').trim().toLowerCase() === label.toLowerCase());
    if (document) {
      onOpenDocument?.({ ...document, id: document.id || document.documentId, documentId: document.documentId || document.id, title: document.title });
      return;
    }
    onToast?.(`尚未找到双链笔记：${title}`, 'error');
  }
  function openIndexedRelation(row) {
    const node = row?.node;
    const edge = row?.edge || {};
    if (!node?.sourceId) return;
    if (node.type === 'document') {
      onOpenDocument?.({ id: node.sourceId, documentId: node.sourceId, title: node.title || node.label, anchor: edge.targetAnchor || edge.sourceAnchor || null, contentVersionId: node.versionId || null });
      return;
    }
    if (node.type === 'note') {
      const linked = notes.find(note => note.id === node.sourceId);
      if (linked) select(linked);
      else onOpenNote?.({ id: node.sourceId, sourceId: node.sourceId, title: node.title || node.label });
    }
  }
  function applyMarkdown(prefix, suffix = '', placeholder = '文本') {
    const input = editorRef.current;
    if (!input || !draft) return;
    const start = input.selectionStart ?? draft.content.length;
    const end = input.selectionEnd ?? start;
    const selected = draft.content.slice(start, end) || placeholder;
    update({ content: `${draft.content.slice(0, start)}${prefix}${selected}${suffix}${draft.content.slice(end)}` });
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    });
  }
  function syncWikiSuggest(content, caret) {
    const before = String(content || '').slice(0, Math.max(0, Number(caret) || 0));
    const match = before.match(/\[\[([^\]\n]*)$/);
    if (!match) {
      setWikiSuggest(null);
      setWikiSuggestIndex(0);
      return;
    }
    const queryText = match[1].trim().toLowerCase();
    const items = wikiTitleOptions.filter(item => !queryText || item.title.toLowerCase().includes(queryText)).slice(0, 8);
    setWikiSuggest({ start: before.length - match[0].length, end: caret, query: match[1], items });
    setWikiSuggestIndex(0);
  }
  function insertWikiTitle(title) {
    if (!draft || !wikiSuggest) return;
    const content = String(draft.content || '');
    const inserted = `[[${title}]]`;
    const next = `${content.slice(0, wikiSuggest.start)}${inserted}${content.slice(wikiSuggest.end)}`;
    const caret = wikiSuggest.start + inserted.length;
    update({ content: next });
    setWikiSuggest(null);
    setWikiSuggestIndex(0);
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(caret, caret);
      setEditorSelection({ start: caret, end: caret });
    });
  }
  function jumpToNoteHeading(anchor) {
    const target = previewRef.current?.querySelector?.(`[id="${CSS.escape(anchor)}"]`);
    target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }
  async function copyNoteWikiLink() {
    const title = String(draft?.title || '').trim();
    if (!title) return;
    const text = `[[${title}]]`;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      try {
        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        ok = document.execCommand('copy');
        input.remove();
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      onToast?.('复制双链失败', 'error');
      return;
    }
    setCopiedWiki(true);
    window.setTimeout(() => setCopiedWiki(false), 1600);
  }
  function openAttachmentPicker(kind) {
    const input = editorRef.current;
    const contentLength = String(draft?.content || '').length;
    const start = Math.max(0, Math.min(contentLength, input?.selectionStart ?? editorSelection.start ?? contentLength));
    const end = Math.max(start, Math.min(contentLength, input?.selectionEnd ?? editorSelection.end ?? start));
    attachmentSelectionRef.current = { start, end };
    (kind === 'image' ? imageInputRef : fileInputRef).current?.click();
  }
  async function uploadNoteAttachment(file, kind) {
    if (!file || !draft?.id) return;
    setAttachmentBusy(kind);
    try {
      const response = await fetch(`/api/notes/${encodeURIComponent(draft.id)}/attachments`, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name || (kind === 'image' ? '图片' : '附件')),
          'X-File-Last-Modified': String(file.lastModified || '')
        },
        body: await file.arrayBuffer()
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || `附件上传失败（HTTP ${response.status}）`);
      let insertedSelection = attachmentSelectionRef.current;
      setDraft(current => {
        if (!current || current.id !== draft.id) return current;
        const applied = insertNoteAttachmentMarkdown({ content: current.content, markdown: data.markdown, selection: attachmentSelectionRef.current });
        insertedSelection = applied.selection;
        return { ...current, content: applied.content, attachments: data.note?.attachments || [...(current.attachments || []), data.attachment], updatedAt: data.note?.updatedAt || current.updatedAt };
      });
      setNotes(current => current.map(note => note.id === draft.id ? { ...note, attachments: data.note?.attachments || [...(note.attachments || []), data.attachment], updatedAt: data.note?.updatedAt || note.updatedAt } : note));
      editRevisionRef.current += 1;
      setDirty(true);
      setSaveError('');
      setMode('edit');
      onGraphChange?.();
      requestAnimationFrame(() => {
        editorRef.current?.focus();
        editorRef.current?.setSelectionRange(insertedSelection.start, insertedSelection.end);
        setEditorSelection(insertedSelection);
      });
      onToast?.(data.attachment?.isImage ? '图片已插入当前笔记' : '文件已插入当前笔记');
    } catch (error) {
      onToast?.(error.message || '附件上传失败', 'error');
    } finally {
      setAttachmentBusy('');
      if (imageInputRef.current) imageInputRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }
  async function insertNoteWebClip() {
    if (!draft?.id) return;
    const raw = window.prompt('把网页放进这篇笔记，对话里 @ 它就能读到摘要。', 'https://');
    if (raw == null) return;
    setAttachmentBusy('web');
    try {
      const data = await request(`/api/notes/${encodeURIComponent(draft.id)}/web-clip`, jsonOptions('POST', { url: raw }));
      setDraft(current => current && current.id === draft.id ? { ...current, ...data.note } : current);
      setNotes(current => current.map(note => note.id === draft.id ? { ...note, ...data.note } : note));
      editRevisionRef.current += 1;
      setDirty(false);
      onToast?.('网页已写入这篇笔记，对话里 @ 它就能引用');
    } catch (error) {
      onToast?.(error.message || '网页写入失败', 'error');
    } finally {
      setAttachmentBusy('');
    }
  }
  function currentWritingSnapshot() {
    const content = String(draft?.content || '');
    const input = editorRef.current;
    const rawStart = input?.selectionStart ?? editorSelection.start;
    const rawEnd = input?.selectionEnd ?? editorSelection.end;
    const start = Math.max(0, Math.min(content.length, Number(rawStart) || 0));
    const end = Math.max(start, Math.min(content.length, Number(rawEnd) || start));
    const hasSelection = end > start;
    return {
      original: hasSelection ? content.slice(start, end) : content,
      baseContent: content,
      range: hasSelection ? { start, end } : { start: 0, end: content.length },
      scope: hasSelection ? '当前选区' : '全文'
    };
  }
  function openAiWriting() {
    const snapshot = currentWritingSnapshot();
    setAiWriter(current => ({ ...initialNotesAiWriter(), open: true, tone: current.tone || NOTES_AI_TONES[0], ...snapshot }));
  }
  async function runAiWriting(action) {
    const snapshot = currentWritingSnapshot();
    if (!snapshot.original.trim()) {
      setAiWriter(current => ({ ...current, open: true, action, ...snapshot, status: 'error', error: '请先在笔记中写入内容，再使用 AI 帮写。', result: '' }));
      return;
    }
    const tone = aiWriter.tone || NOTES_AI_TONES[0];
    const prompt = buildNotesAiWritingPrompt({ action, tone, title: draft?.title, original: snapshot.original, scope: snapshot.scope, sourceRefs: draft?.sourceRefs || [] });
    setAiWriter(current => ({ ...current, open: true, action, tone, ...snapshot, status: 'loading', result: '', error: '', citations: [], model: null, appliedMode: '' }));
    try {
      const documentIds = [...new Set((draft?.sourceRefs || []).map(ref => ref?.documentId).filter(Boolean).map(String))];
      const response = await fetch('/api/skills/run', jsonOptions('POST', { skillId: 'smart-writing', input: prompt, query: prompt, documentIds }));
      const generated = await readNotesAiWritingStream(response, { onDelta: result => setAiWriter(current => ({ ...current, result })) });
      setAiWriter(current => ({ ...current, status: 'preview', result: generated.result, citations: generated.citations, model: generated.model, error: '' }));
    } catch (error) {
      setAiWriter(current => ({ ...current, status: 'error', error: error.message || 'AI 帮写失败' }));
    }
  }
  function applyAiWriting(modeToApply) {
    if (!draft || !aiWriter.result || aiWriter.status !== 'preview') return;
    if (String(draft.content || '') !== aiWriter.baseContent) {
      setAiWriter(current => ({ ...current, status: 'error', error: '生成期间笔记内容已经变化。为避免覆盖新内容，请重新选择范围并生成。' }));
      return;
    }
    try {
      const applied = applyNotesAiWritingResult({ content: draft.content, result: aiWriter.result, range: aiWriter.range, mode: modeToApply, action: aiWriter.action });
      update({ content: applied.content, sourceRefs: mergeNoteSourceRefs(draft.sourceRefs, aiWriter.citations) });
      setAiWriter(current => ({ ...current, status: 'applied', appliedMode: modeToApply, error: '', baseContent: applied.content }));
      requestAnimationFrame(() => {
        editorRef.current?.focus();
        editorRef.current?.setSelectionRange(applied.selection.start, applied.selection.end);
        setEditorSelection(applied.selection);
      });
      onToast?.(modeToApply === 'insert' ? 'AI 结果已插入，原文和来源均已保留' : 'AI 结果已替换所选范围，来源引用仍保留');
    } catch (error) {
      setAiWriter(current => ({ ...current, status: 'error', error: error.message || '写入 AI 结果失败' }));
    }
  }
  async function createNote(kind = 'note') {
    setBusy('create');
    try {
      const payload = kind === 'problem' ? problemNoteDraft() : { title: '无标题笔记', content: '', tags: [] };
      const data = await request('/api/notes', jsonOptions('POST', payload));
      onGraphChange?.();
      setArchived(false); setNotes(current => [data.note, ...current]); select(data.note); setMode('edit');
    } catch (error) { onToast?.(error.message, 'error'); } finally { setBusy(''); }
  }
  async function saveNote(silent = false) {
    if (!draft?.id || !dirty) return;
    const snapshot = noteSaveSnapshot(draft);
    const revision = editRevisionRef.current;
    const requestId = ++saveRequestRef.current;
    setBusy('save');
    try {
      const tags = [...new Set(snapshot.tagsText.split(/[，,;；\n]+/).map(item => item.trim()).filter(Boolean))];
      const data = await request(`/api/notes/${snapshot.id}`, jsonOptions('PATCH', { title: snapshot.title, content: snapshot.content, tags, sourceRefs: snapshot.sourceRefs }));
      if (requestId !== saveRequestRef.current || editRevisionRef.current !== revision) return;
      setDraft({ ...data.note, tagsText: tags.join('，') });
      setNotes(current => current.map(note => note.id === data.note.id ? data.note : note));
      setDirty(false);
      setSaveError('');
      onGraphChange?.();
      if (!silent) onToast?.('笔记已保存');
    } catch (error) {
      if (requestId !== saveRequestRef.current || editRevisionRef.current !== revision) return;
      const message = error.message || '笔记保存失败';
      setSaveError(message);
      onToast?.(message, 'error');
    } finally {
      if (requestId === saveRequestRef.current) setBusy('');
    }
  }
  async function archiveNote() {
    if (!draft?.id) return;
    try { await request(`/api/notes/${draft.id}`, jsonOptions('PATCH', { archived: !draft.archived })); onGraphChange?.(); onToast?.(draft.archived ? '笔记已恢复' : '笔记已归档'); await load(archived); } catch (error) { onToast?.(error.message, 'error'); }
  }
  async function deleteNote() {
    if (!draft?.id) return;
    try { await request(`/api/notes/${draft.id}`, { method: 'DELETE' }); onGraphChange?.(); onToast?.('笔记已移入回收状态'); await load(archived); } catch (error) { onToast?.(error.message, 'error'); }
  }
  async function exportNote(format) {
    try { if (dirty) await saveNote(true); await downloadExport({ entityType: 'note', entityId: draft.id, format }, onToast); } catch (error) { onToast?.(error.message, 'error'); }
  }

  const saveLabel = saveError ? '保存失败，笔记仍保留在当前页面' : dirty ? '正在等待自动保存' : `已保存 · ${formatTime(draft?.updatedAt)}`;
  const relationsAvailable = noteHasVisibleRelations({
    sourceRefs: draft?.sourceRefs,
    attachments: draft?.attachments,
    outgoing: indexedRelations.outgoing,
    incoming: indexedRelations.incoming,
    wikiOutgoing: outgoingTitles,
    wikiIncoming: backlinks,
    loading: indexedRelations.loading
  });
  const relationCount = (draft?.sourceRefs?.length || 0) + (draft?.attachments?.length || 0) + (indexedRelations.outgoing.length || outgoingTitles.length) + (indexedRelations.incoming.length || backlinks.length) + (previewOpen ? headingOutline.length : 0);
  const showRelations = relationsAvailable && relationsOpen;
  const gridClass = assistantOpen && showRelations
    ? 'note-workspace-grid is-with-assistant-and-relations'
    : assistantOpen
      ? 'note-workspace-grid is-with-assistant'
      : showRelations
        ? 'note-workspace-grid'
        : 'note-workspace-grid is-writing-only';
  const problemNotes = visible.filter(isProblemNote);
  const selectedQa = draft && isProblemNote(draft) ? parseQaNote(draft.content) : null;
  const hasEditorSelection = Math.abs((editorSelection?.end || 0) - (editorSelection?.start || 0)) > 0;

  async function askAssistant(event) {
    event?.preventDefault?.();
    const text = String(assistantQuery || '').trim();
    if (!text || !draft || assistantBusy) return;
    const userId = `note-ask-user-${Date.now()}`;
    const assistantId = `note-ask-ai-${Date.now()}`;
    assistantAbortRef.current?.abort();
    const controller = new AbortController();
    assistantAbortRef.current = controller;
    setAssistantQuery('');
    setAssistantBusy(true);
    setAssistantThread(current => [...current, { id: userId, role: 'user', text }, { id: assistantId, role: 'assistant', text: '', status: '正在阅读这篇笔记' }]);
    const streamBatcher = createStreamEventBatcher({
      onFlush(events) {
        setAssistantThread(current => current.map(message => {
          if (message.id !== assistantId) return message;
          return events.reduce((next, event) => {
            if (event.type === 'start') return { ...next, status: event.fastReply ? '' : '正在阅读这篇笔记' };
            if (event.type === 'status') return { ...next, status: event.detail || next.status };
            if (event.type === 'delta') return { ...next, status: '', text: `${next.text || ''}${event.delta || ''}` };
            if (event.type === 'done') return { ...next, status: '', text: event.result?.answer || event.answer || next.text };
            return next;
          }, message);
        }));
      }
    });
    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          query: text,
          question: text,
          mode: 'auto',
          documentIds: [String(draft.id)],
          includeKnowledgeBase: false,
          surface: 'note-assistant',
          readerDocumentId: draft.id
        })
      });
      const answer = await readNoteAssistantStream(response, {
        onEvent: event => streamBatcher.push(event)
      });
      streamBatcher.flush();
      const applied = isProblemNote(draft)
        ? writeAssistantIntoNote({ text: answer }, 'pitfall', { question: text })
        : '';
      setAssistantThread(current => current.map(message => message.id === assistantId ? { ...message, status: '', text: answer, done: true, applied } : message));
    } catch (error) {
      streamBatcher.flush();
      if (error.name === 'AbortError') return;
      setAssistantThread(current => current.map(message => message.id === assistantId ? { ...message, status: '', error: error.message || '提问失败', done: true } : message));
    } finally {
      if (assistantAbortRef.current === controller) setAssistantBusy(false);
    }
  }

  function writeAssistantIntoNote(message, fields = 'both', { question = '', silent = false } = {}) {
    const answer = String(message?.text || '').trim();
    if (!answer || !draft) return '';
    if (isProblemNote(draft) && fields !== 'note') {
      update({
        content: applyAssistantAnswerToProblemNote({
          content: draft.content,
          question: question || parseQaNote(draft.content).question,
          answer,
          fields
        })
      });
    } else {
      update({ content: appendAssistantAnswerToNote(draft.content, answer) });
      fields = 'note';
    }
    if (message?.id) {
      setAssistantThread(current => current.map(item => item.id === message.id ? { ...item, applied: mergeAppliedFields(item.applied, fields) } : item));
    }
    if (!silent) {
      onToast?.(fields === 'pitfall'
        ? '已写入「下次容易忘的点」，不用复制粘贴'
        : fields === 'resolution'
          ? '已写入「这次怎么解决的」'
          : fields === 'both'
            ? '已写入问题记录'
            : '已写入这篇笔记');
    }
    return fields;
  }

  function updateQaField(field, value) {
    if (!draft) return;
    const heading = field === 'question' ? '问题' : field === 'resolution' ? '这次怎么解决的' : '下次容易忘的点';
    const content = field === 'extra'
      ? serializeQaNote({ ...parseQaNote(draft.content), extra: value })
      : replaceQaSection(draft.content, heading, value);
    const customTitle = String(draft.title || '').trim();
    const autoTitle = !customTitle || customTitle === '问题记录' || customTitle.startsWith('问题记录：');
    update({
      content,
      title: field === 'question' && autoTitle
        ? (String(value || '').trim() ? `问题记录：${String(value).trim().slice(0, 40)}` : '问题记录')
        : draft.title
    });
  }

  function openSourceRef(ref) {
    const documentId = ref?.documentId || ref?.contentItemId;
    if (documentId) {
      onOpenDocument?.({ ...ref, id: documentId, documentId });
      return;
    }
    if (ref?.url) onOpenWeb?.(ref.url);
  }

  function runAssistantAction(action) {
    setAssistantOpen(true);
    if (action === 'ask') return;
    openAiWriting();
    void runAiWriting(action);
  }

  return <>
    <aside className="side-panel module-side note-side">
      <div className="side-head"><button type="button" className="note-search-toggle" aria-label="搜索笔记" onClick={() => searchRef.current?.focus()}><Search size={18}/></button><div className="side-head-actions"><button type="button" aria-label="新建问题记录" title="记下这次容易忘的点" onClick={() => createNote('problem')}><ListChecks size={17}/></button><button type="button" aria-label="新建笔记" onClick={createNote}><Plus size={17}/></button></div></div>
      <div className="search-box"><Search size={15}/><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索笔记和标签"/></div>
      <div className="module-tabs note-kind-tabs" role="tablist" aria-label="笔记筛选"><button type="button" className={!archived && kindFilter !== 'problem' ? 'active' : ''} onClick={() => { setArchived(false); setKindFilter('all'); }}>全部</button><button type="button" className={!archived && kindFilter === 'problem' ? 'active' : ''} onClick={() => { setArchived(false); setKindFilter('problem'); }}>问题记录</button><button type="button" className={archived ? 'active' : ''} onClick={() => setArchived(true)}>已归档</button></div>
      <div className="module-list">{busy === 'loading' ? <div className="module-empty"><LoaderCircle className="spin"/>读取笔记…</div> : visible.length ? visible.map(note => <button key={note.id} className={`${selectedId === note.id ? 'active' : ''}${isProblemNote(note) ? ' is-problem' : ''}`} title={noteListAnswerPreview(note)} onClick={() => select(note)}>{isProblemNote(note) ? <ListChecks size={16}/> : <NotebookPen size={16}/>}<span><b>{noteListQuestion(note)}</b><small>{formatTime(note.updatedAt)}</small></span></button>) : <div className="module-empty"><NotebookPen size={25}/><b>暂无笔记</b><small>先记一个容易忘的点，而不是整篇答案</small></div>}</div>
    </aside>
    <main className="workspace module-workspace">{draft ? <>
      <header className="workspace-head note-editor-toolbar"><div className="workspace-title"><small role={saveError ? 'alert' : 'status'}>{saveLabel}</small></div><div className="head-actions">{saveError ? <button type="button" className="writing-retry-save" onClick={() => saveNote(false)} disabled={busy === 'save'}>重试保存</button> : null}<div className="note-mode-switch"><button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}><PencilLine size={15}/>编辑</button><button className={mode === 'read' ? 'active' : ''} onClick={() => { setMode('read'); setPreviewOpen(false); }}><Eye size={15}/>阅读</button></div><div className={`note-more ${moreOpen ? 'is-open' : ''}`} ref={moreRef}><button type="button" className={`note-more-toggle${moreOpen ? ' is-active' : ''}`} onClick={() => setMoreOpen(current => !current)} aria-label="更多操作" aria-expanded={moreOpen}><MoreHorizontal size={16}/></button><div className="note-more-menu" role="menu">{mode === 'edit' ? <><button type="button" role="menuitem" onClick={() => { applyMarkdown('## ', '', '小节标题'); setMoreOpen(false); }}>标题</button><button type="button" role="menuitem" onClick={() => { applyMarkdown('**', '**', '重点'); setMoreOpen(false); }}>加粗</button><button type="button" role="menuitem" onClick={() => { applyMarkdown('[[', ']]', '笔记标题'); setMoreOpen(false); }}>双向链接</button><button type="button" role="menuitem" className="note-attachment-tool" disabled={Boolean(attachmentBusy)} onClick={() => { openAttachmentPicker('image'); setMoreOpen(false); }}>{attachmentBusy === 'image' ? <LoaderCircle className="spin" size={14}/> : <ImagePlus size={14}/>}图片</button><button type="button" role="menuitem" className="note-attachment-tool" disabled={Boolean(attachmentBusy)} onClick={() => { insertNoteWebClip(); setMoreOpen(false); }}><Globe size={14}/>网页</button><button type="button" role="menuitem" className="note-attachment-tool" disabled={Boolean(attachmentBusy)} onClick={() => { openAttachmentPicker('file'); setMoreOpen(false); }}>{attachmentBusy === 'file' ? <LoaderCircle className="spin" size={14}/> : <Paperclip size={14}/>}文件</button><button type="button" role="menuitem" className="note-ai-writing-tool" onClick={() => { openAiWriting(); setMoreOpen(false); }}><Sparkles size={14}/>AI 帮写</button></> : null}<button type="button" role="menuitem" onClick={() => { setAssistantOpen(true); setMoreOpen(false); }}>问这篇笔记</button>{onAskAboutNote ? <button type="button" role="menuitem" onClick={() => { onAskAboutNote(draft); setMoreOpen(false); }}>到对话里继续</button> : null}{mode === 'edit' ? <button type="button" role="menuitem" onClick={() => { setPreviewOpen(current => !current); setMoreOpen(false); }}>{previewOpen ? '收起对照' : '对照预览'}</button> : null}{relationsAvailable ? <button type="button" role="menuitem" onClick={() => { setRelationsOpen(current => !current); setMoreOpen(false); }}>{relationsOpen ? '收起关系' : `关系${relationCount ? ` ${relationCount}` : ''}`}</button> : null}<button type="button" role="menuitem" onClick={() => { saveNote(false); setMoreOpen(false); }} disabled={!dirty || busy === 'save'}>保存</button>{draft.title ? <button type="button" role="menuitem" onClick={() => { void copyNoteWikiLink(); setMoreOpen(false); }}>{copiedWiki ? '已复制双链' : '复制双链'}</button> : null}{String(draft.content || '').trim() ? <><button type="button" role="menuitem" className="export-button" onClick={() => { exportNote('markdown'); setMoreOpen(false); }}>导出 MD</button><button type="button" role="menuitem" className="export-button" onClick={() => { exportNote('html'); setMoreOpen(false); }}>导出 HTML</button></> : null}<button type="button" role="menuitem" onClick={() => { archiveNote(); setMoreOpen(false); }}>{draft.archived ? '恢复笔记' : '归档笔记'}</button><button type="button" role="menuitem" className="danger-lite" onClick={() => { deleteNote(); setMoreOpen(false); }}>删除笔记</button></div></div></div></header>
      <div className={gridClass}>
        <section className="editor-canvas note-editor-canvas">
          <input className="editor-title" value={draft.title} onChange={event => update({ title: event.target.value })} placeholder={isProblemNote(draft) ? '这个问题下次还会再遇到' : '笔记标题'}/>
          <input className="editor-tags" value={draft.tagsText || ''} onChange={event => update({ tagsText: event.target.value })} placeholder="标签，以逗号分隔"/>
          {mode === 'edit' ? <>
            <input ref={imageInputRef} className="note-file-input" type="file" accept="image/*" tabIndex={-1} onChange={event => uploadNoteAttachment(event.target.files?.[0], 'image')}/>
            <input ref={fileInputRef} className="note-file-input" type="file" tabIndex={-1} onChange={event => uploadNoteAttachment(event.target.files?.[0], 'file')}/>
            <div className={previewOpen ? 'note-split-editor' : 'note-source-only'}>
              <div className="note-source-pane">
                {isProblemNote(draft) ? <div className="note-qa-editor" aria-label="问题记录编辑">
                  <label><span>问题</span><textarea value={selectedQa?.question || ''} onChange={event => updateQaField('question', event.target.value)} rows={3} placeholder="这次卡住的是什么？" /></label>
                  <label><span>这次怎么解决的</span><textarea value={selectedQa?.resolution || ''} onChange={event => updateQaField('resolution', event.target.value)} rows={5} placeholder="只记这次真正用上的做法，不必整篇教程" /></label>
                  <label><span>下次容易忘的点</span><textarea value={selectedQa?.pitfall || ''} onChange={event => updateQaField('pitfall', event.target.value)} rows={4} placeholder="例如：出锅前再看一眼葱花" /></label>
                  {selectedQa?.extra ? <label><span>其他（会保留）</span><textarea value={selectedQa.extra} onChange={event => updateQaField('extra', event.target.value)} rows={4} placeholder="关联资料等额外小节" /></label> : null}
                </div> : null}
                {hasEditorSelection && !isProblemNote(draft) ? <div className="note-selection-bubble" role="toolbar" aria-label="选区帮写"><button type="button" className="is-primary" onClick={() => runAssistantAction('polish')}>帮写</button><button type="button" onClick={() => runAssistantAction('summarize')}>解读</button><button type="button" onClick={() => runAssistantAction('summarize')}>精炼</button><button type="button" onClick={() => runAssistantAction('polish')}>润色</button><button type="button" onClick={() => runAssistantAction('continue')}>扩写</button></div> : null}
                {isProblemNote(draft) ? null : <textarea ref={editorRef} className="editor-body markdown-editor-body" value={draft.content || ''} placeholder="写下正文。右上角更多里可插入图片、文件或网页；写好后点「在对话里问这篇」，或在问答输入框 @ 这篇笔记。" onChange={event => { update({ content: event.target.value }); syncWikiSuggest(event.target.value, event.currentTarget.selectionStart); }} onSelect={event => { const start = event.currentTarget.selectionStart; const end = event.currentTarget.selectionEnd; setEditorSelection({ start, end }); syncWikiSuggest(event.currentTarget.value, start); }} onKeyDown={event => {
                  if (event.key === 'Escape') {
                    if (wikiSuggest) { event.preventDefault(); setWikiSuggest(null); setWikiSuggestIndex(0); return; }
                    if (moreOpen) { event.preventDefault(); setMoreOpen(false); return; }
                    if (previewOpen) { event.preventDefault(); setPreviewOpen(false); return; }
                    if (relationsOpen) { event.preventDefault(); setRelationsOpen(false); return; }
                  }
                  if (event.key === 'ArrowDown' && wikiSuggest?.items?.length) { event.preventDefault(); setWikiSuggestIndex(current => (current + 1) % wikiSuggest.items.length); return; }
                  if (event.key === 'ArrowUp' && wikiSuggest?.items?.length) { event.preventDefault(); setWikiSuggestIndex(current => (current - 1 + wikiSuggest.items.length) % wikiSuggest.items.length); return; }
                  if ((event.key === 'Enter' || event.key === 'Tab') && wikiSuggest?.items?.length) { event.preventDefault(); insertWikiTitle(wikiSuggest.items[wikiSuggestIndex]?.title || wikiSuggest.items[0].title); }
                }} placeholder="写下理解、结论或下一步。有来源时会显示在右侧。"/>}
                {wikiSuggest?.items?.length ? <div className="note-wiki-suggest" role="listbox" aria-label="双向链接补全">
                  {wikiSuggest.items.map((item, index) => <button type="button" key={`${item.kind}:${item.title}`} role="option" aria-selected={index === wikiSuggestIndex} className={index === wikiSuggestIndex ? 'is-active' : ''} onMouseDown={event => { event.preventDefault(); insertWikiTitle(item.title); }}>
                    <b>{item.title}</b><small>{item.kind === 'document' ? '文档' : '笔记'}</small>
                  </button>)}
                </div> : null}
              </div>
              {previewOpen ? <article ref={previewRef} className="markdown-note-preview note-live-preview" aria-label="笔记预览"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={{
                ...notePreviewHeadingComponents(headingOutline),
                a: ({ href, children, node, ...props }) => href?.startsWith('#wiki:') ? <button className="wiki-link" onClick={() => openLinkedNote(decodeURIComponent(href.slice(6)))}>{children}</button> : <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>,
                img: ({ src, alt, node, ...props }) => <img className="note-inline-image" src={src} alt={alt || '笔记图片'} loading="lazy" {...props}/>
              }}>{renderedMarkdown || '*空白笔记*'}</ReactMarkdown></article> : null}
            </div>
          </> : <div className="markdown-note-preview">{selectedQa?.question || selectedQa?.pitfall || selectedQa?.resolution ? <div className="note-qa-board" aria-label="问题记录"><section className="note-qa-card"><span>问题</span><p>{selectedQa.question || '还没写下这次卡住的点'}</p></section>{selectedQa.resolution ? <section className="note-qa-card"><span>这次怎么解决的</span><p>{selectedQa.resolution}</p></section> : null}{selectedQa.pitfall ? <section className="note-qa-card"><span>下次容易忘的点</span><p>{selectedQa.pitfall}</p></section> : null}{extraQaCards(selectedQa.extra).map(card => <section className="note-qa-card" key={card.heading}><span>{card.heading}</span><p>{card.body}</p></section>)}</div> : <article><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={{
            a: ({ href, children, node, ...props }) => href?.startsWith('#wiki:') ? <button className="wiki-link" onClick={() => openLinkedNote(decodeURIComponent(href.slice(6)))}>{children}</button> : <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>,
            img: ({ src, alt, node, ...props }) => <img className="note-inline-image" src={src} alt={alt || '笔记图片'} loading="lazy" {...props}/>
          }}>{renderedMarkdown || '*空白笔记*'}</ReactMarkdown></article>}</div>}
          {aiWriter.open && !assistantOpen ? <NotesAiWritingPanel writer={aiWriter} sourceRefs={draft.sourceRefs || []} onAction={runAiWriting} onToneChange={tone => setAiWriter(current => ({ ...current, tone }))} onApply={applyAiWriting} onClose={() => setAiWriter(current => ({ ...current, open: false }))} onOpenSource={openSourceRef}/> : null}
        </section>
        {assistantOpen ? <aside className="note-assistant-panel" aria-label="FlowMind 助手">
          <header><span className="ai-avatar"><Sparkles size={16}/></span><div><b>FlowMind 助手</b><small>{isProblemNote(draft) ? '回答会写入容易忘的点，不用复制粘贴' : '选中文字后可帮写；也可直接问这篇笔记'}</small></div><button type="button" onClick={() => setAssistantOpen(false)} aria-label="关闭助手">关闭</button></header>
          <div className="note-assistant-actions" aria-label="笔记助手操作">
            <button type="button" onClick={() => runAssistantAction('ask')}>在这篇里问</button>
          </div>
          <div className="note-assistant-body">
            {aiWriter.open ? <NotesAiWritingPanel writer={aiWriter} sourceRefs={draft.sourceRefs || []} onAction={runAiWriting} onToneChange={tone => setAiWriter(current => ({ ...current, tone }))} onApply={applyAiWriting} onClose={() => setAiWriter(current => ({ ...current, open: false }))} onOpenSource={openSourceRef}/> : null}
            {assistantThread.length ? <div className="note-assistant-thread" aria-live="polite">{assistantThread.map(message => <article key={message.id} className={`note-assistant-msg ${message.role}`}>{message.error ? message.error : (message.text || message.status || '…')}{message.role === 'assistant' && message.done && !message.error ? <div className="note-assistant-writeback">{isProblemNote(draft) ? <><button type="button" disabled={message.applied === 'pitfall' || message.applied === 'both'} onClick={() => writeAssistantIntoNote(message, 'pitfall')}>{message.applied === 'pitfall' || message.applied === 'both' ? '已写入容易忘的点' : '写入下次容易忘的点'}</button><button type="button" disabled={message.applied === 'resolution' || message.applied === 'both'} onClick={() => writeAssistantIntoNote(message, 'resolution')}>{message.applied === 'resolution' || message.applied === 'both' ? '已写入解决过程' : '写入这次怎么解决的'}</button></> : <button type="button" disabled={message.applied === 'note'} onClick={() => writeAssistantIntoNote(message, 'note')}>{message.applied === 'note' ? '已写入笔记' : '写入这篇笔记'}</button>}</div> : null}</article>)}</div> : (!aiWriter.open ? <p className="note-assistant-empty">{isProblemNote(draft) ? '问这篇问题记录。回答会直接写入「下次容易忘的点」，不用来回粘贴。' : '向 FlowMind 提问，可获取写作帮助。主人，我可以使用写作 Agent 帮您修改这篇笔记。'}</p> : null)}
          </div>
          <form className="note-assistant-composer" onSubmit={askAssistant}>
            <textarea name="note-assistant-question" rows={2} value={assistantQuery} disabled={assistantBusy} placeholder="向 FlowMind 提问…" aria-label="向这篇笔记提问" onChange={event => setAssistantQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void askAssistant(event); } }}/>
            <button type="submit" disabled={assistantBusy || !assistantQuery.trim()} aria-label="发送问题"><Send size={15}/></button>
          </form>
        </aside> : null}
        {showRelations ? <aside className="note-relations-panel">
          {previewOpen && headingOutline.length ? <section><h3><FileText size={15}/>大纲<span>{headingOutline.length}</span></h3>{headingOutline.map(entry => <button key={entry.id} type="button" className="note-outline-link" style={{ '--outline-depth': Math.max(0, entry.level - 1) }} onClick={() => jumpToNoteHeading(entry.id)}><span><b>{entry.title}</b></span></button>)}</section> : null}
          {draft.sourceRefs?.length ? <section><h3><Link2 size={15}/>来源</h3>{draft.sourceRefs.map((ref, index) => {
            const web = Boolean(ref.url) && !ref.documentId;
            const host = webSourceHostname(ref.url);
            return <button key={`${ref.documentId || ref.url || index}:${ref.anchor || ''}`} onClick={() => ref.documentId ? onOpenDocument?.({ ...ref, id: ref.documentId, documentId: ref.documentId }) : ref.url && onOpenWeb?.(ref.url)}>{web ? <Globe size={15}/> : <FileText size={15}/>}<span><b>{ref.title || (web ? host || '网页' : '来源文档')}<EvidenceStatusBadge evidence={ref} compact /></b><small>{ref.pageNumber ? `第 ${ref.pageNumber} 页` : ref.anchor || host || (web ? '打开网页' : '打开原文')}</small></span></button>;
          })}</section> : null}
          {draft.attachments?.length ? <section className="note-attachments-section"><h3><Paperclip size={15}/>附件<span>{draft.attachments.length}</span></h3>{draft.attachments.map(attachment => <a className="note-attachment-row" key={attachment.id} href={attachment.downloadUrl || attachment.url} target="_blank" rel="noreferrer" title={`打开或下载 ${attachment.fileName}`}>
            {attachment.isImage ? <ImagePlus size={15}/> : <FileText size={15}/>}<span><b>{attachment.fileName || '附件'}</b><small>{formatNoteAttachmentSize(attachment.byteSize)} · {attachment.isImage ? '笔记内联图片' : '点击下载文件'}</small></span>
          </a>)}</section> : null}
          {(indexedRelations.outgoing.length || outgoingTitles.length) ? <section><h3><Link2 size={15}/>出链{indexedRelations.outgoing.length ? <span>{indexedRelations.outgoing.length}</span> : null}</h3>{indexedRelations.outgoing.length ? <>{indexedRelations.outgoing.slice(0, 80).map(({ edge, node }, index) => <button key={`${edge.id}:${node.id}:${index}`} type="button" onClick={() => openIndexedRelation({ edge, node })} disabled={!['document', 'note'].includes(node.type)}><span><b>{node.title || node.label}</b><small>{edge.label || edge.type}{edge.targetAnchor ? ` · ${edge.targetAnchor}` : ''}{edge.sourceVersionId ? ` · v${edge.sourceVersionId}` : ''}</small></span></button>)}{indexedRelations.outgoing.length > 80 ? <p>仅显示前 80 条关系；当前索引共有 {indexedRelations.outgoing.length} 条。</p> : null}</> : outgoingTitles.map(title => <button key={title} onClick={() => openLinkedNote(title)}><span><b>{title}</b><small>[[双向链接]]</small></span></button>)}</section> : null}
          {(indexedRelations.incoming.length || backlinks.length) ? <section><h3><Layers3 size={15}/>反向链接{indexedRelations.incoming.length ? <span>{indexedRelations.incoming.length}</span> : null}</h3>{indexedRelations.incoming.length ? <>{indexedRelations.incoming.slice(0, 80).map(({ edge, node }, index) => <button key={`${edge.id}:${node.id}:${index}`} type="button" onClick={() => openIndexedRelation({ edge, node })} disabled={!['document', 'note'].includes(node.type)}><span><b>{node.title || node.label}</b><small>{edge.label || edge.type}{edge.sourceAnchor ? ` · ${edge.sourceAnchor}` : ''}{edge.sourceVersionId ? ` · v${edge.sourceVersionId}` : ''}</small></span></button>)}{indexedRelations.incoming.length > 80 ? <p>仅显示前 80 条反向链接；当前索引共有 {indexedRelations.incoming.length} 条。</p> : null}</> : backlinks.map(note => <button key={note.id} onClick={() => select(note)}><span><b>{note.title}</b><small>{noteListPreview(note.content)}</small></span></button>)}</section> : null}
        </aside> : null}
      </div>
    </> : <ModuleWelcome icon={NotebookPen} title="构建你的个人知识层" description="AI 时代沉淀的是容易忘的点。问完这次，把坑记下来，而不用再整篇抄答案。" action={createNote} actionLabel="创建第一篇笔记"/>}</main>
  </>;
}
