import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ChevronLeft, ChevronRight, CircleCheck, Clock3, FileText, Download, FileDown, Highlighter, Languages,
  Layers3, LoaderCircle, MessageSquareText, Plus, Save, Search, Sparkles, StickyNote, Trash2, UploadCloud
} from 'lucide-react';
import './WorkspaceModules.css';
import { TranslationWorkbench } from './TranslationWorkbench.jsx';
import { downloadExport, formatTime, jsonOptions, request } from './WorkspaceModuleShared.jsx';

const PdfCanvasPage = lazy(() => import('./PdfCanvasPage.jsx').then(module => ({ default: module.PdfCanvasPage })));
const ImageOcrViewer = lazy(() => import('./ImageOcrViewer.jsx').then(module => ({ default: module.ImageOcrViewer })));
const AudioTranscriptViewer = lazy(() => import('./AudioTranscriptViewer.jsx').then(module => ({ default: module.AudioTranscriptViewer })));

function formatAudioClock(value) { const seconds = Math.max(0, Number(value) || 0); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function formatAudioAnchor(anchor) { const match = String(anchor || '').match(/time:([\d.]+)-([\d.]+)/); return match ? `${formatAudioClock(match[1])}–${formatAudioClock(match[2])}` : ''; }
const PDF_VIEW_STATE_KEY = 'flowmind.pdf-view-state.v1';
function readPdfViewState(id) {
  if (!id || typeof localStorage === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(PDF_VIEW_STATE_KEY) || '{}')[id] || {}; } catch { return {}; }
}
function writePdfViewState(id, patch) {
  if (!id || typeof localStorage === 'undefined') return;
  try { const all = JSON.parse(localStorage.getItem(PDF_VIEW_STATE_KEY) || '{}'); all[id] = { ...(all[id] || {}), ...patch }; localStorage.setItem(PDF_VIEW_STATE_KEY, JSON.stringify(all)); } catch {}
}


