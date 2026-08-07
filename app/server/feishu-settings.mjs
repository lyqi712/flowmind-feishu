import { fileURLToPath } from 'node:url';
import { EncryptedSecretStore } from './model/secret-store.mjs';
import { FeishuConnector, parseFeishuResource } from './feishu.mjs';

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
      maxDocuments: Number(overrides.maxDocuments ?? this.saved.maxDocuments ?? 200)
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
      sourceCount: settings.documentUrls.length + settings.spaceIds.length + settings.folderTokens.length
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
      maxDocuments: Math.max(1, Math.min(1000, Number(input.maxDocuments ?? current.maxDocuments ?? 200)))
    };
    if (input.clearCredentials === true) { next.appId = ''; next.appSecret = ''; }
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
    return new FeishuConnector({ env, fetchImpl: this.fetchImpl, ...this.connectorOptions });
  }

  async sync(overrides = {}) {
    await this.ready;
    const config = this.effective(overrides);
    return this.connector(config).sync(config);
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