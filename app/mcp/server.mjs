import { pathToFileURL } from 'node:url';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DEFAULT_STATE_FILE } from '../server/app.mjs';
import { answerQuestion, searchDocuments } from '../server/retrieval.mjs';
import { executeSkill, SKILLS } from '../server/skills.mjs';
import { JsonStateStore } from '../server/state-store.mjs';
import { ContentRepository } from '../server/content/index.mjs';

function jsonText(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function publicDocument(document, { includeContent = false } = {}) {
  return {
    id: document.id,
    title: document.title,
    type: document.type || 'docx',
    url: document.url || null,
    knowledgeBaseId: document.knowledgeBaseId || null,
    updatedAt: document.updatedAt || null,
    ...(includeContent ? { content: document.content || '' } : { excerpt: String(document.content || '').slice(0, 240) })
  };
}

function publicContentMetadata(metadata = {}) {
  const { localPath, aliasPaths, ...safe } = metadata || {};
  return safe;
}

function contentItemToDocument(item) {
  return {
    id: item.metadata?.legacyId || item.id,
    title: item.title,
    content: item.content || '',
    type: item.contentType || 'document',
    contentType: item.contentType || 'document',
    mimeType: item.mimeType || null,
    knowledgeBaseId: item.spaceId || 'local-imports',
    source: item.sourceType || 'local',
    url: item.sourceUrl || null,
    revision: item.revision || null,
    tags: item.tags || [],
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || item.sourceModifiedAt || null,
    metadata: publicContentMetadata(item.metadata)
  };
}

function publicStatus(state, documents, content) {
  return {
    ok: true,
    version: state.version,
    updatedAt: state.updatedAt,
    mode: state.mode,
    knowledgeBases: (state.knowledgeBases || []).map(item => ({ id: item.id, name: item.name, source: item.source, documentCount: item.documentCount || 0, lastSyncedAt: item.lastSyncedAt || null })),
    documents: documents.length,
    contentStore: {
      source: documents.length ? 'sqlite' : 'state-fallback',
      database: 'local',
      schema: content.getSchemaStatus()
    },
    conversations: state.conversations?.length || 0,
    skillRuns: state.skillRuns?.length || 0,
    sync: state.sync || null,
    skills: SKILLS.map(({ id, name, description }) => ({ id, name, description }))
  };
}

async function apiRequest(apiBaseUrl, path, options = {}) {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const text = await response.text();
  let data = {};
  if (text) try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
    error.code = data?.error?.code || 'FLOWMIND_API_FAILED';
    error.status = response.status;
    throw error;
  }
  return data;
}

async function collectSkill(skillId, documents, input) {
  let done = null;
  const events = [];
  for await (const event of executeSkill(skillId, documents, input)) {
    events.push(event);
    if (event.type === 'done') done = event;
  }
  return {
    runId: done?.runId || events.find(event => event.runId)?.runId || null,
    result: done?.result || null,
    events: events.filter(event => ['start', 'step', 'artifact', 'done'].includes(event.type))
  };
}

