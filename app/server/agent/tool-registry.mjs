import { searchDocuments } from '../retrieval.mjs';

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

function sourceRefsFromMatches(matches = []) {
  return matches.map(match => ({
    documentId: match.document?.id || match.documentId || null,
    title: match.document?.title || match.title || 'Untitled document',
    anchor: match.anchor || null,
    excerpt: String(match.excerpt || match.document?.content || '').slice(0, 240)
  })).filter(ref => ref.documentId);
}

function toolError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
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
    properties: { documentId: { type: 'string', minLength: 1 }, anchor: { type: 'string' } }
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
  'note.create': {
    type: 'object', additionalProperties: false, required: ['title', 'content'],
    properties: { title: { type: 'string', minLength: 1 }, content: { type: 'string' }, tags: { type: 'array' }, sourceRefs: { type: 'array' } }
  },
  'draft.create': {
    type: 'object', additionalProperties: false, required: ['title', 'content'],
    properties: { title: { type: 'string', minLength: 1 }, content: { type: 'string' }, sourceRefs: { type: 'array' } }
  },
  'task.create': {
    type: 'object', additionalProperties: false, required: ['title', 'content'],
    properties: { title: { type: 'string', minLength: 1 }, content: { type: 'string' }, sourceRefs: { type: 'array' } }
  },
  'file.write': {
    type: 'object', additionalProperties: false, required: ['path', 'content'],
    properties: { path: { type: 'string', minLength: 1 }, content: { type: 'string' } }
  },
  'graph.append-link': {
    type: 'object', additionalProperties: false, required: ['noteId', 'targetTitle'],
    properties: { noteId: { type: 'string', minLength: 1 }, targetTitle: { type: 'string', minLength: 1 }, anchor: { type: 'string' } }
  }
});

