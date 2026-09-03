import { randomBytes } from 'node:crypto';

export const FEISHU_OAUTH_AUTHORIZE = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
export const FEISHU_OAUTH_TOKEN_PATH = '/authen/v2/oauth/token';
export const FEISHU_OAUTH_USER_PATH = '/authen/v1/user_info';
export const FEISHU_OAUTH_SCOPES = [
  'offline_access',
  'auth:user.id:read',
  'drive:drive:readonly',
  'docx:document:readonly',
  'wiki:wiki:readonly',
  'docs:document.media:download'
];

const PENDING_TTL_MS = 10 * 60 * 1000;

export function isLocalHostName(hostname = '') {
  const host = String(hostname || '').trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function createOAuthState() {
  return randomBytes(16).toString('hex');
}

export function defaultOAuthRedirectUri(origin = '') {
  return `${String(origin || '').replace(/\/$/, '')}/api/feishu/oauth/callback`;
}

export function resolveRequestOrigin(req, fallback = 'http://127.0.0.1:8789') {
  const headers = req?.headers || {};
  const forwarded = String(req?.get?.('x-forwarded-host') || headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwarded || String(req?.get?.('host') || headers.host || '').trim();
  if (!host) return String(fallback).replace(/\/$/, '');
  const protoHeader = String(req?.get?.('x-forwarded-proto') || headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = protoHeader || String(req?.protocol || 'http').replace(/:$/, '');
  return `${proto}://${host}`;
}

export function resolveApiOrigin(req, fallback = 'http://127.0.0.1:8789') {
  const port = Number(req?.socket?.localPort || 0);
  if (port) return `http://127.0.0.1:${port}`;
  return resolveRequestOrigin(req, fallback);
}

export function resolveOAuthRedirectUri(req, fallbackOrigin = 'http://127.0.0.1:8789') {
  return defaultOAuthRedirectUri(resolveApiOrigin(req, fallbackOrigin));
}

export function safeReturnTo(value, fallback = '') {
  const fallbackText = String(fallback || '').trim();
  const raw = String(value || '').trim();
  if (!raw) return fallbackText;
  try {
    const url = new URL(raw, fallbackText || 'http://127.0.0.1/');
    if (!isLocalHostName(url.hostname)) return fallbackText;
    if (!/^https?:$/i.test(url.protocol)) return fallbackText;
    return url.toString();
  } catch {
    return fallbackText;
  }
}

export function buildAuthorizeUrl({ appId, redirectUri, state, scopes = FEISHU_OAUTH_SCOPES } = {}) {
  const url = new URL(FEISHU_OAUTH_AUTHORIZE);
  url.searchParams.set('client_id', String(appId || '').trim());
  url.searchParams.set('redirect_uri', String(redirectUri || '').trim());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', String(state || '').trim());
  url.searchParams.set('scope', (Array.isArray(scopes) ? scopes : String(scopes || '').split(/\s+/)).filter(Boolean).join(' '));
  return url.toString();
}

export function parseOAuthTokenPayload(payload = {}) {
  const source = payload.data && typeof payload.data === 'object' ? { ...payload, ...payload.data } : payload;
  const accessToken = String(source.access_token || '').trim();
  if (!accessToken) return null;
  const now = Date.now();
  const expiresIn = Math.max(60, Number(source.expires_in || 7200));
  const refreshExpiresIn = Math.max(expiresIn, Number(source.refresh_token_expires_in || 0));
  return {
    accessToken,
    refreshToken: String(source.refresh_token || '').trim(),
    tokenType: String(source.token_type || 'Bearer'),
    scope: String(source.scope || ''),
    expiresAt: new Date(now + expiresIn * 1000).toISOString(),
    refreshExpiresAt: source.refresh_token ? new Date(now + refreshExpiresIn * 1000).toISOString() : null,
    name: '',
    openId: ''
  };
}

export function publicUserSession(session, now = Date.now()) {
  if (!session?.accessToken && !session?.refreshToken) {
    return { loggedIn: false, name: '', expiresAt: null, expired: false };
  }
  const expiresAt = session.expiresAt || null;
  const expired = Boolean(expiresAt && Date.parse(expiresAt) <= now && !session.refreshToken);
  return {
    loggedIn: !expired,
    name: session.name || '',
    expiresAt,
    expired
  };
}

export function oauthRedirectHint(redirectUri) {
  return `请在飞书开放平台 → 安全设置 → 重定向 URL 中加入：${redirectUri}`;
}

export function createPendingOAuthStore({ now = () => Date.now(), ttlMs = PENDING_TTL_MS } = {}) {
  const items = new Map();
  return {
    set(state, value) {
      items.set(String(state), { ...value, createdAt: now() });
    },
    take(state) {
      const key = String(state || '');
      const row = items.get(key);
      items.delete(key);
      if (!row) return null;
      if (now() - row.createdAt > ttlMs) return null;
      return row;
    }
  };
}

export function oauthCallbackPage({ ok, title, message, returnTo } = {}) {
  const safeTitle = String(title || (ok ? '飞书登录成功' : '飞书登录未完成'));
  const safeMessage = String(message || '');
  const href = String(returnTo || '').trim();
  const redirect = href ? `<meta http-equiv="refresh" content="0;url=${escapeHtml(href)}">` : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  ${redirect}
  <title>${escapeHtml(safeTitle)}</title>
  <style>
    body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 48px auto; max-width: 36rem; color: #3f3c36; }
    a { color: #b86547; }
  </style>
</head>
<body>
  <h1>${escapeHtml(safeTitle)}</h1>
  <p>${escapeHtml(safeMessage)}</p>
  ${href ? `<p><a href="${escapeHtml(href)}">返回 FlowMind</a></p>` : ''}
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