export async function createFlowMindMcpServer({
  stateFile = process.env.FLOWMIND_STATE_FILE || DEFAULT_STATE_FILE,
  contentDatabase = process.env.FLOWMIND_CONTENT_DATABASE || `${stateFile}.content.sqlite`,
  apiBaseUrl = process.env.FLOWMIND_API_URL || 'http://127.0.0.1:8789'
} = {}) {
  const store = new JsonStateStore(stateFile);
  const state = await store.ready;
  const content = new ContentRepository({ databasePath: contentDatabase });
  content.migrateLegacyState(state);
  const currentDocuments = () => {
    const repositoryDocuments = content.listContentItems({ includeDeleted: false, includeTags: true, limit: 2000 })
      .filter(item => item.contentType !== 'note')
      .map(contentItemToDocument);
    return repositoryDocuments.length ? repositoryDocuments : (store.get().documents || []);
  };
  const server = new McpServer({ name: 'flowmind-feishu', version: '2.0.0' }, {
    capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
    instructions: 'FlowMind 飞书 AI 工作台：检索本地同步内容、执行知识问答和 Skill，并通过运行中的 FlowMind API 发现或同步飞书来源。'
  });

  server.registerTool('flowmind_status', {
    title: '读取 FlowMind 状态',
    description: '返回知识库、文档、同步、会话和 Skill 的公开状态。',
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async () => jsonText(publicStatus(store.get(), currentDocuments(), content)));

  server.registerTool('list_documents', {
    title: '列出知识文档',
    description: '列出本地知识库中的文档，可按标题或正文关键词过滤。',
    inputSchema: {
      query: z.string().optional().describe('可选关键词'),
      limit: z.number().int().min(1).max(100).default(30)
    },
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ query = '', limit = 30 }) => {
    const allDocuments = currentDocuments();
    const documents = query
      ? searchDocuments(allDocuments, query, { limit }).map(item => ({ ...publicDocument(item.document), score: item.score, excerpt: item.excerpt }))
      : allDocuments.slice(0, limit).map(document => publicDocument(document));
    return jsonText({ count: documents.length, documents });
  });

  server.registerTool('search_knowledge', {
    title: '检索知识库',
    description: '对已同步的飞书内容执行本地全文关键词检索，返回相关度、摘录和原文链接。',
    inputSchema: {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(10).default(5),
      documentIds: z.array(z.string()).optional()
    },
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ query, limit = 5, documentIds }) => {
    let documents = currentDocuments();
    if (documentIds?.length) {
      const ids = new Set(documentIds.map(String));
      documents = documents.filter(document => ids.has(String(document.id)));
    }
    const matches = searchDocuments(documents, query, { limit }).map(item => ({ ...publicDocument(item.document), score: item.score, excerpt: item.excerpt }));
    return jsonText({ query, count: matches.length, matches });
  });

  server.registerTool('ask_knowledge', {
    title: '知识库问答',
    description: '基于本地同步材料生成带可追溯引用的回答。',
    inputSchema: {
      question: z.string().min(1),
      limit: z.number().int().min(1).max(10).default(5),
      documentIds: z.array(z.string()).optional()
    },
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ question, limit = 5, documentIds }) => {
    let documents = currentDocuments();
    if (documentIds?.length) {
      const ids = new Set(documentIds.map(String));
      documents = documents.filter(document => ids.has(String(document.id)));
    }
    const result = answerQuestion(documents, question, { limit });
    return jsonText({ question, answer: result.answer, citations: result.citations });
  });

  server.registerTool('run_skill', {
    title: '运行 FlowMind Skill',
    description: '执行总结、对比、研究报告、文档解读、智能写作、行动项、FAQ 或时间线工作流。',
    inputSchema: {
      skillId: z.enum(SKILLS.map(skill => skill.id)),
      query: z.string().optional(),
      documentIds: z.array(z.string()).optional(),
      limit: z.number().int().min(1).max(20).default(6)
    }
  }, async ({ skillId, query = '', documentIds = [], limit = 6 }) => {
    const run = await collectSkill(skillId, currentDocuments(), { query, input: query, documentIds, limit });
    return jsonText(run);
  });

  server.registerTool('feishu_discover', {
    title: '发现飞书来源',
    description: '调用运行中的 FlowMind API 验证已保存凭据，并发现可访问知识空间及飞书链接来源。',
    inputSchema: {
      documentUrls: z.array(z.string().url()).optional(),
      spaceIds: z.array(z.string()).optional()
    }
  }, async ({ documentUrls = [], spaceIds = [] }) => jsonText(await apiRequest(apiBaseUrl, '/api/feishu/discover', {
    method: 'POST', body: JSON.stringify({ documentUrls, spaceIds })
  })));

  server.registerTool('feishu_sync', {
    title: '同步飞书知识',
    description: '通过运行中的 FlowMind API 同步已配置飞书来源，或载入演示知识库。',
    inputSchema: {
      source: z.enum(['feishu', 'mock']).default('feishu'),
      documentUrls: z.array(z.string().url()).optional(),
      spaceIds: z.array(z.string()).optional(),
      recursiveLinks: z.boolean().default(true),
      maxDepth: z.number().int().min(0).max(8).default(2),
      maxDocuments: z.number().int().min(1).max(2000).default(200)
    }
  }, async ({ source = 'feishu', documentUrls = [], spaceIds = [], recursiveLinks = true, maxDepth = 2, maxDocuments = 200 }) => {
    const data = await apiRequest(apiBaseUrl, '/api/sync', {
      method: 'POST', body: JSON.stringify({ source, mode: source, documentUrls, spaceIds, recursiveLinks, maxDepth, maxDocuments })
    });
    await store.initialize();
    content.migrateLegacyState(store.get());
    return jsonText({ ok: data.ok, source: data.source, requestedSource: data.requestedSource, stats: data.stats, warnings: data.warnings || [], fallbackUsed: Boolean(data.fallbackUsed) });
  });

  server.registerResource('flowmind-status', 'flowmind://status', {
    title: 'FlowMind 工作台状态', description: '知识库、文档、同步和 Skill 的公开状态', mimeType: 'application/json'
  }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(publicStatus(store.get(), currentDocuments(), content), null, 2) }] }));

  server.registerResource('flowmind-documents', 'flowmind://documents', {
    title: 'FlowMind 文档目录', description: '本地知识库文档目录', mimeType: 'application/json'
  }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(currentDocuments().map(document => publicDocument(document)), null, 2) }] }));

  const documentTemplate = new ResourceTemplate('flowmind://documents/{documentId}', {
    list: async () => ({ resources: currentDocuments().map(document => ({ uri: `flowmind://documents/${encodeURIComponent(document.id)}`, name: document.title, title: document.title, mimeType: 'text/markdown', description: `${document.type || 'docx'} · ${document.url || '本地内容'}` })) }),
    complete: { documentId: value => currentDocuments().map(document => String(document.id)).filter(id => id.includes(value)).slice(0, 20) }
  });
  server.registerResource('flowmind-document', documentTemplate, {
    title: 'FlowMind 文档正文', description: '按文档 ID 读取完整正文', mimeType: 'text/markdown'
  }, async (uri, variables) => {
    const documentId = decodeURIComponent(String(variables.documentId || ''));
    const document = currentDocuments().find(item => String(item.id) === documentId);
    if (!document) throw new Error(`未找到文档：${documentId}`);
    const header = [`# ${document.title}`, '', document.url ? `来源：${document.url}` : '来源：本地知识库', ''].join('\n');
    return { contents: [{ uri: uri.href, name: document.title, title: document.title, mimeType: 'text/markdown', text: `${header}${document.content || ''}` }] };
  });

  const originalClose = server.close.bind(server);
  server.close = async () => {
    try { await originalClose(); }
    finally { content.close(); }
  };

  return { server, store, content, stateFile, contentDatabase, apiBaseUrl };
}

export async function startFlowMindMcpServer(options = {}) {
  const current = await createFlowMindMcpServer(options);
  const transport = new StdioServerTransport();
  await current.server.connect(transport);
  return { ...current, transport };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFlowMindMcpServer().catch(error => {
    console.error(`[flowmind-mcp] ${error?.stack || error}`);
    process.exitCode = 1;
  });
}
