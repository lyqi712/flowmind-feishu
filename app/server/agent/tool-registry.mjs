import { createHash } from 'node:crypto';
import { isProblemKnowledgeNote, pruneDocumentsForQuery, relaxedTitleSearch, searchDocuments, searchEvidenceChunks, softenRetrievalQuery } from '../retrieval.mjs';
import { evidencePreconditions, resolveEvidence, sameEvidenceVersion, sourceRefFromEvidence } from './evidence.mjs';
import { EXTENDED_TOOL_SCHEMAS, registerExtendedTools } from './extended-tools.mjs';

function clean(value) {
  return String(value ?? '').trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function executionContext(value = {}) {
  return value?.context && typeof value.context === 'object' ? value.context : value;
}

function scopedDocumentIds(value = {}) {
  return new Set(safeArray(executionContext(value)?.documentIds).map(item => String(item || '').trim()).filter(Boolean));
}

function requiredDocumentIds(value = {}) {
  return new Set(safeArray(executionContext(value)?.requiredDocumentIds).map(item => String(item || '').trim()).filter(Boolean));
}

function suppliedDocuments(value = {}) {
  const documents = executionContext(value)?.selectedDocuments;
  return (Array.isArray(documents) ? documents : []).filter(document => document?.id);
}

function documentsInContext(baseDocuments = [], context = {}) {
  const byId = new Map();
  for (const document of Array.isArray(baseDocuments) ? baseDocuments : []) {
    const id = String(document?.id || '').trim();
    if (id) byId.set(id, document);
  }
  for (const document of suppliedDocuments(context)) {
    const id = String(document?.id || '').trim();
    if (id && !byId.has(id)) byId.set(id, document);
  }
  return [...byId.values()];
}

function allowedKnowledgeBaseIds(value = {}) {
  return new Set(safeArray(executionContext(value)?.allowedKnowledgeBaseIds).map(item => String(item || '').trim()).filter(Boolean));
}

function documentAllowedInContext(document, context) {
  const documentId = String(document?.id || '').trim();
  const scope = scopedDocumentIds(context);
  if (scope.size && !scope.has(documentId)) return false;
  if (requiredDocumentIds(context).has(documentId)) return true;
  const kbs = allowedKnowledgeBaseIds(context);
  if (!kbs.size) return true;
  return kbs.has(String(document?.knowledgeBaseId || document?.spaceId || ''));
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function toolError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function isPublicHttpUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host === '0.0.0.0') return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
  if (host === '::1' || host.startsWith('fd') || host.startsWith('fe80')) return false;
  return true;
}

