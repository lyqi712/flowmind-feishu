import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Globe, LoaderCircle, RotateCcw, Scissors, StickyNote } from 'lucide-react';
import { normalizeClientBrowseUrl, observeWebviewNavigation, webBrowseLimitation, webEmbedIsReliable } from '../workspace/web-browse.js';
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
  const [frameUrl, setFrameUrl] = useState(href);
  const activeUrl = useRef(href);
  const urlChange = useRef(onUrlChange);
  urlChange.current = onUrlChange;
  const [history, setHistory] = useState({ back: false, forward: false });
  const [refreshVersion, setRefreshVersion] = useState(0);
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

  function updateLocation(next) {
    if (next !== activeUrl.current) {
      setTitle('');
      setPreview(null);
      setExcerpt('');
    }
    activeUrl.current = next;
    setHref(next);
    setDraft(next);
    setError('');
  }

  useEffect(() => {
    if (!initialUrl) return;
    try {
      const next = normalizeClientBrowseUrl(initialUrl).href;
      // The parent echoes observed guest navigation; do not navigate the guest again.
      if (next === activeUrl.current) return;
      updateLocation(next);
      if (next === frameUrl && webviewRef.current) {
        webviewRef.current.loadURL(next)?.catch?.(currentError => setError(readableError(currentError)));
      }
      setFrameUrl(next);
    } catch (currentError) { setError(readableError(currentError)); }
  }, [initialUrl]);

  const hasFrame = Boolean(frameUrl);
  useEffect(() => {
    const view = webviewRef.current;
    if (!canEmbed || !view) return;
    return observeWebviewNavigation(view, {
      onNavigate(next) {
        const changed = next !== activeUrl.current;
        updateLocation(next);
        if (changed) urlChange.current?.(next, { title: next });
      },
      onTitle(next, nextTitle) {
        if (next !== activeUrl.current) return;
        setTitle(nextTitle);
        urlChange.current?.(next, { title: nextTitle || next });
      },
      onHistory: setHistory,
      onError: currentError => setError(readableError(currentError))
    });
  }, [canEmbed, hasFrame]);

  useEffect(() => {
    if (electron || !href) return;
    const controller = new AbortController();
    let cancelled = false;
    setBusy('preview');
    setPreview(null);
    (async () => {
      try {
        const response = await fetch('/api/web/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: href }),
          signal: controller.signal
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error?.message || body?.message || `网页读取失败（${response.status}）`);
        if (cancelled || activeUrl.current !== href) return;
        setPreview(body);
        setTitle(body.title || '');
        urlChange.current?.(href, { title: body.title || href });
      } catch (currentError) {
        if (!cancelled && activeUrl.current === href) setError(readableError(currentError, '可读摘要失败，仍可剪藏地址栏网址。'));
      } finally {
        if (!cancelled) setBusy(current => current === 'preview' ? '' : current);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [electron, href, refreshVersion]);

  function refresh() {
    setError('');
    try {
      if (electron) webviewRef.current?.reload?.();
      else setRefreshVersion(current => current + 1);
    } catch (currentError) { setError(readableError(currentError)); }
  }

  function navigateHistory(direction) {
    try { webviewRef.current?.[direction]?.(); }
    catch (currentError) { setError(readableError(currentError)); }
  }

  function go(event) {
    event?.preventDefault?.();
    try {
      const next = normalizeClientBrowseUrl(draft).href;
      const same = next === activeUrl.current;
      updateLocation(next);
      if (!same && next === frameUrl && webviewRef.current) {
        webviewRef.current.loadURL(next)?.catch?.(currentError => setError(readableError(currentError)));
      }
      setFrameUrl(next);
      urlChange.current?.(next, { title: same ? title || next : next });
      if (same) refresh();
    } catch (currentError) { setError(readableError(currentError)); }
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
    } catch (currentError) {
      setError(readableError(currentError, '剪藏失败，请重试'));
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
        <button type="button" onClick={() => navigateHistory('goBack')} aria-label="后退" disabled={!href || readerVisible || !history.back}><ArrowLeft size={16} /></button>
        <button type="button" onClick={() => navigateHistory('goForward')} aria-label="前进" disabled={!href || readerVisible || !history.forward}><ArrowRight size={16} /></button>
        <button type="button" onClick={refresh} aria-label="刷新" disabled={!draft.trim()}><RotateCcw size={16} /></button>
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
            src: frameUrl,
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
            <iframe key={refreshVersion} ref={iframeRef} className="embedded-browser-frame" title={frameTitle} src={frameUrl} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" />
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
