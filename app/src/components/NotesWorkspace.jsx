import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import {
  AlertCircle, Archive, ArchiveRestore, Check, FileText, Eye, FileDown, Globe, ImagePlus, Layers3, Link2, ListChecks,
  LoaderCircle, MoreHorizontal, NotebookPen, Paperclip, PencilLine, Plus, Search, Send, Sparkles, Trash2
} from 'lucide-react';
import './WorkspaceModules.css';
import { downloadExport, formatTime, jsonOptions, request } from './WorkspaceModuleShared.jsx';
import { EvidenceStatusBadge } from './EvidenceStatus.jsx';
import { appendAssistantAnswerToNote, applyAssistantAnswerToProblemNote, blankNoteDraft, extraQaCards, isBlankNoteTitle, isProblemNote, nextNoteTitle, NOTE_ASSISTANT_STARTERS, noteHasSubstance, noteHasVisibleRelations, noteListAnswerPreview, noteListPreview, noteListQuestion, parseQaNote, pickOpenNote, PROBLEM_NOTE_STARTERS, problemNoteDraft, replaceQaSection, serializeQaNote } from '../workspace/note-capture.js';
import { mergeNoteSourceRefs, webSourceHostname } from '../workspace/web-browse.js';
import {
  collectNoteDropPayload, collectNotePastePayload, dropLooksLikeFiles, noteAttachmentKind, summarizeNoteIngest
} from '../workspace/note-drop.js';
import {
  NOTES_INDEX_TOKEN, applyPaperTypeKey, buildNotesNavContent, buildSelectionAskPrompt, detectNoteSlash, filterNoteSlashCommands, filterNotesIndexRows, findNoteTextRange, hasNotesIndex, insertNotesIndexBlock, isEmptyBlockCaret,
  notesIndexKindLabel, notesIndexRows, replaceNoteSlash, seedBlankNotePage, shouldCreateBlankNotePage, stripNotesIndexToken, wikiEntryCards
} from '../workspace/note-page.js';
import { PAGE_APPLY_MODES, applyPageAiResult, normalizePageAiResult, normalizePageAskSelection, pageAiApplyLabel, pageKind, resolvePageAiPlan, resolvePageSurface, resolvePaperChrome } from '../workspace/page-architecture.js';
import { createStreamEventBatcher } from '../workspace/stream-events.js';
import {
  NOTE_SAVE_DEBOUNCE_MS,
  createDocumentSaveController,
  jsonBodyWithBaseVersion,
  prepareDocumentSwitch,
  requireSavedRecord,
  sendJsonDocument
} from '../workspace/document-save-controller.js';
import { registerWorkspaceSaveGuard } from '../workspace/workspace-save-guard.js';
import { createDocumentAiRequestController } from '../workspace/document-ai-request.js';

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
  return normalizePageAiResult(value);
}

export function applyNotesAiWritingResult({ content = '', result = '', range = {}, mode = 'replace' } = {}) {
  return applyPageAiResult({ content, result, range, mode });
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
    sourceRefs: Array.isArray(note?.sourceRefs) ? note.sourceRefs : [],
    contentVersionId: note?.contentVersionId ?? note?.currentVersionId ?? null,
    baseVersion: note?.baseVersion ?? note?.contentVersionId ?? note?.currentVersionId ?? null
  };
}

