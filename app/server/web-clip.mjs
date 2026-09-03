import { lookup } from 'node:dns/promises';
import net from 'node:net';

const PREVIEW_TIMEOUT_MS = 8000;
const PREVIEW_MAX_BYTES = 512 * 1024;
const BLOCKED_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal']);

export function normalizeBrowseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw Object.assign(new Error('请输入网址'), { code: 'WEB_URL_REQUIRED' });
  }
  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withProtocol);
  } catch {
    throw Object.assign(new Error('网址无效'), { code: 'WEB_URL_INVALID' });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('只支持 http/https 网页'), { code: 'WEB_URL_PROTOCOL' });
  }
  if (url.username || url.password) {
    throw Object.assign(new Error('网址不能包含凭据'), { code: 'WEB_URL_CREDENTIALS' });
  }
  url.hash = '';
  return url;
}

export function isPrivateIpAddress(ip) {
  const value = String(ip || '').trim().toLowerCase();
  if (!value || !net.isIP(value)) return true;
  if (value === '0.0.0.0' || value.startsWith('127.') || value.startsWith('10.') || value.startsWith('169.254.') || value.startsWith('192.168.')) return true;
  const match = value.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80')) return true;
  if (value.startsWith('::ffff:')) return isPrivateIpAddress(value.slice(7));
  return false;
}

export async function assertPublicHttpUrl(input) {
  const url = input instanceof URL ? input : normalizeBrowseUrl(input);
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw Object.assign(new Error('不能打开内网或本机地址'), { code: 'WEB_URL_PRIVATE' });
  }
  if (net.isIP(host) && isPrivateIpAddress(host)) {
    throw Object.assign(new Error('不能打开内网或本机地址'), { code: 'WEB_URL_PRIVATE' });
  }
  if (!net.isIP(host)) {
    const addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some(item => isPrivateIpAddress(item.address))) {
      throw Object.assign(new Error('不能打开内网或本机地址'), { code: 'WEB_URL_PRIVATE' });
    }
  }
  return url;
}

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

const PREVIEW_MAX_REDIRECTS = 5;

function redirectLocation(response, current) {
  const status = Number(response?.status || 0);
  if (![301, 302, 303, 307, 308].includes(status)) return null;
  const location = String(response.headers?.get?.('location') || '').trim();
  if (!location) {
    throw Object.assign(new Error('网页跳转缺少地址'), { code: 'WEB_FETCH_FAILED' });
  }
  try {
    return new URL(location, current);
  } catch {
    throw Object.assign(new Error('网页跳转地址无效'), { code: 'WEB_URL_INVALID' });
  }
}

async function fetchFollowingPublicRedirects(input, { fetchImpl, signal, headers }) {
  let current = await assertPublicHttpUrl(input);
  for (let hop = 0; hop <= PREVIEW_MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(current.href, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers
    });
    const next = redirectLocation(response, current);
    if (!next) return { response, url: current };
    current = await assertPublicHttpUrl(next);
  }
  throw Object.assign(new Error('网页跳转次数过多'), { code: 'WEB_FETCH_FAILED' });
}

export async function fetchPublicPagePreview(input, { fetchImpl = fetch, timeoutMs = PREVIEW_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { response, url } = await fetchFollowingPublicRedirects(input, {
      fetchImpl,
      signal: controller.signal,
      headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' }
    });
    const contentType = String(response.headers.get('content-type') || '');
    if (!response.ok) {
      throw Object.assign(new Error(`网页读取失败（HTTP ${response.status}）`), { code: 'WEB_FETCH_FAILED' });
    }
    if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
      return { url: url.href, title: url.hostname, excerpt: '', embeddable: false, contentType };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const html = buffer.subarray(0, PREVIEW_MAX_BYTES).toString('utf8');
    return { ...extractHtmlPreview(html, url.href), embeddable: false, contentType: contentType || 'text/html' };
  } catch (error) {
    if (error?.code) throw error;
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error('网页读取超时'), { code: 'WEB_FETCH_TIMEOUT' });
    }
    throw Object.assign(new Error(error?.message || '网页读取失败'), { code: error?.code || 'WEB_FETCH_FAILED' });
  } finally {
    clearTimeout(timer);
  }
}
