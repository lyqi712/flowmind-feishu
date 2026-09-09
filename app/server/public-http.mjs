// Public http(s) fetch with SSRF controls.
// Production connects with a pinned lookup so Node will not re-resolve after the
// private/reserved check (DNS rebinding). Injected fetchImpl is for tests and
// cannot pin TCP; callers must not point it at a real resolver/network.
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import {
  canonicalizeHostname,
  httpError,
  ipVersion,
  isPrivateOrReservedIp,
  normalizeBrowseUrl
} from '../shared/public-http-url.mjs';

export {
  canonicalizeHostname,
  isBlockedHostname,
  isPrivateIpAddress,
  isPrivateOrReservedIp,
  normalizeBrowseUrl
} from '../shared/public-http-url.mjs';

export const DEFAULT_FETCH_TIMEOUT_MS = 8000;
export const DEFAULT_FETCH_MAX_BYTES = 512 * 1024;
export const DEFAULT_MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function normalizeLookupEntries(result) {
  const list = Array.isArray(result) ? result : result == null ? [] : [result];
  return list.map(item => {
    if (typeof item === 'string') {
      return { address: item, family: ipVersion(item) || 4 };
    }
    const address = String(item?.address || '').trim();
    const family = Number(item?.family) || ipVersion(address) || 4;
    return { address, family };
  }).filter(item => item.address);
}

function timeoutError() {
  return httpError('网页读取超时', 'WEB_FETCH_TIMEOUT');
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw timeoutError();
}

export function abortRace(promise, signal) {
  const pending = Promise.resolve(promise);
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(timeoutError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(timeoutError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

export async function defaultLookupAll(hostname, options = {}) {
  const host = canonicalizeHostname(hostname);
  return dnsLookup(host, { all: true, verbatim: true, ...(options.signal ? { signal: options.signal } : {}) });
}

export async function resolvePublicHttpUrl(input, { lookupImpl = defaultLookupAll, signal } = {}) {
  throwIfAborted(signal);
  const url = normalizeBrowseUrl(input instanceof URL ? input.href : input);
  const host = canonicalizeHostname(url.hostname);
  const version = ipVersion(host);
  let addresses;
  if (version) {
    if (isPrivateOrReservedIp(host)) {
      throw httpError('不能打开内网或本机地址', 'WEB_URL_PRIVATE');
    }
    addresses = [{ address: host, family: version }];
  } else {
    let resolved;
    try {
      resolved = await abortRace(lookupImpl(host, { all: true, signal }), signal);
    } catch (error) {
      if (error?.code === 'WEB_FETCH_TIMEOUT') throw error;
      throw httpError(error?.message || '无法解析该网址', 'WEB_FETCH_FAILED');
    }
    addresses = normalizeLookupEntries(resolved);
    if (!addresses.length || addresses.some(item => isPrivateOrReservedIp(item.address))) {
      throw httpError('不能打开内网或本机地址', 'WEB_URL_PRIVATE');
    }
  }
  return {
    url,
    addresses,
    pinned: addresses.find(item => item.family === 4) || addresses[0]
  };
}

export async function assertPublicHttpUrl(input, options) {
  const resolved = await resolvePublicHttpUrl(input, options);
  return resolved.url;
}

export function createPinnedLookup(address, family) {
  const fam = Number(family) === 6 ? 6 : 4;
  return (hostname, options, callback) => {
    let cb = callback;
    let opts = options;
    if (typeof options === 'function') {
      cb = options;
      opts = {};
    }
    const entry = { address, family: fam };
    if (opts?.all) cb(null, [entry]);
    else cb(null, address, fam);
  };
}

function headersFromNode(raw = {}) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (value == null || key === 'set-cookie') continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, String(item));
    } else {
      headers.set(key, String(value));
    }
  }
  return headers;
}

function composeAbortSignal(signals, timeoutMs) {
  const controller = new AbortController();
  const cleanups = [];
  const timer = setTimeout(() => controller.abort(timeoutError()), timeoutMs);
  cleanups.push(() => clearTimeout(timer));
  const abortFrom = signal => {
    if (!signal) return;
    if (signal.aborted) {
      controller.abort(signal.reason || timeoutError());
      return;
    }
    const onAbort = () => controller.abort(signal.reason || timeoutError());
    signal.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => signal.removeEventListener('abort', onAbort));
  };
  for (const signal of signals) abortFrom(signal);
  return {
    signal: controller.signal,
    dispose() {
      while (cleanups.length) {
        try { cleanups.pop()(); } catch { /* ignore listener cleanup errors */ }
      }
    }
  };
}

function releaseReader(reader) {
  try {
    const canceling = reader.cancel();
    if (canceling && typeof canceling.then === 'function') canceling.catch(() => {});
  } catch { /* already cancelled or closed */ }
  try { reader.releaseLock(); } catch { /* already released */ }
}

