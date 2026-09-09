import { fetchPublicHttp } from './public-http.mjs';

export {
  assertPublicHttpUrl,
  isPrivateIpAddress,
  normalizeBrowseUrl
} from './public-http.mjs';

const PREVIEW_TIMEOUT_MS = 8000;
const PREVIEW_MAX_BYTES = 512 * 1024;

export function extractHtmlPreview(html, href) {
  const text = String(html || '');
  const decode = value => String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const title = decode(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 120);
  const description = decode(
    text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1]
    || text.match(/<meta[^>]+content=["']([^"']+)[^>]+name=["']description["']/i)?.[1]
    || ''
  );
  const stripped = decode(text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '));
  const excerpt = (description || stripped).slice(0, 400);
  const url = String(href || '');
  return { url, title: title || url, excerpt };
}

export async function fetchPublicPagePreview(input, {
  fetchImpl,
  lookupImpl,
  requestImpl,
  timeoutMs = PREVIEW_TIMEOUT_MS,
  maxBytes = PREVIEW_MAX_BYTES,
  signal
} = {}) {
  try {
    const page = await fetchPublicHttp(input, {
      fetchImpl,
      lookupImpl,
      requestImpl,
      timeoutMs,
      maxBytes,
      signal,
      headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' }
    });
    const contentType = String(page.response.headers?.get?.('content-type') || '');
    if (!page.response.ok) {
      throw Object.assign(new Error(`网页读取失败（HTTP ${page.response.status}）`), {
        code: 'WEB_FETCH_FAILED',
        httpStatus: page.response.status
      });
    }
    if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
      return { url: page.url.href, title: page.url.hostname, excerpt: '', embeddable: false, contentType };
    }
    const html = page.buffer.subarray(0, maxBytes).toString('utf8');
    return { ...extractHtmlPreview(html, page.url.href), embeddable: false, contentType: contentType || 'text/html' };
  } catch (error) {
    if (error?.code) throw error;
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error('网页读取超时'), { code: 'WEB_FETCH_TIMEOUT' });
    }
    throw Object.assign(new Error(error?.message || '网页读取失败'), { code: error?.code || 'WEB_FETCH_FAILED' });
  }
}
