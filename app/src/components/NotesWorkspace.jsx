import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import {
  AlertCircle, Archive, ArchiveRestore, Check, ChevronRight, FileText, Eye, FileDown, ImagePlus, Layers3, Link2, ListChecks,
  LoaderCircle, NotebookPen, Paperclip, PencilLine, Plus, Quote, Save, Search, Sparkles, Trash2
} from 'lucide-react';
import './WorkspaceModules.css';
import { downloadExport, formatTime, jsonOptions, ModuleWelcome, request } from './WorkspaceModuleShared.jsx';

export const NOTES_AI_ACTIONS = Object.freeze([
  { id: 'polish', label: '润色', description: '优化表达、语法和节奏，不改变事实与结构' },
  { id: 'continue', label: '续写', description: '沿用当前上下文继续写下一段内容' },
  { id: 'summarize', label: '总结', description: '提炼重点，生成可直接放入笔记的摘要' },
  { id: 'tone', label: '改写语气', description: '按选定语气改写，同时保留原意和引用' }
]);

const NOTES_AI_TONES = Object.freeze(['专业简洁', '自然友好', '正式严谨', '清晰有力', '轻松口语']);
const initialNotesAiWriter = () => ({
  open: false, action: 'polish', tone: NOTES_AI_TONES[0], scope: '全文', status: 'idle',
  result: '', error: '', original: '', baseContent: '', range: { start: 0, end: 0 }, citations: [], model: null, appliedMode: ''
});

