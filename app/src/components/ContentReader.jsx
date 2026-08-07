import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { ArrowLeft, BrainCircuit, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Download, ExternalLink, File, FileArchive, FileImage, FilePenLine, FileText, Link2, LoaderCircle, MessageSquarePlus, Paperclip, RefreshCw, RotateCcw, Sparkles, X, XCircle } from 'lucide-react';
import './ContentReader.css';

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
  return [value.id, value.attachmentId, value.externalId, value.token, value.fileToken, value.file_token,
    metadata.token, metadata.fileToken, metadata.file_token, metadata.feishuToken, metadata.externalId].map(cleanToken).filter(Boolean);
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
  return String(markdown || '').replace(/feishu-asset:\/\/([^\s)\]}>"']+)/gi, (source, token) => {
    const resolved = resolveFeishuAsset(token, item, attachments);
    return resolved?.url || `#missing-feishu-asset-${encodeURIComponent(cleanToken(token))}`;
  });
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
    { id: 'explain-selection', label: '解释这段', prompt: `解释“${selection.quote || selection.text}”在《${title}》中的含义，并指出上下文依据。` },
    { id: 'summarize-selection', label: '总结这段', prompt: `把《${title}》当前选区总结成 3 个清晰要点，并保留关键事实。` },
    { id: 'apply-selection', label: '形成行动', prompt: `基于《${title}》当前选区，给出可执行的下一步、风险和待确认问题。` }
  ];
  return [
    { id: 'summary', label: '概括核心结论', prompt: `概括《${title}》的核心结论，先给结论，再列依据。` },
    { id: 'actions', label: '提取行动项', prompt: `从《${title}》提取行动项、负责人线索、时间要求和风险。` },
    { id: 'relations', label: '观察知识关联', prompt: `分析《${title}》与当前知识库其他内容的共识、冲突和关联，并给出引用依据。` }
  ];
}

const INTERPRETATION_LABELS = {
  'mind-map': { title: '思维导图', description: '沿着文档结构展开，点击节点回到原文', Icon: BrainCircuit },
  quiz: { title: '互动测验', description: '逐题作答，用来源解释巩固理解', Icon: CircleHelp }
};

function runDocumentIds(run = {}) {
  return (run.documentIds || run.input?.documentIds || []).map(String);
}

