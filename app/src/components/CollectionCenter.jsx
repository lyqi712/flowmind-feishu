import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, FileText, FolderOpen, Library, Link2, LoaderCircle, Sparkles, Upload, X } from 'lucide-react';
import './CollectionCenter.css';

function readableError(error, fallback = '导入失败，请稍后重试') {
  return String(error?.message || error || fallback).trim() || fallback;
}

function resultRows(result) {
  if (Array.isArray(result)) return result;
  for (const key of ['items', 'results', 'files', 'documents']) {
    if (Array.isArray(result?.[key])) return result[key];
  }
  return [];
}

function rowFailed(row) {
  const status = String(row?.status || '').toLowerCase();
  return row?.ok === false || row?.success === false || ['error', 'failed', 'failure', 'rejected'].includes(status);
}

function rowMessage(row, fallback) {
  return String(row?.message || row?.error || row?.detail || fallback || '').trim();
}

function normalizeFileResult(files, result) {
  const rows = resultRows(result);
  const explicitFailureCount = Math.max(0, Number(result?.failed ?? result?.failureCount ?? 0) || 0);
  const explicitImportedCount = Number(result?.imported ?? result?.succeeded ?? result?.successCount);
  const inferredSucceeded = Number.isFinite(explicitImportedCount)
    ? Math.max(0, Math.min(files.length, explicitImportedCount))
    : Math.max(0, files.length - explicitFailureCount);
  const explicitSuccess = result?.ok !== false && result?.success !== false;
  const items = files.map((file, index) => {
    const matched = rows.find(row => row?.name === file.name || row?.fileName === file.name) || rows[index];
    const failed = matched ? rowFailed(matched) : (!explicitSuccess && !inferredSucceeded) || index >= inferredSucceeded;
    return {
      name: file.name || `文件 ${index + 1}`,
      status: failed ? 'error' : 'success',
      message: rowMessage(matched, failed ? '导入失败' : '已导入知识库')
    };
  });
  const succeeded = items.filter(item => item.status === 'success').length;
  const failed = items.length - succeeded;
  return {
    kind: 'files',
    ok: succeeded > 0 && failed === 0,
    partial: succeeded > 0 && failed > 0,
    succeeded,
    failed,
    total: items.length,
    title: failed ? `已导入 ${succeeded} 个，${failed} 个失败` : `已导入 ${succeeded} 个文件`,
    message: rowMessage(result, failed ? '部分文件需要重新导入' : '文件已进入知识库，可以立即查看和提问。'),
    items,
    raw: result
  };
}

/** 一次传入用户选择的全部 File，并发布逐文件状态。 */
export async function importCollectionFiles(files, onImportFiles, onStatus) {
  const list = Array.from(files || []);
  if (!list.length) return null;
  if (typeof onImportFiles !== 'function') throw new TypeError('onImportFiles 必须是函数');
  onStatus?.(list.map(file => ({ name: file.name, status: 'loading', message: '正在导入…' })));
  try {
    const result = await onImportFiles(list);
    const normalized = normalizeFileResult(list, result);
    onStatus?.(normalized.items);
    return normalized;
  } catch (error) {
    const message = readableError(error);
    onStatus?.(list.map(file => ({ name: file.name, status: 'error', message })));
    throw error;
  }
}

/** 快速文本统一以 { title, content } 传给宿主。 */
export async function importCollectionText(payload, onImportText) {
  if (typeof onImportText !== 'function') throw new TypeError('onImportText 必须是函数');
  const normalized = {
    title: String(payload?.title || '').trim(),
    content: String(payload?.content || '').trim()
  };
  if (!normalized.title || !normalized.content) throw new TypeError('标题和正文不能为空');
  const result = await onImportText(normalized);
  const ok = result?.ok !== false && result?.success !== false;
  return {
    kind: 'text', ok, succeeded: ok ? 1 : 0, failed: ok ? 0 : 1, total: 1,
    title: ok ? '文本已加入知识库' : '文本导入失败',
    message: rowMessage(result, ok ? '现在可以在知识库中查看、搜索和继续提问。' : '请检查内容后重试。'),
    items: [], raw: result
  };
}

