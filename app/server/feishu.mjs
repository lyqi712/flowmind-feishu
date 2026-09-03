import { createHash } from 'node:crypto';
import { renderFeishuDocumentBlocks } from './feishu-richtext.mjs';
import { mediaExtraCandidates } from './feishu-media.mjs';

﻿const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

export class FeishuConnectorError extends Error {
  constructor(message, { code = 'FEISHU_ERROR', stage = 'unknown', status = 502, retriable = false, details } = {}) {
    super(message);
    this.name = 'FeishuConnectorError';
    this.code = code;
    this.stage = stage;
    this.status = status;
    this.retriable = retriable;
    this.details = details;
  }

  toPublicJSON() {
    return { code: this.code, message: this.message, stage: this.stage, status: this.status, retriable: this.retriable, ...(this.details ? { details: this.details } : {}) };
  }
}

function list(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(/[\r\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

function unique(values) { return [...new Set(values.filter(Boolean))]; }

function requireCredentials(env) {
  const missing = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET'].filter((key) => !env[key]);
  if (missing.length) {
    throw new FeishuConnectorError(`飞书连接配置缺失: ${missing.join(', ')}`, { code: 'FEISHU_CONFIG_MISSING', stage: 'configuration', status: 400 });
  }
  return { appId: env.FEISHU_APP_ID, appSecret: env.FEISHU_APP_SECRET };
}

export function mediaDownloadExtra(asset = {}, documentToken = '') {
  if (asset?.extra) return typeof asset.extra === 'string' ? asset.extra : JSON.stringify(asset.extra);
  const token = String(documentToken || '').trim();
  return token ? JSON.stringify({ drive_route_token: token }) : '';
}

export function mediaDownloadPath(asset = {}, { documentToken, extra } = {}) {
  const payload = extra === undefined ? mediaDownloadExtra(asset, documentToken) : extra;
  const path = `/drive/v1/medias/${encodeURIComponent(asset.token)}/download`;
  return payload ? `${path}?extra=${encodeURIComponent(payload)}` : path;
}

function assetDownloadTimeoutMs(asset = {}, attempt = 0) {
  const isFile = asset.kind === 'file' || /video|pdf|zip|octet-stream/i.test(asset.mimeType || '');
  if (attempt > 0) return isFile ? 180000 : 90000;
  return isFile ? 120000 : 45000;
}

export function parseFeishuResource(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  const parts = parsed.pathname.split('/').filter(Boolean);
  const type = parts[0]?.toLowerCase();
  const token = parts[1];
  const aliases = { docx: 'docx', docs: 'doc', doc: 'doc', sheets: 'sheet', sheet: 'sheet', base: 'bitable', bitable: 'bitable', wiki: 'wiki', folder: 'folder', file: 'file', slides: 'slides', mindnotes: 'mindnote' };
  if (!aliases[type] || !token) return null;
  return { type: aliases[type], token, url: raw, host: parsed.host };
}

export const FEISHU_EXPORT_FOLDER_NAME = 'FlowMind 导出';

function isRetryableStatus(status) { return status === 408 || status === 429 || status >= 500; }
function text(value) { return value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value); }
function now() { return new Date().toISOString(); }

export class FeishuConnector {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, apiBase = FEISHU_API_BASE, timeoutMs = 30000, minDocRequestIntervalMs = 220, getUserAccessToken } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.apiBase = apiBase.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.minDocRequestIntervalMs = minDocRequestIntervalMs;
    this.lastDocRequestAt = 0;
    this.getUserAccessToken = typeof getUserAccessToken === 'function' ? getUserAccessToken : async () => '';
    this.secretValues = [env.FEISHU_APP_ID, env.FEISHU_APP_SECRET].filter(Boolean);
  }

  configuredSources(overrides = {}) {
    return {
      spaceIds: unique(list(overrides.spaceIds ?? overrides.spaceId ?? this.env.FEISHU_SPACE_IDS ?? this.env.FEISHU_SPACE_ID)),
      documentUrls: unique(list(overrides.documentUrls ?? overrides.urls ?? this.env.FEISHU_DOCUMENT_URLS)),
      folderTokens: unique(list(overrides.folderTokens ?? overrides.folderUrls ?? this.env.FEISHU_FOLDER_TOKENS ?? this.env.FEISHU_FOLDER_URLS)),
      recursiveLinks: overrides.recursiveLinks !== false,
      maxDepth: Math.max(0, Math.min(5, Number(overrides.maxDepth ?? this.env.FEISHU_RECURSIVE_DEPTH ?? 2))),
      maxDocuments: Math.max(1, Math.min(1000, Number(overrides.maxDocuments ?? this.env.FEISHU_MAX_DOCUMENTS ?? 200)))
    };
  }

  isConfigured() {
    const sources = this.configuredSources();
    return Boolean(this.env.FEISHU_APP_ID && this.env.FEISHU_APP_SECRET && (sources.spaceIds.length || sources.documentUrls.length || sources.folderTokens.length));
  }

  redact(value) {
    let output = String(value || '');
    for (const secret of this.secretValues) output = output.split(secret).join('[REDACTED]');
    return output;
  }

  async request(path, { method = 'GET', token, body, stage } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.apiBase}${path}`, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      let payload;
      try { payload = await response.json(); }
      catch {
        throw new FeishuConnectorError(`飞书接口在 ${stage} 阶段返回了非 JSON 响应`, { code: 'FEISHU_INVALID_RESPONSE', stage, status: 502, retriable: isRetryableStatus(response.status) });
      }
      if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
        const upstreamCode = payload.code === undefined ? response.status : payload.code;
        const upstreamMessage = typeof payload.msg === 'string' ? this.redact(payload.msg) : '上游请求失败';
        throw new FeishuConnectorError(`飞书接口错误（${stage}，code=${upstreamCode}）: ${upstreamMessage}`, {
          code: 'FEISHU_UPSTREAM_ERROR', stage, status: response.status >= 400 && response.status < 500 ? response.status : 502, retriable: isRetryableStatus(response.status)
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof FeishuConnectorError) throw error;
      if (error?.name === 'AbortError') throw new FeishuConnectorError(`飞书接口请求超时（${stage}）`, { code: 'FEISHU_TIMEOUT', stage, status: 504, retriable: true });
      throw new FeishuConnectorError(`飞书接口网络错误（${stage}）`, { code: 'FEISHU_NETWORK_ERROR', stage, status: 502, retriable: true });
    } finally { clearTimeout(timeout); }
  }

  async requestBinary(path, { token, stage, timeoutMs } = {}) {
    const controller = new AbortController();
    const limit = Math.max(1000, Number(timeoutMs) || this.timeoutMs);
    const timeout = setTimeout(() => controller.abort(), limit);
    const absolute = /^https?:\/\//i.test(path);
    const href = absolute ? path : `${this.apiBase}${path}`;
    try {
      const response = await this.fetchImpl(href, {
        headers: { ...(!absolute && token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: controller.signal
      });
      if (!response.ok) {
        const forbidden = response.status === 403;
        throw new FeishuConnectorError(forbidden ? `飞书拒绝下载该素材（${stage}，没有素材权限）` : `飞书资源下载失败（${stage}，HTTP ${response.status}）`, {
          code: forbidden ? 'FEISHU_MEDIA_FORBIDDEN' : 'FEISHU_MEDIA_DOWNLOAD_FAILED',
          stage,
          status: response.status >= 400 && response.status < 500 ? response.status : 502,
          retriable: !forbidden && isRetryableStatus(response.status)
        });
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      return { bytes, contentType: response.headers.get('content-type') || 'application/octet-stream', disposition: response.headers.get('content-disposition') || '' };
    } catch (error) {
      if (error instanceof FeishuConnectorError) throw error;
      if (error?.name === 'AbortError') throw new FeishuConnectorError(`飞书资源下载超时（${stage}）`, { code: 'FEISHU_MEDIA_TIMEOUT', stage, status: 504, retriable: true });
      throw new FeishuConnectorError(`飞书资源下载网络错误（${stage}）`, { code: 'FEISHU_MEDIA_NETWORK_ERROR', stage, status: 502, retriable: true });
    } finally { clearTimeout(timeout); }
  }

  packDownloadedAsset(asset, payload, extra = '') {
    return {
      externalId: `feishu:${asset.kind}:${asset.token}`,
      fileName: asset.fileName,
      mimeType: payload.contentType || asset.mimeType,
      byteSize: payload.bytes.length,
      contentHash: createHash('sha256').update(payload.bytes).digest('hex'),
      data: payload.bytes,
      metadata: { kind: asset.kind, feishuToken: asset.token, blockId: asset.blockId, anchor: asset.anchor, width: asset.width, height: asset.height, ...(extra ? { extra } : {}) }
    };
  }

  async downloadDocAssetOnce(asset, token, extra, attempt = 0) {
    const payload = await this.requestBinary(mediaDownloadPath(asset, { extra }), {
      token,
      stage: `docx-${asset.kind}-download`,
      timeoutMs: assetDownloadTimeoutMs(asset, attempt)
    });
    return this.packDownloadedAsset(asset, payload, extra);
  }

  async downloadDocAssetFromTmp(asset, token, extra) {
    const params = new URLSearchParams({ file_tokens: asset.token });
    if (extra) params.set('extra', extra);
    const payload = await this.request(`/drive/v1/medias/batch_get_tmp_download_url?${params}`, { token, stage: `docx-${asset.kind}-tmp` });
    const row = (payload.data?.tmp_download_urls || []).find((entry) => entry?.tmp_download_url || entry?.url);
    const url = row?.tmp_download_url || row?.url;
    if (!url) return null;
    const file = await this.requestBinary(url, { stage: `docx-${asset.kind}-tmp-get`, timeoutMs: assetDownloadTimeoutMs(asset, 1) });
    return this.packDownloadedAsset(asset, file, extra);
  }

  async downloadDocAssetWithToken(asset, token, { documentToken, nodeToken } = {}) {
    const extras = mediaExtraCandidates(asset, { documentToken, nodeToken });
    let lastError;
    for (const extra of extras) {
      try {
        return await this.downloadDocAssetOnce(asset, token, extra, 0);
      } catch (error) {
        lastError = error;
        if (error?.code === 'FEISHU_MEDIA_TIMEOUT') {
          try { return await this.downloadDocAssetOnce(asset, token, extra, 1); }
          catch (retryError) { lastError = retryError; }
        }
      }
    }
    for (const extra of extras) {
      try {
        const fromTmp = await this.downloadDocAssetFromTmp(asset, token, extra);
        if (fromTmp) return fromTmp;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async downloadDocAsset(asset, token, options = {}) {
    try {
      return await this.downloadDocAssetWithToken(asset, token, options);
    } catch (error) {
      if (error?.code !== 'FEISHU_MEDIA_FORBIDDEN') throw error;
      const userToken = String(await this.getUserAccessToken() || '').trim();
      if (!userToken || userToken === token) throw error;
      this.secretValues.push(userToken);
      return this.downloadDocAssetWithToken(asset, userToken, options);
    }
  }

  async resyncAssets({ documentToken, nodeToken, assets = [] } = {}) {
    const credentials = requireCredentials(this.env);
    const token = await this.getTenantToken(credentials);
    const imported = [];
    const warnings = [];
    for (const asset of assets) {
      try { imported.push(await this.downloadDocAsset(asset, token, { documentToken, nodeToken })); }
      catch (error) {
        warnings.push({
          tokenSuffix: String(asset.token || '').slice(-6),
          kind: asset.kind || 'file',
          code: error.code || 'FEISHU_ASSET_FAILED',
          message: this.redact(error.message)
        });
      }
    }
    return { imported, warnings };
  }

  async getTenantToken(config) {
    const payload = await this.request('/auth/v3/tenant_access_token/internal', { method: 'POST', stage: 'tenant-token', body: { app_id: config.appId, app_secret: config.appSecret } });
    if (!payload.tenant_access_token) throw new FeishuConnectorError('飞书 tenant token 响应缺少 tenant_access_token', { code: 'FEISHU_TOKEN_MISSING', stage: 'tenant-token', status: 502 });
    this.secretValues.push(payload.tenant_access_token);
    return payload.tenant_access_token;
  }

  async throttleDocRequest() {
    const waitMs = this.minDocRequestIntervalMs - (Date.now() - this.lastDocRequestAt);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.lastDocRequestAt = Date.now();
  }

  async listNodePage({ spaceId, token, parentNodeToken, pageToken }) {
    const params = new URLSearchParams({ page_size: '50' });
    if (parentNodeToken) params.set('parent_node_token', parentNodeToken);
    if (pageToken) params.set('page_token', pageToken);
    const payload = await this.request(`/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes?${params}`, { token, stage: 'wiki-nodes' });
    return payload.data || {};
  }

  async listAllNodes({ spaceId, token }) {
    const nodes = [];
    const seen = new Set();
    const parents = [null];
    while (parents.length) {
      const parentNodeToken = parents.shift();
      let pageToken;
      do {
        const page = await this.listNodePage({ spaceId, token, parentNodeToken, pageToken });
        for (const node of page.items || []) {
          const identity = node.node_token || `${node.obj_type}:${node.obj_token}`;
          if (!identity || seen.has(identity)) continue;
          seen.add(identity); nodes.push(node);
          if (node.has_child && node.node_token) parents.push(node.node_token);
        }
        pageToken = page.has_more ? page.page_token : undefined;
      } while (pageToken);
    }
    return nodes;
  }

  async listSpaces(token) {
    const spaces = [];
    let pageToken;
    do {
      const params = new URLSearchParams({ page_size: '50' });
      if (pageToken) params.set('page_token', pageToken);
      const payload = await this.request(`/wiki/v2/spaces?${params}`, { token, stage: 'wiki-spaces' });
      spaces.push(...(payload.data?.items || []));
      pageToken = payload.data?.has_more ? payload.data?.page_token : undefined;
    } while (pageToken);
    return spaces.map((space) => ({ id: space.space_id, name: space.name, description: space.description || '', visibility: space.visibility || null }));
  }

  async getWikiNode(nodeToken, token) {
    const params = new URLSearchParams({ token: nodeToken, obj_type: 'wiki' });
    const payload = await this.request(`/wiki/v2/spaces/get_node?${params}`, { token, stage: 'wiki-node' });
    return payload.data?.node || payload.data || null;
  }

  async getRawContent(documentId, token) {
    await this.throttleDocRequest();
    const payload = await this.request(`/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`, { token, stage: 'docx-raw-content' });
    return typeof payload.data?.content === 'string' ? payload.data.content : '';
  }

  async getDocxMeta(documentId, token) {
    const payload = await this.request(`/docx/v1/documents/${encodeURIComponent(documentId)}`, { token, stage: 'docx-meta' });
    return payload.data?.document || payload.data || {};
  }

  async listDocxBlocks(documentId, token) {
    const items = [];
    let pageToken;
    do {
      const params = new URLSearchParams({ page_size: '500', document_revision_id: '-1' });
      if (pageToken) params.set('page_token', pageToken);
      const payload = await this.request(`/docx/v1/documents/${encodeURIComponent(documentId)}/blocks?${params}`, { token, stage: 'docx-blocks' });
      items.push(...(payload.data?.items || []));
      pageToken = payload.data?.has_more ? payload.data?.page_token : undefined;
    } while (pageToken);
    return items;
  }

  extractLinks(blocks) {
    const links = [];
    const walk = (value) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'url' && typeof child === 'string') links.push(child);
        else if (typeof child === 'object') walk(child);
      }
    };
    for (const block of blocks) walk(block);
    return unique(links).filter((url) => parseFeishuResource(url));
  }

  async importDocx(resource, token, { inspectLinks = false, metadata = {} } = {}) {
    const [rawContent, meta, blocks] = await Promise.all([
      this.getRawContent(resource.token, token).catch(() => ''),
      this.getDocxMeta(resource.token, token).catch(() => ({})),
      this.listDocxBlocks(resource.token, token).catch(() => [])
    ]);
    const rendered = blocks.length ? renderFeishuDocumentBlocks(blocks, { title: meta.title || resource.title || '' }) : { content: rawContent, links: [], assets: [], metadata: { documentFormat: 'feishu-raw-content', richText: false, blockCount: 0, outline: [], blockAnchors: [] } };
    const links = inspectLinks ? unique([...rendered.links, ...this.extractLinks(blocks)]) : rendered.links;
    const attachments = [];
    const assetWarnings = [];
    for (const asset of rendered.assets || []) {
      try { attachments.push(await this.downloadDocAsset(asset, token, { documentToken: resource.token, nodeToken: resource.nodeToken })); }
      catch (error) { assetWarnings.push({ tokenSuffix: asset.token.slice(-6), kind: asset.kind, code: error.code || 'FEISHU_ASSET_FAILED', message: this.redact(error.message) }); }
    }
    const content = rendered.content || rawContent;
    return {
      document: {
        id: `docx:${resource.token}`, externalId: resource.token, nodeToken: resource.nodeToken || null,
        title: meta.title || resource.title || content.split(/\r?\n/).find(Boolean)?.replace(/^#+\s*/, '').slice(0, 120) || '未命名飞书文档',
        content, source: 'feishu', sourceType: 'docx', mimeType: 'text/markdown', url: resource.url || `https://feishu.cn/docx/${resource.token}`,
        updatedAt: now(), attachments,
        metadata: { ...metadata, ...rendered.metadata, revisionId: meta.revision_id || null, discoveredLinks: links.length, assetCount: rendered.assets?.length || 0, importedAssetCount: attachments.length, assetWarnings, nodeToken: resource.nodeToken || metadata.nodeToken || null }
      },
      links
    };
  }

  async importLegacyDoc(resource, token) {
    const payload = await this.request(`/doc/v2/${encodeURIComponent(resource.token)}/raw_content`, { token, stage: 'doc-raw-content' });
    const content = payload.data?.content || payload.data?.raw_content || '';
    return { id: `doc:${resource.token}`, externalId: resource.token, title: payload.data?.title || content.split(/\r?\n/).find(Boolean)?.slice(0, 120) || '飞书旧版文档', content, source: 'feishu', sourceType: 'doc', url: resource.url, updatedAt: now() };
  }

  async importSheet(resource, token) {
    const metaPayload = await this.request(`/sheets/v3/spreadsheets/${encodeURIComponent(resource.token)}`, { token, stage: 'sheet-meta' });
    const sheetsPayload = await this.request(`/sheets/v3/spreadsheets/${encodeURIComponent(resource.token)}/sheets/query`, { token, stage: 'sheet-list' });
    const spreadsheet = metaPayload.data?.spreadsheet || metaPayload.data || {};
    const parts = [];
    for (const sheet of sheetsPayload.data?.sheets || []) {
      const sheetId = sheet.sheet_id || sheet.sheetId;
      if (!sheetId) continue;
      const range = encodeURIComponent(`${sheetId}!A1:Z2000`);
      const valuesPayload = await this.request(`/sheets/v2/spreadsheets/${encodeURIComponent(resource.token)}/values/${range}`, { token, stage: 'sheet-values' });
      const values = valuesPayload.data?.valueRange?.values || valuesPayload.data?.value_range?.values || [];
      parts.push(`# ${sheet.title || sheetId}\n${values.map((row) => row.map((cell) => text(cell).replace(/\s+/g, ' ')).join('\t')).join('\n')}`);
    }
    return { id: `sheet:${resource.token}`, externalId: resource.token, title: spreadsheet.title || '飞书电子表格', content: parts.join('\n\n'), source: 'feishu', sourceType: 'sheet', url: resource.url, updatedAt: now(), metadata: { sheetCount: parts.length } };
  }

  async importBitable(resource, token) {
    const tables = [];
    let pageToken;
    do {
      const params = new URLSearchParams({ page_size: '100' });
      if (pageToken) params.set('page_token', pageToken);
      const payload = await this.request(`/bitable/v1/apps/${encodeURIComponent(resource.token)}/tables?${params}`, { token, stage: 'bitable-tables' });
      tables.push(...(payload.data?.items || []));
      pageToken = payload.data?.has_more ? payload.data?.page_token : undefined;
    } while (pageToken);
    const parts = [];
    for (const table of tables) {
      const records = [];
      let recordPage;
      do {
        const params = new URLSearchParams({ page_size: '500' });
        if (recordPage) params.set('page_token', recordPage);
        const payload = await this.request(`/bitable/v1/apps/${encodeURIComponent(resource.token)}/tables/${encodeURIComponent(table.table_id)}/records?${params}`, { token, stage: 'bitable-records' });
        records.push(...(payload.data?.items || []));
        recordPage = payload.data?.has_more ? payload.data?.page_token : undefined;
      } while (recordPage);
      parts.push(`# ${table.name || table.table_id}\n${records.map((record) => JSON.stringify(record.fields || {})).join('\n')}`);
    }
    return { id: `bitable:${resource.token}`, externalId: resource.token, title: `飞书多维表格 ${resource.token.slice(-6)}`, content: parts.join('\n\n'), source: 'feishu', sourceType: 'bitable', url: resource.url, updatedAt: now(), metadata: { tableCount: tables.length } };
  }

  async listDriveFolder(folderToken, token) {
    const resources = [];
    let pageToken;
    do {
      const params = new URLSearchParams({ folder_token: folderToken, page_size: '200', order_by: 'EditedTime', direction: 'DESC' });
      if (pageToken) params.set('page_token', pageToken);
      const payload = await this.request(`/drive/v1/files?${params}`, { token, stage: 'drive-folder' });
      for (const item of payload.data?.files || []) {
        const typeMap = { docx: 'docx', doc: 'doc', sheet: 'sheet', bitable: 'bitable', folder: 'folder' };
        if (typeMap[item.type] && item.token) resources.push({ type: typeMap[item.type], token: item.token, url: item.url || null, title: item.name });
      }
      pageToken = payload.data?.has_more ? payload.data?.next_page_token : undefined;
    } while (pageToken);
    return resources;
  }

  async importResource(resource, token, options = {}) {
    if (resource.type === 'wiki') {
      const node = await this.getWikiNode(resource.token, token);
      if (!node?.obj_token) throw new FeishuConnectorError('飞书 Wiki 节点缺少 obj_token', { code: 'FEISHU_WIKI_NODE_INVALID', stage: 'wiki-node', status: 422 });
      return this.importResource({ type: node.obj_type, token: node.obj_token, url: resource.url, title: node.title, nodeToken: node.node_token }, token, options);
    }
    if (resource.type === 'docx') return this.importDocx(resource, token, options);
    if (resource.type === 'doc') return { document: await this.importLegacyDoc(resource, token), links: [] };
    if (resource.type === 'sheet') return { document: await this.importSheet(resource, token), links: [] };
    if (resource.type === 'bitable') return { document: await this.importBitable(resource, token), links: [] };
    throw new FeishuConnectorError(`暂不支持读取该飞书资源类型: ${resource.type}`, { code: 'FEISHU_RESOURCE_UNSUPPORTED', stage: 'resource-dispatch', status: 422, details: { type: resource.type } });
  }

  async sync(overrides = {}) {
    const credentials = requireCredentials(this.env);
    const sources = this.configuredSources(overrides);
    if (!sources.spaceIds.length && !sources.documentUrls.length && !sources.folderTokens.length) {
      throw new FeishuConnectorError('请至少配置一个知识空间、飞书文档链接或云盘文件夹', { code: 'FEISHU_SOURCE_MISSING', stage: 'configuration', status: 400 });
    }
    const token = await this.getTenantToken(credentials);
    const documents = new Map();
    const warnings = [];
    const queue = [];
    let discovered = 0;
    let skipped = 0;

    for (const spaceId of sources.spaceIds) {
      const nodes = await this.listAllNodes({ spaceId, token });
      discovered += nodes.length;
      for (const node of nodes) {
        if (!node.obj_token || node.obj_type === 'wiki') { skipped += 1; continue; }
        queue.push({ resource: { type: node.obj_type, token: node.obj_token, nodeToken: node.node_token, title: node.title, url: node.node_token ? `https://feishu.cn/wiki/${node.node_token}` : null }, depth: 0, fromSpace: spaceId });
      }
    }
    for (const value of sources.documentUrls) {
      const resource = parseFeishuResource(value);
      if (resource) queue.push({ resource, depth: 0 }); else warnings.push({ code: 'FEISHU_URL_INVALID', value: String(value).slice(0, 160) });
    }
    for (const value of sources.folderTokens) {
      const parsed = parseFeishuResource(value);
      const folderToken = parsed?.token || String(value);
      for (const resource of await this.listDriveFolder(folderToken, token)) queue.push({ resource, depth: 0 });
    }

    const seen = new Set();
    while (queue.length && documents.size < sources.maxDocuments) {
      const entry = queue.shift();
      const identity = `${entry.resource.type}:${entry.resource.token}`;
      if (seen.has(identity)) continue;
      seen.add(identity); discovered += entry.depth > 0 ? 1 : 0;
      try {
        if (entry.resource.type === 'folder') {
          if (entry.depth >= sources.maxDepth) { skipped += 1; continue; }
          const children = await this.listDriveFolder(entry.resource.token, token);
          for (const child of children) queue.push({ resource: child, depth: entry.depth + 1 });
          continue;
        }
        const imported = await this.importResource(entry.resource, token, { inspectLinks: sources.recursiveLinks && entry.depth < sources.maxDepth, metadata: { spaceId: entry.fromSpace || null } });
        documents.set(imported.document.id, imported.document);
        if (sources.recursiveLinks && entry.depth < sources.maxDepth) {
          for (const link of imported.links || []) {
            const resource = parseFeishuResource(link);
            if (resource) queue.push({ resource, depth: entry.depth + 1 });
          }
        }
      } catch (error) {
        skipped += 1;
        warnings.push({ code: error.code || 'FEISHU_IMPORT_FAILED', stage: error.stage || 'import', type: entry.resource.type, tokenSuffix: entry.resource.token.slice(-6), message: this.redact(error.message) });
      }
    }

    if (!documents.size && warnings.length) {
      throw new FeishuConnectorError('飞书来源已发现，但没有任何文档成功导入', { code: 'FEISHU_NO_DOCUMENT_IMPORTED', stage: 'import', status: 422, details: { warnings } });
    }
    const values = [...documents.values()];
    const byType = values.reduce((acc, item) => ({ ...acc, [item.sourceType]: (acc[item.sourceType] || 0) + 1 }), {});
    return {
      source: 'feishu',
      space: { id: sources.spaceIds[0] || 'feishu-mixed', name: sources.spaceIds.length === 1 && !sources.documentUrls.length ? `飞书空间 ${sources.spaceIds[0]}` : '飞书多来源资料库' },
      documents: values,
      cursor: `feishu:${seen.size}:${values.length}:${Date.now()}`,
      stats: { discovered, imported: values.length, skipped, byType, warnings: warnings.length },
      warnings
    };
  }

  async getRootFolder(token) {
    const payload = await this.request('/drive/explorer/v2/root_folder/meta', { token, stage: 'drive-root' });
    const data = payload.data || {};
    return { token: data.token || data.id || '', name: data.name || '云空间根目录' };
  }

  async getFolderMeta(folderToken, token) {
    const payload = await this.request(`/drive/explorer/v2/folder/${encodeURIComponent(folderToken)}/meta`, { token, stage: 'drive-folder-meta' });
    const data = payload.data || {};
    return { token: data.token || folderToken, name: data.name || `云盘文件夹 ${String(folderToken).slice(-6)}` };
  }

  async getFileParent(fileToken, token, type = 'docx') {
    const params = new URLSearchParams({ type });
    const payload = await this.request(`/drive/v1/files/${encodeURIComponent(fileToken)}?${params}`, { token, stage: 'drive-file-meta' });
    const file = payload.data?.file || payload.data || {};
    return file.parent_token || file.folder_token || '';
  }

  async createDriveFolder({ name, folderToken, token } = {}) {
    const payload = await this.request('/drive/v1/files/create_folder', {
      method: 'POST',
      token,
      stage: 'drive-create-folder',
      body: { name, folder_token: folderToken }
    });
    const data = payload.data || {};
    const folderId = data.token || data.folder_token;
    if (!folderId) {
      throw new FeishuConnectorError('飞书创建文件夹成功，但没有返回文件夹 ID', { code: 'FEISHU_EXPORT_FOLDER_MISSING', stage: 'drive-create-folder', status: 502 });
    }
    return { token: folderId, url: data.url || '', name };
  }

  async resolveExportParentTokens(token, sources = this.configuredSources()) {
    const parents = [];
    for (const value of sources.folderTokens) {
      const parsed = parseFeishuResource(value);
      parents.push(parsed?.token || String(value));
    }
    for (const value of sources.documentUrls) {
      const resource = parseFeishuResource(value);
      if (resource?.type !== 'docx' || !resource.token) continue;
      const parentToken = await this.getFileParent(resource.token, token, 'docx').catch(() => '');
      if (parentToken) parents.push(parentToken);
    }
    const root = await this.getRootFolder(token).catch(() => null);
    if (root?.token) parents.push(root.token);
    return unique(parents.filter(Boolean));
  }

  async ensureExportFolderUnder(parentToken, token) {
    const children = await this.listDriveFolder(parentToken, token).catch(() => []);
    const found = children.find((item) => item.type === 'folder' && item.title === FEISHU_EXPORT_FOLDER_NAME);
    if (found?.token) {
      return { id: found.token, name: FEISHU_EXPORT_FOLDER_NAME, kind: 'folder', default: true };
    }
    const created = await this.createDriveFolder({ name: FEISHU_EXPORT_FOLDER_NAME, folderToken: parentToken, token });
    return { id: created.token, name: FEISHU_EXPORT_FOLDER_NAME, kind: 'folder', default: true };
  }

  async ensureExportDestination(existingToken) {
    const credentials = requireCredentials(this.env);
    const token = existingToken || await this.getTenantToken(credentials);
    const sources = this.configuredSources();
    if (sources.spaceIds[0]) {
      return { id: `wiki:${sources.spaceIds[0]}`, name: `知识空间 ${sources.spaceIds[0]}`, kind: 'wiki', default: true };
    }
    for (const parentToken of await this.resolveExportParentTokens(token, sources)) {
      try {
        return await this.ensureExportFolderUnder(parentToken, token);
      } catch {
        continue;
      }
    }
    return null;
  }

  async listFolders() {
    const credentials = requireCredentials(this.env);
    const token = await this.getTenantToken(credentials);
    const sources = this.configuredSources();
    const folders = [];
    const seen = new Set();
    const add = (folder) => {
      if (!folder?.id) return;
      if (seen.has(folder.id)) {
        const current = folders.find((item) => item.id === folder.id);
        if (current && folder.default) current.default = true;
        if (current && folder.name && current.name === current.id) current.name = folder.name;
        return;
      }
      seen.add(folder.id);
      folders.push({ id: folder.id, name: folder.name || folder.id, kind: folder.kind || 'folder', default: Boolean(folder.default) });
    };

    if (sources.spaceIds.length) {
      const spaces = await this.listSpaces(token).catch(() => []);
      const byId = new Map(spaces.map((space) => [space.id, space]));
      for (const spaceId of sources.spaceIds) {
        add({ id: `wiki:${spaceId}`, name: byId.get(spaceId)?.name || `知识空间 ${spaceId}`, kind: 'wiki' });
      }
    }

    for (const value of sources.folderTokens) {
      const parsed = parseFeishuResource(value);
      const folderToken = parsed?.token || String(value);
      const meta = await this.getFolderMeta(folderToken, token).catch(() => null);
      add({ id: folderToken, name: meta?.name || `云盘文件夹 ${folderToken.slice(-6)}`, kind: 'folder' });
      const children = await this.listDriveFolder(folderToken, token).catch(() => []);
      for (const child of children) {
        if (child.type === 'folder') add({ id: child.token, name: child.title || child.token, kind: 'folder' });
      }
    }

    for (const value of sources.documentUrls) {
      const resource = parseFeishuResource(value);
      if (resource?.type !== 'docx' || !resource.token) continue;
      const parentToken = await this.getFileParent(resource.token, token, 'docx').catch(() => '');
      if (!parentToken) continue;
      const meta = await this.getFolderMeta(parentToken, token).catch(() => null);
      add({ id: parentToken, name: meta?.name || `文档所在文件夹 ${parentToken.slice(-6)}`, kind: 'folder' });
    }

    if (!folders.length) {
      const root = await this.getRootFolder(token).catch(() => null);
      if (root?.token) {
        add({ id: root.token, name: root.name || '云空间根目录', kind: 'folder' });
        const children = await this.listDriveFolder(root.token, token).catch(() => []);
        for (const child of children) {
          if (child.type === 'folder') add({ id: child.token, name: child.title || child.token, kind: 'folder' });
        }
      }
    }
    const destination = await this.ensureExportDestination(token);
    if (destination) add(destination);
    folders.sort((left, right) => Number(Boolean(right.default)) - Number(Boolean(left.default)));
    return folders;
  }

  async createWikiDocument({ spaceId, title, token, parentNodeToken = '' } = {}) {
    const payload = await this.request(`/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`, {
      method: 'POST',
      token,
      stage: 'wiki-create-node',
      body: {
        obj_type: 'docx',
        node_type: 'origin',
        title,
        ...(parentNodeToken ? { parent_node_token: parentNodeToken } : {})
      }
    });
    const node = payload.data?.node || payload.data || {};
    const documentId = node.obj_token;
    if (!documentId) {
      throw new FeishuConnectorError('飞书知识库节点已创建，但没有返回文档 ID', { code: 'FEISHU_EXPORT_DOCUMENT_MISSING', stage: 'wiki-create-node', status: 502 });
    }
    return {
      document_id: documentId,
      url: node.node_token ? `https://feishu.cn/wiki/${node.node_token}` : `https://feishu.cn/docx/${documentId}`,
      folder_token: `wiki:${spaceId}`
    };
  }

  async createDriveDocument({ folderToken = '', title, token } = {}) {
    const payload = await this.request('/docx/v1/documents', {
      method: 'POST',
      token,
      stage: 'docx-create',
      body: {
        title,
        ...(folderToken ? { folder_token: folderToken } : {})
      }
    });
    const documentId = payload.data?.document?.document_id || payload.data?.document_id;
    if (!documentId) {
      throw new FeishuConnectorError('飞书创建文档成功，但没有返回文档 ID', { code: 'FEISHU_EXPORT_DOCUMENT_MISSING', stage: 'docx-create', status: 502 });
    }
    return {
      document_id: documentId,
      url: `https://feishu.cn/docx/${documentId}`,
      folder_token: folderToken || null
    };
  }

  async appendDocumentBlocks(documentId, blocks, token) {
    const batchSize = 50;
    for (let index = 0; index < blocks.length; index += batchSize) {
      await this.throttleDocRequest();
      await this.request(`/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children?document_revision_id=-1`, {
        method: 'POST',
        token,
        stage: 'docx-create-blocks',
        body: { children: blocks.slice(index, index + batchSize) }
      });
    }
  }

  async createDocument({ title, folderToken, folder_token, blocks } = {}) {
    const credentials = requireCredentials(this.env);
    const token = await this.getTenantToken(credentials);
    const name = String(title || '').trim().slice(0, 800);
    if (!name) {
      throw new FeishuConnectorError('文档标题不能为空', { code: 'FEISHU_EXPORT_TITLE_MISSING', stage: 'docx-create', status: 400 });
    }
    const destination = String(folderToken || folder_token || '').trim();
    const children = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
    let created;
    if (destination.startsWith('wiki:')) {
      created = await this.createWikiDocument({ spaceId: destination.slice(5), title: name, token });
    } else if (destination) {
      created = await this.createDriveDocument({ folderToken: destination, title: name, token });
    } else {
      const fallback = await this.ensureExportDestination(token);
      if (fallback?.id?.startsWith('wiki:')) {
        created = await this.createWikiDocument({ spaceId: fallback.id.slice(5), title: name, token });
      } else if (fallback?.id) {
        created = await this.createDriveDocument({ folderToken: fallback.id, title: name, token });
      } else {
        created = await this.createDriveDocument({ folderToken: '', title: name, token });
      }
    }
    if (children.length) {
      try {
        await this.appendDocumentBlocks(created.document_id, children, token);
      } catch (error) {
        throw new FeishuConnectorError(`飞书文档已创建，但正文写入失败：${this.redact(error.message)}`, {
          code: 'FEISHU_EXPORT_BLOCKS_FAILED',
          stage: 'docx-create-blocks',
          status: error.status || 502,
          details: { documentId: created.document_id, url: created.url }
        });
      }
    }
    return {
      document: {
        document_id: created.document_id,
        url: created.url,
        title: name,
        folder_token: created.folder_token || destination || null
      }
    };
  }
}

export function toPublicFeishuError(error) {
  if (error instanceof FeishuConnectorError) return error.toPublicJSON();
  return { code: 'FEISHU_UNKNOWN_ERROR', message: '飞书连接器发生未知错误', stage: 'unknown', status: 502, retriable: false };
}