function htmlToText(html = '') {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function publicDocument(document) {
  if (!document) return null;
  return {
    id: String(document.id),
    title: String(document.title || 'Untitled document'),
    revision: document.revision || null,
    contentHash: document.contentHash || null,
    currentVersionId: document.currentVersionId ?? null,
    content: String(document.content || '')
  };
}

function sourceRefsFromMatches(matches = [], getDocument = () => null) {
  return matches.filter(match => !match?.matchKind || match.matchKind === 'text-match').map(match => {
    const document = publicDocument(getDocument(match.document?.id || match.documentId) || match.document || {});
    if (!document?.id) return null;
    return {
      documentId: document.id,
      contentItemId: document.id,
      title: document.title,
      anchor: match.anchor || null,
      chunkId: match.chunkId || null,
      sourceId: match.sourceId || null,
      excerpt: String(match.excerpt || match.evidenceText || document.content || '').slice(0, 240),
      revision: document.revision,
      contentHash: document.contentHash,
      contentVersionId: document.currentVersionId
    };
  }).filter(Boolean);
}

function knownAnchors(document) {
  const metadata = document?.metadata || {};
  const candidates = [
    ...safeArray(metadata.anchors).map(item => typeof item === 'string' ? item : item?.id || item?.anchor),
    ...safeArray(metadata.pages).map(item => item?.anchor),
    ...safeArray(metadata.ocrRegions).map(item => item?.anchor),
    ...safeArray(metadata.blocks).map(item => item?.anchor || item?.blockId),
    ...safeArray(metadata.segments).map(item => item?.anchor)
  ].map(clean).filter(Boolean);
  return new Set(candidates);
}

function validateDocumentAnchor(document, anchor) {
  const requested = clean(anchor);
  if (!requested) return null;
  const anchors = knownAnchors(document);
  if (anchors.has(requested)) return requested;
  throw toolError('KNOWLEDGE_ANCHOR_INVALID', `The requested anchor is not available in document ${document?.id || 'unknown'}`);
}

function chunkAnchor(chunk) {
  return clean(chunk?.anchor || chunk?.metadata?.anchor || chunk?.metadata?.pageAnchor) || null;
}

function hydrateDocumentContent(repository, documents = []) {
  if (!repository?.getContentItem) return Array.isArray(documents) ? documents : [];
  return (Array.isArray(documents) ? documents : []).map(document => {
    if (String(document?.content || '').length > 80) return document;
    const item = repository.getContentItem(document.id, { includeTags: false, includeDeleted: true });
    if (!item) return document;
    return {
      ...document,
      title: item.title || document.title,
      content: item.content || '',
      revision: item.revision || document.revision,
      contentHash: item.contentHash || document.contentHash,
      currentVersionId: item.currentVersionId ?? document.currentVersionId
    };
  });
}

function indexedChunksFor(repository, documents = []) {
  const chunksByDocument = {};
  if (!repository?.listIndexChunks) return chunksByDocument;
  for (const document of documents) {
    const chunks = repository.listIndexChunks(document.id);
    if (chunks.length) chunksByDocument[String(document.id)] = chunks;
  }
  return chunksByDocument;
}

function ftsCandidateIds(repository, query, limit) {
  const text = clean(query);
  if (!text || typeof repository?.searchContent !== 'function') return [];
  try {
    return (repository.searchContent(text, { limit }) || []).map(item => String(item.id || '')).filter(Boolean);
  } catch {
    return [];
  }
}

function evidenceCandidates(documents, query, requiredDocumentIds = [], limit = 12, repository = null) {
  const required = new Set(safeArray(requiredDocumentIds).map(String));
  const candidateLimit = Math.max(18, Math.min(48, limit * 6));
  const pruned = hydrateDocumentContent(repository, pruneDocumentsForQuery(documents, query, {
    requiredDocumentIds: [...required],
    ftsIds: ftsCandidateIds(repository, query, candidateLimit),
    limit: candidateLimit
  }));
  const ranked = searchDocuments(pruned, query, { limit: candidateLimit, requiredDocumentIds });
  const candidates = new Map();
  for (const document of pruned) if (required.has(String(document.id))) candidates.set(String(document.id), document);
  for (const match of ranked) candidates.set(String(match.document.id), match.document);
  return [...candidates.values()];
}

function chunkWindow(chunks, chunk) {
  if (!chunk) return [];
  const index = chunks.findIndex(entry => String(entry.id) === String(chunk.id));
  if (index < 0) return [chunk];
  return chunks.slice(Math.max(0, index - 1), Math.min(chunks.length, index + 2));
}

function graphWithinScope(graph, scope) {
  if (!scope.size) return graph;
  const allowed = new Set((graph.nodes || []).filter(node => scope.has(String(node.sourceId || node.contentItemId || node.id?.replace(/^content:/, '')))).map(node => node.id));
  return {
    ...graph,
    nodes: (graph.nodes || []).filter(node => allowed.has(node.id)),
    edges: (graph.edges || []).filter(edge => allowed.has(edge.from) && allowed.has(edge.to)),
    unresolved: [],
    suggestions: []
  };
}

function sourceRefsFromGraph(graph = {}, getDocument = () => null) {
  const byId = new Map();
  for (const node of graph.nodes || []) {
    const documentId = clean(node.sourceRef?.documentId || node.sourceId || node.contentItemId);
    if (!documentId || byId.has(documentId)) continue;
    const document = publicDocument(getDocument(documentId) || { id: documentId, title: node.label || node.title });
    if (!document?.id) continue;
    byId.set(document.id, {
      documentId: document.id,
      contentItemId: document.id,
      title: document.title,
      excerpt: String(node.sourceRef?.excerpt || document.content || node.label || document.title || '').slice(0, 240),
      revision: document.revision,
      contentHash: document.contentHash,
      contentVersionId: document.currentVersionId
    });
  }
  return [...byId.values()];
}

function proposalEvidence(args, context, { required = false } = {}) {
  const execution = executionContext(context);
  const resolution = resolveEvidence(execution?.evidence || [], {
    evidenceIds: args.evidenceIds,
    sourceRefs: args.sourceRefs,
    fallbackToAll: false
  });
  if (resolution.unsupportedEvidenceIds.length || resolution.unsupportedSourceRefs.length
    || resolution.entries.some(entry => entry?.evidenceStatus !== 'current')) {
    throw toolError('AGENT_EVIDENCE_NOT_OBSERVED', 'A write proposal referenced evidence that was not currently verified by the server');
  }
  if (required && !resolution.entries.length) {
    throw toolError('AGENT_EVIDENCE_REQUIRED', 'A decision proposal requires at least one server-observed evidence item');
  }
  return {
    evidenceIds: resolution.entries.map(entry => entry.id),
    sourceRefs: resolution.entries.map(sourceRefFromEvidence).filter(Boolean),
    preconditions: evidencePreconditions(resolution.entries)
  };
}

function proposalFor(name, args, context) {
  const evidence = proposalEvidence(args, context, { required: name === 'decision.note.create' });
  const sourceRefs = evidence.sourceRefs;
  let proposal;
  if (name === 'note.create' || name === 'decision.note.create') {
    const tags = [...new Set([...safeArray(args.tags), ...(name === 'decision.note.create' ? ['决策笔记'] : [])].map(clean).filter(Boolean))];
    proposal = {
      action: 'note.create',
      requestedTool: name,
      diff: { before: '', after: args.content, path: `notes/${args.title}.md` },
      payload: { title: args.title, content: args.content, tags, sourceRefs },
      sourceRefs
    };
  } else if (name === 'note.update') {
    proposal = {
      action: 'note.update',
      requestedTool: name,
      diff: { before: null, after: args.content, path: `notes/${args.noteId}.md` },
      payload: { noteId: args.noteId, title: args.title, content: args.content, tags: safeArray(args.tags).map(clean).filter(Boolean), sourceRefs },
      sourceRefs
    };
  } else if (name === 'draft.create') {
    const fileName = clean(args.fileName) || `${args.title}.md`;
    proposal = {
      action: name,
      diff: { before: '', after: args.content, path: `drafts/${fileName}` },
      payload: {
        title: args.title,
        content: args.content,
        fileName,
        language: clean(args.language),
        kind: clean(args.kind) || ( /\.(?:py|js|ts|jsx|tsx|go|rs|java|c|cpp)$/i.test(fileName) ? 'code' : 'markdown'),
        sourceRefs
      },
      sourceRefs
    };
  } else if (name === 'task.create') {
    proposal = {
      action: name,
      diff: { before: '', after: args.content, path: `tasks/${args.title}.md` },
      payload: { title: args.title, content: args.content, sourceRefs },
      sourceRefs
    };
  } else if (name === 'file.write') {
    proposal = {
      action: name,
      diff: { before: null, after: args.content, path: args.path },
      payload: { path: args.path, content: args.content },
      sourceRefs: []
    };
  } else if (name === 'graph.append-link') {
    proposal = {
      action: name,
      diff: { before: null, after: `[[${args.targetTitle}${args.anchor ? `#${args.anchor}` : ''}]]`, path: `notes/${args.noteId}.md` },
      payload: { noteId: args.noteId, targetTitle: args.targetTitle, anchor: args.anchor || '' },
      sourceRefs
    };
  } else if (name === 'feishu.document.create') {
    proposal = {
      action: name,
      diff: { before: '', after: args.content, path: `feishu/${args.title}.md` },
      payload: { title: args.title, content: args.content, folderId: args.folderId || '', sourceRefs },
      sourceRefs
    };
  } else {
    throw toolError('TOOL_NOT_FOUND', `Unsupported write tool: ${name}`, 404);
  }
  proposal.evidenceIds = evidence.evidenceIds;
  proposal.preconditions = evidence.preconditions;
  proposal.diffHash = stableHash({ action: proposal.action, diff: proposal.diff, payload: proposal.payload, sourceRefs: proposal.sourceRefs, evidenceIds: proposal.evidenceIds, preconditions: proposal.preconditions });
  return proposal;
}

export function validateToolArguments(schema, value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const required = schema?.required || [];
  for (const key of required) if (input[key] === undefined || input[key] === null || input[key] === '') {
    throw toolError('TOOL_ARGUMENT_INVALID', `Missing required tool argument: ${key}`);
  }
  if (schema?.additionalProperties === false) {
    for (const key of Object.keys(input)) if (!schema.properties?.[key]) throw toolError('TOOL_ARGUMENT_INVALID', `Unsupported tool argument: ${key}`);
  }
  for (const [key, rule] of Object.entries(schema?.properties || {})) {
    const item = input[key];
    if (item === undefined || item === null) continue;
    const expected = rule.type;
    const valid = expected === 'array' ? Array.isArray(item)
      : expected === 'object' ? typeof item === 'object' && !Array.isArray(item)
        : expected === 'integer' ? Number.isInteger(item)
          : expected === 'number' ? typeof item === 'number' && Number.isFinite(item)
            : typeof item === expected;
    if (!valid) throw toolError('TOOL_ARGUMENT_INVALID', `Invalid tool argument type: ${key}`);
    if (rule.minLength && String(item).length < rule.minLength) throw toolError('TOOL_ARGUMENT_INVALID', `Tool argument is too short: ${key}`);
    if (key === 'content' && required.includes('content') && !String(item).trim()) {
      throw toolError('TOOL_ARGUMENT_INVALID', 'Write tools require non-empty content');
    }
    if (rule.minimum !== undefined && Number(item) < rule.minimum) throw toolError('TOOL_ARGUMENT_INVALID', `Tool argument is too small: ${key}`);
    if (rule.maximum !== undefined && Number(item) > rule.maximum) throw toolError('TOOL_ARGUMENT_INVALID', `Tool argument is too large: ${key}`);
  }
  return structuredClone(input);
}

export const TOOL_SCHEMAS = Object.freeze({
  'knowledge.search': {
    type: 'object', additionalProperties: false, required: ['query'],
    properties: { query: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 12 } }
  },
  'knowledge.read': {
    type: 'object', additionalProperties: false, required: ['documentId'],
    properties: { documentId: { type: 'string', minLength: 1 }, anchor: { type: 'string' }, chunkId: { type: 'string' } }
  },
  'graph.query': {
    type: 'object', additionalProperties: false,
    properties: { nodeId: { type: 'string' }, depth: { type: 'integer', minimum: 1, maximum: 3 }, spaceId: { type: 'string' } }
  },
  'mcp.list': { type: 'object', additionalProperties: false, properties: {} },
  'mcp.call': {
    type: 'object', additionalProperties: false, required: ['name'],
    properties: { name: { type: 'string', minLength: 1 }, arguments: { type: 'object' } }
  },
  'mcp.read': {
    type: 'object', additionalProperties: false, required: ['uri'],
    properties: { uri: { type: 'string', minLength: 1 } }
  },
  'file.read': {
    type: 'object', additionalProperties: false, required: ['path'],
    properties: { path: { type: 'string', minLength: 1 } }
  },
  'notes.search': {
    type: 'object', additionalProperties: false, required: ['query'],
    properties: { query: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 20 } }
  },
  'notes.read': {
    type: 'object', additionalProperties: false, required: ['noteId'],
    properties: { noteId: { type: 'string', minLength: 1 } }
  },
  'web.fetch': {
    type: 'object', additionalProperties: false, required: ['url'],
    properties: { url: { type: 'string', minLength: 8 }, maxChars: { type: 'integer', minimum: 200, maximum: 20000 } }
  },
  'note.create': {
    type: 'object', additionalProperties: false, required: ['title', 'content'],
    properties: { title: { type: 'string', minLength: 1 }, content: { type: 'string' }, tags: { type: 'array' }, sourceRefs: { type: 'array' }, evidenceIds: { type: 'array' } }
  },
  'note.update': {
    type: 'object', additionalProperties: false, required: ['noteId', 'content'],
    properties: { noteId: { type: 'string', minLength: 1 }, title: { type: 'string' }, content: { type: 'string' }, tags: { type: 'array' }, sourceRefs: { type: 'array' }, evidenceIds: { type: 'array' } }
  },
  'decision.note.create': {
    type: 'object', additionalProperties: false, required: ['title', 'content', 'evidenceIds'],
    properties: { title: { type: 'string', minLength: 1 }, content: { type: 'string' }, tags: { type: 'array' }, sourceRefs: { type: 'array' }, evidenceIds: { type: 'array' } }
  },
  'draft.create': {
    type: 'object', additionalProperties: false, required: ['title', 'content'],
    properties: {
      title: { type: 'string', minLength: 1 },
      content: { type: 'string' },
      fileName: { type: 'string' },
      language: { type: 'string' },
      kind: { type: 'string', enum: ['markdown', 'code', 'document', 'file'] },
      sourceRefs: { type: 'array' },
      evidenceIds: { type: 'array' }
    }
  },
  'task.create': {
    type: 'object', additionalProperties: false, required: ['title', 'content'],
    properties: { title: { type: 'string', minLength: 1 }, content: { type: 'string' }, sourceRefs: { type: 'array' }, evidenceIds: { type: 'array' } }
  },
  'file.write': {
    type: 'object', additionalProperties: false, required: ['path', 'content'],
    properties: { path: { type: 'string', minLength: 1 }, content: { type: 'string' }, evidenceIds: { type: 'array' } }
  },
  'graph.append-link': {
    type: 'object', additionalProperties: false, required: ['noteId', 'targetTitle'],
    properties: { noteId: { type: 'string', minLength: 1 }, targetTitle: { type: 'string', minLength: 1 }, anchor: { type: 'string' }, sourceRefs: { type: 'array' }, evidenceIds: { type: 'array' } }
  },
  'feishu.document.create': {
    type: 'object', additionalProperties: false, required: ['title', 'content'],
    properties: { title: { type: 'string', minLength: 1 }, content: { type: 'string' }, folderId: { type: 'string' }, sourceRefs: { type: 'array' }, evidenceIds: { type: 'array' } }
  },
  ...EXTENDED_TOOL_SCHEMAS
});