export function ContentReader({ item, attachments = [], inQuestionScope = false, onToggleQuestionScope,
  onAsk, onCreateWriting, onRunInterpretation, interpretationRuns = [], onWriteSourceNote, onClose, onSelectionChange,
  onReadingPositionChange, onAnchorChange, initialReadingPosition = null, initialAnchor = '', className = '' }) {
  const readerRef = useRef(null);
  const [selectionContext, setSelectionContext] = useState(null);
  const [activeInterpretation, setActiveInterpretation] = useState('');
  const [interpretationRun, setInterpretationRun] = useState(null);
  const [interpretationBusy, setInterpretationBusy] = useState(false);
  const [interpretationError, setInterpretationError] = useState('');
  const [expandedNodes, setExpandedNodes] = useState(() => new Set());
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState({});
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
  const markdown = useMemo(() => rewriteFeishuAssetUrls(sourceItem.content || sourceItem.markdown || '', sourceItem, attachments), [sourceItem, attachments]);
  const quickQuestions = useMemo(() => buildReaderQuickQuestions(sourceItem, selectionContext), [sourceItem, selectionContext]);
  const currentRuns = useMemo(() => interpretationRuns.filter(run => ['mind-map', 'quiz'].includes(run.skillId)
    && runDocumentIds(run).includes(String(sourceItem.id || '')) && run.artifact), [interpretationRuns, sourceItem.id]);

  useEffect(() => {
    setSelectionContext(null);
    setActiveInterpretation('');
    setInterpretationRun(null);
    setInterpretationError('');
    setQuizIndex(0);
    setQuizAnswers({});
  }, [item?.id]);

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

  const jumpTo = (anchor, smooth = true) => {
    const reader = readerRef.current;
    if (!reader) return;
    const normalized = normalizeAnchor(anchor || 'root');
    const target = normalized === 'root' ? null : reader.querySelector(`[id="${String(normalized).replace(/"/g, '\\"')}"]`);
    if (!target) {
      reader.scrollTo?.({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
      reader.focus({ preventScroll: true });
      onAnchorChange?.('root');
      onReadingPositionChange?.(readingPositionFromElement(reader, 'root'));
      return;
    }
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    target.focus({ preventScroll: true });
    onAnchorChange?.(normalized);
    onReadingPositionChange?.(readingPositionFromElement(reader, normalized));
  };

  useEffect(() => {
    const reader = readerRef.current;
    if (!reader || !item) return;
    if (initialReadingPosition?.scrollTop) reader.scrollTop = Number(initialReadingPosition.scrollTop) || 0;
    const anchor = normalizeAnchor(initialAnchor || initialReadingPosition?.anchor);
    if (anchor) requestAnimationFrame(() => jumpTo(anchor, false));
  }, [item?.id, initialAnchor]);

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

  const openSource = (sourceRef = {}) => {
    if (sourceRef.documentId && String(sourceRef.documentId) !== String(item.id)) return;
    jumpTo(sourceRef.anchor || 'root');
  };

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

  return (
    <section className={`content-reader ${className}`.trim()} aria-label={`${item.title || '未命名文档'}阅读器`}>
      <header className="content-reader-toolbar">
        <div className="content-reader-title-group">
          <button type="button" className="content-reader-icon-button content-reader-back" onClick={onClose} aria-label="关闭阅读器"><ArrowLeft size={18} /></button>
          <div><span className="content-reader-source">{sourceLabel(item)}</span><h1>{item.title || '未命名文档'}</h1></div>
        </div>
        <div className="content-reader-actions">
          <button type="button" className="content-reader-action content-reader-ask" onClick={() => onAsk?.(quickQuestions[0].prompt, selectionContext)}><Sparkles size={16} />{selectionContext ? '问这段' : '问这篇'}</button>
          <button type="button" className={`content-reader-action ${inQuestionScope ? 'is-active' : ''}`} onClick={() => onToggleQuestionScope?.(item, !inQuestionScope)} aria-pressed={inQuestionScope}>
            {inQuestionScope ? <Check size={16} /> : <Link2 size={16} />}{inQuestionScope ? '移出问答范围' : '加入问答范围'}
          </button>
          <button type="button" className="content-reader-action" onClick={() => onWriteSourceNote?.(item, selectionContext)}><MessageSquarePlus size={16} />{selectionContext ? '记下选区' : '写来源笔记'}</button>
          <button type="button" className="content-reader-icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
      </header>

      <section className={`content-reader-ai-bar ${selectionContext ? 'has-selection' : ''}`} aria-label="AI 阅读助手">
        <div className="content-reader-ai-intro"><span><Sparkles size={15}/></span><div><b>{selectionContext ? '已选中一段内容' : 'AI 阅读助手'}</b><small>{selectionContext ? String(selectionContext.quote || selectionContext.text).slice(0, 76) : '直接围绕当前飞书材料继续提问'}</small></div></div>
        <div className="content-reader-ai-prompts">
          {quickQuestions.map(question => <button type="button" key={question.id} onClick={() => onAsk?.(question.prompt, selectionContext)}>{question.label}</button>)}
          <button type="button" className="content-reader-create-writing" onClick={() => onCreateWriting?.(selectionContext)}><FilePenLine size={13}/>{selectionContext ? '用选区写作' : '创建写作草稿'}</button>
          <button type="button" className={`content-reader-interpretation-trigger ${activeInterpretation === 'mind-map' ? 'is-active' : ''}`} aria-pressed={activeInterpretation === 'mind-map'} onClick={() => openInterpretation('mind-map')}><BrainCircuit size={13}/>思维导图</button>
          <button type="button" className={`content-reader-interpretation-trigger ${activeInterpretation === 'quiz' ? 'is-active' : ''}`} aria-pressed={activeInterpretation === 'quiz'} onClick={() => openInterpretation('quiz')}><CircleHelp size={13}/>测验</button>
        </div>
        {selectionContext && <button type="button" className="content-reader-selection-clear" onClick={() => setSelectionContext(null)}>清除选区</button>}
      </section>

      <div className={`content-reader-layout ${outline.length ? 'has-outline' : ''} ${activeInterpretation ? 'has-interpretation' : ''}`.trim()}>
        {outline.length > 0 && <aside className="content-reader-outline" aria-label="文档目录">
          <div className="content-reader-outline-title">文档目录</div>
          <nav>{outline.map((entry, index) => <button type="button" key={`${entry.anchor}-${index}`} className="content-reader-outline-link"
            style={{ '--outline-depth': entry.level - 1 }} onClick={() => jumpTo(entry.anchor)}><ChevronRight size={13} /><span>{entry.title}</span></button>)}</nav>
        </aside>}

        <main className="content-reader-scroll" ref={readerRef} tabIndex="0" onMouseUp={() => { const payload = selectionPayload(globalThis.getSelection?.(), readerRef.current, item.id); if (payload) { setSelectionContext(payload); onSelectionChange?.(payload, item); } }} onScroll={event => { const reader = event.currentTarget; const headings = [...reader.querySelectorAll('.content-reader-heading')]; const activeHeading = headings.filter(heading => heading.offsetTop <= reader.scrollTop + 32).at(-1); onReadingPositionChange?.(readingPositionFromElement(reader, activeHeading?.id || '')); }}>
          <article className="content-reader-markdown">
            {markdown.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} urlTransform={url => defaultUrlTransform(url)} components={{
              h1: headingComponent(1), h2: headingComponent(2), h3: headingComponent(3), h4: headingComponent(4), h5: headingComponent(5), h6: headingComponent(6),
              a({ href = '', children, node, ...props }) {
                const external = /^https?:\/\//i.test(href);
                return <a {...props} href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer noopener' : undefined}>{children}{external && <ExternalLink size={12} />}</a>;
              },
              img({ src = '', alt = '', node, ...props }) { return <span className="content-reader-image"><img {...props} src={src} alt={alt} loading="lazy" /><span className="content-reader-image-caption">{alt || '文档图片'}</span></span>; },
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
      </div>
    </section>
  );
}
export default ContentReader;