function StatusIcon({ status }) {
  if (status === 'loading') return <LoaderCircle className="collection-spin" size={16} aria-hidden="true"/>;
  if (status === 'success') return <CheckCircle2 size={16} aria-hidden="true"/>;
  return <AlertCircle size={16} aria-hidden="true"/>;
}

export function CollectionCenter({ open = true, onClose, onOpenFeishu, onImportFiles, onImportText, onOpenLibrary }) {
  const titleId = useId();
  const descriptionId = useId();
  const fileInputId = useId();
  const fileInputRef = useRef(null);
  const closeButtonRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [feishuBusy, setFeishuBusy] = useState(false);
  const [textBusy, setTextBusy] = useState(false);
  const [fileStatuses, setFileStatuses] = useState([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState('');
  const busy = fileBusy || feishuBusy || textBusy;

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  const handleFiles = useCallback(async selectedFiles => {
    const files = Array.from(selectedFiles || []);
    if (!files.length || fileBusy || typeof onImportFiles !== 'function') return;
    setError(''); setLastResult(null); setFileBusy(true);
    try {
      const result = await importCollectionFiles(files, onImportFiles, setFileStatuses);
      setLastResult(result);
    } catch (currentError) {
      setError(readableError(currentError));
    } finally {
      setFileBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [fileBusy, onImportFiles]);

  async function handleFeishu() {
    if (feishuBusy || typeof onOpenFeishu !== 'function') return;
    setError(''); setFeishuBusy(true);
    try { await onOpenFeishu(); }
    catch (currentError) { setError(readableError(currentError, '飞书入口打开失败，请重试')); }
    finally { setFeishuBusy(false); }
  }

  async function handleTextSubmit(event) {
    event.preventDefault();
    if (textBusy || !title.trim() || !content.trim() || typeof onImportText !== 'function') return;
    setError(''); setLastResult(null); setTextBusy(true);
    try {
      const result = await importCollectionText({ title, content }, onImportText);
      if (!result.ok) setError(result.message);
      else { setTitle(''); setContent(''); }
      setLastResult(result);
    } catch (currentError) { setError(readableError(currentError)); }
    finally { setTextBusy(false); }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    void handleFiles(event.dataTransfer.files);
  }

  if (!open) return null;
  const canOpenLibrary = Boolean(lastResult && (lastResult.ok || lastResult.partial) && onOpenLibrary);

  return (
    <div className="collection-center-backdrop" onClick={onClose} role="presentation">
      <section className="collection-center" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} onClick={event => event.stopPropagation()}>
        <header className="collection-center-header">
          <div className="collection-center-heading">
            <span className="collection-center-brand" aria-hidden="true"><Sparkles size={20}/></span>
            <div><p className="collection-center-eyebrow">快速收集</p><h2 id={titleId}>把内容放进 FlowMind</h2><p id={descriptionId}>链接、文件或随手记录，从这里一步进入你的知识库。</p></div>
          </div>
          <button ref={closeButtonRef} type="button" className="collection-center-close" aria-label="关闭收集中心" onClick={onClose}><X size={20}/></button>
        </header>

        <div className="collection-center-grid">
          <article className="collection-entry collection-entry-feishu">
            <div className="collection-entry-icon" aria-hidden="true"><Link2 size={22}/></div>
            <div className="collection-entry-copy"><span className="collection-entry-kicker">飞书内容</span><h3>链接与知识空间</h3><p>粘贴飞书文档链接，或连接知识空间后批量同步。</p></div>
            <button type="button" className="collection-primary-button" onClick={handleFeishu} disabled={feishuBusy || typeof onOpenFeishu !== 'function'} aria-busy={feishuBusy}>
              {feishuBusy ? <LoaderCircle className="collection-spin" size={17}/> : <FolderOpen size={17}/>}
              {feishuBusy ? '正在打开…' : '打开飞书导入'}{!feishuBusy && <ArrowRight size={16}/>}
            </button>
          </article>

          <article className="collection-entry collection-entry-files">
            <div className="collection-entry-title-row">
              <div className="collection-entry-icon" aria-hidden="true"><Upload size={22}/></div>
              <div className="collection-entry-copy"><span className="collection-entry-kicker">本地资料</span><h3>拖放或选择文件</h3><p>支持一次选择多个文件，选择后立即开始导入。</p></div>
            </div>
            <div className={`collection-dropzone${dragging ? ' is-dragging' : ''}${fileBusy ? ' is-busy' : ''}`}
              onDragEnter={event => { event.preventDefault(); setDragging(true); }}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true); }}
              onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={handleDrop}>
              <input ref={fileInputRef} id={fileInputId} className="collection-file-input" type="file" multiple
                disabled={fileBusy || typeof onImportFiles !== 'function'} onChange={event => void handleFiles(event.target.files)}/>
              {fileBusy ? <LoaderCircle className="collection-spin" size={25} aria-hidden="true"/> : <Upload size={25} aria-hidden="true"/>}
              <strong>{fileBusy ? '正在导入文件…' : dragging ? '松开即可导入' : '把文件拖到这里'}</strong><span>或</span>
              <label className={`collection-file-picker${fileBusy || typeof onImportFiles !== 'function' ? ' is-disabled' : ''}`} htmlFor={fileInputId}
                aria-disabled={fileBusy || typeof onImportFiles !== 'function'}>{fileBusy ? '请稍候' : '选择文件'}</label>
            </div>
            {fileStatuses.length > 0 && <ul className="collection-file-statuses" aria-label="文件导入状态" aria-live="polite">
              {fileStatuses.map((item, index) => <li key={`${item.name}-${index}`} data-status={item.status}><StatusIcon status={item.status}/><span><b>{item.name}</b><small>{item.message}</small></span></li>)}
            </ul>}
          </article>

          <article className="collection-entry collection-entry-text">
            <div className="collection-entry-title-row">
              <div className="collection-entry-icon" aria-hidden="true"><FileText size={22}/></div>
              <div className="collection-entry-copy"><span className="collection-entry-kicker">随手记</span><h3>快速文本</h3><p>把灵感、会议记录或待整理内容直接收进知识库。</p></div>
            </div>
            <form className="collection-text-form" onSubmit={handleTextSubmit}>
              <label><span>标题</span><input value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：项目复盘要点" disabled={textBusy} autoComplete="off"/></label>
              <label><span>正文</span><textarea value={content} onChange={event => setContent(event.target.value)} placeholder="粘贴或输入内容…" rows={5} disabled={textBusy}
                onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') event.currentTarget.form?.requestSubmit(); }}/></label>
              <div className="collection-text-actions"><small>Ctrl / ⌘ + Enter 快速导入</small>
                <button type="submit" className="collection-secondary-button" disabled={textBusy || !title.trim() || !content.trim() || typeof onImportText !== 'function'} aria-busy={textBusy}>
                  {textBusy ? <LoaderCircle className="collection-spin" size={17}/> : <FileText size={17}/>}{textBusy ? '正在导入…' : '加入知识库'}
                </button>
              </div>
            </form>
          </article>
        </div>

        {(error || lastResult) && <aside className={`collection-result ${error || !lastResult?.ok && !lastResult?.partial ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'} aria-live="polite">
          <span className="collection-result-icon" aria-hidden="true">{error || !lastResult?.ok && !lastResult?.partial ? <AlertCircle size={21}/> : <CheckCircle2 size={21}/>}</span>
          <div><strong>{error ? '导入没有完成' : lastResult?.title}</strong><p>{error || lastResult?.message}</p></div>
          {canOpenLibrary && <button type="button" onClick={() => onOpenLibrary?.(lastResult)}><Library size={16}/>查看知识库<ArrowRight size={15}/></button>}
        </aside>}

        <footer className="collection-center-footer"><span><CheckCircle2 size={15}/>导入后可立即查看、搜索和提问</span><button type="button" onClick={onClose}>稍后再说</button></footer>
      </section>
    </div>
  );
}