export class ToolRegistry {
  constructor({ getDocuments = () => [], contentRepository, graphIndex, writers = {}, mcpGateway = null, fileGateway = null, feishuGateway = null } = {}) {
    this.getDocuments = getDocuments;
    this.contentRepository = contentRepository || null;
    this.graphIndex = graphIndex || null;
    this.writers = writers;
    this.mcpGateway = mcpGateway;
    this.fileGateway = fileGateway;
    this.feishuGateway = feishuGateway;
    this.tools = new Map();
    this.registerBuiltIns();
    registerExtendedTools(this);
  }

  register(definition) {
    if (!definition?.name || typeof definition.execute !== 'function') throw new TypeError('tool name and execute function are required');
    this.tools.set(definition.name, { ...definition, schema: definition.schema || { type: 'object', properties: {} } });
    return this;
  }

  getDocument(id, { includeDeleted = false } = {}) {
    const contentItem = this.contentRepository?.getContentItem?.(id, { includeDeleted });
    if (contentItem) return contentItem;
    return this.getDocuments().find(document => String(document.id) === String(id)) || null;
  }

  getDocumentInContext(id, context, { includeDeleted = false } = {}) {
    const documentId = String(id || '').trim();
    if (!documentId) return null;
    return documentsInContext(this.getDocuments(), context).find(document => String(document.id) === documentId)
      || this.getDocument(documentId, { includeDeleted });
  }

