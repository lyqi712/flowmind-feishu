import { timingSafeEqual } from 'node:crypto';

export function hasValidLocalSessionToken(value, expected) {
  const actual = Buffer.from(String(value || ''), 'utf8');
  const target = Buffer.from(String(expected || ''), 'utf8');
  return actual.length > 0 && actual.length === target.length && timingSafeEqual(actual, target);
}

export function extractBearerToken(req) {
  const authorization = String(req?.get?.('authorization') || req?.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/iu);
  return match ? match[1].trim() : '';
}

export function createLocalSessionAuth({ token = '', enabled = Boolean(token) } = {}) {
  const expected = String(token || '').trim();
  const active = Boolean(enabled && expected);
  return Object.freeze({
    enabled: active,
    authenticate(req) {
      if (!active) return { ok: true, disabled: true };
      const actual = extractBearerToken(req);
      return hasValidLocalSessionToken(actual, expected)
        ? { ok: true }
        : { ok: false, code: actual ? 'LOCAL_SESSION_INVALID' : 'LOCAL_SESSION_REQUIRED', message: actual ? '本地会话凭据无效，请重新打开 FlowMind。' : '需要本地应用会话凭据。' };
    }
  });
}

export function localSessionError(result) {
  return {
    ok: false,
    error: {
      code: result?.code || 'LOCAL_SESSION_REQUIRED',
      message: result?.message || '需要本地应用会话凭据。'
    }
  };
}
