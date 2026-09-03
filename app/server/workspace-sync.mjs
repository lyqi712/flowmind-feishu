import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EncryptedSecretStore } from './model/secret-store.mjs';
import {
  createLocalProjection,
  createWorkspaceBundle,
  createWorkspaceSyncEnvelope,
  digestValue,
  mergeWorkspaceProjections,
  sanitizeWorkspaceProjection,
  sanitizeWorkspaceSession,
  verifyWorkspaceBundle,
  verifyWorkspaceSyncEnvelope
} from '../shared/workspace-sync.mjs';

export const DEFAULT_WORKSPACE_SYNC_SECRET_FILE = fileURLToPath(new URL('../../runtime-data/workspace-sync-secret.enc', import.meta.url));
export const DEFAULT_WORKSPACE_SYNC_MASTER_KEY_FILE = fileURLToPath(new URL('../../runtime-data/.workspace-sync-master-key', import.meta.url));
export const DEFAULT_WORKSPACE_SYNC_RELAY_FILE = fileURLToPath(new URL('../../runtime-data/workspace-sync-relay.json', import.meta.url));

const RELAY_FORMAT_VERSION = 1;
const TOKEN_PREFIX = 'flowmind-workspace-sync:v1:';

function syncError(message, code, status = 400, details = undefined) {
  const error = Object.assign(new Error(message), { code, status });
  if (details !== undefined) error.details = details;
  return error;
}

function text(value, maximum = 1200) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, maximum);
}

function optionalText(value, maximum = 1200) {
  const result = text(value, maximum);
  return result || null;
}