  availability(tool) {
    if (tool.name.startsWith('mcp.') && !this.mcpGateway) return { available: false, reason: 'No MCP connector is configured for this Agent' };
    if (tool.name.startsWith('file.') && !this.fileGateway) return { available: false, reason: 'No user-selected file root is configured' };
    if (tool.name === 'graph.query' && !this.graphIndex) return { available: false, reason: 'Graph index is not configured' };
    if (tool.name === 'note.create' || tool.name === 'decision.note.create') return { available: typeof this.writers.createNote === 'function', reason: 'Note writing is not configured' };
    if (tool.name === 'note.update') return { available: typeof this.writers.updateNote === 'function', reason: 'Note updating is not configured' };
    if (tool.name === 'draft.create') return { available: typeof this.writers.createDraft === 'function', reason: 'Draft writing is not configured' };
    if (tool.name === 'task.create') return { available: typeof this.writers.createTask === 'function', reason: 'Task writing is not configured' };
    if (tool.name === 'graph.append-link') return { available: typeof this.writers.appendGraphLink === 'function', reason: 'Graph link writing is not configured' };
    if (tool.name === 'feishu.document.create') {
      const hasWriter = typeof this.writers.createFeishuDocument === 'function';
      const configured = typeof this.feishuGateway?.isAvailable === 'function'
        ? Boolean(this.feishuGateway.isAvailable())
        : Boolean(this.feishuGateway?.available);
      return {
        available: hasWriter && configured,
        reason: hasWriter ? '还没连接飞书。先在设置里完成应用授权，才能创建文档。' : 'Feishu document writing is not configured'
      };
    }
    return { available: true, reason: '' };
  }

