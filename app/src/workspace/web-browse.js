import { isBlockedHostname, normalizeBrowseUrl } from '../../shared/public-http-url.mjs';
import { isPlaceholderPitfall, isProblemNote, parseQaNote, problemNoteDraft, replaceQaSection } from './note-capture.js';

const WEB_CLIP_EXCERPT_LIMIT = 400;
const WEB_CLIP_PITFALL_LIMIT = 160;

export const WEB_EMBED_LIMITATION = '浏览器里很多网站禁止嵌入，页面经常是白的。桌面版才能完整浏览；这里用可读摘要，把容易忘的点剪进问题记录。尝试嵌入时无法读取跨域页面跳转后的网址和标题，剪藏仅使用地址栏网址；请粘贴目标网址后再剪藏。';

export function webEmbedIsReliable(electron = false) {
  return Boolean(electron);
}

export function webBrowseLimitation(electron = false) {
  return webEmbedIsReliable(electron) ? '' : WEB_EMBED_LIMITATION;
}

export function isPrivateBrowseHost(host) {
  return isBlockedHostname(host);
}

export function normalizeClientBrowseUrl(input) {
  return normalizeBrowseUrl(input);
}

// Subscribe once per guest, not per URL: remounting a webview destroys its history.
export function observeWebviewNavigation(view, { onNavigate, onTitle, onHistory, onError }) {
  function history() {
    onHistory?.({ back: Boolean(view.canGoBack?.()), forward: Boolean(view.canGoForward?.()) });
  }
  function navigate(event) {
    if (event.isMainFrame === false) return;
    try {
      const url = normalizeClientBrowseUrl(event.url || view.getURL()).href;
      onNavigate?.(url);
      history();
    } catch (error) {
      view.stop?.();
      onError?.(error);
    }
  }
  function title(event) {
    try {
      const url = normalizeClientBrowseUrl(view.getURL()).href;
      onTitle?.(url, String(event.title || view.getTitle?.() || ''));
      history();
    } catch (error) { onError?.(error); }
  }
  function failed(event) {
    if (event.isMainFrame === false || event.errorCode === -3) return;
    onError?.(new Error(event.errorDescription || '网页打开失败'));
  }
  const listeners = {
    'did-navigate': navigate,
    'did-navigate-in-page': navigate,
    'page-title-updated': title,
    'did-finish-load': title,
    'did-fail-load': failed
  };
  for (const [name, listener] of Object.entries(listeners)) view.addEventListener(name, listener);
  return () => {
    for (const [name, listener] of Object.entries(listeners)) view.removeEventListener(name, listener);
  };
}

export function webSourceHostname(url) {
  const href = String(url || '').trim();
  if (!href) return '';
  try {
    return new URL(href).hostname || href;
  } catch {
    return href;
  }
}

export function createWebWorkspaceTab({ url = '', title = '', id } = {}) {
  const href = String(url || '').trim();
  const label = String(title || '').trim() || href || '网页';
  return {
    // Keep the complete URL: a truncated prefix aliases distinct long paths/queries.
    id: id || (href ? `web-${encodeURIComponent(href)}` : `web-${globalThis.crypto.randomUUID()}`),
    kind: 'web',
    type: 'web',
    route: 'web',
    url: href,
    resourceId: href || undefined,
    title: label,
    openedAt: Date.now(),
    lastActiveAt: Date.now()
  };
}

export function webClipSourceRef(clip = {}) {
  const url = String(clip.url || '').trim();
  const title = String(clip.title || '').trim() || url || '网页';
  const excerpt = String(clip.excerpt || clip.quote || clip.selection || '').trim().slice(0, WEB_CLIP_EXCERPT_LIMIT);
  if (!url && !excerpt) return null;
  return {
    kind: 'web',
    sourceType: 'web',
    url,
    title,
    excerpt,
    quote: excerpt || undefined,
    selection: Boolean(excerpt)
  };
}

export function mergeNoteSourceRefs(existing = [], received = []) {
  const refs = new Map();
  for (const ref of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(received) ? received : [])]) {
    const documentId = String(ref?.documentId || ref?.contentItemId || '').trim();
    const url = String(ref?.url || '').trim();
    if (!documentId && !url) continue;
    const anchor = String(ref?.anchor || '').trim();
    const key = documentId ? `${documentId}:${anchor}` : `url:${url}:${anchor}`;
    refs.set(key, {
      ...ref,
      ...(documentId ? { documentId, contentItemId: ref?.contentItemId || documentId } : {}),
      ...(url ? { url } : {}),
      title: ref?.title || (documentId ? '来源文档' : url || '网页'),
      anchor: anchor || null,
      excerpt: String(ref?.excerpt || ref?.snippet || ref?.quote || '').slice(0, 240)
    });
  }
  return [...refs.values()];
}

export function pickProblemNoteForWebClip({ tabs = [], notes = [], preferredId } = {}) {
  const byId = new Map((Array.isArray(notes) ? notes : []).map(note => [String(note.id), note]));
  const noteTabs = (Array.isArray(tabs) ? tabs : [])
    .filter(tab => (tab?.kind === 'note' || tab?.type === 'note' || tab?.route === 'notes') && tab?.noteId)
    .sort((a, b) => Number(b.lastActiveAt || 0) - Number(a.lastActiveAt || 0));
  for (const tab of noteTabs) {
    const note = byId.get(String(tab.noteId));
    if (note && isProblemNote(note)) return note;
  }
  const preferred = preferredId ? byId.get(String(preferredId)) : null;
  if (preferred && isProblemNote(preferred)) return preferred;
  return null;
}

export function appendWebClipToProblemContent(content, clip = {}) {
  const qa = parseQaNote(content);
  const title = String(clip.title || '').trim() || String(clip.url || '').trim() || '网页';
  const excerpt = String(clip.excerpt || clip.quote || '').trim().slice(0, WEB_CLIP_PITFALL_LIMIT);
  const url = String(clip.url || '').trim();
  const line = `- ${title}${url ? ` (${url})` : ''}`;
  const resolution = qa.resolution.includes(line) ? qa.resolution : (qa.resolution ? `${qa.resolution}\n${line}` : line);
  let next = replaceQaSection(content, '这次怎么解决的', resolution);
  if (excerpt) {
    const current = isPlaceholderPitfall(qa.pitfall) ? '' : qa.pitfall;
    if (!current.includes(excerpt)) {
      const pitfallLine = /^[-*•]\s+/.test(excerpt) ? excerpt : `- ${excerpt}`;
      next = replaceQaSection(next, '下次容易忘的点', current ? `${current}\n${pitfallLine}` : pitfallLine);
    }
  }
  return next;
}

export function problemNoteFromWebClip(clip = {}) {
  const url = String(clip.url || '').trim();
  const title = String(clip.title || '').trim() || url;
  const excerpt = String(clip.excerpt || clip.quote || '').trim();
  const draft = problemNoteDraft({
    question: title ? `从网页记下：${title.slice(0, 40)}` : '从网页记下的问题',
    pitfall: excerpt ? excerpt.slice(0, WEB_CLIP_PITFALL_LIMIT) : ''
  });
  return {
    ...draft,
    content: appendWebClipToProblemContent(draft.content, { url, title, excerpt }),
    sourceRefs: [webClipSourceRef({ url, title, excerpt })].filter(Boolean)
  };
}