function proposalFor(name, args) {
  if (name === 'note.create') return {
    action: name,
    diff: { before: '', after: args.content, path: `notes/${args.title}.md` },
    payload: { title: args.title, content: args.content, tags: safeArray(args.tags), sourceRefs: safeArray(args.sourceRefs) },
    sourceRefs: safeArray(args.sourceRefs)
  };
  if (name === 'draft.create') return {
    action: name,
    diff: { before: '', after: args.content, path: `drafts/${args.title}.md` },
    payload: { title: args.title, content: args.content, sourceRefs: safeArray(args.sourceRefs) },
    sourceRefs: safeArray(args.sourceRefs)
  };
  if (name === 'task.create') return {
    action: name,
    diff: { before: '', after: args.content, path: `tasks/${args.title}.md` },
    payload: { title: args.title, content: args.content, sourceRefs: safeArray(args.sourceRefs) },
    sourceRefs: safeArray(args.sourceRefs)
  };
  if (name === 'file.write') return {
    action: name,
    diff: { before: null, after: args.content, path: args.path },
    payload: { path: args.path, content: args.content },
    sourceRefs: []
  };
  if (name === 'graph.append-link') return {
    action: name,
    diff: { before: null, after: `[[${args.targetTitle}${args.anchor ? `#${args.anchor}` : ''}]]`, path: `notes/${args.noteId}.md` },
    payload: { noteId: args.noteId, targetTitle: args.targetTitle, anchor: args.anchor || '' },
    sourceRefs: []
  };
  throw toolError('TOOL_NOT_FOUND', `Unsupported write tool: ${name}`, 404);
}

export class ToolRegistry {
  constructor({ getDocuments = () => [], contentRepository, graphIndex, writers = {}, mcpGateway = null, fileGateway = null } = {}) {
    this.getDocuments = getDocuments;
    this.contentRepository = contentRepository || null;
    this.graphIndex = graphIndex || null;
    this.writers = writers;
    this.mcpGateway = mcpGateway;
    this.fileGateway = fileGateway;
    this.tools = new Map();
    this.registerBuiltIns();
  }

  register(definition) {
    if (!definition?.name || typeof definition.execute !== 'function') throw new TypeError('tool name and execute function are required');
    this.tools.set(definition.name, { ...definition, schema: definition.schema || { type: 'object', properties: {} } });
    return this;
  }

  list({ includeWrite = true } = {}) {
    return [...this.tools.values()]
      .filter(tool => includeWrite || tool.effect !== 'write')
      .map(({ name, description, schema, effect }) => ({ name, description, schema, effect: effect || 'read' }));
  }

  get(name) {
    const tool = this.tools.get(String(name));
    if (!tool) throw toolError('TOOL_NOT_FOUND', `Unknown tool: ${name}`, 404);
    return tool;
  }

  async execute(name, rawArguments = {}, context = {}) {
    const tool = this.get(name);
    const argumentsValue = validateToolArguments(tool.schema, rawArguments);
    if (tool.effect === 'write') return {
      status: 'confirmation_required',
      tool: tool.name,
      proposal: proposalFor(tool.name, argumentsValue)
    };
    const result = await tool.execute(argumentsValue, context);
    return { status: 'completed', tool: tool.name, result };
  }

  async commit(proposal, context = {}) {
    const action = clean(proposal?.action);
    const payload = proposal?.payload || {};
    if (action === 'note.create') {
      if (typeof this.writers.createNote !== 'function') throw toolError('WRITE_CAPABILITY_UNAVAILABLE', 'Note writing is not configured', 501);
      return this.writers.createNote(payload, context);
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
    throw toolError('TOOL_NOT_FOUND', `Unsupported write proposal: ${action}`, 404);
  }

  registerBuiltIns() {
    this.register({
      name: 'knowledge.search', effect: 'read', schema: TOOL_SCHEMAS['knowledge.search'],
      description: 'Search the current FlowMind knowledge library and return source anchors.',
      execute: ({ query, limit = 5 }, context) => {
        const scope = scopedDocumentIds(context);
        const documents = this.getDocuments().filter(document => !scope.size || scope.has(String(document.id)));
        const matches = searchDocuments(documents, query, {
          limit: Math.max(1, Math.min(12, limit)),
          requiredDocumentIds: [...scope]
        });
        return { query, scopeDocumentIds: [...scope], matches: matches.map(match => ({ documentId: match.document.id, title: match.document.title, excerpt: match.excerpt, score: match.score, anchor: match.anchor || null })), sourceRefs: sourceRefsFromMatches(matches) };
      }
    });
    this.register({
      name: 'knowledge.read', effect: 'read', schema: TOOL_SCHEMAS['knowledge.read'],
      description: 'Read a known document and retain the requested source anchor.',
      execute: ({ documentId, anchor = '' }, context) => {
        const scope = scopedDocumentIds(context);
        if (scope.size && !scope.has(String(documentId))) throw toolError('KNOWLEDGE_DOCUMENT_OUT_OF_SCOPE', `Document is outside the selected knowledge scope: ${documentId}`);
        const item = this.contentRepository?.getContentItem(documentId) || this.getDocuments().find(document => String(document.id) === String(documentId));
        if (!item) throw toolError('KNOWLEDGE_DOCUMENT_NOT_FOUND', `Document not found: ${documentId}`, 404);
        return { documentId: item.id, title: item.title, content: String(item.content || ''), anchor: anchor || null, sourceRefs: [{ documentId: item.id, title: item.title, contentItemId: item.id, anchor: anchor || null, excerpt: String(item.content || '').slice(0, 240) }] };
      }
    });
    this.register({
      name: 'graph.query', effect: 'read', schema: TOOL_SCHEMAS['graph.query'],
      description: 'Query the explicit, attributable knowledge graph.',
      execute: ({ nodeId = '', depth = 1, spaceId = '' }) => {
        if (!this.graphIndex) throw toolError('GRAPH_CAPABILITY_UNAVAILABLE', 'Graph index is not configured', 501);
        return nodeId ? this.graphIndex.localGraph(nodeId, depth, { spaceId }) : this.graphIndex.snapshot({ spaceId });
      }
    });
    this.register({
      name: 'mcp.list', effect: 'read', schema: TOOL_SCHEMAS['mcp.list'],
      description: 'List configured MCP tools. Unconfigured connectors return an explicit capability error.',
      execute: async () => {
        if (!this.mcpGateway?.list) throw toolError('MCP_CAPABILITY_UNAVAILABLE', 'No MCP connector is configured for this Agent', 501);
        return this.mcpGateway.list();
      }
    });
    this.register({
      name: 'mcp.call', effect: 'read', schema: TOOL_SCHEMAS['mcp.call'],
      description: 'Call a configured MCP tool using validated JSON arguments.',
      execute: async ({ name, arguments: args = {} }) => {
        if (!this.mcpGateway?.call) throw toolError('MCP_CAPABILITY_UNAVAILABLE', 'No MCP connector is configured for this Agent', 501);
        return this.mcpGateway.call(name, args);
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
    for (const [name, description] of [
      ['note.create', 'Propose a new FlowMind note. Requires explicit confirmation before writing.'],
      ['draft.create', 'Propose a new writing draft. Requires explicit confirmation before writing.'],
      ['task.create', 'Propose a new task note. Requires explicit confirmation before writing.'],
      ['file.write', 'Propose a write under a user-selected file root. Requires explicit confirmation before writing.'],
      ['graph.append-link', 'Propose adding an explicit link to a note. Requires explicit confirmation before writing.']
    ]) this.register({ name, effect: 'write', schema: TOOL_SCHEMAS[name], description, execute: async () => null });
  }
}

export function createToolRegistry(options) {
  return new ToolRegistry(options);
}
