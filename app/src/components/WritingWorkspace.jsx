import React, { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, ChevronRight, Clock3, FilePenLine, Link2, LoaderCircle, Plus, Save, Sparkles, X } from 'lucide-react';
import './WorkspaceModules.css';
import { formatTime, jsonOptions, ModuleWelcome, request } from './WorkspaceModuleShared.jsx';
import { EvidenceStatusBadge } from './EvidenceStatus.jsx';
import {
  WRITING_AI_TONES,
  WritingAiPanel,
  applyWritingAiResult,
  buildWritingAiPrompt,
  readWritingAiStream
} from './WritingAiSupport.jsx';

function initialWritingAssistant() {
  return {
    open: false, action: 'polish', tone: WRITING_AI_TONES[0], scope: '全文', status: 'idle',
    result: '', error: '', original: '', baseContent: '', range: { start: 0, end: 0 },
    citations: [], model: null, appliedMode: ''
  };
}

export function mergeWritingSourceRefs(existing = [], received = []) {
  const refs = new Map();
  for (const ref of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(received) ? received : [])]) {
    const documentId = String(ref?.documentId || ref?.contentItemId || '').trim();
    if (!documentId) continue;
    const anchor = String(ref?.anchor || '').trim();
    const key = `${documentId}:${anchor}`;
    refs.set(key, {
      ...ref,
      documentId,
      contentItemId: ref?.contentItemId || documentId,
      title: ref?.title || '来源资料',
      anchor: anchor || null,
      excerpt: String(ref?.excerpt || ref?.snippet || ref?.quote || '').slice(0, 240)
    });
  }
  return [...refs.values()];
}

export function writingSaveSnapshot(draft = {}) {
  return {
    id: String(draft?.id || ''),
    title: String(draft?.title || ''),
    content: String(draft?.content || ''),
    template: String(draft?.template || 'freeform'),
    audience: String(draft?.audience || ''),
    tone: String(draft?.tone || ''),
    sourceRefs: Array.isArray(draft?.sourceRefs) ? draft.sourceRefs : []
  };
}