async function sendNoteSnapshot(snapshot, { keepalive } = {}) {
  const tags = [...new Set(String(snapshot.tagsText || '').split(/[，,;；\n]+/).map(item => item.trim()).filter(Boolean))];
  const data = await sendJsonDocument(`/api/notes/${encodeURIComponent(snapshot.id)}`, jsonBodyWithBaseVersion({
    title: snapshot.title,
    content: snapshot.content,
    tags,
    sourceRefs: snapshot.sourceRefs
  }, snapshot), { keepalive });
  const note = requireSavedRecord(data, 'note', '笔记保存响应缺少正文，已保留未保存编辑');
  return { note, tagsText: tags.join('，') };
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
  return <section className="note-ai-suggest" aria-label={title} data-notes-ai-writing="true">
    <header>
      <Sparkles size={16}/>
      <div>
        <b>{title}</b>
        <small>当前范围：{writer.scope} · {helperText}</small>
      </div>
      <button type="button" onClick={onClose}>关闭</button>
    </header>
    <div className="note-ai-suggest-actions" aria-label="AI 帮写操作">{NOTES_AI_ACTIONS.map(item => <button type="button" key={item.id} aria-pressed={writer.action === item.id} disabled={writer.status === 'loading'} onClick={() => onAction(item.id)} title={item.description}>{item.label}</button>)}</div>
    <label className="note-ai-suggest-tone"><span>改写语气</span><select value={writer.tone} disabled={writer.status === 'loading'} onChange={event => onToneChange(event.target.value)}>{NOTES_AI_TONES.map(tone => <option key={tone}>{tone}</option>)}</select></label>
    {writer.status === 'loading' ? <div role="status" className="note-ai-suggest-status"><LoaderCircle className="spin" size={16}/>AI 正在处理，原文保持不变…</div> : null}
    {writer.error ? <div role="alert" className="note-ai-suggest-error"><AlertCircle size={16}/><span>{writer.error}</span></div> : null}
    {writer.original ? <details><summary>查看原文快照（{writer.original.length} 字）</summary><pre>{writer.original}</pre></details> : null}
    {writer.result ? <div className="note-ai-suggest-result"><b>结果预览</b><pre aria-label="AI 帮写结果预览">{writer.result}</pre></div> : null}
    {references?.length ? <details><summary>来源与引用（{references.length}）</summary><ul>{references.map((ref, index) => {
      const documentId = ref.documentId || ref.contentItemId;
      const label = `${ref.title || ref.label || `来源 ${index + 1}`}${ref.pageNumber ? ` · 第 ${ref.pageNumber} 页` : ref.anchor ? ` · ${ref.anchor}` : ''}`;
      return <li key={`${ref.id || documentId || 'source'}:${ref.anchor || index}`}>
        {(documentId || ref.url) && onOpenSource ? <button type="button" className="note-ai-suggest-source" onClick={() => onOpenSource(ref)}><Link2 size={13}/>{label}</button> : label}
      </li>;
    })}</ul></details> : null}
    {writer.status === 'preview' && writer.result ? <div className="note-ai-suggest-apply"><button type="button" className="is-primary" onClick={() => onApply('replace')}><Check size={15}/>替换{writer.scope}</button><button type="button" onClick={() => onApply('insert')}><Plus size={15}/>插入到原文后</button></div> : null}
    {writer.status === 'applied' && writer.appliedMode ? <small className="note-ai-suggest-done">已{writer.appliedMode === 'insert' ? '插入' : '替换'}，原来源引用仍保留</small> : null}
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
  const [dropActive, setDropActive] = useState(false);
  const [webClipOpen, setWebClipOpen] = useState(false);
  const [webClipUrl, setWebClipUrl] = useState('');
  const [slashMenu, setSlashMenu] = useState(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [indexView, setIndexView] = useState('all');
  const [indexDraft, setIndexDraft] = useState('');
  const [indexQuery, setIndexQuery] = useState('');
  const [bodyFocused, setBodyFocused] = useState(true);
  const moreRef = useRef(null);
  const assistantAbortRef = useRef(null);
  const assistantRequestRef = useRef(null);
  if (!assistantRequestRef.current) assistantRequestRef.current = createDocumentAiRequestController();
  const draftRef = useRef(null);
  const dirtyRef = useRef(false);
  const saveRuntimeRef = useRef({});
  const saveControllerRef = useRef(null);
  const selectGenerationRef = useRef(0);
  const aiRequestRef = useRef(null);
  if (!aiRequestRef.current) aiRequestRef.current = createDocumentAiRequestController();
  const editorRef = useRef(null);
  const titleRef = useRef(null);
  const questionRef = useRef(null);
  const titleTouchedRef = useRef(false);
  const searchRef = useRef(null);
  const previewRef = useRef(null);
  const imageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachmentSelectionRef = useRef({ start: 0, end: 0 });
  const attachmentBusyRef = useRef('');
  attachmentBusyRef.current = attachmentBusy;
  if (!saveControllerRef.current) {
    saveControllerRef.current = createDocumentSaveController({
      debounceMs: NOTE_SAVE_DEBOUNCE_MS,
      send: (snapshot, options) => saveRuntimeRef.current.send(snapshot, options),
      onChange: event => saveRuntimeRef.current.onChange(event)
    });
  }
  draftRef.current = draft;
  dirtyRef.current = dirty;
  useLayoutEffect(() => {
    setAiWriter(initialNotesAiWriter());
    return () => {
      aiRequestRef.current.invalidate();
      assistantRequestRef.current.invalidate();
    };
  }, [draft?.id]);

  function closeAssistant() {
    assistantRequestRef.current.invalidate();
    assistantAbortRef.current?.abort();
    setAssistantBusy(false);
    closeAiWriting();
    setAssistantOpen(false);
  }
  function closeAiWriting() {
    aiRequestRef.current.invalidate();
    setAiWriter(initialNotesAiWriter());
  }
  function ownsAiRequest(token) {
    return aiRequestRef.current.isCurrent(token, draftRef.current?.id);
  }
  function publishAiWriting(token, patch) {
    if (!ownsAiRequest(token)) return;
    setAiWriter(current => ownsAiRequest(token) && current.requestToken === token
      ? { ...current, ...patch } : current);
  }
  const visible = useMemo(() => notes.filter(note => {
    if (kindFilter === 'problem' && !isProblemNote(note)) return false;
    if (kindFilter === 'note' && isProblemNote(note)) return false;
    if (!query) return true;
    return `${note.title} ${note.content} ${(note.tags || []).join(' ')}`.toLowerCase().includes(query.toLowerCase());
  }), [notes, query, kindFilter]);
  const outgoingTitles = useMemo(() => [...new Set([...String(draft?.content || '').matchAll(/\[\[([^\]]+)\]\]/g)].map(match => match[1].trim()).filter(Boolean))], [draft?.content]);
  const backlinks = useMemo(() => draft?.title ? notes.filter(note => note.id !== draft.id && String(note.content || '').includes(`[[${draft.title}]]`)) : [], [draft?.id, draft?.title, notes]);
  const renderedMarkdown = useMemo(() => stripNotesIndexToken(String(draft?.content || '')).replace(/\[\[([^\]]+)\]\]/g, (_, title) => `[${title}](#wiki:${encodeURIComponent(title)})`), [draft?.content]);
  const pageCards = useMemo(() => wikiEntryCards(draft?.content || ''), [draft?.content]);
  const indexRows = useMemo(() => filterNotesIndexRows(notesIndexRows(notes, { view: indexView, excludeId: draft?.id }), indexQuery), [notes, indexView, draft?.id, indexQuery]);
  const showNotesIndex = hasNotesIndex(draft?.content);
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
    const current = draftRef.current;
    if (current?.id && (dirtyRef.current || saveControllerRef.current.hasUnsaved(current.id))) {
      saveControllerRef.current.schedule(noteSaveSnapshot(current));
      const gate = await prepareDocumentSwitch(saveControllerRef.current, current.id);
      if (gate.blocked) {
        setSaveError(gate.error);
        onToast?.(gate.error, 'error');
        return;
      }
    }
    setBusy('loading');
    try {
      const data = await request(`/api/notes${nextArchived ? '?archived=true' : ''}`);
      let list = nextArchived ? data.notes.filter(note => note.archived) : data.notes.filter(note => !note.archived);
      if (shouldCreateBlankNotePage(list, { archived: nextArchived })) {
        const existingBlank = (data.notes || []).find(note => !note.archived && !noteHasSubstance(note));
        if (existingBlank) {
          list = [existingBlank, ...list.filter(note => note.id !== existingBlank.id)];
        } else {
          const created = await seedBlankNotePage(() => request('/api/notes', jsonOptions('POST', blankNoteDraft())));
          if (created?.note) {
            list = [created.note];
            onGraphChange?.();
          }
        }
      }
      setNotes(list);
      const next = pickOpenNote(list, { preferredId: initialNoteId, selectedId });
      assistantRequestRef.current.invalidate();
      setAssistantBusy(false);
      closeAiWriting();
      setSelectedId(next?.id || null);
      setDraft(next ? { ...next, tagsText: (next.tags || []).join('，') } : null);
      setBodyFocused(Boolean(next) && !isProblemNote(next) && !String(next.content || '').trim());
      setDirty(false);
      setSaveError('');
      if (next?.id) saveControllerRef.current.acceptBaseline(next.id, next);
    } catch (error) { onToast?.(error.message, 'error'); }
    finally { setBusy(''); }
  }
  useEffect(() => { load(archived); }, [archived]);
  useEffect(() => {
    const controller = saveControllerRef.current;
    const detachLifecycle = controller.attachLifecycle(typeof window === 'undefined' ? null : window);
    const unregisterGuard = registerWorkspaceSaveGuard(async () => {
      if (attachmentBusyRef.current) return { ok: false, error: '附件或网页仍在保存，请稍后再切换。' };
      const current = draftRef.current;
      if (current?.id && (dirtyRef.current || controller.hasUnsaved(current.id) || controller.inspect(current.id)?.hasTimer)) {
        controller.schedule(noteSaveSnapshot(current));
      }
      const result = await controller.flushAll();
      if (result?.ok === false) {
        const message = result.error || '保存尚未完成，已保留当前编辑。';
        setSaveError(message);
        return { ok: false, error: message };
      }
      return { ok: true };
    });
    return () => {
      unregisterGuard();
      detachLifecycle();
      void controller.detach({ keepalive: true });
    };
  }, []);
  useEffect(() => {
    assistantAbortRef.current?.abort();
    setAssistantThread([]);
    setAssistantQuery('');
    setAssistantBusy(false);
  }, [draft?.id]);
  useEffect(() => {
    const linked = notes.find(note => note.id === initialNoteId);
    if (linked && linked.id !== selectedId) void select(linked);
  }, [initialNoteId]);
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
    saveControllerRef.current.schedule(noteSaveSnapshot(draft));
    return undefined;
  }, [draft?.title, draft?.content, draft?.tagsText, draft?.sourceRefs, dirty, saveError]);
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

  async function select(note) {
    if (!note?.id || note.id === selectedId) return false;
    if (attachmentBusyRef.current) { onToast?.('附件或网页仍在保存，请稍后再切换。', 'error'); return false; }
    const generation = ++selectGenerationRef.current;
    const current = draftRef.current;
    if (current?.id && (dirtyRef.current || saveControllerRef.current.hasUnsaved(current.id))) {
      saveControllerRef.current.schedule(noteSaveSnapshot(current));
    }
    const gate = await prepareDocumentSwitch(saveControllerRef.current, current?.id);
    if (generation !== selectGenerationRef.current) return false;
    if (gate.blocked) {
      setSaveError(gate.error);
      onToast?.(gate.error, 'error');
      return false;
    }
    assistantRequestRef.current.invalidate();
    setAssistantBusy(false);
    closeAiWriting();
    saveControllerRef.current.acceptBaseline(note.id, note);
    setSelectedId(note.id);
    titleTouchedRef.current = !isBlankNoteTitle(note.title);
    const nextDraft = { ...note, tagsText: (note.tags || []).join('，') };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setBodyFocused(!isProblemNote(note) && !String(note.content || '').trim());
    setDirty(false);
    setSaveError('');
    setEditorSelection({ start: 0, end: 0 });
    setAiWriter(initialNotesAiWriter());
    setRelationsOpen(false);
    setWikiSuggest(null);
    setWikiSuggestIndex(0);
    setCopiedWiki(false);
    setMoreOpen(false);
    return true;
  }
  function update(patch, aiSnapshot = null) {
    const documentId = draftRef.current?.id;
    const result = { accepted: false, applied: false };
    if (attachmentBusyRef.current) return result;
    // Resolve the queued draft before publishing success or dirty state.
    // AI writeback must validate against the actual preceding edits, not a render snapshot.
    flushSync(() => setDraft(current => {
      result.accepted = result.applied = false;
      if (!current || current.id !== documentId) return current;
      const requestController = aiSnapshot?.requestController || aiRequestRef.current;
      if (aiSnapshot && (!requestController.isCurrent(aiSnapshot.requestToken, current.id)
        || String(current?.content || '') !== aiSnapshot.baseContent)) return current;
      result.accepted = result.applied = true;
      return { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
    }));
    if (result.applied) {
      setDirty(true);
      setSaveError('');
    }
    return result;
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
  function syncSlash(content, caret) {
    const slash = detectNoteSlash(content, caret);
    if (!slash) {
      setSlashMenu(null);
      setSlashIndex(0);
      return;
    }
    const items = filterNoteSlashCommands(slash.query);
    setSlashMenu({ ...slash, items });
    setSlashIndex(0);
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
  function rememberEditorSelection() {
    const current = draftRef.current;
    const input = editorRef.current;
    const contentLength = String(current?.content || '').length;
    const start = Math.max(0, Math.min(contentLength, input?.selectionStart ?? editorSelection.start ?? contentLength));
    const end = Math.max(start, Math.min(contentLength, input?.selectionEnd ?? editorSelection.end ?? start));
    attachmentSelectionRef.current = { start, end };
    return attachmentSelectionRef.current;
  }
  function openAttachmentPicker(kind) {
    rememberEditorSelection();
    (kind === 'image' ? imageInputRef : fileInputRef).current?.click();
  }
  async function uploadNoteAttachment(file, kind, { notify = true } = {}) {
    const current = draftRef.current;
    if (!file || !current?.id) return false;
    setAttachmentBusy(kind || noteAttachmentKind(file));
    try {
      const saved = await saveNote(true);
      if (saved?.ok === false) throw new Error(saved.error || '请先保存笔记再放入文件');
      const noteId = draftRef.current?.id;
      if (!noteId) throw new Error('当前笔记还没准备好');
      const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}/attachments`, {
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
      if (!data.note?.id || !data.markdown) throw new Error('附件响应不完整，未修改笔记');
      saveControllerRef.current.acceptBaseline(noteId, data.note);
      let insertedSelection = attachmentSelectionRef.current;
      setDraft(existing => {
        if (!existing || existing.id !== noteId) return existing;
        const applied = insertNoteAttachmentMarkdown({ content: existing.content, markdown: data.markdown, selection: attachmentSelectionRef.current });
        insertedSelection = applied.selection;
        attachmentSelectionRef.current = { start: applied.selection.end, end: applied.selection.end };
        return { ...existing, content: applied.content, contentVersionId: data.note.contentVersionId, baseVersion: data.note.contentVersionId, attachments: data.note?.attachments || [...(existing.attachments || []), data.attachment], updatedAt: data.note?.updatedAt || existing.updatedAt };
      });
      setNotes(list => list.map(note => note.id === noteId ? { ...note, attachments: data.note?.attachments || [...(note.attachments || []), data.attachment], updatedAt: data.note?.updatedAt || note.updatedAt } : note));
      setDirty(true);
      setSaveError('');
      setMode('edit');
      onGraphChange?.();
      requestAnimationFrame(() => {
        editorRef.current?.focus();
        editorRef.current?.setSelectionRange(insertedSelection.start, insertedSelection.end);
        setEditorSelection(insertedSelection);
      });
      if (notify) onToast?.(data.attachment?.isImage ? '图片已放入这篇笔记' : '文件已放入这篇笔记');
      return true;
    } catch (error) {
      onToast?.(error.message || '文件没有放进去', 'error');
      return false;
    } finally {
      setAttachmentBusy('');
      if (imageInputRef.current) imageInputRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }
  async function insertNoteWebClip(rawUrl, { notify = true } = {}) {
    const current = draftRef.current;
    if (!current?.id) return false;
    const raw = String(rawUrl || '').trim();
    if (!raw) {
      setWebClipOpen(true);
      setWebClipUrl('');
      return false;
    }
    setAttachmentBusy('web');
    try {
      const saved = await saveNote(true);
      if (saved?.ok === false) throw new Error(saved.error || '请先保存笔记再放入网页');
      const noteId = draftRef.current?.id;
      const data = await request(`/api/notes/${encodeURIComponent(noteId)}/web-clip`, jsonOptions('POST', { url: raw }));
      if (!data.note?.id) throw new Error('网页保存响应不完整');
      saveControllerRef.current.acceptBaseline(noteId, data.note);
      setDraft(existing => existing && existing.id === noteId ? { ...existing, ...data.note } : existing);
      setNotes(list => list.map(note => note.id === noteId ? { ...note, ...data.note } : note));
      setDirty(false);
      setWebClipOpen(false);
      setWebClipUrl('');
      if (notify) onToast?.('网页已放入这篇笔记');
      return true;
    } catch (error) {
      onToast?.(error.message || '网页没有放进去', 'error');
      return false;
    } finally {
      setAttachmentBusy('');
    }
  }
  async function ingestNotePayload({ files = [], urls = [] } = {}) {
    if (attachmentBusyRef.current) return;
    const fileList = [...files].filter(Boolean);
    const linkList = [...urls].filter(Boolean);
    if (!fileList.length && !linkList.length) return;
    rememberEditorSelection();
    if (!draftRef.current?.id) {
      const created = await createNote('note');
      if (!created?.id) return;
    }
    let ok = 0;
    for (const file of fileList) {
      if (await uploadNoteAttachment(file, noteAttachmentKind(file), { notify: false })) ok += 1;
    }
    for (const url of linkList) {
      if (await insertNoteWebClip(url, { notify: false })) ok += 1;
    }
    const summary = summarizeNoteIngest({ files: fileList, urls: linkList });
    if (ok && summary) onToast?.(summary);
  }
  function handleNoteDragOver(event) {
    if (!dropLooksLikeFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  }
  function handleNoteDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDropActive(false);
  }
  function handleNoteDrop(event) {
    if (!dropLooksLikeFiles(event.dataTransfer) && !event.dataTransfer?.files?.length) return;
    event.preventDefault();
    setDropActive(false);
    const payload = collectNoteDropPayload(event.dataTransfer);
    if (payload.hasPayload) void ingestNotePayload(payload);
  }
  function handleNotePaste(event, { allowUrl = false } = {}) {
    const payload = collectNotePastePayload(event.clipboardData);
    if (payload.files.length) {
      event.preventDefault();
      event.stopPropagation();
      void ingestNotePayload({ files: payload.files });
      return;
    }
    if (allowUrl && payload.urls.length && payload.intercept) {
      event.preventDefault();
      event.stopPropagation();
      void ingestNotePayload({ urls: payload.urls });
    }
  }
  function handlePickedFiles(list) {
    const files = [...(list || [])].filter(Boolean);
    if (files.length) void ingestNotePayload({ files });
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
    aiRequestRef.current.invalidate();
    const snapshot = currentWritingSnapshot();
    setAiWriter(current => ({ ...initialNotesAiWriter(), open: true, tone: current.tone || NOTES_AI_TONES[0], ...snapshot }));
  }
  async function runAiWriting(action) {
    const requestToken = aiRequestRef.current.begin(draftRef.current?.id);
    if (!requestToken) return;
    const snapshot = currentWritingSnapshot();
    if (!snapshot.original.trim()) {
      setAiWriter(current => ({ ...current, open: true, action, ...snapshot, status: 'error', error: '请先在笔记中写入内容，再使用 AI 帮写。', result: '' }));
      return;
    }
    const tone = aiWriter.tone || NOTES_AI_TONES[0];
    const prompt = buildNotesAiWritingPrompt({ action, tone, title: draft?.title, original: snapshot.original, scope: snapshot.scope, sourceRefs: draft?.sourceRefs || [] });
    setAiWriter(current => ({ ...current, open: true, action, tone, ...snapshot, requestToken, status: 'loading', result: '', error: '', citations: [], model: null, appliedMode: '' }));
    try {
      const documentIds = [...new Set((draft?.sourceRefs || []).map(ref => ref?.documentId).filter(Boolean).map(String))];
      const response = await fetch('/api/skills/run', { ...jsonOptions('POST', { skillId: 'smart-writing', input: prompt, query: prompt, documentIds }), signal: requestToken.signal });
      const generated = await readNotesAiWritingStream(response, { onDelta: result => publishAiWriting(requestToken, { result }) });
      publishAiWriting(requestToken, { status: 'preview', result: generated.result, citations: generated.citations, model: generated.model, error: '' });
    } catch (error) {
      publishAiWriting(requestToken, { status: 'error', error: error.message || 'AI 帮写失败' });
    }
  }
  function applyAiWriting(modeToApply) {
    if (attachmentBusyRef.current) return;
    if (!draft || !aiWriter.open || !aiWriter.result || aiWriter.status !== 'preview' || !ownsAiRequest(aiWriter.requestToken)) return;
    if (String(draft.content || '') !== aiWriter.baseContent) {
      setAiWriter(current => ({ ...current, status: 'error', error: '生成期间笔记内容已经变化。为避免覆盖新内容，请重新选择范围并生成。' }));
      return;
    }
    try {
      const applied = applyPageAiResult({ content: draft.content, result: aiWriter.result, range: aiWriter.range, mode: modeToApply });
      const result = update({ content: applied.content, sourceRefs: mergeNoteSourceRefs(draft.sourceRefs, aiWriter.citations) }, aiWriter);
      if (!result?.accepted) return;
      setAiWriter(current => ({ ...current, status: 'applied', appliedMode: modeToApply, error: '', baseContent: applied.content }));
      requestAnimationFrame(() => {
        if (!ownsAiRequest(aiWriter.requestToken)) return;
        editorRef.current?.focus();
        editorRef.current?.setSelectionRange(applied.selection.start, applied.selection.end);
        setEditorSelection(applied.selection);
      });
      onToast?.(modeToApply === 'insert' ? 'AI 结果已插入，原文和来源均已保留' : 'AI 结果已替换所选范围，来源引用仍保留');
      setBodyFocused(false);
    } catch (error) {
      setAiWriter(current => ({ ...current, status: 'error', error: error.message || '写入 AI 结果失败' }));
    }
  }
  async function createNote(kind = 'note') {
    if (attachmentBusy) return;
    if (draftRef.current?.id) {
      const saved = await saveNote(true);
      if (saved?.ok === false) { onToast?.(saved.error || '请先保存当前笔记', 'error'); return; }
    }
    setBusy('create');
    try {
      const payload = kind === 'problem' ? problemNoteDraft() : blankNoteDraft();
      const data = await request('/api/notes', jsonOptions('POST', payload));
      onGraphChange?.();
      setArchived(false); setNotes(current => [data.note, ...current]);
      titleTouchedRef.current = kind === 'problem';
      await select(data.note);
      setMode('edit');
      setBodyFocused(kind !== 'problem');
      requestAnimationFrame(() => {
        if (kind === 'problem') questionRef.current?.focus();
        else titleRef.current?.focus();
      });
      return data.note;
    } catch (error) { onToast?.(error.message, 'error'); return null; } finally { setBusy(''); }
  }
  async function persistSiblingNote(payload) {
    if (draftRef.current?.id) {
      const saved = await saveNote(true);
      if (saved?.ok === false) throw new Error(saved.error || '请先保存当前笔记');
    }
    const data = await request('/api/notes', jsonOptions('POST', payload));
    onGraphChange?.();
    setNotes(current => [data.note, ...current]);
    return data.note;
  }
  async function createLinkedNote(titleHint = '') {
    const slash = slashMenu;
    try {
      const title = String(titleHint || '').trim() || '无标题笔记';
      const note = await persistSiblingNote({ ...blankNoteDraft(), title });
      const current = draftRef.current;
      if (current?.id) {
        const inserted = `[[${note.title}]]`;
        const next = slash ? replaceNoteSlash(current.content, slash, inserted) : `${current.content || ''}${current.content?.endsWith('\n') ? '' : '\n'}${inserted}`;
        update({ content: next });
      }
      setSlashMenu(null);
      onToast?.(`已链到「${note.title}」`);
      return note;
    } catch (error) {
      onToast?.(error.message, 'error');
      return null;
    }
  }
  async function createFromIndex(event) {
    event?.preventDefault?.();
    const title = String(indexDraft || '').trim();
    if (!title) return;
    setIndexDraft('');
    const note = await persistSiblingNote({ ...blankNoteDraft(), title }).catch(error => {
      onToast?.(error.message, 'error');
      return null;
    });
    if (note) onToast?.(`已新建「${note.title}」`);
  }
  function applySlashInsert(insert) {
    const current = draftRef.current;
    if (!current || !slashMenu) return;
    const next = replaceNoteSlash(current.content, slashMenu, insert);
    update({ content: next });
    setSlashMenu(null);
    requestAnimationFrame(() => {
      const caret = slashMenu.start + String(insert || '').length;
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(caret, caret);
      setEditorSelection({ start: caret, end: caret });
    });
  }
  async function runSlashCommand(item) {
    if (!item) return;
    if (item.id === 'file') { applySlashInsert(''); openAttachmentPicker('file'); return; }
    if (item.id === 'web') { applySlashInsert(''); setWebClipOpen(true); return; }
    if (item.id === 'ask') { applySlashInsert(''); setAssistantOpen(true); return; }
    if (item.id === 'index') {
      const current = draftRef.current;
      const cleared = slashMenu ? replaceNoteSlash(current.content, slashMenu, '') : current.content;
      const next = insertNotesIndexBlock(cleared, slashMenu?.start || cleared.length);
      update({ content: next.content });
      setSlashMenu(null);
      return;
    }
    if (item.id === 'organize') {
      const current = draftRef.current;
      const cleared = slashMenu ? replaceNoteSlash(current.content, slashMenu, '') : current.content;
      update({ content: buildNotesNavContent({ title: current.title, notes, content: cleared }) });
      setSlashMenu(null);
      setAssistantOpen(true);
      void askAssistant(null, '用两三句说明这一页怎么用。只根据快速入口和索引里已有的笔记，不要编造。');
      return;
    }
    if (item.id === 'page') {
      await createLinkedNote(slashMenu?.query);
      return;
    }
    if (item.id === 'problem') {
      applySlashInsert('');
      await createNote('problem');
    }
  }
  function handleNoteSaveChange(event) {
    const currentId = draftRef.current?.id;
    if (event.status === 'saving' && event.id === currentId) setBusy('save');
    if (event.status === 'saved' && !event.conflict) {
      const note = event.result?.note;
      if (note) {
        setNotes(list => list.map(item => item.id === note.id ? note : item));
        if (currentId === note.id) {
          draftRef.current = { ...note, tagsText: event.result.tagsText ?? draftRef.current?.tagsText };
          dirtyRef.current = false;
        }
        setDraft(current => current?.id === note.id ? { ...note, tagsText: event.result.tagsText ?? current.tagsText } : current);
      }
      if (event.id === currentId) {
        setDirty(false);
        setSaveError('');
        setBusy(busy => busy === 'save' ? '' : busy);
      }
      onGraphChange?.();
    }
    if (event.status === 'error' && event.id === currentId) {
      setSaveError(event.error || '笔记保存失败');
      setBusy(busy => busy === 'save' ? '' : busy);
      onToast?.(event.error || '笔记保存失败', 'error');
    }
  }
  saveRuntimeRef.current = { send: sendNoteSnapshot, onChange: handleNoteSaveChange };
  async function saveNote(silent = false) {
    if (!draft?.id) return;
    if (dirty) saveControllerRef.current.schedule(noteSaveSnapshot(draft));
    const result = saveError
      ? await saveControllerRef.current.retry(draft.id)
      : await saveControllerRef.current.flush(draft.id);
    if (result?.ok && !result.skipped && !silent) onToast?.('笔记已保存');
    return result;
  }
  async function archiveNote() {
    if (!draft?.id || attachmentBusy) return;
    try {
      const saved = await saveNote(true);
      if (saved?.ok === false) throw new Error(saved.error || '请先保存笔记');
      const current = draftRef.current;
      const data = await request(`/api/notes/${current.id}`, jsonOptions('PATCH', { archived: !current.archived, baseVersion: current.contentVersionId }));
      saveControllerRef.current.acceptBaseline(current.id, data.note);
      draftRef.current = { ...data.note, tagsText: (data.note.tags || []).join('，') };
      dirtyRef.current = false;
      setDraft(draftRef.current); setDirty(false);
      onGraphChange?.(); onToast?.(current.archived ? '笔记已恢复' : '笔记已归档');
      await load(archived);
    } catch (error) { onToast?.(error.message, 'error'); }
  }
  async function deleteNote() {
    if (!draft?.id || attachmentBusy) return;
    try {
      const saved = await saveNote(true);
      if (saved?.ok === false) throw new Error(saved.error || '请先保存笔记');
      await request(`/api/notes/${draft.id}`, { method: 'DELETE' });
      assistantRequestRef.current.invalidate();
      setAssistantBusy(false);
      closeAiWriting();
      draftRef.current = null; dirtyRef.current = false;
      setDraft(null); setDirty(false);
      onGraphChange?.(); onToast?.('笔记已移入回收状态'); await load(archived);
    } catch (error) { onToast?.(error.message, 'error'); }
  }
  async function exportNote(format) {
    try {
      const saved = await saveNote(true);
      if (saved?.ok === false) throw new Error(saved.error || '请先保存笔记再导出');
      await downloadExport({ entityType: 'note', entityId: draft.id, format }, onToast);
    } catch (error) { onToast?.(error.message, 'error'); }
  }

  const saveLabel = attachmentBusy ? '正在保存附件或网页，完成后可继续编辑' : saveError ? '保存失败，笔记仍保留在当前页面' : dirty ? '正在等待自动保存' : `已保存 · ${formatTime(draft?.updatedAt)}`;
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
  const pageSurface = draft ? resolvePageSurface({
    kind: pageKind(draft),
    mode,
    bodyFocused,
    content: draft.content,
    slashOpen: Boolean(slashMenu),
    wikiOpen: Boolean(wikiSuggest),
    busy: Boolean(attachmentBusy)
  }) : { showSource: false, showPage: false };
  const paperChrome = draft ? resolvePaperChrome({
    kind: pageKind(draft),
    mode,
    bodyFocused,
    slashOpen: Boolean(slashMenu),
    wikiOpen: Boolean(wikiSuggest),
    webClipOpen,
    hasTags: Boolean(String(draft.tagsText || '').trim())
  }) : { paperEditing: false, showFormatToolbar: false, showTags: false, lookAtPage: false };
  const showSourceEditor = Boolean(pageSurface.showSource);
  const showLivePage = Boolean(pageSurface.showPage);
  const noteAskPlan = resolvePageAiPlan({ verb: 'ask', kind: pageKind(draft), hasSelection: hasEditorSelection, requestedMode: 'auto' });
  function beginPageEdit(event) {
    if (event?.target?.closest?.('a,button,input,textarea,label,.note-index-embed,.note-page-cards,.note-selection-bubble,.note-ai-suggest')) return;
    setMode('edit');
    setBodyFocused(true);
    requestAnimationFrame(() => editorRef.current?.focus());
  }
  function leavePaperEditing(event) {
    if (slashMenu || wikiSuggest || webClipOpen) return;
    if (event?.relatedTarget?.closest?.('.note-slash-menu,.note-wiki-suggest,.note-format-toolbar,.note-selection-bubble,.note-assistant-panel,.editor-title,.editor-tags')) return;
    setBodyFocused(false);
  }
  function typeOnPaper(event) {
    if (showSourceEditor) return;
    if (event?.target?.closest?.('a,button,input,textarea,label,.note-index-embed,.note-page-cards,.note-selection-bubble,.note-ai-suggest')) return;
    const current = draftRef.current;
    if (!current || isProblemNote(current)) return;
    const next = applyPaperTypeKey(current.content || '', event);
    if (!next) return;
    event.preventDefault();
    setMode('edit');
    setBodyFocused(true);
    update({ content: next.content });
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(next.caret, next.caret);
      setEditorSelection({ start: next.caret, end: next.caret });
      syncSlash(next.content, next.caret);
      syncWikiSuggest(next.content, next.caret);
    });
  }

  async function askAssistant(event, overrideText) {
    event?.preventDefault?.();
    const text = String(overrideText ?? assistantQuery ?? '').trim();
    const currentNote = draftRef.current;
    if (!text || !currentNote || assistantBusy) return;
    const userId = `note-ask-user-${Date.now()}`;
    const assistantId = `note-ask-ai-${Date.now()}`;
    assistantAbortRef.current?.abort();
    const requestToken = assistantRequestRef.current.begin(currentNote.id);
    const controller = requestToken.controller;
    const ownsRequest = () => assistantRequestRef.current.isCurrent(requestToken, draftRef.current?.id);
    const baseContent = String(currentNote.content || '');
    assistantAbortRef.current = controller;
    setAssistantQuery('');
    setAssistantBusy(true);
    setAssistantThread(current => [...current, { id: userId, role: 'user', text }, { id: assistantId, documentId: currentNote.id, role: 'assistant', text: '', status: '正在阅读这篇笔记' }]);
    const streamBatcher = createStreamEventBatcher({
      onFlush(events) {
        if (!ownsRequest()) return;
        setAssistantThread(current => !ownsRequest() ? current : current.map(message => {
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
          documentIds: [String(currentNote.id)],
          includeKnowledgeBase: false,
          surface: 'note-assistant',
          readerDocumentId: currentNote.id,
          noteContext: { id: currentNote.id, title: currentNote.title, content: currentNote.content || '' },
          selection: normalizePageAskSelection(currentNote, (() => {
            const snapshot = currentWritingSnapshot();
            return snapshot.scope === '当前选区' && snapshot.original.trim()
              ? { quote: snapshot.original, startOffset: snapshot.range.start, endOffset: snapshot.range.end }
              : null;
          })()) || undefined
        })
      });
      const answer = await readNoteAssistantStream(response, {
        onEvent: event => streamBatcher.push(event)
      });
      streamBatcher.flush();
      if (!ownsRequest()) return;
      let applied = '';
      if (isProblemNote(draftRef.current) && String(draftRef.current?.content || '') === baseContent) {
        const writeResult = writeAssistantIntoNote({ text: answer, documentId: requestToken.documentId }, 'pitfall', { question: text, requestToken, baseContent });
        applied = writeResult?.accepted ? writeResult.applied : '';
      }
      setAssistantThread(current => !ownsRequest() ? current : current.map(message => message.id === assistantId ? { ...message, status: '', text: answer, done: true, applied } : message));
    } catch (error) {
      streamBatcher.flush();
      if (!ownsRequest() || error.name === 'AbortError') return;
      setAssistantThread(current => !ownsRequest() ? current : current.map(message => message.id === assistantId ? { ...message, status: '', error: error.message || '提问失败', done: true } : message));
    } finally {
      if (ownsRequest()) setAssistantBusy(false);
    }
  }

  function writeAssistantIntoNote(message, fields = 'both', { question = '', silent = false, requestToken = null, baseContent = null } = {}) {
    const answer = String(message?.text || '').trim();
    const target = draftRef.current;
    if (!answer || !target || message?.documentId !== target.id) return { applied: '', accepted: false };
    const requestedFields = fields;
    const updateResult = update(current => {
      // Explicit writes merge with preceding queued edits. Automatic writes reach
      // this callback only after update has checked the token and baseContent.
      fields = isProblemNote(current) && requestedFields !== 'note' ? requestedFields : 'note';
      return {
        content: fields === 'note'
          ? appendAssistantAnswerToNote(current.content, answer)
          : applyAssistantAnswerToProblemNote({
            content: current.content,
            question: question || parseQaNote(current.content).question,
            answer,
            fields
          })
      };
    }, requestToken && { requestToken, requestController: assistantRequestRef.current, baseContent: String(baseContent ?? target.content) });
    if (!updateResult?.accepted) return { applied: '', accepted: false };
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
    const appliedMessage = fields;
    return { applied: appliedMessage, accepted: true };
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
    if (action === 'ask') {
      setAssistantOpen(true);
      void askAboutSelection();
      return;
    }
    openAiWriting();
    void runAiWriting(action);
  }
  function capturePreviewSelection() {
    const quote = String(window.getSelection?.()?.toString() || '').trim();
    if (!quote || !draftRef.current) return;
    const range = findNoteTextRange(draftRef.current.content, quote);
    if (range) setEditorSelection(range);
  }
  function askAboutSelection() {
    const snapshot = currentWritingSnapshot();
    const quote = snapshot.scope === '当前选区' ? String(snapshot.original || '').trim() : '';
    setAssistantOpen(true);
    if (!quote) return;
    const prompt = buildSelectionAskPrompt(quote);
    setAssistantQuery(prompt);
    void askAssistant(null, prompt);
  }
  function applyAssistantToPage(message, mode = 'auto') {
    const answer = String(message?.text || '').trim();
    const current = draftRef.current;
    if (!answer || !current) return;
    const snapshot = currentWritingSnapshot();
    const hasSel = snapshot.scope === '当前选区' && snapshot.original.trim();
    const plan = resolvePageAiPlan({
      verb: 'ask',
      kind: pageKind(current),
      hasSelection: hasSel,
      requestedMode: mode
    });
    if (plan.applyMode === PAGE_APPLY_MODES.field) {
      writeAssistantIntoNote(message, plan.field);
      return;
    }
    try {
      const applied = applyPageAiResult({ content: current.content, result: answer, range: snapshot.range, mode: plan.applyMode });
      const result = update({ content: applied.content });
      if (!result?.accepted) return;
      setAssistantThread(thread => thread.map(item => item.id === message.id ? { ...item, applied: 'note' } : item));
      requestAnimationFrame(() => {
        editorRef.current?.focus();
        editorRef.current?.setSelectionRange(applied.selection.start, applied.selection.end);
        setEditorSelection(applied.selection);
      });
      onToast?.(plan.applyMode === PAGE_APPLY_MODES.replace ? '已替换选区' : '已用上');
      setBodyFocused(false);
    } catch (error) {
      onToast?.(error.message || '没有用上', 'error');
    }
  }

  return <>
    <aside className="side-panel module-side note-side">
      <div className="side-head"><button type="button" className="note-search-toggle" aria-label="搜索笔记" onClick={() => searchRef.current?.focus()}><Search size={18}/></button><div className="side-head-actions"><button type="button" aria-label="新建问题记录" title="记下这次容易忘的点" onClick={() => createNote('problem')}><ListChecks size={17}/></button><button type="button" aria-label="新建笔记" onClick={createNote}><Plus size={17}/></button></div></div>
      <div className="search-box"><Search size={15}/><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索笔记和标签"/></div>
      <div className="module-tabs note-kind-tabs" role="tablist" aria-label="笔记筛选"><button type="button" className={!archived && kindFilter !== 'problem' ? 'active' : ''} onClick={() => { setArchived(false); setKindFilter('all'); }}>全部</button><button type="button" className={!archived && kindFilter === 'problem' ? 'active' : ''} onClick={() => { setArchived(false); setKindFilter('problem'); }}>问题记录</button><button type="button" className={archived ? 'active' : ''} onClick={() => setArchived(true)}>已归档</button></div>
      <div className="module-list">{busy === 'loading' ? <div className="module-empty"><LoaderCircle className="spin"/>读取笔记…</div> : visible.length ? visible.map(note => <button key={note.id} className={`${selectedId === note.id ? 'active' : ''}${isProblemNote(note) ? ' is-problem' : ''}`} title={noteListAnswerPreview(note)} onClick={() => select(note)}>{isProblemNote(note) ? <ListChecks size={16}/> : <NotebookPen size={16}/>}<span><b>{noteListQuestion(note)}</b><small>{noteListAnswerPreview(note)}</small></span></button>) : <div className="module-empty"><NotebookPen size={25}/><b>暂无笔记</b><small>点右上角 +，直接写一张白纸</small></div>}</div>
    </aside>
    <main className={`workspace module-workspace${dropActive ? ' is-dropping' : ''}`} onDragOver={handleNoteDragOver} onDragLeave={handleNoteDragLeave} onDrop={handleNoteDrop}>{draft ? <>
      <header className="workspace-head note-editor-toolbar"><div className="workspace-title"><small role={saveError ? 'alert' : 'status'}>{saveLabel}</small></div><div className="head-actions">{saveError ? <button type="button" className="writing-retry-save" onClick={() => saveNote(false)} disabled={busy === 'save'}>重试保存</button> : null}<button type="button" className={`note-preview-toggle${assistantOpen ? ' is-active' : ''}`} onClick={() => setAssistantOpen(current => !current)} aria-pressed={assistantOpen} aria-label="问这篇笔记"><Sparkles size={15}/>问这篇</button><div className="note-mode-switch"><button className={mode === 'edit' ? 'active' : ''} onClick={() => { setMode('edit'); setBodyFocused(true); }}><PencilLine size={15}/>编辑</button><button className={mode === 'read' ? 'active' : ''} onClick={() => { setMode('read'); setBodyFocused(false); setPreviewOpen(false); }}><Eye size={15}/>阅读</button></div><div className={`note-more ${moreOpen ? 'is-open' : ''}`} ref={moreRef}><button type="button" className={`note-more-toggle${moreOpen ? ' is-active' : ''}`} onClick={() => setMoreOpen(current => !current)} aria-label="更多操作" aria-expanded={moreOpen}><MoreHorizontal size={16}/></button><div className="note-more-menu" role="menu">{mode === 'edit' ? <><button type="button" role="menuitem" onClick={() => { applyMarkdown('## ', '', '小节标题'); setMoreOpen(false); }}>标题</button><button type="button" role="menuitem" onClick={() => { applyMarkdown('**', '**', '重点'); setMoreOpen(false); }}>加粗</button><button type="button" role="menuitem" onClick={() => { applyMarkdown('[[', ']]', '笔记标题'); setMoreOpen(false); }}>双向链接</button><button type="button" role="menuitem" className="note-attachment-tool" disabled={Boolean(attachmentBusy)} onClick={() => { openAttachmentPicker('image'); setMoreOpen(false); }}>{attachmentBusy === 'image' ? <LoaderCircle className="spin" size={14}/> : <ImagePlus size={14}/>}图片</button><button type="button" role="menuitem" className="note-attachment-tool" disabled={Boolean(attachmentBusy)} onClick={() => { setWebClipOpen(true); setMoreOpen(false); }}><Globe size={14}/>网页</button><button type="button" role="menuitem" className="note-attachment-tool" disabled={Boolean(attachmentBusy)} onClick={() => { openAttachmentPicker('file'); setMoreOpen(false); }}>{attachmentBusy === 'file' ? <LoaderCircle className="spin" size={14}/> : <Paperclip size={14}/>}文件</button><button type="button" role="menuitem" className="note-ai-writing-tool" onClick={() => { openAiWriting(); setMoreOpen(false); }}><Sparkles size={14}/>AI 帮写</button></> : null}<button type="button" role="menuitem" onClick={() => { setAssistantOpen(true); setMoreOpen(false); }}>问这篇笔记</button>{onAskAboutNote ? <button type="button" role="menuitem" title="到对话里继续" onClick={() => { onAskAboutNote(draft, '', hasEditorSelection ? { quote: String(draft.content || '').slice(editorSelection.start, editorSelection.end), startOffset: editorSelection.start, endOffset: editorSelection.end } : null); setMoreOpen(false); }}>在对话里问这篇</button> : null}{mode === 'edit' ? <button type="button" role="menuitem" onClick={() => { setPreviewOpen(current => !current); setMoreOpen(false); }}>{previewOpen ? '收起对照' : '对照预览'}</button> : null}{relationsAvailable ? <button type="button" role="menuitem" onClick={() => { setRelationsOpen(current => !current); setMoreOpen(false); }}>{relationsOpen ? '收起关系' : `关系${relationCount ? ` ${relationCount}` : ''}`}</button> : null}<button type="button" role="menuitem" onClick={() => { saveNote(false); setMoreOpen(false); }} disabled={!dirty || busy === 'save'}>保存</button>{draft.title ? <button type="button" role="menuitem" onClick={() => { void copyNoteWikiLink(); setMoreOpen(false); }}>{copiedWiki ? '已复制双链' : '复制双链'}</button> : null}{String(draft.content || '').trim() ? <><button type="button" role="menuitem" className="export-button" onClick={() => { exportNote('markdown'); setMoreOpen(false); }}>导出 MD</button><button type="button" role="menuitem" className="export-button" onClick={() => { exportNote('html'); setMoreOpen(false); }}>导出 HTML</button></> : null}<button type="button" role="menuitem" onClick={() => { archiveNote(); setMoreOpen(false); }}>{draft.archived ? '恢复笔记' : '归档笔记'}</button><button type="button" role="menuitem" className="danger-lite" onClick={() => { deleteNote(); setMoreOpen(false); }}>删除笔记</button></div></div></div></header>
      <div className={gridClass}>
        <section className={`editor-canvas note-editor-canvas${paperChrome.paperEditing ? ' is-paper-editing' : ''}${paperChrome.lookAtPage ? ' is-look-at-page' : ''}`} data-paper-surface="true" onPaste={event => handleNotePaste(event)}>
          <input ref={titleRef} name="note-title" readOnly={Boolean(attachmentBusy)} className="editor-title" value={isBlankNoteTitle(draft.title) ? '' : draft.title} onChange={event => { titleTouchedRef.current = true; update({ title: event.target.value.trim() ? event.target.value : '无标题笔记' }); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (isProblemNote(draft)) questionRef.current?.focus(); else { setBodyFocused(true); editorRef.current?.focus(); } } }} placeholder={isProblemNote(draft) ? '这个问题下次还会再遇到' : '无标题'}/>
          <input className={`editor-tags${paperChrome.showTags ? '' : ' is-paper-chrome-hidden'}`} value={draft.tagsText || ''} onChange={event => update({ tagsText: event.target.value })} placeholder="标签，以逗号分隔" aria-label="标签"/>
          {mode !== 'read' && !isProblemNote(draft) ? <div className={`markdown-toolbar note-format-toolbar${paperChrome.showFormatToolbar ? ' is-open' : ''}`} hidden={!paperChrome.showFormatToolbar} role="toolbar" aria-label="笔记格式">
             <button type="button" onClick={() => applyMarkdown('## ', '', '小节标题')}>标题</button>
             <button type="button" onClick={() => applyMarkdown('**', '**', '重点')}>加粗</button>
             <button type="button" onClick={() => applyMarkdown('[[', ']]', '笔记标题')}>双向链接</button>
             <button type="button" onClick={() => { const next = insertNotesIndexBlock(draft.content || '', editorRef.current?.selectionStart || String(draft.content || '').length); update({ content: next.content }); }}>索引</button>
             <span className="markdown-toolbar-divider"/>
             <button type="button" className="note-attachment-tool" disabled={Boolean(attachmentBusy)} onClick={() => openAttachmentPicker('image')}>{attachmentBusy === 'image' ? <LoaderCircle className="spin" size={14}/> : <ImagePlus size={14}/>}图片</button>
             <button type="button" className="note-attachment-tool" disabled={Boolean(attachmentBusy)} onClick={() => { setWebClipOpen(true); setMoreOpen(false); }}>{attachmentBusy === 'web' ? <LoaderCircle className="spin" size={14}/> : <Globe size={14}/>}<span>网页</span></button>
             <button type="button" className="note-attachment-tool" disabled={Boolean(attachmentBusy)} onClick={() => openAttachmentPicker('file')}>{attachmentBusy === 'file' ? <LoaderCircle className="spin" size={14}/> : <Paperclip size={14}/>}文件</button>
             <span className="markdown-toolbar-divider"/>
             <button type="button" className="note-ai-writing-tool" onClick={() => { setAssistantOpen(true); update({ content: buildNotesNavContent({ title: draft.title, notes, content: draft.content }) }); void askAssistant(null, '用两三句说明这一页怎么用。只根据快速入口和索引里已有的笔记，不要编造。'); }}><Sparkles size={14}/>整理这一页</button>
             {webClipOpen ? <input className="note-web-clip-input" value={webClipUrl} autoFocus placeholder="粘贴链接，回车放入" aria-label="放入网页" onChange={event => setWebClipUrl(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void insertNoteWebClip(webClipUrl); } if (event.key === 'Escape') { setWebClipOpen(false); setWebClipUrl(''); } }} onBlur={() => { if (!webClipUrl.trim()) setWebClipOpen(false); }}/> : null}
           </div> : null}
          {showSourceEditor ? <>
            <input ref={imageInputRef} className="note-file-input" type="file" accept="image/*" multiple tabIndex={-1} onChange={event => handlePickedFiles(event.target.files)}/>
            <input ref={fileInputRef} className="note-file-input" type="file" multiple tabIndex={-1} onChange={event => handlePickedFiles(event.target.files)}/>
            <div className={previewOpen ? 'note-split-editor' : 'note-source-only'}>
              <div className="note-source-pane">
                {isProblemNote(draft) ? <div className="note-qa-editor" aria-label="问题记录编辑">
                  <label><span>问题</span><textarea ref={questionRef} readOnly={Boolean(attachmentBusy)} value={selectedQa?.question || ''} onChange={event => updateQaField('question', event.target.value)} rows={3} placeholder="这次卡住的是什么？" /></label>
                  <label><span>这次怎么解决的</span><textarea readOnly={Boolean(attachmentBusy)} value={selectedQa?.resolution || ''} onChange={event => updateQaField('resolution', event.target.value)} rows={5} placeholder="只记这次真正用上的做法，不必整篇教程" /></label>
                  <label><span>下次容易忘的点</span><textarea readOnly={Boolean(attachmentBusy)} value={selectedQa?.pitfall || ''} onChange={event => updateQaField('pitfall', event.target.value)} rows={4} placeholder="例如：出锅前再看一眼葱花" /></label>
                  {selectedQa?.extra ? <label><span>其他（会保留）</span><textarea readOnly={Boolean(attachmentBusy)} value={selectedQa.extra} onChange={event => updateQaField('extra', event.target.value)} rows={4} placeholder="关联资料等额外小节" /></label> : null}
                </div> : null}
                {hasEditorSelection && !isProblemNote(draft) ? <div className="note-selection-bubble" role="toolbar" aria-label="选区帮写"><button type="button" className="is-primary" onClick={() => runAssistantAction('ask')}>问 AI</button><button type="button" onClick={() => runAssistantAction('polish')}>润色</button><button type="button" onClick={() => runAssistantAction('continue')}>续写</button><button type="button" onClick={() => runAssistantAction('summarize')}>总结</button></div> : null}
                {isProblemNote(draft) ? null : <textarea readOnly={Boolean(attachmentBusy)} ref={editorRef} className="editor-body markdown-editor-body" value={draft.content || ''} placeholder="写点什么。空行按空格问 AI，输入 / 新建页面或放文件。" onFocus={() => setBodyFocused(true)} onBlur={leavePaperEditing} onPaste={event => handleNotePaste(event, { allowUrl: true })} onChange={event => { const content = event.target.value; update({ content, title: nextNoteTitle({ title: draft.title, content, titleTouched: titleTouchedRef.current }) }); syncWikiSuggest(content, event.currentTarget.selectionStart); syncSlash(content, event.currentTarget.selectionStart); }} onSelect={event => { const start = event.currentTarget.selectionStart; const end = event.currentTarget.selectionEnd; setEditorSelection({ start, end }); syncWikiSuggest(event.currentTarget.value, start); syncSlash(event.currentTarget.value, start); }} onKeyDown={event => {
                  if (slashMenu?.items?.length) {
                    if (event.key === 'Escape') { event.preventDefault(); setSlashMenu(null); return; }
                    if (event.key === 'ArrowDown') { event.preventDefault(); setSlashIndex(current => (current + 1) % slashMenu.items.length); return; }
                    if (event.key === 'ArrowUp') { event.preventDefault(); setSlashIndex(current => (current - 1 + slashMenu.items.length) % slashMenu.items.length); return; }
                    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); void runSlashCommand(slashMenu.items[slashIndex] || slashMenu.items[0]); return; }
                  }
                  if (event.key === ' ' && !event.shiftKey && !event.ctrlKey && !event.metaKey && isEmptyBlockCaret(event.currentTarget.value, event.currentTarget.selectionStart)) {
                    event.preventDefault();
                    setAssistantOpen(true);
                    return;
                  }
                  if (event.key === 'Escape') {
                    if (wikiSuggest) { event.preventDefault(); setWikiSuggest(null); setWikiSuggestIndex(0); return; }
                    if (moreOpen) { event.preventDefault(); setMoreOpen(false); return; }
                    if (previewOpen) { event.preventDefault(); setPreviewOpen(false); return; }
                    if (relationsOpen) { event.preventDefault(); setRelationsOpen(false); return; }
                  }
                  if (event.key === 'ArrowDown' && wikiSuggest?.items?.length) { event.preventDefault(); setWikiSuggestIndex(current => (current + 1) % wikiSuggest.items.length); return; }
                  if (event.key === 'ArrowUp' && wikiSuggest?.items?.length) { event.preventDefault(); setWikiSuggestIndex(current => (current - 1 + wikiSuggest.items.length) % wikiSuggest.items.length); return; }
                  if ((event.key === 'Enter' || event.key === 'Tab') && wikiSuggest?.items?.length) { event.preventDefault(); insertWikiTitle(wikiSuggest.items[wikiSuggestIndex]?.title || wikiSuggest.items[0].title); }
                }}/>}
                {!isProblemNote(draft) && !String(draft.content || '').trim() ? <p className="note-empty-hint">输入 / 新建页面、放入文件，或插入笔记索引。也可以把文件拖进来。</p> : null}
                {slashMenu?.items?.length ? <div className="note-slash-menu" role="listbox" aria-label="在这一页插入">
                  {slashMenu.items.map((item, index) => <button type="button" key={item.id} role="option" aria-selected={index === slashIndex} className={index === slashIndex ? 'is-active' : ''} onMouseDown={event => { event.preventDefault(); void runSlashCommand(item); }}>
                    <b>{item.label}</b><small>{item.hint}</small>
                  </button>)}
                </div> : null}
                {wikiSuggest?.items?.length ? <div className="note-wiki-suggest" role="listbox" aria-label="双向链接补全">
                  {wikiSuggest.items.map((item, index) => <button type="button" key={`${item.kind}:${item.title}`} role="option" aria-selected={index === wikiSuggestIndex} className={index === wikiSuggestIndex ? 'is-active' : ''} onMouseDown={event => { event.preventDefault(); insertWikiTitle(item.title); }}>
                    <b>{item.title}</b><small>{item.kind === 'document' ? '文档' : '笔记'}</small>
                  </button>)}
                </div> : null}
              </div>
              {previewOpen && !showLivePage ? <article ref={previewRef} className="markdown-note-preview note-live-preview" aria-label="笔记预览" onMouseUp={capturePreviewSelection}><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={{
                ...notePreviewHeadingComponents(headingOutline),
                a: ({ href, children, node, ...props }) => href?.startsWith('#wiki:') ? <button className="wiki-link" onClick={() => openLinkedNote(decodeURIComponent(href.slice(6)))}>{children}</button> : <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>,
                img: ({ src, alt, node, ...props }) => <img className="note-inline-image" src={src} alt={alt || '笔记图片'} loading="lazy" {...props}/>
              }}>{renderedMarkdown || '*空白笔记*'}</ReactMarkdown></article> : null}
            {hasEditorSelection && !isProblemNote(draft) && previewOpen ? <div className="note-selection-bubble" role="toolbar" aria-label="选区帮写"><button type="button" className="is-primary" onClick={() => runAssistantAction('ask')}>问 AI</button><button type="button" onClick={() => runAssistantAction('polish')}>润色</button></div> : null}
            </div>
          </> : null}
          {showLivePage ? <div className="markdown-note-preview note-page-view" data-note-live-page="true" tabIndex={showSourceEditor ? -1 : 0} aria-label="笔记纸面，点按或输入 / 开始写" onClick={showSourceEditor ? undefined : beginPageEdit} onKeyDown={showSourceEditor ? undefined : typeOnPaper} onMouseUp={capturePreviewSelection}>{selectedQa?.question || selectedQa?.pitfall || selectedQa?.resolution ? <div className="note-qa-board" aria-label="问题记录"><section className="note-qa-card"><span>问题</span><p>{selectedQa.question || '还没写下这次卡住的点'}</p></section>{selectedQa.resolution ? <section className="note-qa-card"><span>这次怎么解决的</span><p>{selectedQa.resolution}</p></section> : null}{selectedQa.pitfall ? <section className="note-qa-card"><span>下次容易忘的点</span><p>{selectedQa.pitfall}</p></section> : null}{extraQaCards(selectedQa.extra).map(card => <section className="note-qa-card" key={card.heading}><span>{card.heading}</span><p>{card.body}</p></section>)}</div> : <article ref={previewRef} aria-label="笔记预览"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={{
            a: ({ href, children, node, ...props }) => href?.startsWith('#wiki:') ? <button className="wiki-link" onClick={() => openLinkedNote(decodeURIComponent(href.slice(6)))}>{children}</button> : <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>,
            img: ({ src, alt, node, ...props }) => <img className="note-inline-image" src={src} alt={alt || '笔记图片'} loading="lazy" {...props}/>
          }}>{renderedMarkdown || '*空白笔记*'}</ReactMarkdown></article>}</div> : null}
          {hasEditorSelection && !isProblemNote(draft) && showLivePage ? <div className="note-selection-bubble" role="toolbar" aria-label="选区帮写"><button type="button" className="is-primary" onClick={() => runAssistantAction('ask')}>问 AI</button><button type="button" onClick={() => runAssistantAction('polish')}>润色</button></div> : null}
          {!isProblemNote(draft) && (pageCards.length || showNotesIndex) ? <div className="note-page-surface">
            {pageCards.length ? <div className="note-page-cards" aria-label="页面入口">
              {pageCards.map(card => <button type="button" key={card.title} onClick={() => openLinkedNote(card.title)}><FileText size={16}/><span><b>{card.title}</b></span></button>)}
              <button type="button" className="is-new" onClick={() => void createLinkedNote()}><Plus size={16}/><span><b>新建页面</b></span></button>
            </div> : null}
            {showNotesIndex ? <section className="note-index-embed" aria-label="笔记索引">
              <header>
                <b>笔记索引</b>
                <div className="note-index-views" role="tablist" aria-label="索引视图">
                  <button type="button" className={indexView === 'all' ? 'active' : ''} onClick={() => setIndexView('all')}>全部</button>
                  <button type="button" className={indexView === 'recent' ? 'active' : ''} onClick={() => setIndexView('recent')}>最近</button>
                  <button type="button" className={indexView === 'problem' ? 'active' : ''} onClick={() => setIndexView('problem')}>问题记录</button>
                </div>
              </header>
              <label className="note-index-search"><Search size={14}/><input value={indexQuery} onChange={event => setIndexQuery(event.target.value)} placeholder="在索引里找标题、标签或正文" aria-label="搜索笔记索引"/></label>
              <div className="note-index-table">
                <div className="note-index-head"><span>名称</span><span>类型</span><span>更新</span></div>
                {indexRows.map(note => <button type="button" className="note-index-row" key={note.id} onClick={() => select(note)}>
                  <b>{noteListQuestion(note)}</b>
                  <small>{notesIndexKindLabel(note)}</small>
                  <small>{formatTime(note.updatedAt)}</small>
                </button>)}
                <form className="note-index-new" onSubmit={event => void createFromIndex(event)}>
                  <Plus size={14}/>
                  <input value={indexDraft} onChange={event => setIndexDraft(event.target.value)} placeholder="新建页面，回车即可" aria-label="在索引里新建页面"/>
                </form>
              </div>
            </section> : null}
          </div> : null}
          {aiWriter.open && !assistantOpen ? <NotesAiWritingPanel writer={aiWriter} sourceRefs={draft.sourceRefs || []} onAction={runAiWriting} onToneChange={tone => setAiWriter(current => ({ ...current, tone }))} onApply={applyAiWriting} onClose={closeAiWriting} onOpenSource={openSourceRef}/> : null}
        </section>
        {assistantOpen ? <aside className="note-assistant-panel" aria-label="FlowMind 助手">
          <header><span className="ai-avatar"><Sparkles size={16}/></span><div><b>问这一页</b><small>{hasEditorSelection ? `已选 ${Math.abs((editorSelection.end || 0) - (editorSelection.start || 0))} 字，改完可直接用上` : (isProblemNote(draft) ? '回答会写入容易忘的点，不用复制粘贴' : '划一段再问，或直接改这一页')}</small></div><button type="button" onClick={closeAssistant} aria-label="关闭助手">关闭</button></header>
          {hasEditorSelection && !isProblemNote(draft) ? <p className="note-assistant-quote">{String(draft.content || '').slice(editorSelection.start, editorSelection.end)}</p> : null}
          <div className="note-assistant-actions" aria-label="笔记助手操作">
            <button type="button" onClick={() => runAssistantAction('ask')}>在这篇里问</button>
            {hasEditorSelection ? <button type="button" onClick={() => runAssistantAction('polish')}>润色选区</button> : null}
          </div>
          <div className="note-assistant-body">
            {aiWriter.open ? <NotesAiWritingPanel writer={aiWriter} sourceRefs={draft.sourceRefs || []} onAction={runAiWriting} onToneChange={tone => setAiWriter(current => ({ ...current, tone }))} onApply={applyAiWriting} onClose={closeAiWriting} onOpenSource={openSourceRef}/> : null}
            {assistantThread.length ? <div className="note-assistant-thread" aria-live="polite">{assistantThread.map(message => <article key={message.id} className={`note-assistant-msg ${message.role}`}>{message.error ? message.error : (message.text || message.status || '…')}{message.role === 'assistant' && message.done && !message.error ? <div className="note-assistant-writeback">{isProblemNote(draft) ? <><button type="button" disabled={message.applied === 'pitfall' || message.applied === 'both'} onClick={() => writeAssistantIntoNote(message, 'pitfall')}>{message.applied === 'pitfall' || message.applied === 'both' ? '已写入容易忘的点' : '写入下次容易忘的点'}</button><button type="button" disabled={message.applied === 'resolution' || message.applied === 'both'} onClick={() => writeAssistantIntoNote(message, 'resolution')}>{message.applied === 'resolution' || message.applied === 'both' ? '已写入解决过程' : '写入这次怎么解决的'}</button></> : <><button type="button" className="is-primary" disabled={message.applied === 'note'} onClick={() => applyAssistantToPage(message, 'auto')}>{pageAiApplyLabel(noteAskPlan, { hasSelection: hasEditorSelection, applied: message.applied === 'note' })}</button><button type="button" disabled={message.applied === 'note'} onClick={() => applyAssistantToPage(message, 'insert')}>插在后面</button></>}</div> : null}</article>)}</div> : (!aiWriter.open ? <div className="note-assistant-empty"><p>{isProblemNote(draft) ? '问这篇问题记录。回答可以直接写入「下次容易忘的点」。' : '就这篇提问、起稿、润色，或整理成导航页。答完后可以写回正文。'}</p><div className="note-assistant-starters">{(isProblemNote(draft) ? PROBLEM_NOTE_STARTERS : NOTE_ASSISTANT_STARTERS).map(item => <button type="button" key={item.id} onClick={() => void askAssistant(null, item.prompt)}>{item.label}</button>)}{!isProblemNote(draft) ? <button type="button" onClick={() => { update({ content: buildNotesNavContent({ title: draft.title, notes, content: draft.content }) }); void askAssistant(null, '用两三句说明这一页怎么用。只根据快速入口和索引里已有的笔记，不要编造。'); }}>整理成导航</button> : null}</div></div> : null)}
          </div>
          <form className="note-assistant-composer" onSubmit={askAssistant}>
            <textarea name="note-assistant-question" rows={2} value={assistantQuery} disabled={assistantBusy} placeholder={hasEditorSelection ? '针对划中的文字提问，回车发送' : '就这篇提问，例如：帮我起稿 / 润色这段'} aria-label="向这篇笔记提问" onChange={event => setAssistantQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void askAssistant(event); } }}/>
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
    </> : <div className="note-page-pending"><b>{archived ? '没有已归档的笔记' : '正在打开一页'}</b><small>{archived ? '切回全部即可继续写' : '像 Notion 一样，进来就是一张白纸'}</small></div>}
      {dropActive ? <div className="note-drop-overlay" aria-hidden="true"><b>{draft ? '放到这篇笔记里' : '放到一张新笔记里'}</b><small>图片、PDF、文件或链接都可以</small></div> : null}
    </main>
  </>;
}
