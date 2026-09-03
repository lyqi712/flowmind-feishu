import { fileURLToPath } from 'node:url';
import { EncryptedSecretStore } from './model/secret-store.mjs';
import { FeishuConnector, FeishuConnectorError, parseFeishuResource } from './feishu.mjs';
import {
  FEISHU_OAUTH_TOKEN_PATH,
  FEISHU_OAUTH_USER_PATH,
  buildAuthorizeUrl,
  createOAuthState,
  createPendingOAuthStore,
  oauthRedirectHint,
  parseOAuthTokenPayload,
  publicUserSession,
  resolveOAuthRedirectUri,
  safeReturnTo
} from './feishu-oauth.mjs';

export const DEFAULT_FEISHU_SECRET_FILE = fileURLToPath(new URL('../../runtime-data/feishu-secret.enc', import.meta.url));
export const DEFAULT_FEISHU_MASTER_KEY_FILE = fileURLToPath(new URL('../../runtime-data/.feishu-master-key', import.meta.url));

function list(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(/[\r\n,;]+/).map((item) => item.trim()).filter(Boolean);
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function maskAppId(value) { const text = String(value || ''); return text ? `${text.slice(0, 7)}••••${text.slice(-4)}` : ''; }

export class FeishuSettingsService {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, secretFile = DEFAULT_FEISHU_SECRET_FILE, masterKeyFile = DEFAULT_FEISHU_MASTER_KEY_FILE, secretStore, connectorOptions = {} } = {}) {
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.connectorOptions = connectorOptions;
    this.secrets = secretStore || new EncryptedSecretStore({ secretFile, keyFile: masterKeyFile });
    this.saved = {};
    this.pendingOAuth = createPendingOAuthStore();
    this.ready = this.initialize();
  }

  async initialize() {
    await this.secrets.ready;
    const raw = await this.secrets.get();
    if (raw) {
      try { this.saved = JSON.parse(raw); } catch { this.saved = {}; }
    }
    return this.publicSettings();
  }

  effective(overrides = {}) {
    const envDocumentUrls = list(this.env.FEISHU_DOCUMENT_URLS);
    const envSpaceIds = list(this.env.FEISHU_SPACE_IDS || this.env.FEISHU_SPACE_ID);
    const envFolderTokens = list(this.env.FEISHU_FOLDER_TOKENS || this.env.FEISHU_FOLDER_URLS);
    return {
      appId: String(overrides.appId ?? this.saved.appId ?? this.env.FEISHU_APP_ID ?? '').trim(),
      appSecret: String(overrides.appSecret || this.saved.appSecret || this.env.FEISHU_APP_SECRET || '').trim(),
      documentUrls: unique(list(overrides.documentUrls ?? overrides.urls ?? this.saved.documentUrls ?? envDocumentUrls)),
      spaceIds: unique(list(overrides.spaceIds ?? overrides.spaceId ?? this.saved.spaceIds ?? envSpaceIds)),
      folderTokens: unique(list(overrides.folderTokens ?? overrides.folderUrls ?? this.saved.folderTokens ?? envFolderTokens)),
      recursiveLinks: overrides.recursiveLinks ?? this.saved.recursiveLinks ?? true,
      maxDepth: Number(overrides.maxDepth ?? this.saved.maxDepth ?? 2),
      maxDocuments: Number(overrides.maxDocuments ?? this.saved.maxDocuments ?? 200),
      userSession: overrides.userSession === undefined ? this.saved.userSession || null : overrides.userSession
    };
  }

  publicSettings() {
    const settings = this.effective();
    return {
      configured: Boolean(settings.appId && settings.appSecret && (settings.documentUrls.length || settings.spaceIds.length || settings.folderTokens.length)),
      credentialsConfigured: Boolean(settings.appId && settings.appSecret),
      appIdMasked: maskAppId(settings.appId),
      documentUrls: settings.documentUrls,
      spaceIds: settings.spaceIds,
      folderTokens: settings.folderTokens,
      recursiveLinks: settings.recursiveLinks,
      maxDepth: settings.maxDepth,
      maxDocuments: settings.maxDocuments,
      sourceCount: settings.documentUrls.length + settings.spaceIds.length + settings.folderTokens.length,
      user: publicUserSession(settings.userSession)
    };
  }

  isConfigured() { return this.publicSettings().configured; }

  async update(input = {}) {
    await this.ready;
    const current = this.effective();
    const next = {
      appId: String(input.appId ?? current.appId).trim(),
      appSecret: String(input.appSecret || current.appSecret).trim(),
      documentUrls: unique(list(input.documentUrls ?? input.urls ?? current.documentUrls)),
      spaceIds: unique(list(input.spaceIds ?? input.spaceId ?? current.spaceIds)),
      folderTokens: unique(list(input.folderTokens ?? input.folderUrls ?? current.folderTokens)),
      recursiveLinks: input.recursiveLinks ?? current.recursiveLinks,
      maxDepth: Math.max(0, Math.min(5, Number(input.maxDepth ?? current.maxDepth ?? 2))),
      maxDocuments: Math.max(1, Math.min(1000, Number(input.maxDocuments ?? current.maxDocuments ?? 200))),
      userSession: current.userSession || null
    };
    if (input.clearCredentials === true) { next.appId = ''; next.appSecret = ''; next.userSession = null; }
    if (input.clearSources === true) { next.documentUrls = []; next.spaceIds = []; next.folderTokens = []; }
    this.saved = next;
    await this.secrets.set(JSON.stringify(next));
    return this.publicSettings();
  }

  async clear() {
    await this.ready;
    this.saved = {};
    await this.secrets.clear();
    return this.publicSettings();
  }

  connector(overrides = {}) {
    const config = this.effective(overrides);
    const env = {
      FEISHU_APP_ID: config.appId,
      FEISHU_APP_SECRET: config.appSecret,
      FEISHU_DOCUMENT_URLS: config.documentUrls.join('\n'),
      FEISHU_SPACE_IDS: config.spaceIds.join(','),
      FEISHU_FOLDER_TOKENS: config.folderTokens.join(','),
      FEISHU_RECURSIVE_DEPTH: String(config.maxDepth),
      FEISHU_MAX_DOCUMENTS: String(config.maxDocuments)
    };
    return new FeishuConnector({
      env,
      fetchImpl: this.fetchImpl,
      getUserAccessToken: () => this.getUserAccessToken(),
      ...this.connectorOptions
    });
  }

  async startUserLogin({ req, returnTo, origin } = {}) {
    await this.ready;
    const config = this.effective();
    if (!config.appId || !config.appSecret) {
      throw new FeishuConnectorError('请先保存飞书应用凭据，再登录账号拉图', { code: 'FEISHU_CONFIG_MISSING', stage: 'oauth-start', status: 400 });
    }
    const state = createOAuthState();
    const redirectUri = origin ? `${String(origin).replace(/\/$/, '')}/api/feishu/oauth/callback` : resolveOAuthRedirectUri(req);
    const nextReturnTo = safeReturnTo(returnTo, origin || resolveOAuthRedirectUri(req).replace(/\/api\/feishu\/oauth\/callback$/, '/'));
    this.pendingOAuth.set(state, { redirectUri, returnTo: nextReturnTo });
    return {
      url: buildAuthorizeUrl({ appId: config.appId, redirectUri, state }),
      redirectUri,
      hint: oauthRedirectHint(redirectUri)
    };
  }

  async completeUserLogin({ code, state }) {
    await this.ready;
    const pending = this.pendingOAuth.take(state);
    if (!pending) {
      throw new FeishuConnectorError('飞书登录已过期，请重新点登录', { code: 'FEISHU_OAUTH_STATE_INVALID', stage: 'oauth-callback', status: 400 });
    }
    if (!String(code || '').trim()) {
      throw new FeishuConnectorError('飞书没有返回授权码', { code: 'FEISHU_OAUTH_CODE_MISSING', stage: 'oauth-callback', status: 400 });
    }
    const session = await this.exchangeUserToken({
      grantType: 'authorization_code',
      code: String(code).trim(),
      redirectUri: pending.redirectUri
    });
    this.saved = { ...this.effective(), userSession: session };
    await this.secrets.set(JSON.stringify(this.saved));
    return { settings: this.publicSettings(), returnTo: pending.returnTo || '' };
  }

  async clearUserSession() {
    await this.ready;
    this.saved = { ...this.effective(), userSession: null };
    await this.secrets.set(JSON.stringify(this.saved));
    return this.publicSettings();
  }

  async getUserAccessToken() {
    await this.ready;
    const session = this.saved.userSession;
    if (!session?.accessToken && !session?.refreshToken) return '';
    if (session.expiresAt && Date.parse(session.expiresAt) - 60_000 > Date.now()) return session.accessToken;
    if (!session.refreshToken) return session.accessToken || '';
    try {
      const next = await this.exchangeUserToken({ grantType: 'refresh_token', refreshToken: session.refreshToken });
      this.saved = { ...this.effective(), userSession: { ...session, ...next, name: next.name || session.name, openId: next.openId || session.openId } };
      await this.secrets.set(JSON.stringify(this.saved));
      return this.saved.userSession.accessToken;
    } catch {
      return '';
    }
  }

  async exchangeUserToken({ grantType, code, redirectUri, refreshToken }) {
    const config = this.effective();
    const body = grantType === 'refresh_token'
      ? { grant_type: 'refresh_token', client_id: config.appId, client_secret: config.appSecret, refresh_token: refreshToken }
      : { grant_type: 'authorization_code', client_id: config.appId, client_secret: config.appSecret, code, redirect_uri: redirectUri };
    const response = await this.fetchImpl(`https://open.feishu.cn/open-apis${FEISHU_OAUTH_TOKEN_PATH}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body)
    });
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      const message = payload.error_description || payload.msg || payload.error || '换取用户令牌失败';
      throw new FeishuConnectorError(`飞书登录失败：${message}`, { code: 'FEISHU_OAUTH_TOKEN_FAILED', stage: 'oauth-token', status: response.status >= 400 ? response.status : 502 });
    }
    const session = parseOAuthTokenPayload(payload);
    if (!session) throw new FeishuConnectorError('飞书登录响应缺少 user_access_token', { code: 'FEISHU_OAUTH_TOKEN_MISSING', stage: 'oauth-token', status: 502 });
    const profile = await this.fetchUserProfile(session.accessToken);
    return { ...session, ...profile };
  }

  async fetchUserProfile(accessToken) {
    try {
      const response = await this.fetchImpl(`https://open.feishu.cn/open-apis${FEISHU_OAUTH_USER_PATH}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
      });
      const payload = await response.json();
      const data = payload.data || payload;
      return {
        name: String(data.name || data.en_name || '').trim(),
        openId: String(data.open_id || data.openId || '').trim()
      };
    } catch {
      return { name: '', openId: '' };
    }
  }

  async sync(overrides = {}) {
    await this.ready;
    const config = this.effective(overrides);
    return this.connector(config).sync(config);
  }

  async resyncAssets(input = {}) {
    await this.ready;
    const config = this.effective();
    return this.connector(config).resyncAssets(input);
  }

  async listFolders() {
    await this.ready;
    return this.connector().listFolders();
  }

  async ensureExportDestination() {
    await this.ready;
    return this.connector().ensureExportDestination();
  }

  async createDocument(input = {}) {
    await this.ready;
    return this.connector().createDocument(input);
  }

  async discover(overrides = {}) {
    await this.ready;
    const config = this.effective(overrides);
    const connector = this.connector(config);
    const token = await connector.getTenantToken({ appId: config.appId, appSecret: config.appSecret });
    const spaces = await connector.listSpaces(token).catch(() => []);
    const sources = [];
    for (const url of config.documentUrls) {
      const resource = parseFeishuResource(url);
      if (!resource) continue;
      const item = { type: resource.type, tokenSuffix: resource.token.slice(-6), url };
      if (resource.type === 'docx') {
        const meta = await connector.getDocxMeta(resource.token, token).catch(() => ({}));
        item.title = meta.title || null;
      }
      sources.push(item);
    }
    return { ok: true, tenantAuthorized: true, spaces, sources, settings: this.publicSettings() };
  }
}