export function WritingModule({ onToast, initialDraftId = '', onOpenDocument }) {
  const [drafts, setDrafts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState('loading');
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [editorSelection, setEditorSelection] = useState({ start: 0, end: 0 });
  const [aiWriter, setAiWriter] = useState(initialWritingAssistant);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceCandidates, setSourceCandidates] = useState([]);
  const [sourceBusy, setSourceBusy] = useState(false);
  const timer = useRef(null);
  const editRevisionRef = useRef(0);
  const saveRequestRef = useRef(0);
  const editorRef = useRef(null);

  async function load() {
    setBusy('loading');
    try {
      const data = await request('/api/writing/drafts');
      setDrafts(data.drafts);
      const next = data.drafts.find(item => item.id === initialDraftId) || data.drafts.find(item => item.id === selectedId) || data.drafts[0] || null;
      setSelectedId(next?.id || null);
      editRevisionRef.current += 1;
      setDraft(next);
      setDirty(false);
      setSaveError('');
    } catch (error) { onToast?.(error.message, 'error'); }
    finally { setBusy(''); }
  }

  useEffect(() => { load(); return () => clearTimeout(timer.current); }, [initialDraftId]);
  useEffect(() => {
    if (!dirty || !draft?.id || saveError) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(true), 800);
    return () => clearTimeout(timer.current);
  }, [draft?.title, draft?.content, draft?.template, draft?.audience, draft?.tone, draft?.sourceRefs, dirty, saveError]);

  function select(item) {
    clearTimeout(timer.current);
    editRevisionRef.current += 1;
    setSelectedId(item.id);
    setDraft(item);
    setDirty(false);
    setSaveError('');
    setEditorSelection({ start: 0, end: 0 });
    setAiWriter(initialWritingAssistant());
    setSourcePickerOpen(false);
    setSourceQuery('');
    setSourceCandidates([]);
  }

  function update(patch) {
    editRevisionRef.current += 1;
    setDraft(current => ({ ...current, ...patch }));
    setDirty(true);
    setSaveError('');
  }

  async function createDraft() {
    setBusy('create');
    try {
      const data = await request('/api/writing/drafts', jsonOptions('POST', { title: '新写作草稿', content: '', template: 'freeform', audience: '', tone: '专业' }));
      setDrafts(current => [data.draft, ...current]);
      select(data.draft);
      onToast?.('已创建写作草稿');
    } catch (error) { onToast?.(error.message, 'error'); }
    finally { setBusy(''); }
  }

  async function save(silent = false) {
    if (!draft?.id || !dirty) return;
    const snapshot = writingSaveSnapshot(draft);
    const revision = editRevisionRef.current;
    const requestId = ++saveRequestRef.current;
    setBusy('save');
    try {
      const data = await request(`/api/writing/drafts/${snapshot.id}`, jsonOptions('PATCH', {
        title: snapshot.title,
        content: snapshot.content,
        template: snapshot.template,
        audience: snapshot.audience,
        tone: snapshot.tone,
        sourceRefs: snapshot.sourceRefs
      }));
      if (requestId !== saveRequestRef.current || editRevisionRef.current !== revision) return;
      setDraft(data.draft);
      setDrafts(current => current.map(item => item.id === data.draft.id ? data.draft : item));
      setDirty(false);
      setSaveError('');
      if (!silent) onToast?.('草稿已保存并生成版本');
    } catch (error) {
      if (requestId !== saveRequestRef.current || editRevisionRef.current !== revision) return;
      const message = error.message || '草稿保存失败';
      setSaveError(message);
      onToast?.(message, 'error');
    } finally {
      if (requestId === saveRequestRef.current) setBusy('');
    }
  }

  function restore(version) {
    update({ content: version.content });
    onToast?.('历史版本已载入编辑器');
  }

  function currentWritingSnapshot() {
    const content = String(draft?.content || '');
    const input = editorRef.current;
    const rawStart = input?.selectionStart ?? editorSelection.start;
    const rawEnd = input?.selectionEnd ?? editorSelection.end;
    const start = Math.max(0, Math.min(content.length, Number(rawStart) || 0));
    const end = Math.max(start, Math.min(content.length, Number(rawEnd) || start));
    const selected = end > start;
    return {
      original: selected ? content.slice(start, end) : content,
      baseContent: content,
      range: selected ? { start, end } : { start: 0, end: content.length },
      scope: selected ? '当前选区' : '全文'
    };
  }

  function openAiWriting() {
    const snapshot = currentWritingSnapshot();
    setAiWriter(current => ({ ...initialWritingAssistant(), open: true, tone: current.tone || draft?.tone || WRITING_AI_TONES[0], ...snapshot }));
  }

  async function runAiWriting(action) {
    const snapshot = currentWritingSnapshot();
    const sourceRefs = draft?.sourceRefs || [];
    if (!snapshot.original.trim() && !sourceRefs.length) {
      setAiWriter(current => ({ ...current, open: true, action, ...snapshot, status: 'error', error: '请先附加 1–3 篇来源，或在草稿中写入内容，再使用 AI 写作。', result: '' }));
      return;
    }
    const tone = aiWriter.tone || draft?.tone || WRITING_AI_TONES[0];
    const prompt = [
      buildWritingAiPrompt({ action, tone, title: draft?.title, original: snapshot.original, scope: snapshot.scope, sourceRefs, template: draft?.template, audience: draft?.audience }),
      snapshot.original.trim() ? `写作约束：模板=${draft?.template || 'freeform'}；受众=${draft?.audience || '未指定'}；输出语气=${tone}。` : `当前草稿为空。请根据已绑定来源起草可直接放入编辑器的初稿；不要编造来源未覆盖的事实。写作约束：模板=${draft?.template || 'freeform'}；受众=${draft?.audience || '未指定'}；输出语气=${tone}。`
    ].join('\n\n');
    setAiWriter(current => ({ ...current, open: true, action, tone, ...snapshot, status: 'loading', result: '', error: '', citations: [], model: null, appliedMode: '' }));
    try {
      const documentIds = [...new Set(sourceRefs.map(ref => ref?.documentId || ref?.contentItemId).filter(Boolean).map(String))];
      const response = await fetch('/api/skills/run', jsonOptions('POST', { skillId: 'smart-writing', input: prompt, query: prompt, documentIds }));
      const generated = await readWritingAiStream(response, { onDelta: result => setAiWriter(current => ({ ...current, result })) });
      setAiWriter(current => ({ ...current, status: 'preview', result: generated.result, citations: generated.citations, model: generated.model, error: '' }));
    } catch (error) {
      setAiWriter(current => ({ ...current, status: 'error', error: error.message || 'AI 写作失败' }));
    }
  }

  function applyAiWriting(mode) {
    if (!draft || !aiWriter.result || aiWriter.status !== 'preview') return;
    if (String(draft.content || '') !== aiWriter.baseContent) {
      setAiWriter(current => ({ ...current, status: 'error', error: '生成期间草稿已经变化。为避免覆盖新内容，请重新选择范围并生成。' }));
      return;
    }
    try {
      const applied = applyWritingAiResult({ content: draft.content, result: aiWriter.result, range: aiWriter.range, mode, action: aiWriter.action });
      update({ content: applied.content, sourceRefs: mergeWritingSourceRefs(draft.sourceRefs, aiWriter.citations) });
      setAiWriter(current => ({ ...current, status: 'applied', appliedMode: mode, error: '', baseContent: applied.content }));
      requestAnimationFrame(() => {
        editorRef.current?.focus();
        editorRef.current?.setSelectionRange(applied.selection.start, applied.selection.end);
        setEditorSelection(applied.selection);
      });
      onToast?.(mode === 'insert' ? 'AI 结果已插入草稿，来源已保留' : 'AI 结果已替换选区，来源已保留');
    } catch (error) {
      setAiWriter(current => ({ ...current, status: 'error', error: error.message || 'AI 结果写入失败' }));
    }
  }

  const sourceRefs = Array.isArray(draft?.sourceRefs) ? draft.sourceRefs : [];

  async function loadSourceCandidates(query = sourceQuery) {
    setSourceBusy(true);
    try {
      const q = String(query || '').trim();
      const data = await request(`/api/content/items?limit=40${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      const attached = new Set(sourceRefs.map(ref => String(ref.documentId || ref.contentItemId || '')));
      setSourceCandidates((data.items || []).filter(item => item?.id && !attached.has(String(item.id))).slice(0, 20));
    } catch (error) {
      onToast?.(error.message, 'error');
      setSourceCandidates([]);
    } finally {
      setSourceBusy(false);
    }
  }

  function toggleSourcePicker() {
    const next = !sourcePickerOpen;
    setSourcePickerOpen(next);
    if (next) void loadSourceCandidates('');
  }

  function attachWritingSource(item) {
    if (sourceRefs.length >= 3) {
      onToast?.('一篇草稿最多附加 3 个来源', 'error');
      return;
    }
    const documentId = String(item?.id || '');
    if (!documentId) return;
    update({
      sourceRefs: mergeWritingSourceRefs(sourceRefs, [{
        documentId,
        contentItemId: documentId,
        title: item.title || '来源资料',
        excerpt: String(item.excerpt || item.summary || item.content || '').replace(/\s+/g, ' ').trim().slice(0, 240)
      }])
    });
    setSourceCandidates(current => current.filter(row => String(row.id) !== documentId));
    if (sourceRefs.length + 1 >= 3) setSourcePickerOpen(false);
  }

  function removeWritingSource(documentId) {
    update({ sourceRefs: sourceRefs.filter(ref => String(ref.documentId || ref.contentItemId) !== String(documentId)) });
  }

  const saveLabel = saveError ? '保存失败，草稿仍保留在当前页面' : dirty ? '编辑中 · 将自动保存' : `${draft?.versions?.length || 0} 个历史版本`;

  return <>
    <aside className="side-panel module-side">
      <div className="side-head"><div><span>AI Writing</span><h2>智能写作</h2></div><button type="button" onClick={createDraft} title="新建草稿" aria-label="新建草稿"><Plus size={17}/></button></div>
      <div className="module-list padded">{busy === 'loading' ? <div className="module-empty"><LoaderCircle className="spin"/>读取草稿…</div> : drafts.length ? drafts.map(item => <button key={item.id} className={selectedId === item.id ? 'active' : ''} onClick={() => select(item)}><FilePenLine size={16}/><span><b>{item.title}</b><small>{item.template} · {formatTime(item.updatedAt)}</small></span><ChevronRight size={14}/></button>) : <div className="module-empty"><FilePenLine size={25}/><b>暂无草稿</b><small>从空白页开始写作</small></div>}</div>
    </aside>
    <main className="workspace module-workspace">{draft ? <>
      <header className="workspace-head"><div className="workspace-title"><span className="ai-avatar"><FilePenLine size={19}/></span><div><strong>智能写作</strong><small role={saveError ? 'alert' : 'status'}>{saveLabel}</small></div></div><div className="head-actions">{saveError ? <button type="button" className="writing-retry-save" onClick={() => save(false)} disabled={busy === 'save'}>重试保存</button> : null}<button type="button" onClick={() => save(false)} disabled={!dirty || busy === 'save'}>{busy === 'save' ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>}保存版本</button></div></header>
      <div className="writing-layout"><section className="editor-canvas"><input name="writing-draft-title" className="editor-title" value={draft.title} onChange={event => update({ title: event.target.value })} placeholder="草稿标题"/><div className="writing-meta"><label>模板<select name="writing-template" value={draft.template || 'freeform'} onChange={event => update({ template: event.target.value })}><option value="freeform">自由写作</option><option value="weekly">周报</option><option value="proposal">方案</option><option value="article">文章</option><option value="brief">简报</option></select></label><label>受众<input name="writing-audience" value={draft.audience || ''} onChange={event => update({ audience: event.target.value })} placeholder="团队 / 客户 / 管理层"/></label><label>语气<input name="writing-tone" value={draft.tone || ''} onChange={event => update({ tone: event.target.value })} placeholder="专业、简洁"/></label></div><div className="writing-ai-toolbar"><button type="button" aria-label="打开草稿 AI 写作" title="润色、续写、总结或改写语气" onClick={openAiWriting}><Sparkles size={15}/>AI 写作</button><small>{editorSelection.end > editorSelection.start ? '将处理当前选区' : '将处理全文'}</small></div><textarea name="writing-draft-content" ref={editorRef} className="editor-body" value={draft.content || ''} onChange={event => update({ content: event.target.value })} onSelect={event => setEditorSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })} placeholder="在这里开始写作；AI 会基于已绑定来源生成可预览结果。"/>{aiWriter.open ? <WritingAiPanel writer={aiWriter} sourceRefs={sourceRefs} onAction={runAiWriting} onToneChange={tone => setAiWriter(current => ({ ...current, tone }))} onApply={applyAiWriting} onClose={() => setAiWriter(current => ({ ...current, open: false }))} onOpenSource={ref => { const documentId = ref?.documentId || ref?.contentItemId; if (documentId) onOpenDocument?.({ ...ref, id: documentId, documentId }); }}/> : null}</section><aside className="version-panel"><section className="writing-sources"><h3><Link2 size={16}/>来源资料 <span>{sourceRefs.length}</span></h3>{sourceRefs.length ? sourceRefs.map((ref, index) => <div className="writing-source-row" key={`${ref.documentId || ref.sourceId || ref.url || ref.title || index}:${index}`}><button type="button" disabled={!ref.documentId || typeof onOpenDocument !== 'function'} onClick={() => onOpenDocument?.({ ...ref, id: ref.documentId, documentId: ref.documentId, title: ref.title || '来源文档', source: ref.source || ref.kind })}><span><b>{ref.title || '来源资料'}<EvidenceStatusBadge evidence={ref} compact /></b><small>{ref.quote || ref.source || ref.kind || ref.type || ref.excerpt || '写作来源'}</small></span><ChevronRight size={14}/></button><button type="button" className="writing-source-remove" aria-label={`移除来源 ${ref.title || '资料'}`} onClick={() => removeWritingSource(ref.documentId || ref.contentItemId)}><X size={13}/></button></div>) : <p>此草稿暂未附加来源。</p>}{sourceRefs.length < 3 ? <button type="button" className="writing-source-attach" onClick={toggleSourcePicker}>{sourcePickerOpen ? '收起来源选择' : '选 1–3 篇再生成'}</button> : null}{sourcePickerOpen && sourceRefs.length < 3 ? <div className="writing-source-picker"><input value={sourceQuery} onChange={event => { setSourceQuery(event.target.value); void loadSourceCandidates(event.target.value); }} placeholder="搜索知识库文档" aria-label="搜索可附加的来源"/>{sourceBusy ? <small>正在读取文档…</small> : sourceCandidates.length ? sourceCandidates.map(item => <button type="button" key={item.id} onClick={() => attachWritingSource(item)}><span><b>{item.title || '未命名文档'}</b><small>{item.source || item.contentType || '知识库文档'}</small></span><Plus size={13}/></button>) : <small>没有可附加的文档</small>}</div> : null}</section><h3><Clock3 size={16}/>版本历史</h3>{draft.versions?.length ? [...draft.versions].reverse().map((version, index) => <button key={`${version.savedAt}-${index}`} onClick={() => restore(version)}><span><b>{formatTime(version.savedAt)}</b><small>{String(version.content || '').slice(0, 70) || '空白版本'}</small></span><ArchiveRestore size={14}/></button>) : <div className="module-empty"><Clock3 size={22}/><small>内容变化后会保留版本</small></div>}</aside></div>
    </> : <ModuleWelcome icon={FilePenLine} title="把知识变成可交付内容" description="创建草稿、配置模板/受众/语气，并保留可恢复的版本历史。" action={createDraft} actionLabel="创建写作草稿"/>}</main>
  </>;
}