export function DocumentAnalysisModule({ onToast, initialDocumentId = '' }) {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [queue, setQueue] = useState([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfZoom, setPdfZoom] = useState(100);
  const [activeAnchor, setActiveAnchor] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [selectionDraft, setSelectionDraft] = useState(null);
  const [annotationComment, setAnnotationComment] = useState('');
  const [annotationColor, setAnnotationColor] = useState('yellow');
  const [audioMinutes, setAudioMinutes] = useState({ summary: '', actions: '' });
  const [audioMinutesSaving, setAudioMinutesSaving] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [translations, setTranslations] = useState([]);
  const [translation, setTranslation] = useState(null);
  const [translationBusy, setTranslationBusy] = useState('');
  const [translationDirty, setTranslationDirty] = useState(false);
  const [translationSettings, setTranslationSettings] = useState({ sourceLanguage: '自动检测', targetLanguage: '简体中文', provider: 'auto', glossary: '' });
  const inputRef = useRef(null);
  const initialDocumentEffectReady = useRef(false);
  const visible = useMemo(() => items.filter(item => !query || `${item.title} ${item.contentType} ${item.content || ''}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  const isPdf = detail?.item?.contentType === 'pdf';
  const isImage = detail?.item?.contentType === 'image';
  const isAudio = detail?.item?.contentType === 'audio';
  const pdfPages = useMemo(() => {
    if (!isPdf) return [];
    const content = String(detail?.item?.content || '');
    const pages = Array.isArray(detail?.item?.metadata?.pages) ? detail.item.metadata.pages : [];
    return pages.map((page, index) => ({
      pageNumber: Number(page.pageNumber || index + 1),
      anchor: page.anchor || `page:${page.pageNumber || index + 1}`,
      text: content.slice(Number(page.startChar || 0), Number(page.endChar || 0)).trim()
    }));
  }, [detail, isPdf]);
  const imageRegions = useMemo(() => {
    if (!isImage) return [];
    const metadata = detail?.item?.metadata || {};
    if (Array.isArray(metadata.ocrRegions) && metadata.ocrRegions.length) return metadata.ocrRegions;
    return Array.isArray(metadata.pages) ? metadata.pages.filter(page => page?.region || page?.bbox) : [];
  }, [detail, isImage]);
  const audioSegments = useMemo(() => isAudio && Array.isArray(detail?.item?.metadata?.pages) ? detail.item.metadata.pages : [], [detail, isAudio]);
  const audioTranscriptRows = useMemo(() => audioSegments.map((segment, index) => ({ ...segment, text: String(detail?.item?.content || '').slice(Number(segment.startChar || 0), Number(segment.endChar || 0)).trim(), label: formatAudioAnchor(segment.anchor), index })).filter(segment => segment.text), [audioSegments, detail]);
  const currentPdfPage = pdfPages.find(page => page.pageNumber === pdfPage) || pdfPages[0];

  async function loadItems(preferredId) {
    try {
      const data = await request('/api/content/items?limit=300');
      setItems(data.items || []);
      const nextId = preferredId || selectedId || data.items?.[0]?.id;
      if (nextId) await openItem(nextId);
    } catch (error) { onToast?.(error.message, 'error'); }
  }
  async function openItem(id) {
    setSelectedId(id); setAnswer(null); setActiveAnchor(null); setAudioMinutes({ summary: '', actions: '' }); setTranslationDirty(false);
    try {
      const [data, translationData] = await Promise.all([request(`/api/content/items/${id}`), request(`/api/translations?documentId=${encodeURIComponent(id)}`).catch(() => ({ translations: [] }))]);
      const view = data.item?.contentType === 'pdf' ? readPdfViewState(id) : {};
      const pageCount = Math.max(1, Number(data.item?.metadata?.pageCount || data.item?.metadata?.pages?.length || 1));
      setPdfPage(Math.max(1, Math.min(pageCount, Number(view.page) || 1)));
      setPdfZoom(Math.max(70, Math.min(180, Number(view.zoom) || 100)));
      const savedTranslations = translationData.translations || []; const latestTranslation = savedTranslations[0] || null;
      setDetail(data); setAnnotations(data.annotations || []); setSelectionDraft(null); setAnnotationComment(''); setTranslations(savedTranslations); setTranslation(latestTranslation);
      setTranslationSettings(latestTranslation ? { sourceLanguage: latestTranslation.sourceLanguage || '自动检测', targetLanguage: latestTranslation.targetLanguage || '简体中文', provider: latestTranslation.provider === 'local' ? 'local' : 'auto', glossary: latestTranslation.glossary || '' } : { sourceLanguage: '自动检测', targetLanguage: '简体中文', provider: 'auto', glossary: '' });
    } catch (error) { setDetail(null); onToast?.(error.message, 'error'); }
  }
  useEffect(() => { loadItems(initialDocumentId); }, []);
  useEffect(() => {
    if (!initialDocumentEffectReady.current) {
      initialDocumentEffectReady.current = true;
      return;
    }
    if (initialDocumentId && initialDocumentId !== selectedId) openItem(initialDocumentId);
  }, [initialDocumentId]);

  function goToPdfPage(value) {
    const pageCount = Math.max(1, Number(detail?.item?.metadata?.pageCount || pdfPages.length || 1));
    const page = Math.max(1, Math.min(pageCount, Number(value) || 1));
    setPdfPage(page); writePdfViewState(selectedId, { page, zoom: pdfZoom });
  }
  function changePdfZoom(delta) {
    const zoom = Math.max(70, Math.min(180, pdfZoom + delta));
    setPdfZoom(zoom);
    if (isPdf) writePdfViewState(selectedId, { page: pdfPage, zoom });
  }
  function goToContentLocation(anchor, pageNumber) {
    const normalizedAnchor = String(anchor || '');
    const region = normalizedAnchor.match(/(?:page:\d+:)?region:\d+|time:[\d.]+-[\d.]+/)?.[0];
    if (normalizedAnchor) setActiveAnchor(normalizedAnchor);
    if ((isImage || isAudio) && region) return;
    const anchorPage = Number(normalizedAnchor.match(/page:(\d+)/)?.[1] || 0);
    if (pageNumber || anchorPage) goToPdfPage(pageNumber || anchorPage);
  }

  const originalAttachment = detail?.originalAttachment || detail?.attachments?.find(attachment => attachment.externalId === 'original' || attachment.externalId?.startsWith('original:') || attachment.metadata?.kind === 'original');

  async function saveAnnotation() {
    if (!selectionDraft || !detail?.item?.id) return;
    try {
      const data = await request('/api/content/items/' + detail.item.id + '/annotations', jsonOptions('POST', { ...selectionDraft, attachmentId: originalAttachment?.id || null, comment: annotationComment.trim(), color: annotationColor }));
      setAnnotations(current => [...current, data.annotation]);
      setSelectionDraft(null); setAnnotationComment('');
      onToast?.('高亮标注已保存');
    } catch (error) { onToast?.(error.message, 'error'); }
  }
  async function deleteAnnotation(annotation) {
    try {
      await request('/api/content/items/' + detail.item.id + '/annotations/' + annotation.id, { method: 'DELETE' });
      setAnnotations(current => current.filter(item => item.id !== annotation.id));
    } catch (error) { onToast?.(error.message, 'error'); }
  }
  async function convertAnnotationToNote(annotation) {
    try {
      const data = await request('/api/content/items/' + detail.item.id + '/annotations/' + annotation.id + '/to-note', jsonOptions('POST', {}));
      onToast?.('已转为笔记: ' + data.note.title);
    } catch (error) { onToast?.(error.message, 'error'); }
  }

  async function uploadFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    setUploading(true);
    setQueue(files.map(file => ({ name: file.name, status: 'pending', message: '等待上传' })));
    let lastItemId = null;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setQueue(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, status: 'running', message: /\.(png|jpe?g|webp)$/i.test(file.name) ? '正在 OCR 并建立区域索引' : /\.(mp3|m4a|wav|aac)$/i.test(file.name) ? '正在转写并建立时间戳索引' : '正在解析和建立索引' } : item));
      try {
        const response = await fetch('/api/content/import/file', {
          method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'x-file-last-modified': String(file.lastModified || '') }, body: file
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
        const imported = data.items?.[0]?.item;
        if (imported) lastItemId = imported.id;
        const warning = data.warnings?.[0];
        setQueue(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, status: warning ? 'failed' : 'done', message: warning?.message || (data.stats?.duplicates ? '内容已存在，已关联来源' : '解析完成') } : item));
      } catch (error) {
        setQueue(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, status: 'failed', message: error.message } : item));
      }
    }
    setUploading(false);
    await loadItems(lastItemId);
    onToast?.('本地文件导入任务已结束');
  }

  async function askDocument() {
    const text = question.trim();
    if (!text || !detail?.item?.id || asking) return;
    setAsking(true); setAnswer({ question: text, text: '', citations: [] });
    try {
      const response = await fetch('/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: text, documentIds: [detail.item.id], limit: 6 }) });
      const raw = await response.text();
      const events = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      const failed = events.find(event => event.type === 'error');
      if (failed) throw new Error(failed.error?.message || '文档问答失败');
      const done = [...events].reverse().find(event => event.type === 'done');
      setAnswer({ question: text, text: done?.answer || events.filter(event => event.type === 'delta').map(event => event.delta || '').join(''), citations: done?.citations || [] });
      setQuestion('');
    } catch (error) { onToast?.(error.message, 'error'); setAnswer(current => ({ ...current, error: error.message })); }
    finally { setAsking(false); }
  }

  function generateAudioMinutes() {
    if (!audioTranscriptRows.length) { onToast?.('当前音频还没有可生成纪要的转写片段', 'error'); return; }
    const highlights = audioTranscriptRows.slice(0, 8).map(segment => `- [${segment.label || '00:00'}] ${segment.speaker ? `${segment.speaker}：` : ''}${segment.text}`).join('\n');
    const actionCandidates = audioTranscriptRows.filter(segment => /(行动|负责|完成|截止|确认|跟进|需要|todo|owner|deadline|follow.?up)/i.test(segment.text));
    const selectedActions = (actionCandidates.length ? actionCandidates : audioTranscriptRows.slice(-Math.min(3, audioTranscriptRows.length))).slice(0, 8);
    setAudioMinutes({
      summary: `录音《${detail.item.title}》共 ${audioTranscriptRows.length} 个时间戳片段。\n\n${highlights}`,
      actions: selectedActions.map((segment, index) => `${index + 1}. [ ] ${segment.text}（${segment.speaker || '待确认负责人'} · ${segment.label || '00:00'}）`).join('\n')
    });
  }
  async function saveAudioMinutes() {
    if (!audioMinutes.summary.trim() && !audioMinutes.actions.trim()) { onToast?.('请先生成或填写会议纪要', 'error'); return; }
    setAudioMinutesSaving(true);
    try {
      const first = audioTranscriptRows[0];
      const data = await request('/api/notes', jsonOptions('POST', {
        title: `${detail.item.title} · 会议纪要`,
        content: `# 会议摘要\n\n${audioMinutes.summary.trim()}\n\n## 行动项\n\n${audioMinutes.actions.trim() || '- 暂无行动项'}`,
        tags: ['会议纪要', '音频'],
        sourceRefs: [{ documentId: detail.item.id, anchor: first?.anchor || 'time:0-0', timeStart: first?.timeStart || 0, timeEnd: first?.timeEnd || 0 }]
      }));
      onToast?.(`会议纪要已保存到笔记：${data.note.title}`);
    } catch (error) { onToast?.(error.message, 'error'); }
    finally { setAudioMinutesSaving(false); }
  }

  function changeTranslationSettings(patch) { setTranslationSettings(current => ({ ...current, ...patch })); setTranslationDirty(true); }
  function selectTranslationRecord(id) {
    const selected = translations.find(item => item.id === id) || null; setTranslation(selected); setTranslationDirty(false);
    if (selected) setTranslationSettings({ sourceLanguage: selected.sourceLanguage || '自动检测', targetLanguage: selected.targetLanguage || '简体中文', provider: selected.provider === 'local' ? 'local' : 'auto', glossary: selected.glossary || '' });
  }
  function updateTranslationSegment(index, translatedText) { setTranslation(current => ({ ...current, segments: (current?.segments || []).map((row, rowIndex) => rowIndex === index ? { ...row, translatedText } : row) })); setTranslationDirty(true); }
  async function generateDocumentTranslation() {
    if (!detail?.item?.id || translationBusy) return; setTranslationBusy('generate');
    try {
      const data = await request('/api/translations/generate', jsonOptions('POST', { documentId: detail.item.id, ...translationSettings }));
      setTranslation(data.translation); setTranslations(current => [data.translation, ...current.filter(item => item.id !== data.translation.id)]); setTranslationDirty(false); setTranslationOpen(true);
      onToast?.(data.fallbackUsed ? '已生成离线可编辑翻译草稿；配置模型后可重新生成' : '对照翻译已生成');
    } catch (error) { onToast?.(error.message, 'error'); } finally { setTranslationBusy(''); }
  }
  async function saveDocumentTranslation() {
    if (!translation?.id || translationBusy) return; setTranslationBusy('save');
    try {
      const data = await request('/api/translations/' + translation.id, jsonOptions('PATCH', { ...translationSettings, provider: translationSettings.provider === 'local' ? 'local' : (translation.provider || 'auto'), segments: translation.segments }));
      setTranslation(data.translation); setTranslations(current => current.map(item => item.id === data.translation.id ? data.translation : item)); setTranslationDirty(false); onToast?.('翻译修改已保存');
    } catch (error) { onToast?.(error.message, 'error'); } finally { setTranslationBusy(''); }
  }
  async function exportDocumentEntity(entityType, entityId, format, extra = {}) { try { await downloadExport({ entityType, entityId, format, ...extra }, onToast); } catch (error) { onToast?.(error.message, 'error'); } }

  const pageCount = detail?.item?.metadata?.pageCount || pdfPages.length || 1;
  const ocr = detail?.item?.metadata?.ocr;
  return <>
    <aside className="side-panel module-side analysis-side">
      <div className="side-head"><div><span>Document Intelligence</span><h2>文档解读</h2></div><button onClick={() => inputRef.current?.click()} title="导入文件"><Plus size={17}/></button></div>
      <input ref={inputRef} className="hidden-file-input" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.mp3,.m4a,.wav,.aac,.txt,.md,.markdown,.html,.htm,.csv,.tsv,.json,.docx,.pptx,.xlsx,.epub,.xmind" onChange={event => { uploadFiles(event.target.files); event.target.value = ''; }}/>
      <div className="search-box"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索已导入内容"/></div>
      <button className="mini-drop" onClick={() => inputRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); uploadFiles(event.dataTransfer.files); }}><UploadCloud size={18}/><span><b>拖放或选择文件</b><small>PDF、图片 OCR、音频转写、Office、EPUB、XMind</small></span></button>
      {queue.length > 0 && <div className="upload-queue">{queue.map(item => <div key={item.name} className={item.status}>{item.status === 'running' ? <LoaderCircle className="spin" size={14}/> : item.status === 'done' ? <CircleCheck size={14}/> : item.status === 'failed' ? <AlertCircle size={14}/> : <Clock3 size={14}/>}<span><b>{item.name}</b><small>{item.message}</small></span></div>)}</div>}
      <div className="module-list analysis-list">{visible.length ? visible.map(item => <button key={item.id} className={selectedId === item.id ? 'active' : ''} onClick={() => openItem(item.id)}><FileText size={16}/><span><b>{item.title}</b><small>{item.contentType} · {formatTime(item.updatedAt)}</small></span><ChevronRight size={14}/></button>) : <div className="module-empty"><Layers3 size={26}/><b>还没有可阅读内容</b><small>导入文件或先同步飞书知识库</small></div>}</div>
    </aside>
    <main className="workspace module-workspace analysis-workspace">{detail?.item ? <>
      <header className="workspace-head"><div className="workspace-title"><span className="ai-avatar"><FileText size={19}/></span><div><strong>{detail.item.title}</strong><small>{detail.item.contentType} · {detail.item.mimeType || '已建立索引'} · {detail.chunks?.length || 0} 个引用片段</small></div></div><div className="head-actions"><button className={translationOpen ? 'primary-inline' : ''} onClick={() => setTranslationOpen(current => !current)}><Languages size={16}/>{translationOpen ? '返回阅读' : '对照翻译'}</button><button className="export-button" onClick={() => exportDocumentEntity('document', detail.item.id, 'markdown')}><FileDown size={16}/>MD</button><button className="export-button" onClick={() => exportDocumentEntity('document', detail.item.id, 'html')}><FileDown size={16}/>HTML</button><button onClick={() => inputRef.current?.click()}><UploadCloud size={16}/>继续导入</button></div></header>
      {translationOpen ? <TranslationWorkbench
        translation={translation}
        translations={translations}
        sourceLanguage={translationSettings.sourceLanguage}
        targetLanguage={translationSettings.targetLanguage}
        provider={translationSettings.provider}
        glossary={translationSettings.glossary}
        busy={translationBusy}
        dirty={translationDirty}
        activeAnchor={activeAnchor}
        onChangeSettings={changeTranslationSettings}
        onSelect={selectTranslationRecord}
        onGenerate={generateDocumentTranslation}
        onSave={saveDocumentTranslation}
        onClose={() => setTranslationOpen(false)}
        onLocate={goToContentLocation}
        onUpdateSegment={updateTranslationSegment}
        onExport={format => exportDocumentEntity('translation', translation?.id, format)}
        onToast={onToast}
      /> :
      <div className="reader-layout">
        <article className={`document-reader ${isPdf ? 'pdf-document-reader' : ''} ${isImage ? 'image-document-reader' : ''} ${isAudio ? 'audio-document-reader' : ''}`}>
          <div className="reader-meta"><span>{detail.item.metadata?.fileName || detail.item.contentType}</span><span>{detail.item.metadata?.byteSize ? `${Math.ceil(detail.item.metadata.byteSize / 1024)} KB` : '知识库内容'}</span><span>{detail.versions?.length || 1} 个版本</span>{isPdf && <span>{pageCount} 页</span>}{isImage && <><span>{detail.item.metadata?.width || '?'} × {detail.item.metadata?.height || '?'}</span><span>OCR {ocr?.languages?.join?.(' + ') || '已识别'} · {Math.round(Number(ocr?.confidence || 0))}%</span></>}</div>
          {isPdf ? <div className="pdf-reader-shell">
            <div className="pdf-toolbar"><div className="pdf-page-nav"><button disabled={pdfPage <= 1} onClick={() => goToPdfPage(pdfPage - 1)} title="上一页"><ChevronLeft size={16}/></button><label>第 <input type="number" min="1" max={pageCount} value={pdfPage} onChange={event => goToPdfPage(event.target.value)}/> / {pageCount} 页</label><button disabled={pdfPage >= pageCount} onClick={() => goToPdfPage(pdfPage + 1)} title="下一页"><ChevronRight size={16}/></button></div><div className="pdf-zoom"><button disabled={pdfZoom <= 70} onClick={() => changePdfZoom(-10)}>−</button><span>{pdfZoom}%</span><button disabled={pdfZoom >= 180} onClick={() => changePdfZoom(10)}>＋</button></div>{originalAttachment && <a className="pdf-download" href={'/api/content/items/' + detail.item.id + '/original/download'}><Download size={15}/>下载原件</a>}</div>
            <div className="pdf-page-stage">{originalAttachment ? <Suspense fallback={<div className="pdf-canvas-loading">正在加载 PDF 阅读器…</div>}><PdfCanvasPage src={'/api/content/items/' + detail.item.id + '/original'} pageNumber={pdfPage} zoom={pdfZoom} annotations={annotations} onSelectionChange={setSelectionDraft} onAnnotationClick={annotation => goToPdfPage(annotation.pageNumber)}/></Suspense> : <section className="pdf-text-page" style={{ width: `${Math.round(720 * pdfZoom / 100)}px`, minHeight: `${Math.round(930 * pdfZoom / 100)}px` }} data-page-number={currentPdfPage?.pageNumber || pdfPage}><div className="pdf-page-label">Page {currentPdfPage?.pageNumber || pdfPage}</div><pre style={{ fontSize: `${Math.max(12, 14 * pdfZoom / 100)}px` }}>{currentPdfPage?.text || ''}</pre></section>}</div>
          </div> : isAudio ? <div className="audio-reader-shell">
            <div className="pdf-toolbar"><div className="image-ocr-summary"><b>{audioSegments.length ? audioSegments.length + ' 个转写片段' : '待转写音频'}</b><span>{detail.item.metadata?.audio?.status === 'completed' ? '点击转写片段或引用即可跳转播放' : '原件已保存，配置转写服务后可生成时间戳'}</span></div>{originalAttachment && <a className="pdf-download" href={'/api/content/items/' + detail.item.id + '/original/download'}><Download size={15}/>下载音频</a>}</div>
            <div className="audio-page-stage">{originalAttachment ? <Suspense fallback={<div className="pdf-canvas-loading">正在加载音频播放器…</div>}><AudioTranscriptViewer src={'/api/content/items/' + detail.item.id + '/original'} segments={audioSegments} content={detail.item.content} activeAnchor={activeAnchor} durationMs={detail.item.metadata?.durationMs} onAnchorChange={anchor => setActiveAnchor(anchor)}/></Suspense> : <pre>{detail.item.content}</pre>}</div>
          </div> : isImage ? <div className="image-reader-shell">
            <div className="pdf-toolbar"><div className="image-ocr-summary"><b>{imageRegions.length} 个 OCR 区域</b><span>点击框选区域或右侧引用即可定位</span></div><div className="pdf-zoom"><button disabled={pdfZoom <= 70} onClick={() => changePdfZoom(-10)}>−</button><span>{pdfZoom}%</span><button disabled={pdfZoom >= 180} onClick={() => changePdfZoom(10)}>＋</button></div>{originalAttachment && <a className="pdf-download" href={'/api/content/items/' + detail.item.id + '/original/download'}><Download size={15}/>下载原图</a>}</div>
            <div className="image-page-stage">{originalAttachment ? <Suspense fallback={<div className="pdf-canvas-loading">正在加载 OCR 图片阅读器…</div>}><ImageOcrViewer src={'/api/content/items/' + detail.item.id + '/original'} regions={imageRegions} content={detail.item.content} activeAnchor={activeAnchor} zoom={pdfZoom} width={detail.item.metadata?.width} height={detail.item.metadata?.height} confidence={detail.item.metadata?.ocr?.confidence} onRegionClick={anchor => setActiveAnchor(anchor)}/></Suspense> : <pre>{detail.item.content}</pre>}</div>
          </div> : <pre>{detail.item.content}</pre>}
        </article>
        <aside className="document-copilot">
          <div className="document-copilot-title"><MessageSquareText size={17}/><div><b>问问这篇{isImage ? '图片' : isAudio ? '音频' : '文档'}</b><small>回答范围已锁定当前内容</small></div></div>
          {answer && <section className={`document-answer ${answer.error ? 'failed' : ''}`}><b>{answer.question}</b><p>{answer.error || answer.text || (asking ? '正在检索和生成…' : '')}</p>{answer.citations?.length > 0 && <div>{answer.citations.map((citation, index) => <button key={`${citation.documentId || index}-${citation.anchor || ''}`} onClick={() => goToContentLocation(citation.anchor, citation.pageNumber)}><span>[{index + 1}] {citation.title}{isAudio && citation.anchor ? ` · ${formatAudioAnchor(citation.anchor) || '时间戳'}` : isImage && citation.anchor ? ` · ${String(citation.anchor).match(/region:\d+/)?.[0] || 'OCR 区域'}` : citation.pageNumber ? ` · 第 ${citation.pageNumber} 页` : ''}</span><small>{citation.excerpt}</small></button>)}</div>} {!answer.error && answer.text && <div className="answer-export-actions"><button type="button" onClick={() => exportDocumentEntity('answer', '', 'markdown', { title: `${detail.item.title} · 问答`, content: answer.text, citations: answer.citations })}><FileDown size={14}/>导出回答 MD</button><button type="button" onClick={() => exportDocumentEntity('answer', '', 'html', { title: `${detail.item.title} · 问答`, content: answer.text, citations: answer.citations })}><FileDown size={14}/>导出回答 HTML</button></div>}</section>}
          {isPdf && selectionDraft && <section className="pdf-annotation-editor"><div><Highlighter size={16}/><b>创建第 {selectionDraft.pageNumber} 页高亮</b><button type="button" onClick={() => setSelectionDraft(null)}>×</button></div><blockquote>{selectionDraft.quote}</blockquote><textarea value={annotationComment} onChange={event => setAnnotationComment(event.target.value)} placeholder="添加批注（可选）"/><div className="annotation-editor-actions"><div className="annotation-colors">{['yellow', 'blue', 'green', 'pink'].map(color => <button type="button" key={color} className={'annotation-color color-' + color + (annotationColor === color ? ' selected' : '')} onClick={() => setAnnotationColor(color)} aria-label={color}/>)}</div><button type="button" onClick={saveAnnotation}><Save size={14}/>保存高亮</button></div></section>}
          {isAudio && <><div className="audio-quick-actions"><button type="button" onClick={generateAudioMinutes}>生成本地纪要</button><button type="button" onClick={() => setQuestion('请按议题生成结构化录音纪要并提取行动项，列出负责人、截止时间和时间戳引用。')}>AI 深度整理</button></div><section className="audio-minutes-panel"><div className="audio-minutes-head"><div><b>会议纪要与行动项</b><small>转写结果可本地整理、手动编辑，并带时间戳来源保存到个人笔记</small></div></div><div className="audio-minutes-editor"><label className="audio-minutes-field"><span>会议摘要</span><textarea value={audioMinutes.summary} onChange={event => setAudioMinutes(current => ({ ...current, summary: event.target.value }))} placeholder="点击“生成本地纪要”，或在这里直接编辑会议摘要…"/></label><label className="audio-minutes-field"><span>行动项</span><textarea value={audioMinutes.actions} onChange={event => setAudioMinutes(current => ({ ...current, actions: event.target.value }))} placeholder="记录负责人、截止时间和对应时间戳…"/></label></div><div className="audio-minutes-actions"><span className="audio-minutes-status">保存后可在“笔记”工作区继续编辑与检索</span><button type="button" className="audio-minutes-save" disabled={audioMinutesSaving || (!audioMinutes.summary.trim() && !audioMinutes.actions.trim())} onClick={saveAudioMinutes}>{audioMinutesSaving ? <LoaderCircle className="spin" size={14}/> : <Save size={14}/>}保存为笔记</button></div></section></>}
          <div className="document-question"><textarea value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); askDocument(); } }} placeholder={isImage ? '识别关键信息、解释图中文字、提炼行动项…' : isAudio ? '生成纪要、提取行动项、定位关键发言…' : '提炼要点、解释术语、寻找风险或行动项…'}/><button disabled={!question.trim() || asking} onClick={askDocument}>{asking ? <LoaderCircle className="spin" size={15}/> : <Sparkles size={15}/>}提问</button></div>
          {isPdf && <section className="annotation-list"><h3><Highlighter size={15}/>我的标注</h3>{annotations.length ? annotations.map(annotation => <article key={annotation.id} className="annotation-card"><button type="button" onClick={() => goToPdfPage(annotation.pageNumber)}><b>第 {annotation.pageNumber} 页 · {annotation.color}</b><small>{annotation.quote || '无引用文字'}</small>{annotation.comment && <em>{annotation.comment}</em>}</button><div><button type="button" title="转为笔记" onClick={() => convertAnnotationToNote(annotation)}><StickyNote size={14}/></button><button type="button" title="删除标注" onClick={() => deleteAnnotation(annotation)}><Trash2 size={14}/></button></div></article>) : <p className="annotation-empty">在 PDF 文本层拖选文字即可创建高亮。</p>}</section>}
          <section className="chunk-list"><h3>{isImage ? 'OCR 区域与引用定位' : isAudio ? '时间戳与引用定位' : '引用定位'}</h3>{(detail.chunks || []).slice(0, 12).map((chunk, index) => { const anchor = chunk.metadata?.pageAnchor || chunk.metadata?.anchor; const region = String(anchor || '').match(/(?:page:\d+:)?region:\d+|time:[\d.]+-[\d.]+/)?.[0]; const activeRegion = String(activeAnchor || '').match(/(?:page:\d+:)?region:\d+|time:[\d.]+-[\d.]+/)?.[0]; return <button key={chunk.id || index} className={region && (activeAnchor === anchor || activeRegion === region) ? 'active' : ''} onClick={() => goToContentLocation(anchor, chunk.metadata?.pageNumber)}><b>{region ? `${region.startsWith('time:') ? formatAudioAnchor(region) : region} · ` : chunk.metadata?.pageNumber ? `第 ${chunk.metadata.pageNumber} 页 · ` : ''}片段 {index + 1}</b><small>{String(chunk.text || '').slice(0, 120)}</small></button>; })}</section>
        </aside>
      </div>}
    </> : <div className="analysis-empty-drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); uploadFiles(event.dataTransfer.files); }}><span><UploadCloud size={32}/></span><h2>{uploading ? '正在解析文件' : '拖入文件开始文档解读'}</h2><p>支持 PDF、PNG、JPG、WebP、MP3、M4A、WAV、AAC、TXT、Markdown、HTML、CSV、JSON、DOCX、PPTX、XLSX、EPUB 和 XMind；图片会自动 OCR，音频会转写为时间戳片段，并提供可点击引用定位。</p><button onClick={() => inputRef.current?.click()}><Plus size={16}/>选择本地文件</button></div>}</main>
  </>;
}
