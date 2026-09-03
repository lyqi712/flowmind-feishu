import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Globe, LoaderCircle, RotateCcw, Scissors, StickyNote } from 'lucide-react';
import { normalizeClientBrowseUrl, webBrowseLimitation, webEmbedIsReliable } from '../workspace/web-browse.js';
import './EmbeddedBrowser.css';

function readableError(error, fallback = '网页打开失败') {
  return String(error?.message || error || fallback).trim() || fallback;
}

function isElectronHost() {
  return Boolean(typeof window !== 'undefined' && window.flowMindDesktop) || (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || ''));
}

export function EmbeddedBrowser({
  initialUrl = '',
  onUrlChange,
  onClip,
  onOpenNote
}) {
  const [draft, setDraft] = useState(() => String(initialUrl || ''));
  const [href, setHref] = useState(() => {
    try {
      return initialUrl ? normalizeClientBrowseUrl(initialUrl).href : '';
    } catch {
      return '';
    }
  });
  const [title, setTitle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [readerMode, setReaderMode] = useState(() => !isElectronHost());
  const [lastClip, setLastClip] = useState(null);
  const iframeRef = useRef(null);
  const webviewRef = useRef(null);
  const electron = useMemo(() => isElectronHost(), []);
  const canEmbed = webEmbedIsReliable(electron);
  const limitation = webBrowseLimitation(electron);

  useEffect(() => {
    const next = String(initialUrl || '');
    if (!next) return;
    setDraft(next);
    try {
      setHref(normalizeClientBrowseUrl(next).href);
      setError('');
    } catch (currentError) {
      setError(readableError(currentError));
    }
  }, [initialUrl]);

  async function loadPreview(target) {
    setBusy('preview');
    try {
      const response = await fetch('/api/web/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: target })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || body?.message || `网页读取失败（${response.status}）`);
      setPreview(body);
      if (body.title) {
        setTitle(body.title);
        onUrlChange?.(target, { title: body.title });
      }
      return body;
    } finally {
      setBusy('');
    }
  }

  async function go(event) {
    event?.preventDefault?.();
    setError('');
    setPreview(null);
    setReaderMode(false);
    try {
      const next = normalizeClientBrowseUrl(draft).href;
      setHref(next);
      setTitle('');
      onUrlChange?.(next, { title: next });
      if (!electron) {
        try {
          await loadPreview(next);
        } catch (currentError) {
          setError(readableError(currentError, '可读摘要失败。若页面能嵌入，仍可继续浏览并剪藏网址。'));
        }
      }
    } catch (currentError) {
      setError(readableError(currentError));
    }
  }

  async function clip(mode = 'excerpt') {
    if (!href || busy === 'clip') return;
    const quote = mode === 'url' ? '' : excerpt.trim();
    if (mode === 'excerpt' && !quote) return;
    setBusy('clip');
    try {
      const note = await onClip?.({
        url: href,
        title: title || preview?.title || href,
        excerpt: quote,
        quote,
        targetNoteId: lastClip?.id
      });
      if (note?.id) setLastClip(note);
    } finally {
      setBusy('');
    }
  }

  const frameTitle = title || href || '网页';
  const readerVisible = Boolean(!canEmbed && readerMode);
  const canClipPitfall = Boolean(href && excerpt.trim());

  return (
    <section className="embedded-browser" aria-label="内嵌网页">
      <form className="embedded-browser-toolbar" onSubmit={go}>
        <button type="button" onClick={() => (electron ? webviewRef.current?.goBack?.() : iframeRef.current?.contentWindow?.history.back())} aria-label="后退" disabled={!href || readerVisible}><ArrowLeft size={16} /></button>
        <button type="button" onClick={() => (electron ? webviewRef.current?.goForward?.() : iframeRef.current?.contentWindow?.history.forward())} aria-label="前进" disabled={!href || readerVisible}><ArrowRight size={16} /></button>
        <button type="button" onClick={() => go()} aria-label="刷新" disabled={!draft.trim()}><RotateCcw size={16} /></button>
        <label className="embedded-browser-address">
          <Globe size={15} aria-hidden="true" />
          <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="粘贴或输入网址，例如 example.com" aria-label="网址" autoComplete="off" />
        </label>
        <button type="submit" className="is-primary" disabled={busy === 'preview'}>{busy === 'preview' ? <LoaderCircle className="spin" size={15} /> : '打开'}</button>
      </form>
      {error ? <p className="embedded-browser-error" role="alert">{error}</p> : null}
      {href && limitation ? <p className="embedded-browser-notice" role="status">{limitation}</p> : null}
      <div className="embedded-browser-stage">
        {href ? (
          canEmbed ? React.createElement('webview', {
            ref: webviewRef,
            key: href,
            src: href,
            partition: 'persist:flowmind-web',
            allowpopups: 'false',
            webpreferences: 'contextIsolation=yes, nodeIntegration=no, sandbox=yes',
            className: 'embedded-browser-frame',
            title: frameTitle
          }) : readerMode ? (
            <article className="embedded-browser-reader" aria-label="网页可读预览">
              <h1>{preview?.title || title || href}</h1>
              <a href={preview?.url || href} target="_blank" rel="noreferrer">{preview?.url || href}</a>
              <p>{preview?.excerpt || (busy === 'preview' ? '正在读取摘要…' : '没有提取到正文摘要，仍可把网址剪藏。')}</p>
            </article>
          ) : (
            <iframe ref={iframeRef} className="embedded-browser-frame" title={frameTitle} src={href} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" />
          )
        ) : (
          <div className="embedded-browser-empty">
            <Globe size={28} />
            <b>粘贴网址，看完再剪藏</b>
            <small>只记这次容易忘的点，不要整页复制。</small>
          </div>
        )}
      </div>
      <footer className={`embedded-browser-clip${href ? '' : ' is-empty'}`}>
        {href ? (
          <>
            <div className="embedded-browser-clip-meta">
              <small>{lastClip?.title ? `已写入：${lastClip.title}` : '已打开的问题记录会追加；否则新建一篇。'}</small>
              {!canEmbed ? (
                <button type="button" className="embedded-browser-mode" onClick={() => setReaderMode(current => !current)}>
                  {readerMode ? <Globe size={14} /> : <BookOpen size={14} />}
                  {readerMode ? '尝试嵌入网页' : '改用可读摘要'}
                </button>
              ) : null}
              {lastClip?.id && typeof onOpenNote === 'function' ? (
                <button type="button" className="embedded-browser-mode" onClick={() => onOpenNote(lastClip)}>查看问题记录</button>
              ) : null}
            </div>
            <label>
              <span>这次容易忘的点</span>
              <textarea value={excerpt} onChange={event => setExcerpt(event.target.value)} rows={3} placeholder="例如：出锅前再看一眼葱花。不要整页复制。" />
            </label>
            <div className="embedded-browser-clip-actions">
              {preview?.excerpt ? <button type="button" onClick={() => setExcerpt(preview.excerpt.slice(0, 160))}>填入摘要</button> : null}
              <button type="button" disabled={busy === 'clip'} onClick={() => clip('url')}><Globe size={15} />只剪网址</button>
              <button type="button" className="is-primary" disabled={!canClipPitfall || busy === 'clip'} onClick={() => clip('excerpt')}>
                {busy === 'clip' ? <LoaderCircle className="spin" size={15} /> : <Scissors size={15} />}
                剪进问题记录
              </button>
              <span className="embedded-browser-clip-hint"><StickyNote size={14} />写入「下次容易忘的点」，网页进来源</span>
            </div>
          </>
        ) : (
          <p className="embedded-browser-clip-hint"><StickyNote size={14} />打开网页后，把例外记进问题记录。</p>
        )}
      </footer>
    </section>
  );
}

export default EmbeddedBrowser;