  list({ includeWrite = true, includeUnavailable = true } = {}) {
    return [...this.tools.values()]
      .filter(tool => includeWrite || (tool.effect !== 'write' && tool.effect !== 'external'))
      .map(({ name, description, schema, effect }) => {
        const availability = this.availability({ name });
        return { name, description, schema, effect: effect || 'read', available: availability.available, availabilityReason: availability.available ? '' : availability.reason };
      })
      .filter(tool => includeUnavailable || tool.available);
  }

  capabilitySnapshot() {
    return this.list({ includeWrite: true, includeUnavailable: true }).map(tool => ({
      name: tool.name,
      effect: tool.effect,
      available: tool.available,
      reason: tool.availabilityReason || null,
      schemaVersion: 1
    }));
  }

  get(name) {
    const tool = this.tools.get(String(name));
    if (!tool) throw toolError('TOOL_NOT_FOUND', `Unknown tool: ${name}`, 404);
    return tool;
  }

  async execute(name, rawArguments = {}, context = {}) {
    const tool = this.get(name);
    const availability = this.availability(tool);
    if (!availability.available) throw toolError(`${tool.name.split('.')[0].toUpperCase()}_CAPABILITY_UNAVAILABLE`, availability.reason, 501);
    const argumentsValue = validateToolArguments(tool.schema, rawArguments);
    const execution = executionContext(context);
    const mode = clean(execution?.mode).toLowerCase();
    if (tool.effect === 'external') throw toolError('AGENT_EXTERNAL_CONFIRMATION_REQUIRED', 'External capabilities require an explicit proposal and confirmation before they can run', 409);
    if (tool.effect === 'write') {
      if (mode && !['change', 'write'].includes(mode)) throw toolError('AGENT_TOOL_MODE_FORBIDDEN', `Tool ${tool.name} is only available in change mode`, 403);
      const proposal = proposalFor(tool.name, argumentsValue, context);
      if (tool.name === 'graph.append-link' || tool.name === 'note.update') {
        const target = this.getDocument(argumentsValue.noteId);
        if (!target) throw toolError('NOTE_NOT_FOUND', `Note not found: ${argumentsValue.noteId}`, 404);
        proposal.targetPrecondition = {
          documentId: String(target.id), revision: target.revision || null, contentHash: target.contentHash || null, contentVersionId: target.currentVersionId ?? null
        };
        if (tool.name === 'note.update') {
          proposal.diff = { before: String(target.content || ''), after: argumentsValue.content, path: `notes/${target.title || argumentsValue.noteId}.md` };
        }
        proposal.diffHash = stableHash({ action: proposal.action, diff: proposal.diff, payload: proposal.payload, sourceRefs: proposal.sourceRefs, evidenceIds: proposal.evidenceIds, preconditions: proposal.preconditions, targetPrecondition: proposal.targetPrecondition });
      }
      return { status: 'confirmation_required', tool: tool.name, proposal };
    }
    const result = await tool.execute(argumentsValue, context);
    return { status: 'completed', tool: tool.name, result };
  }

  validateProposal(proposal) {
    const expectedHash = stableHash({
      action: proposal?.action,
      diff: proposal?.diff,
      payload: proposal?.payload,
      sourceRefs: proposal?.sourceRefs,
      evidenceIds: proposal?.evidenceIds,
      preconditions: proposal?.preconditions,
      ...(proposal?.targetPrecondition ? { targetPrecondition: proposal.targetPrecondition } : {})
    });
    if (!proposal?.diffHash || proposal.diffHash !== expectedHash) {
      throw toolError('AGENT_PROPOSAL_HASH_MISMATCH', 'The confirmation proposal changed before it could be committed', 409);
    }
    for (const condition of safeArray(proposal.preconditions)) {
      const document = this.getDocument(condition?.documentId);
      if (!sameEvidenceVersion(condition, document)) {
        throw toolError('AGENT_CONFIRMATION_STALE', 'The source evidence changed before confirmation. Generate a new proposal.', 409);
      }
    }
    if (proposal.targetPrecondition) {
      const target = this.getDocument(proposal.targetPrecondition.documentId);
      if (!sameEvidenceVersion(proposal.targetPrecondition, target)) {
        throw toolError('AGENT_CONFIRMATION_STALE', 'The target changed before confirmation. Generate a new proposal.', 409);
      }
    }
    return true;
  }