export function buildNotesAiWritingPrompt({ action = 'polish', tone = NOTES_AI_TONES[0], title = '', original = '', scope = '全文', sourceRefs = [] } = {}) {
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
    `你正在执行笔记 AI 帮写：${meta.label}。`,
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

export function formatNoteAttachmentSize(byteSize = 0) {
  const bytes = Math.max(0, Number(byteSize) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

export function NotesAiWritingPanel({ writer, sourceRefs = [], onAction, onToneChange, onApply, onClose }) {
  const references = writer.citations?.length ? writer.citations : sourceRefs;
  const panelStyle = { marginTop: 14, border: '1px solid #dfe4f5', borderRadius: 14, background: '#f8f9ff', padding: 14, display: 'grid', gap: 12 };
  const buttonRowStyle = { display: 'flex', gap: 8, flexWrap: 'wrap' };
  const previewStyle = { margin: 0, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', font: 'inherit', lineHeight: 1.65, padding: 12, borderRadius: 10, background: '#fff', border: '1px solid #e5e8f2' };
  return <section aria-label="笔记 AI 帮写" data-notes-ai-writing="true" style={panelStyle}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Sparkles size={17}/><div style={{ flex: 1 }}><b>AI 帮写</b><small style={{ display: 'block', color: '#778197', marginTop: 2 }}>当前范围：{writer.scope} · 结果先预览，不会直接覆盖笔记</small></div><button type="button" onClick={onClose}>关闭</button></div>
    <div style={buttonRowStyle} aria-label="AI 帮写操作">{NOTES_AI_ACTIONS.map(item => <button type="button" key={item.id} aria-pressed={writer.action === item.id} disabled={writer.status === 'loading'} onClick={() => onAction(item.id)} title={item.description}>{item.label}</button>)}</div>
    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>改写语气</span><select value={writer.tone} disabled={writer.status === 'loading'} onChange={event => onToneChange(event.target.value)}>{NOTES_AI_TONES.map(tone => <option key={tone}>{tone}</option>)}</select></label>
    {writer.status === 'loading' ? <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><LoaderCircle className="spin" size={17}/>AI 正在处理，原文保持不变…</div> : null}
    {writer.error ? <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#b42318' }}><AlertCircle size={17}/><span>{writer.error}</span></div> : null}
    {writer.original ? <details><summary>查看原文快照（{writer.original.length} 字）</summary><pre style={previewStyle}>{writer.original}</pre></details> : null}
    {writer.result ? <div><b>结果预览</b><pre aria-label="AI 帮写结果预览" style={{ ...previewStyle, marginTop: 7 }}>{writer.result}</pre></div> : null}
    {references?.length ? <details><summary>来源与引用（{references.length}）</summary><ul>{references.map((ref, index) => <li key={ref.id || ref.documentId || index}>{ref.title || ref.label || `来源 ${index + 1}`}{ref.pageNumber ? ` · 第 ${ref.pageNumber} 页` : ref.anchor ? ` · ${ref.anchor}` : ''}</li>)}</ul></details> : null}
    {writer.status === 'preview' && writer.result ? <div style={buttonRowStyle}><button type="button" onClick={() => onApply('insert')}><Plus size={15}/>插入到原文后</button><button type="button" onClick={() => onApply('replace')}><Check size={15}/>替换{writer.scope}</button></div> : null}
    {writer.status === 'applied' && writer.appliedMode ? <small style={{ color: '#2f7d32' }}>已{writer.appliedMode === 'insert' ? '插入' : '替换'}，原来源引用仍保留</small> : null}
  </section>;
}

export function NotesModule({ onToast, onOpenDocument, initialNoteId = '' }) {
  const [notes, setNotes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState('loading');
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState('edit');
  const [editorSelection, setEditorSelection] = useState({ start: 0, end: 0 });
  const [aiWriter, setAiWriter] = useState(initialNotesAiWriter);
  const [attachmentBusy, setAttachmentBusy] = useState('');
  const saveTimer = useRef(null);
  const editorRef = useRef(null);
  const imageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachmentSelectionRef = useRef({ start: 0, end: 0 });
  const visible = useMemo(() => notes.filter(note => !query || `${note.title} ${note.content} ${(note.tags || []).join(' ')}`.toLowerCase().includes(query.toLowerCase())), [notes, query]);
  const outgoingTitles = useMemo(() => [...new Set([...String(draft?.content || '').matchAll(/\[\[([^\]]+)\]\]/g)].map(match => match[1].trim()).filter(Boolean))], [draft?.content]);
  const backlinks = useMemo(() => draft?.title ? notes.filter(note => note.id !== draft.id && String(note.content || '').includes(`[[${draft.title}]]`)) : [], [draft?.id, draft?.title, notes]);
  const renderedMarkdown = useMemo(() => String(draft?.content || '').replace(/\[\[([^\]]+)\]\]/g, (_, title) => `[${title}](#wiki:${encodeURIComponent(title)})`), [draft?.content]);

  async function load(nextArchived = archived) {
    setBusy('loading');
    try {
      const data = await request(`/api/notes${nextArchived ? '?archived=true' : ''}`);
      const list = nextArchived ? data.notes.filter(note => note.archived) : data.notes.filter(note => !note.archived);
      setNotes(list);
      const next = list.find(note => note.id === initialNoteId) || list.find(note => note.id === selectedId) || list[0] || null;
      setSelectedId(next?.id || null);
      setDraft(next ? { ...next, tagsText: (next.tags || []).join('，') } : null);
      setDirty(false);
    } catch (error) { onToast?.(error.message, 'error'); }
    finally { setBusy(''); }
  }
  useEffect(() => { load(archived); }, [archived]);
  useEffect(() => {
    const linked = notes.find(note => note.id === initialNoteId);
    if (linked && linked.id !== selectedId) select(linked);
  }, [initialNoteId]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  useEffect(() => {
    if (!dirty || !draft?.id) return undefined;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveNote(true), 650);
    return () => clearTimeout(saveTimer.current);
  }, [draft?.title, draft?.content, draft?.tagsText, dirty]);

  function select(note) {
    clearTimeout(saveTimer.current);
    setSelectedId(note.id);
    setDraft({ ...note, tagsText: (note.tags || []).join('，') });
    setDirty(false);
    setEditorSelection({ start: 0, end: 0 });
    setAiWriter(initialNotesAiWriter());
  }
  function update(patch) { setDraft(current => ({ ...current, ...patch })); setDirty(true); }
  function openLinkedNote(title) {
    const linked = notes.find(note => String(note.title || '').trim().toLowerCase() === String(title || '').trim().toLowerCase());
    if (linked) select(linked);
    else onToast?.(`尚未找到双链笔记：${title}`, 'error');
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
      setDirty(true);
      setMode('edit');
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
      update({ content: applied.content });
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
  async function createNote() {
    setBusy('create');
    try {
      const data = await request('/api/notes', jsonOptions('POST', { title: '无标题笔记', content: '', tags: [] }));
      setArchived(false); setNotes(current => [data.note, ...current]); select(data.note); setMode('edit'); onToast?.('已创建笔记');
    } catch (error) { onToast?.(error.message, 'error'); } finally { setBusy(''); }
  }
  async function saveNote(silent = false) {
    if (!draft?.id || !dirty) return;
    setBusy('save');
    try {
      const tags = [...new Set(String(draft.tagsText || '').split(/[，,;；\n]+/).map(item => item.trim()).filter(Boolean))];
      const data = await request(`/api/notes/${draft.id}`, jsonOptions('PATCH', { title: draft.title, content: draft.content, tags, sourceRefs: draft.sourceRefs || [] }));
      setDraft({ ...data.note, tagsText: tags.join('，') });
      setNotes(current => current.map(note => note.id === data.note.id ? data.note : note));
      setDirty(false);
      if (!silent) onToast?.('笔记已保存');
    } catch (error) { onToast?.(error.message, 'error'); } finally { setBusy(''); }
  }
  async function archiveNote() {
    if (!draft?.id) return;
    try { await request(`/api/notes/${draft.id}`, jsonOptions('PATCH', { archived: !draft.archived })); onToast?.(draft.archived ? '笔记已恢复' : '笔记已归档'); await load(archived); } catch (error) { onToast?.(error.message, 'error'); }
  }
  async function deleteNote() {
    if (!draft?.id) return;
    try { await request(`/api/notes/${draft.id}`, { method: 'DELETE' }); onToast?.('笔记已移入回收状态'); await load(archived); } catch (error) { onToast?.(error.message, 'error'); }
  }
  async function exportNote(format) {
    try { if (dirty) await saveNote(true); await downloadExport({ entityType: 'note', entityId: draft.id, format }, onToast); } catch (error) { onToast?.(error.message, 'error'); }
  }

  return <>
    <aside className="side-panel module-side">
      <div className="side-head"><div><span>Personal Knowledge</span><h2>笔记</h2></div><button onClick={createNote}><Plus size={17}/></button></div>
      <div className="search-box"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索笔记和标签"/></div>
      <div className="module-tabs"><button className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>当前</button><button className={archived ? 'active' : ''} onClick={() => setArchived(true)}>已归档</button></div>
      <div className="module-list">{busy === 'loading' ? <div className="module-empty"><LoaderCircle className="spin"/>读取笔记…</div> : visible.length ? visible.map(note => <button key={note.id} className={selectedId === note.id ? 'active' : ''} onClick={() => select(note)}><NotebookPen size={16}/><span><b>{note.title || '无标题笔记'}</b><small>{String(note.content || '').slice(0, 54) || '空白笔记'} · {formatTime(note.updatedAt)}</small></span><ChevronRight size={14}/></button>) : <div className="module-empty"><NotebookPen size={25}/><b>暂无笔记</b><small>创建笔记后会自动保存</small></div>}</div>
    </aside>
    <main className="workspace module-workspace">{draft ? <>
      <header className="workspace-head"><div className="workspace-title"><span className="ai-avatar"><NotebookPen size={19}/></span><div><strong>{draft.title || '无标题笔记'}</strong><small>{dirty ? '正在等待自动保存' : `已保存 · ${formatTime(draft.updatedAt)}`}</small></div></div><div className="head-actions"><div className="note-mode-switch"><button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}><PencilLine size={15}/>编辑</button><button className={mode === 'read' ? 'active' : ''} onClick={() => setMode('read')}><Eye size={15}/>阅读</button></div><button className="export-button" onClick={() => exportNote('markdown')}><FileDown size={16}/>MD</button><button className="export-button" onClick={() => exportNote('html')}><FileDown size={16}/>HTML</button><button onClick={() => saveNote(false)} disabled={!dirty || busy === 'save'}>{busy === 'save' ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>}保存</button><button onClick={archiveNote}>{draft.archived ? <ArchiveRestore size={16}/> : <Archive size={16}/>}</button><button className="danger-lite" onClick={deleteNote}><Trash2 size={16}/></button></div></header>
      <div className="note-workspace-grid">
        <section className="editor-canvas note-editor-canvas">
          <input className="editor-title" value={draft.title} onChange={event => update({ title: event.target.value })} placeholder="笔记标题"/>
          <input className="editor-tags" value={draft.tagsText || ''} onChange={event => update({ tagsText: event.target.value })} placeholder="标签，以逗号分隔"/>
          {mode === 'edit' ? <>
            <div className="markdown-toolbar" aria-label="Markdown 格式工具栏">
              <button title="标题" onClick={() => applyMarkdown('## ', '', '小节标题')}>H2</button>
              <button title="加粗" onClick={() => applyMarkdown('**', '**', '重点')}>B</button>
              <button title="引用" onClick={() => applyMarkdown('> ', '', '引用内容')}><Quote size={14}/></button>
              <button title="任务" onClick={() => applyMarkdown('- [ ] ', '', '待办事项')}><ListChecks size={14}/></button>
              <button title="双向链接" onClick={() => applyMarkdown('[[', ']]', '笔记标题')}><Link2 size={14}/></button>
              <button title="代码" onClick={() => applyMarkdown(String.fromCharCode(96), String.fromCharCode(96), 'code')}>{'</>'}</button>
              <span className="markdown-toolbar-divider" aria-hidden="true"/>
              <button type="button" className="note-attachment-tool" title="上传本地图片并插入光标位置" disabled={Boolean(attachmentBusy)} onClick={() => openAttachmentPicker('image')}>{attachmentBusy === 'image' ? <LoaderCircle className="spin" size={14}/> : <ImagePlus size={14}/>}图片</button>
              <button type="button" className="note-attachment-tool" title="上传本地文件并插入光标位置" disabled={Boolean(attachmentBusy)} onClick={() => openAttachmentPicker('file')}>{attachmentBusy === 'file' ? <LoaderCircle className="spin" size={14}/> : <Paperclip size={14}/>}文件</button>
              <button type="button" className="note-ai-writing-tool" title="AI 帮写：润色、续写、总结或改写语气" aria-label="打开笔记 AI 帮写" onClick={openAiWriting}><Sparkles size={14}/>AI 帮写</button>
              <input ref={imageInputRef} className="note-file-input" type="file" accept="image/*" tabIndex={-1} onChange={event => uploadNoteAttachment(event.target.files?.[0], 'image')}/>
              <input ref={fileInputRef} className="note-file-input" type="file" tabIndex={-1} onChange={event => uploadNoteAttachment(event.target.files?.[0], 'file')}/>
            </div>
            <textarea ref={editorRef} className="editor-body markdown-editor-body" value={draft.content || ''} onChange={event => update({ content: event.target.value })} onSelect={event => setEditorSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })} placeholder="使用 Markdown 记录；输入 [[笔记标题]] 建立双向链接…"/>
          </> : <article className="markdown-note-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={{
            a: ({ href, children, node, ...props }) => href?.startsWith('#wiki:') ? <button className="wiki-link" onClick={() => openLinkedNote(decodeURIComponent(href.slice(6)))}>{children}</button> : <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>,
            img: ({ src, alt, node, ...props }) => <img className="note-inline-image" src={src} alt={alt || '笔记图片'} loading="lazy" {...props}/>
          }}>{renderedMarkdown || '*空白笔记*'}</ReactMarkdown></article>}
          {aiWriter.open ? <NotesAiWritingPanel writer={aiWriter} sourceRefs={draft.sourceRefs || []} onAction={runAiWriting} onToneChange={tone => setAiWriter(current => ({ ...current, tone }))} onApply={applyAiWriting} onClose={() => setAiWriter(current => ({ ...current, open: false }))}/> : null}
        </section>
        <aside className="note-relations-panel">
          <section><h3><Link2 size={15}/>来源</h3>{draft.sourceRefs?.length ? draft.sourceRefs.map((ref, index) => <button key={ref.documentId || index} onClick={() => ref.documentId && onOpenDocument?.(ref.documentId)}><FileText size={15}/><span><b>{ref.title || '来源文档'}</b><small>{ref.pageNumber ? `第 ${ref.pageNumber} 页` : ref.anchor || '打开原文'}</small></span></button>) : <p>从文档阅读器创建笔记后，来源会显示在这里。</p>}</section>
          <section className="note-attachments-section"><h3><Paperclip size={15}/>附件<span>{draft.attachments?.length || 0}</span></h3>{draft.attachments?.length ? draft.attachments.map(attachment => <a className="note-attachment-row" key={attachment.id} href={attachment.downloadUrl || attachment.url} target="_blank" rel="noreferrer" title={`打开或下载 ${attachment.fileName}`}>
            {attachment.isImage ? <ImagePlus size={15}/> : <FileText size={15}/>}<span><b>{attachment.fileName || '附件'}</b><small>{formatNoteAttachmentSize(attachment.byteSize)} · {attachment.isImage ? '笔记内联图片' : '点击下载文件'}</small></span>
          </a>) : <p>在编辑工具栏上传图片或文件，会直接插入当前光标位置。</p>}</section>
          <section><h3><Link2 size={15}/>出链</h3>{outgoingTitles.length ? outgoingTitles.map(title => <button key={title} onClick={() => openLinkedNote(title)}><span><b>{title}</b><small>[[双向链接]]</small></span></button>) : <p>输入 [[笔记标题]] 连接相关笔记。</p>}</section>
          <section><h3><Layers3 size={15}/>反向链接</h3>{backlinks.length ? backlinks.map(note => <button key={note.id} onClick={() => select(note)}><span><b>{note.title}</b><small>{String(note.content || '').slice(0, 64)}</small></span></button>) : <p>暂时没有其他笔记链接到这里。</p>}</section>
        </aside>
      </div>
    </> : <ModuleWelcome icon={NotebookPen} title="构建你的个人知识层" description="笔记支持 Markdown、双向链接、来源引用、标签、全文搜索和自动保存。" action={createNote} actionLabel="创建第一篇笔记"/>}</main>
  </>;
}