function finiteRevision(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function workspaceId(value = '') {
  const result = text(value, 180);
  if (!result) return '';
  if (!/^[a-zA-Z0-9_.-]+$/u.test(result)) throw syncError('同步空间标识格式无效', 'WORKSPACE_SYNC_WORKSPACE_ID_INVALID');
  return result;
}

function createId(prefix) {
  return `${prefix}_${randomBytes(18).toString('base64url')}`;
}

function tokenDigest(token) {
  return createHash('sha256').update(String(token), 'utf8').digest();
}

function sameToken(token, digestBase64 = '') {
  if (!token || !digestBase64) return false;
  try {
    const expected = Buffer.from(digestBase64, 'base64');
    const actual = tokenDigest(token);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function normalizeEndpoint(value) {
  const raw = text(value, 1600);
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { throw syncError('同步端点必须是有效的 HTTP(S) 地址', 'WORKSPACE_SYNC_ENDPOINT_INVALID'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw syncError('同步端点必须是不含凭据的 HTTP(S) 地址', 'WORKSPACE_SYNC_ENDPOINT_INVALID');
  }
  const host = url.hostname.toLowerCase();
  const privateIpv4 = /^10\./u.test(host) || /^192\.168\./u.test(host) || /^172\.(1[6-9]|2\d|3[01])\./u.test(host);
  const local = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) || privateIpv4 || host.endsWith('.local');
  if (url.protocol === 'http:' && !local) throw syncError('公共同步端点必须使用 HTTPS', 'WORKSPACE_SYNC_ENDPOINT_INSECURE');
  url.pathname = url.pathname.replace(/\/+$/u, '');
  return url.toString().replace(/\/$/u, '');
}

function relayUrl(endpoint, id) {
  const base = normalizeEndpoint(endpoint);
  if (!base) throw syncError('请先配置同步端点', 'WORKSPACE_SYNC_NOT_CONFIGURED', 409);
  const suffix = '/api/workspace-sync/relay';
  const root = base.endsWith(suffix) ? base : `${base}${suffix}`;
  return `${root}/${encodeURIComponent(workspaceId(id))}`;
}

function deriveEncryptionKey(token) {
  return createHash('sha256').update(`${TOKEN_PREFIX}${String(token)}`, 'utf8').digest();
}

async function encryptedPayload(envelope, token) {
  const iv = randomBytes(12);
  const key = deriveEncryptionKey(token);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const aad = Buffer.from(`${TOKEN_PREFIX}${envelope.workspaceId}`, 'utf8');
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(envelope), 'utf8'), cipher.final()]);
  const payload = { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
  return { payload, digest: await digestValue(payload) };
}

async function decryptedEnvelope(payload, digest, token, expectedWorkspaceId) {
  if (!payload || payload.version !== 1 || !payload.iv || !payload.tag || !payload.data) {
    throw syncError('远端同步数据格式无效', 'WORKSPACE_SYNC_REMOTE_PAYLOAD_INVALID', 502);
  }
  if (digest && await digestValue(payload) !== String(digest)) {
    throw syncError('远端同步数据校验失败', 'WORKSPACE_SYNC_REMOTE_DIGEST_INVALID', 502);
  }
  try {
    const key = deriveEncryptionKey(token);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAAD(Buffer.from(`${TOKEN_PREFIX}${expectedWorkspaceId}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
    return verifyWorkspaceSyncEnvelope(JSON.parse(plaintext), { workspaceId: expectedWorkspaceId });
  } catch (error) {
    if (error?.code?.startsWith('WORKSPACE_SYNC_')) throw error;
    throw syncError('无法解密远端工作现场；请检查配对密钥和同步空间', 'WORKSPACE_SYNC_REMOTE_DECRYPT_FAILED', 502);
  }
}

function defaultProfile() {
  return {
    version: 1,
    endpoint: '',
    workspaceId: '',
    accessToken: '',
    deviceId: createId('device'),
    enabled: false,
    counter: 0,
    localProjection: null,
    baseProjection: null,
    lastRemoteRevision: null,
    lastSyncedAt: null,
    lastStatus: 'idle',
    lastError: null,
    conflictCount: 0
  };
}

function normalizeProfile(value) {
  const source = value && typeof value === 'object' ? value : {};
  const defaults = defaultProfile();
  const endpoint = source.endpoint ? normalizeEndpoint(source.endpoint) : '';
  let id = '';
  try { id = source.workspaceId ? workspaceId(source.workspaceId) : ''; } catch { id = ''; }
  return {
    ...defaults,
    endpoint,
    workspaceId: id,
    accessToken: text(source.accessToken, 512),
    deviceId: text(source.deviceId, 120) || defaults.deviceId,
    enabled: source.enabled === true,
    counter: Math.max(0, Math.trunc(Number(source.counter) || 0)),
    localProjection: source.localProjection ? sanitizeWorkspaceProjection(source.localProjection) : null,
    baseProjection: source.baseProjection ? sanitizeWorkspaceProjection(source.baseProjection) : null,
    lastRemoteRevision: finiteRevision(source.lastRemoteRevision),
    lastSyncedAt: optionalText(source.lastSyncedAt, 64),
    lastStatus: text(source.lastStatus, 64) || 'idle',
    lastError: optionalText(source.lastError, 320),
    conflictCount: Math.max(0, Math.trunc(Number(source.conflictCount) || 0))
  };
}

function publicProfile(profile) {
  const configured = Boolean(profile.endpoint && profile.workspaceId && profile.accessToken);
  return {
    configured,
    enabled: configured && profile.enabled === true,
    endpoint: profile.endpoint || null,
    workspaceId: profile.workspaceId || null,
    deviceId: profile.deviceId,
    accessTokenConfigured: Boolean(profile.accessToken),
    lastRemoteRevision: profile.lastRemoteRevision,
    lastSyncedAt: profile.lastSyncedAt,
    lastStatus: profile.lastStatus,
    lastError: profile.lastError,
    conflictCount: profile.conflictCount
  };
}

export class WorkspaceSyncRelayStore {
  constructor({ filePath } = {}) {
    if (!filePath) throw new TypeError('relay file path is required');
    this.filePath = filePath;
    this.records = { version: RELAY_FORMAT_VERSION, records: {} };
    this.queue = Promise.resolve();
    this.ready = this.initialize();
  }

  async initialize() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, 'utf8');
      if (!raw.trim()) return this.records;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== RELAY_FORMAT_VERSION || !parsed.records || typeof parsed.records !== 'object') throw new Error('invalid relay file');
      this.records = parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw syncError('同步 relay 状态读取失败', 'WORKSPACE_SYNC_RELAY_READ_FAILED', 500);
      await this.persist(this.records);
    }
    return this.records;
  }

  async persist(records) {
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
      await rename(temporary, this.filePath);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async update(mutator) {
    const operation = this.queue.catch(() => undefined).then(async () => {
      await this.ready;
      const next = structuredClone(this.records);
      const result = await mutator(next);
      await this.persist(next);
      this.records = next;
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async create({ id = '', token = '' } = {}) {
    const recordId = workspaceId(id || createId('workspace'));
    const pairingToken = text(token, 512) || createId('pair');
    await this.update(records => {
      if (records.records[recordId]) throw syncError('同步空间已存在', 'WORKSPACE_SYNC_RELAY_EXISTS', 409);
      records.records[recordId] = {
        workspaceId: recordId,
        tokenHash: tokenDigest(pairingToken).toString('base64'),
        revision: 0,
        payload: null,
        digest: null,
        updatedAt: null
      };
    });
    return { workspaceId: recordId, pairingToken };
  }

  assertAuthorized(record, token) {
    if (!record || !sameToken(token, record.tokenHash)) throw syncError('同步空间未授权', 'WORKSPACE_SYNC_RELAY_UNAUTHORIZED', 401);
  }

  async read(id, token) {
    await this.ready;
    const record = this.records.records[workspaceId(id)];
    this.assertAuthorized(record, token);
    if (!record.payload) throw syncError('同步空间尚无工作现场', 'WORKSPACE_SYNC_RELAY_EMPTY', 404);
    return { workspaceId: record.workspaceId, revision: record.revision, payload: record.payload, digest: record.digest, updatedAt: record.updatedAt };
  }

  async write(id, token, { expectedRevision = null, payload, digest } = {}) {
    const recordId = workspaceId(id);
    const expected = finiteRevision(expectedRevision);
    if (!payload || typeof payload !== 'object' || !text(digest, 128)) throw syncError('同步写入数据不完整', 'WORKSPACE_SYNC_RELAY_WRITE_INVALID');
    return this.update(records => {
      const record = records.records[recordId];
      this.assertAuthorized(record, token);
      const actual = Number(record.revision || 0);
      if (expected === null ? actual !== 0 : actual !== expected) {
        throw syncError('远端工作现场已变化，请先重新检查', 'WORKSPACE_SYNC_RELAY_REVISION_CONFLICT', 409, { actualRevision: actual });
      }
      const nextRevision = actual + 1;
      records.records[recordId] = { ...record, revision: nextRevision, payload, digest: text(digest, 128), updatedAt: new Date().toISOString() };
      return { workspaceId: recordId, revision: nextRevision, updatedAt: records.records[recordId].updatedAt };
    });
  }
}

export class WorkspaceSyncService {
  constructor({ secretFile = DEFAULT_WORKSPACE_SYNC_SECRET_FILE, masterKeyFile = DEFAULT_WORKSPACE_SYNC_MASTER_KEY_FILE, relayFile = DEFAULT_WORKSPACE_SYNC_RELAY_FILE, secretStore, relayStore, fetchImpl = globalThis.fetch } = {}) {
    this.secrets = secretStore || new EncryptedSecretStore({ secretFile, keyFile: masterKeyFile });
    this.relay = relayStore || new WorkspaceSyncRelayStore({ filePath: relayFile });
    this.fetchImpl = fetchImpl;
    this.profile = defaultProfile();
    this.ready = this.initialize();
  }

  async initialize() {
    await Promise.all([this.secrets.ready, this.relay.ready]);
    const raw = await this.secrets.get();
    if (raw) {
      try { this.profile = normalizeProfile(JSON.parse(raw)); }
      catch { this.profile = { ...defaultProfile(), lastStatus: 'error', lastError: '同步配置无法读取，未使用该配置。' }; }
    }
    return this.publicSettings();
  }

  async saveProfile() {
    await this.secrets.set(JSON.stringify(this.profile));
  }

  publicSettings() {
    return publicProfile(this.profile);
  }

  async updateSettings(input = {}) {
    await this.ready;
    if (input.clear === true) {
      this.profile = defaultProfile();
      await this.saveProfile();
      return this.publicSettings();
    }
    const previousPair = `${this.profile.endpoint}\u001f${this.profile.workspaceId}\u001f${this.profile.accessToken}`;
    const endpoint = input.endpoint === undefined ? this.profile.endpoint : normalizeEndpoint(input.endpoint);
    const id = input.workspaceId === undefined ? this.profile.workspaceId : workspaceId(input.workspaceId || '');
    const token = input.accessToken === undefined && input.pairingToken === undefined
      ? this.profile.accessToken
      : text(input.accessToken ?? input.pairingToken, 512);
    const nextPair = `${endpoint}\u001f${id}\u001f${token}`;
    this.profile = {
      ...this.profile,
      endpoint,
      workspaceId: id,
      accessToken: token,
      enabled: input.enabled === undefined ? Boolean(endpoint && id && token) : input.enabled === true,
      ...(nextPair !== previousPair ? { counter: 0, localProjection: null, baseProjection: null, lastRemoteRevision: null, lastSyncedAt: null, lastStatus: 'idle', lastError: null, conflictCount: 0 } : {})
    };
    if (this.profile.enabled && !(endpoint && id && token)) throw syncError('启用同步前请完整填写端点、同步空间和配对密钥', 'WORKSPACE_SYNC_SETTINGS_INCOMPLETE');
    await this.saveProfile();
    return this.publicSettings();
  }

  ensureConfigured() {
    if (!this.profile.enabled || !this.profile.endpoint || !this.profile.workspaceId || !this.profile.accessToken) {
      throw syncError('工作现场同步尚未启用', 'WORKSPACE_SYNC_NOT_CONFIGURED', 409);
    }
  }

  async createRelay({ endpoint = '', id = '' } = {}) {
    await this.ready;
    const created = await this.relay.create({ id });
    return { ...created, endpoint: endpoint ? normalizeEndpoint(endpoint) : null };
  }

  async relayRead(id, token) {
    await this.ready;
    return this.relay.read(id, token);
  }

  async relayWrite(id, token, payload) {
    await this.ready;
    return this.relay.write(id, token, payload);
  }

  async prepareLocal(session) {
    const projected = createLocalProjection(session, this.profile.localProjection, { actorId: this.profile.deviceId, counter: this.profile.counter });
    this.profile.counter = projected.counter;
    this.profile.localProjection = projected.projection;
    await this.saveProfile();
    return projected;
  }

  async fetchRemote() {
    const response = await this.fetchImpl(relayUrl(this.profile.endpoint, this.profile.workspaceId), {
      method: 'GET', headers: { authorization: `Bearer ${this.profile.accessToken}`, accept: 'application/json' }
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 404 && body?.error?.code === 'WORKSPACE_SYNC_RELAY_EMPTY') return { missing: true, revision: null };
    if (!response.ok) {
      throw syncError(body?.error?.message || `同步端点请求失败（${response.status}）`, body?.error?.code || 'WORKSPACE_SYNC_REMOTE_READ_FAILED', response.status >= 400 && response.status < 600 ? response.status : 502);
    }
    const envelope = await decryptedEnvelope(body.payload, body.digest, this.profile.accessToken, this.profile.workspaceId);
    return { missing: false, revision: finiteRevision(body.revision), envelope, updatedAt: body.updatedAt || null };
  }

  async pushRemote(envelope, expectedRevision) {
    const secured = await encryptedPayload(envelope, this.profile.accessToken);
    const response = await this.fetchImpl(relayUrl(this.profile.endpoint, this.profile.workspaceId), {
      method: 'PUT',
      headers: { authorization: `Bearer ${this.profile.accessToken}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ expectedRevision, payload: secured.payload, digest: secured.digest })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw syncError(body?.error?.message || `同步端点写入失败（${response.status}）`, body?.error?.code || 'WORKSPACE_SYNC_REMOTE_WRITE_FAILED', response.status >= 400 && response.status < 600 ? response.status : 502, body?.error?.details);
    }
    return { revision: finiteRevision(body.revision), updatedAt: body.updatedAt || null };
  }

  async preview(session) {
    await this.ready;
    this.ensureConfigured();
    const local = await this.prepareLocal(session);
    try {
      const remote = await this.fetchRemote();
      const merged = mergeWorkspaceProjections({
        localProjection: local.projection,
        remoteProjection: remote.missing ? null : remote.envelope.projection,
        baseProjection: this.profile.baseProjection,
        localSession: sanitizeWorkspaceSession(session)
      });
      this.profile.lastStatus = merged.canApply ? (remote.missing ? 'ready-to-push' : 'ready') : 'conflict';
      this.profile.lastError = null;
      this.profile.conflictCount = merged.unresolvedConflicts.length;
      await this.saveProfile();
      return {
        ok: true,
        status: this.profile.lastStatus,
        remoteRevision: remote.revision,
        remoteUpdatedAt: remote.updatedAt || null,
        remoteMissing: remote.missing,
        plan: merged,
        settings: this.publicSettings()
      };
    } catch (error) {
      this.profile.lastStatus = 'offline';
      this.profile.lastError = text(error?.message, 320) || '同步端点不可用';
      await this.saveProfile().catch(() => undefined);
      throw error;
    }
  }

  async apply(session, { resolutions = {}, expectedRevision = undefined } = {}) {
    const preview = await this.preview(session);
    const expected = finiteRevision(expectedRevision);
    if (expectedRevision !== undefined && expected !== preview.remoteRevision) {
      throw syncError('远端工作现场在检查后发生变化，请重新查看合并计划', 'WORKSPACE_SYNC_REMOTE_CHANGED', 409, { actualRevision: preview.remoteRevision });
    }
    const merged = mergeWorkspaceProjections({
      localProjection: this.profile.localProjection,
      remoteProjection: preview.remoteMissing ? null : (await this.fetchRemote()).envelope.projection,
      baseProjection: this.profile.baseProjection,
      localSession: sanitizeWorkspaceSession(session),
      resolutions
    });
    if (!merged.canApply) {
      this.profile.lastStatus = 'conflict';
      this.profile.conflictCount = merged.unresolvedConflicts.length;
      await this.saveProfile();
      throw syncError('请先处理工作现场冲突', 'WORKSPACE_SYNC_CONFLICTS_UNRESOLVED', 409, { conflicts: merged.unresolvedConflicts });
    }
    const envelope = await createWorkspaceSyncEnvelope({
      workspaceId: this.profile.workspaceId,
      deviceId: this.profile.deviceId,
      projection: merged.projection,
      revision: preview.remoteRevision
    });
    try {
      const pushed = await this.pushRemote(envelope, preview.remoteRevision);
      this.profile.localProjection = merged.projection;
      this.profile.baseProjection = merged.projection;
      this.profile.counter = Math.max(this.profile.counter, merged.projection.clock);
      this.profile.lastRemoteRevision = pushed.revision;
      this.profile.lastSyncedAt = pushed.updatedAt || new Date().toISOString();
      this.profile.lastStatus = 'synced';
      this.profile.lastError = null;
      this.profile.conflictCount = 0;
      await this.saveProfile();
      return { ok: true, status: 'synced', revision: pushed.revision, session: merged.session, plan: merged, settings: this.publicSettings() };
    } catch (error) {
      this.profile.lastStatus = error?.code === 'WORKSPACE_SYNC_RELAY_REVISION_CONFLICT' ? 'conflict' : 'offline';
      this.profile.lastError = text(error?.message, 320) || '同步写入失败';
      await this.saveProfile().catch(() => undefined);
      throw error;
    }
  }

  async exportBundle(session) {
    await this.ready;
    return createWorkspaceBundle(session, { deviceId: this.profile.deviceId });
  }

  async importBundle(bundle) {
    await this.ready;
    return verifyWorkspaceBundle(bundle);
  }
}