  async commit(proposal, context = {}) {
    this.validateProposal(proposal);
    const action = clean(proposal?.action);
    const payload = proposal?.payload || {};
    if (action === 'note.create') {
      if (typeof this.writers.createNote !== 'function') throw toolError('WRITE_CAPABILITY_UNAVAILABLE', 'Note writing is not configured', 501);
      return this.writers.createNote(payload, context);
    }
    if (action === 'note.update') {
      if (typeof this.writers.updateNote !== 'function') throw toolError('WRITE_CAPABILITY_UNAVAILABLE', 'Note updating is not configured', 501);
      return this.writers.updateNote(payload, context);
    }
    if (action === 'draft.create') {
      if (typeof this.writers.createDraft !== 'function') throw toolError('WRITE_CAPABILITY_UNAVAILABLE', 'Draft writing is not configured', 501);
      return this.writers.createDraft(payload, context);
    }
    if (action === 'task.create') {
      if (typeof this.writers.createTask !== 'function') throw toolError('WRITE_CAPABILITY_UNAVAILABLE', 'Task writing is not configured', 501);
      return this.writers.createTask(payload, context);
    }
    if (action === 'graph.append-link') {
      if (typeof this.writers.appendGraphLink !== 'function') throw toolError('WRITE_CAPABILITY_UNAVAILABLE', 'Graph link writing is not configured', 501);
      return this.writers.appendGraphLink(payload, context);
    }
    if (action === 'file.write') {
      if (!this.fileGateway?.write) throw toolError('FILE_CAPABILITY_UNAVAILABLE', 'No user-selected file root is configured', 501);
      return this.fileGateway.write(payload, context);
    }
    if (action === 'feishu.document.create') {
      if (typeof this.writers.createFeishuDocument !== 'function') throw toolError('FEISHU_CAPABILITY_UNAVAILABLE', 'Feishu document writing is not configured', 501);
      return this.writers.createFeishuDocument(payload, context);
    }
    throw toolError('TOOL_NOT_FOUND', `Unsupported write proposal: ${action}`, 404);
  }