function cancelBody(body) {
  if (!body) return Promise.resolve();
  if (typeof body.cancel === 'function') return Promise.resolve(body.cancel()).catch(() => {});
  if (typeof body.destroy === 'function') {
    body.destroy();
    return Promise.resolve();
  }
  if (typeof body.getReader === 'function') {
    try {
      return Promise.resolve(body.getReader().cancel()).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }
  return Promise.resolve();
}

async function readLimitedBody(response, maxBytes, signal) {
  throwIfAborted(signal);
  const declared = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await cancelBody(response.body);
    throw httpError('网页内容过大', 'WEB_FETCH_TOO_LARGE');
  }
  const body = response?.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        throwIfAborted(signal);
        const { done, value } = await abortRace(reader.read(), signal);
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > maxBytes) throw httpError('网页内容过大', 'WEB_FETCH_TOO_LARGE');
        chunks.push(chunk);
      }
      return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
    } finally {
      releaseReader(reader);
    }
  }
  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let total = 0;
    const iterator = body[Symbol.asyncIterator]();
    try {
      while (true) {
        throwIfAborted(signal);
        const { done, value } = await abortRace(iterator.next(), signal);
        if (done) break;
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        total += chunk.length;
        if (total > maxBytes) throw httpError('网页内容过大', 'WEB_FETCH_TOO_LARGE');
        chunks.push(chunk);
      }
      return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
    } catch (error) {
      if (typeof body.destroy === 'function') body.destroy();
      if (error?.code === 'WEB_FETCH_TOO_LARGE' || error?.code === 'WEB_FETCH_TIMEOUT') throw error;
      throw httpError(error?.message || '网页读取失败', error?.code || 'WEB_FETCH_FAILED');
    }
  }
  if (typeof response?.arrayBuffer === 'function') {
    const buffer = Buffer.from(await abortRace(response.arrayBuffer(), signal));
    if (buffer.length > maxBytes) throw httpError('网页内容过大', 'WEB_FETCH_TOO_LARGE');
    return buffer;
  }
  if (typeof response?.text === 'function') {
    const text = await abortRace(response.text(), signal);
    const buffer = Buffer.from(text);
    if (buffer.length > maxBytes) throw httpError('网页内容过大', 'WEB_FETCH_TOO_LARGE');
    return buffer;
  }
  return Buffer.alloc(0);
}

function redirectLocation(response, current) {
  const status = Number(response?.status || 0);
  if (!REDIRECT_STATUSES.has(status)) return null;
  const location = String(response.headers?.get?.('location') || '').trim();
  if (!location) throw httpError('网页跳转缺少地址', 'WEB_FETCH_FAILED');
  try {
    return new URL(location, current);
  } catch {
    throw httpError('网页跳转地址无效', 'WEB_URL_INVALID');
  }
}

function pinnedNodeFetch(url, { pinned, headers, signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const hostname = canonicalizeHostname(url.hostname);
    let response = null;
    let headersResolved = false;
    let settled = false;
    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', failTimeout);
    };
    const failTimeout = () => {
      req.destroy();
      if (response && typeof response.destroy === 'function') response.destroy();
      cleanup();
      if (settled || headersResolved) return;
      settled = true;
      reject(timeoutError());
    };
    const req = lib.request({
      method: 'GET',
      hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers: { ...headers, host: url.host },
      lookup: createPinnedLookup(pinned.address, pinned.family),
      servername: isHttps ? hostname : undefined,
      timeout: timeoutMs
    }, res => {
      response = res;
      if (signal?.aborted) {
        failTimeout();
        return;
      }
      headersResolved = true;
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        headers: headersFromNode(res.headers),
        body: res,
        url: url.href
      });
    });
    if (signal) {
      if (signal.aborted) {
        failTimeout();
        return;
      }
      signal.addEventListener('abort', failTimeout, { once: true });
    }
    req.on('timeout', failTimeout);
    req.on('error', error => {
      if (headersResolved || settled) return;
      settled = true;
      cleanup();
      if (error?.code === 'WEB_FETCH_TIMEOUT' || error?.name === 'AbortError') {
        reject(timeoutError());
        return;
      }
      reject(httpError(error?.message || '网页读取失败', error?.code || 'WEB_FETCH_FAILED'));
    });
    req.end();
  });
}

async function performRequest(url, { pinned, fetchImpl, requestImpl, headers, signal, timeoutMs }) {
  throwIfAborted(signal);
  if (typeof fetchImpl === 'function') {
    return abortRace(fetchImpl(url.href, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers
    }), signal);
  }
  if (typeof requestImpl === 'function') {
    return abortRace(requestImpl({
      url,
      href: url.href,
      pinnedAddress: pinned.address,
      pinnedFamily: pinned.family,
      headers,
      signal
    }), signal);
  }
  return abortRace(pinnedNodeFetch(url, { pinned, headers, signal, timeoutMs }), signal);
}

export async function fetchPublicHttp(input, {
  fetchImpl,
  lookupImpl = defaultLookupAll,
  requestImpl,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  maxBytes = DEFAULT_FETCH_MAX_BYTES,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  headers = {},
  signal
} = {}) {
  const abort = composeAbortSignal([signal], timeoutMs);
  try {
    let current = input instanceof URL ? new URL(input.href) : input;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      throwIfAborted(abort.signal);
      const resolved = await resolvePublicHttpUrl(current, { lookupImpl, signal: abort.signal });
      current = resolved.url;
      throwIfAborted(abort.signal);
      const response = await performRequest(current, {
        pinned: resolved.pinned,
        fetchImpl,
        requestImpl,
        headers,
        signal: abort.signal,
        timeoutMs
      });
      throwIfAborted(abort.signal);
      const next = redirectLocation(response, current);
      if (!next) {
        const buffer = await readLimitedBody(response, maxBytes, abort.signal);
        return {
          url: current,
          response,
          buffer,
          bytes: buffer.length,
          pinnedAddress: resolved.pinned.address,
          pinnedFamily: resolved.pinned.family
        };
      }
      await cancelBody(response.body);
      current = next;
    }
    throw httpError('网页跳转次数过多', 'WEB_FETCH_FAILED');
  } catch (error) {
    if (error?.code) throw error;
    if (error?.name === 'AbortError') throw httpError('网页读取超时', 'WEB_FETCH_TIMEOUT');
    throw httpError(error?.message || '网页读取失败', 'WEB_FETCH_FAILED');
  } finally {
    abort.dispose();
  }
}

export function createPublicHttpGateway(defaults = {}) {
  return {
    fetch(input, options = {}) {
      return fetchPublicHttp(input, { ...defaults, ...options });
    }
  };
}