  registerBuiltIns() {
    this.register({
      name: 'knowledge.search', effect: 'read', schema: TOOL_SCHEMAS['knowledge.search'],
      description: 'Search only the server-verified FlowMind knowledge scope and return chunk-level evidence anchors.',
      execute: ({ query, limit = 5 }, context) => {
        const scope = scopedDocumentIds(context);
        const required = requiredDocumentIds(context);
        const preferred = new Set(safeArray(executionContext(context)?.preferredDocumentIds).map(item => String(item || '').trim()).filter(Boolean));
        const availableDocuments = documentsInContext(this.getDocuments(), context);
        const documents = availableDocuments.filter(document => documentAllowedInContext(document, context));
        const requiredIds = [...new Set([...scope, ...required, ...preferred])];
        const candidates = evidenceCandidates(documents, query, requiredIds, Math.max(1, Math.min(12, limit)), this.contentRepository);
        const searchOptions = {
          limit: Math.max(1, Math.min(12, limit)),
          requiredDocumentIds: requiredIds,
          chunksByDocument: indexedChunksFor(this.contentRepository, candidates),
          maxChunksPerDocument: 3
        };
        let matches = searchEvidenceChunks(candidates, query, searchOptions);
        if (!matches.length) {
          const softened = softenRetrievalQuery(query);
          if (softened && softened !== String(query || '').trim()) matches = searchEvidenceChunks(candidates, softened, searchOptions);
        }
        if (!matches.length) {
          matches = relaxedTitleSearch(documents, query, { limit: searchOptions.limit }).map(entry => ({
            document: entry.document,
            score: entry.score,
            excerpt: entry.excerpt,
            excerptStart: 0,
            matchKind: 'title-only',
            chunkId: null,
            evidenceText: String(entry.document.content || '').slice(0, 800)
          }));
        }
        return {
          query,
          scopeDocumentIds: [...scope],
          matches: matches.map(match => ({
            documentId: match.document.id,
            title: match.document.title,
            chunkId: match.chunkId,
            sourceId: match.sourceId,
            excerpt: match.excerpt,
            score: match.score,
            matchKind: match.matchKind || 'text-match',
            anchor: match.anchor || null,
            source: match.document.source || match.document.sourceType || null,
            type: match.document.type || match.document.contentType || match.document.itemType || null
          })),
          sourceRefs: sourceRefsFromMatches(matches, id => this.getDocumentInContext(id, context))
        };
      }
    });
    this.register({
      name: 'knowledge.read', effect: 'read', schema: TOOL_SCHEMAS['knowledge.read'],
      description: 'Read a known in-scope chunk window with a validated source anchor.',
      execute: ({ documentId, anchor = '', chunkId = '' }, context) => {
        const scope = scopedDocumentIds(context);
        const documentKey = String(documentId || '');
        if (scope.size && !scope.has(documentKey) && !requiredDocumentIds(context).has(documentKey)) throw toolError('KNOWLEDGE_DOCUMENT_OUT_OF_SCOPE', `Document is outside the selected knowledge scope: ${documentId}`);
        const item = this.getDocumentInContext(documentId, context);
        if (!item) throw toolError('KNOWLEDGE_DOCUMENT_NOT_FOUND', `Document not found: ${documentId}`, 404);
        if (!documentAllowedInContext(item, context)) throw toolError('KNOWLEDGE_DOCUMENT_OUT_OF_SCOPE', `Document is outside the selected knowledge scope: ${documentId}`);
        const chunks = this.contentRepository?.listIndexChunks?.(item.id) || [];
        let target = clean(chunkId) ? chunks.find(chunk => String(chunk.id) === clean(chunkId)) : null;
        if (clean(chunkId) && !target) throw toolError('KNOWLEDGE_CHUNK_INVALID', `The requested chunk is not available in document ${item.id}`);
        if (!target && clean(anchor)) target = chunks.find(chunk => chunkAnchor(chunk) === clean(anchor) || clean(chunk?.metadata?.pageAnchor) === clean(anchor));
        const validatedAnchor = target ? chunkAnchor(target) : validateDocumentAnchor(item, anchor);
        if (chunks.length) {
          target ||= chunks[0];
          const window = chunkWindow(chunks, target);
          const content = window.map(chunk => String(chunk.text || '')).join('\n\n').slice(0, 6000);
          return {
            documentId: item.id,
            title: item.title,
            content,
            chunkId: target.id,
            windowChunkIds: window.map(chunk => chunk.id),
            anchor: validatedAnchor || chunkAnchor(target),
            sourceRefs: [{
              documentId: item.id,
              contentItemId: item.id,
              title: item.title,
              anchor: validatedAnchor || chunkAnchor(target),
              chunkId: target.id,
              excerpt: String(target.text || '').slice(0, 240),
              revision: item.revision || null,
              contentHash: item.contentHash || null,
              contentVersionId: item.currentVersionId ?? null
            }]
          };
        }
        return {
          documentId: item.id,
          title: item.title,
          content: String(item.content || ''),
          anchor: validatedAnchor,
          sourceRefs: [{
            documentId: item.id,
            contentItemId: item.id,
            title: item.title,
            anchor: validatedAnchor,
            excerpt: String(item.content || '').slice(0, 240),
            revision: item.revision || null,
            contentHash: item.contentHash || null,
            contentVersionId: item.currentVersionId ?? null
          }]
        };
      }
    });
    this.register({
      name: 'graph.query', effect: 'read', schema: TOOL_SCHEMAS['graph.query'],
      description: 'Query only explicit, attributable graph relations that are within the server-verified scope.',
      execute: ({ nodeId = '', depth = 1, spaceId = '' }, context) => {
        if (!this.graphIndex) throw toolError('GRAPH_CAPABILITY_UNAVAILABLE', 'Graph index is not configured', 501);
        const scope = scopedDocumentIds(context);
        const graph = nodeId ? this.graphIndex.localGraph(nodeId, depth, { spaceId }) : this.graphIndex.snapshot({ spaceId });
        const scoped = graphWithinScope(graph, scope);
        if (nodeId && scope.size && !scoped.nodes.some(node => node.id === nodeId)) {
          throw toolError('GRAPH_NODE_OUT_OF_SCOPE', 'Graph node is outside the selected knowledge scope', 403);
        }
        return {
          ...scoped,
          sourceRefs: sourceRefsFromGraph(scoped, id => this.getDocument(id))
        };
      }
    });
    this.register({
      name: 'mcp.list', effect: 'read', schema: TOOL_SCHEMAS['mcp.list'],
      description: 'List configured MCP capabilities. Unconfigured connectors are omitted from the capability snapshot.',
      execute: async () => {
        if (!this.mcpGateway?.list) throw toolError('MCP_CAPABILITY_UNAVAILABLE', 'No MCP connector is configured for this Agent', 501);
        return this.mcpGateway.list();
      }
    });
    this.register({
      name: 'mcp.call', effect: 'external', schema: TOOL_SCHEMAS['mcp.call'],
      description: 'External MCP calls are never executed automatically because their side effects are unknown.',
      execute: async () => {
        throw toolError('AGENT_EXTERNAL_CONFIRMATION_REQUIRED', 'External MCP calls require a dedicated reviewed proposal', 409);
      }
    });
    this.register({
      name: 'mcp.read', effect: 'read', schema: TOOL_SCHEMAS['mcp.read'],
      description: 'Read a configured MCP resource.',
      execute: async ({ uri }) => {
        if (!this.mcpGateway?.read) throw toolError('MCP_CAPABILITY_UNAVAILABLE', 'No MCP connector is configured for this Agent', 501);
        return this.mcpGateway.read(uri);
      }
    });
    this.register({
      name: 'file.read', effect: 'read', schema: TOOL_SCHEMAS['file.read'],
      description: 'Read from a user-selected file root only.',
      execute: async ({ path }) => {
        if (!this.fileGateway?.read) throw toolError('FILE_CAPABILITY_UNAVAILABLE', 'No user-selected file root is configured', 501);
        return this.fileGateway.read({ path });
      }
    });
    this.register({
      name: 'notes.search', effect: 'read', schema: TOOL_SCHEMAS['notes.search'],
      description: 'Search user notes by title, tags and body. Use this before creating a duplicate note, or when the question is about a previous problem record.',
      execute: ({ query, limit = 8 }, context) => {
        const notes = this.getDocuments().filter(item => String(item?.contentType || item?.type || '') === 'note' && documentAllowedInContext(item, context));
        const noteLimit = Math.max(1, Math.min(20, limit));
        let matches = searchDocuments(notes, query, { limit: noteLimit });
        if (!matches.length) {
          const softened = softenRetrievalQuery(query);
          if (softened && softened !== String(query || '').trim()) matches = searchDocuments(notes, softened, { limit: noteLimit });
        }
        if (!matches.length) matches = relaxedTitleSearch(notes, query, { limit: noteLimit });
        const sourceRefs = matches.map(match => ({
          documentId: match.document.id,
          title: match.document.title,
          excerpt: String(match.excerpt || match.document.content || '').slice(0, 240),
          revision: match.document.revision || null,
          contentHash: match.document.contentHash || null,
          contentVersionId: match.document.currentVersionId ?? null
        }));
        return {
          query,
          matches: matches.map(match => ({
            noteId: match.document.id,
            documentId: match.document.id,
            title: match.document.title,
            excerpt: String(match.excerpt || match.document.content || '').slice(0, 240),
            tags: match.document.tags || [],
            updatedAt: match.document.updatedAt || null,
            problem: isProblemKnowledgeNote(match.document)
          })),
          sourceRefs
        };
      }
    });
    this.register({
      name: 'notes.read', effect: 'read', schema: TOOL_SCHEMAS['notes.read'],
      description: 'Read one existing note by id so the agent can continue, append, or cite it without asking the user to paste.',
      execute: ({ noteId }, context) => {
        const note = this.getDocument(noteId);
        if (!note || String(note.contentType || note.type || '') !== 'note') throw toolError('NOTE_NOT_FOUND', `Note not found: ${noteId}`, 404);
        if (!documentAllowedInContext(note, context)) throw toolError('KNOWLEDGE_DOCUMENT_OUT_OF_SCOPE', `Note is outside the selected knowledge scope: ${noteId}`, 403);
        const content = String(note.content || '');
        return {
          noteId: String(note.id),
          documentId: String(note.id),
          title: String(note.title || '未命名笔记'),
          content,
          tags: note.tags || [],
          sourceRefs: [{
            documentId: String(note.id),
            title: String(note.title || '未命名笔记'),
            excerpt: content.slice(0, 240),
            revision: note.revision || note.updatedAt || null,
            contentHash: note.contentHash || null,
            contentVersionId: note.currentVersionId ?? null
          }],
          updatedAt: note.updatedAt || null
        };
      }
    });
    this.register({
      name: 'web.fetch', effect: 'read', schema: TOOL_SCHEMAS['web.fetch'],
      description: 'Fetch a public http(s) page and return readable text so the agent can read web docs without asking the user to copy-paste.',
      execute: async ({ url, maxChars = 8000 }) => {
        if (!isPublicHttpUrl(url)) throw toolError('WEB_URL_FORBIDDEN', 'Only public http(s) URLs can be fetched', 400);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': 'FlowMind/1.2 (knowledge-agent)' } });
          const raw = await response.text();
          const contentType = String(response.headers.get('content-type') || '');
          const text = contentType.includes('html') ? htmlToText(raw) : String(raw || '').replace(/\s+/g, ' ').trim();
          const limit = Math.max(200, Math.min(20000, Number(maxChars) || 8000));
          return {
            url: response.url || url,
            status: response.status,
            contentType,
            title: (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 160),
            text: text.slice(0, limit),
            truncated: text.length > limit
          };
        } catch (error) {
          throw toolError('WEB_FETCH_FAILED', error?.message || 'Failed to fetch URL', 502);
        } finally {
          clearTimeout(timer);
        }
      }
    });
    for (const [name, description] of [
      ['note.create', 'Propose a new FlowMind note. Requires explicit confirmation before writing.'],
      ['note.update', 'Propose updating an existing note. Requires explicit confirmation before writing.'],
      ['decision.note.create', 'Propose a cited decision note from server-observed evidence. Requires explicit confirmation before writing.'],
      ['draft.create', 'Propose a new writing draft. Requires explicit confirmation before writing.'],
      ['task.create', 'Propose a new task note. Requires explicit confirmation before writing.'],
      ['file.write', 'Propose a write under a user-selected file root. Requires explicit confirmation before writing.'],
      ['graph.append-link', 'Propose adding an explicit link to a note. Requires explicit confirmation before writing.'],
      ['feishu.document.create', 'Propose creating a Feishu/Lark document from markdown. Requires explicit confirmation. Unavailable until Feishu is connected.']
    ]) this.register({ name, effect: 'write', schema: TOOL_SCHEMAS[name], description, execute: async () => null });
  }
}

export function createToolRegistry(options) {
  return new ToolRegistry(options);
}
