import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CURRENT_VERSION = 2;

function nowIso() {
  return new Date().toISOString();
}

function emptyAgent() {
  return { runs: [], confirmations: [] };
}

export function sidecarPath(stateFile, name) {
  if (!stateFile) throw new TypeError('state file path is required');
  return /\.json$/i.test(stateFile)
    ? stateFile.replace(/\.json$/i, `.${name}.json`)
    : `${stateFile}.${name}.json`;
}

export function sidecarDir(stateFile, name) {
  return sidecarPath(stateFile, name).replace(/\.json$/i, '');
}

function conversationFingerprint(item) {
  const messages = Array.isArray(item?.messages) ? item.messages : [];
  return [
    item?.id || '',
    item?.updatedAt || '',
    item?.archived ? '1' : '0',
    item?.title || '',
    item?.question || '',
    messages.length,
    messages.at(-1)?.id || '',
    String(item?.answer || '').length
  ].join('|');
}

function conversationFileName(id) {
  return `${String(id || 'conversation').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'conversation'}.json`;
}

export function createDefaultState() {
  const timestamp = nowIso();
  return {
    version: CURRENT_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: {
      activeKnowledgeBaseId: 'feishu-space',
      activeCopilotId: 'copilot-default',
      preferredSource: 'mock',
      model: {
        provider: 'local', baseUrl: '', model: '', timeoutMs: 120000, temperature: 0.4, maxTokens: 4096,
        fallbackToLocal: false, apiVersion: '2024-10-21', modelsPath: '', chatPath: '', authMode: 'none',
        apiKeyHeader: 'Authorization', requestFormat: 'local', responseFormat: 'auto', extraHeaders: {}
      },
      mcpConnectors: []
    },
    knowledgeLibraryState: { followedIds: [], discovered: [], refreshedAt: null },
    starredIds: [],
    knowledgeBases: [
      {
        id: 'feishu-space',
        name: '飞书知识库',
        source: 'mock',
        documentCount: 0,
        lastSyncedAt: null
      }
    ],
    documents: [],
    notes: [],
    writingDrafts: [],
    translations: [],
    copilots: [{ id: 'copilot-default', name: 'FlowMind 知识伙伴', avatar: '✨', userPrompt: '基于已连接的知识与用户偏好，像同事一样自然、准确地回答；该引用时用 [1] [2]。', knowledgeBaseIds: [], skillIds: [], starterPrompts: [], memoryEnabled: true, memories: [], createdAt: timestamp, updatedAt: timestamp }],
    conversations: [],
    sync: {
      status: 'idle',
      source: null,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastError: null,
      cursor: null,
      stats: { discovered: 0, imported: 0, skipped: 0 }
    },
    skillRuns: [],
    feishuExports: [],
    agent: emptyAgent()
  };
}

function clone(value) {
  return structuredClone(value);
}

function normalizeConversations(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeAgent(value) {
  return {
    runs: Array.isArray(value?.runs) ? value.runs : [],
    confirmations: Array.isArray(value?.confirmations) ? value.confirmations : []
  };
}

function normalizeState(input) {
  const defaults = createDefaultState();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return defaults;

  return {
    ...defaults,
    ...input,
    version: CURRENT_VERSION,
    settings: {
      ...defaults.settings,
      ...(input.settings || {}),
      model: { ...defaults.settings.model, ...(input.settings?.model || {}) },
      mcpConnectors: Array.isArray(input.settings?.mcpConnectors) ? input.settings.mcpConnectors : (defaults.settings.mcpConnectors || [])
    },
    knowledgeLibraryState: {
      ...defaults.knowledgeLibraryState,
      ...(input.knowledgeLibraryState || {}),
      followedIds: Array.isArray(input.knowledgeLibraryState?.followedIds) ? [...new Set(input.knowledgeLibraryState.followedIds.map(String))] : [],
      discovered: Array.isArray(input.knowledgeLibraryState?.discovered) ? input.knowledgeLibraryState.discovered : [],
    },
    starredIds: Array.isArray(input.starredIds) ? [...new Set(input.starredIds.map(String).filter(Boolean))] : [],
    knowledgeBases: Array.isArray(input.knowledgeBases) ? input.knowledgeBases : defaults.knowledgeBases,
    documents: Array.isArray(input.documents) ? input.documents : [],
    notes: Array.isArray(input.notes) ? input.notes : [],
    writingDrafts: Array.isArray(input.writingDrafts) ? input.writingDrafts : [],
    translations: Array.isArray(input.translations) ? input.translations : [],
    copilots: Array.isArray(input.copilots) && input.copilots.length ? input.copilots : defaults.copilots,
    conversations: normalizeConversations(input.conversations),
    sync: {
      ...defaults.sync,
      ...(input.sync || {}),
      stats: { ...defaults.sync.stats, ...(input.sync?.stats || {}) }
    },
    skillRuns: Array.isArray(input.skillRuns) ? input.skillRuns : [],
    feishuExports: Array.isArray(input.feishuExports) ? input.feishuExports : [],
    agent: normalizeAgent(input.agent)
  };
}

function stripSidecars(state) {
  state.conversations = [];
  state.agent = emptyAgent();
  return state;
}

function consumeOwnValue(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || typeof descriptor.get === 'function') return { present: false, value: undefined };
  const value = descriptor.value;
  delete object[key];
  return { present: true, value };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, 'utf8');
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export class JsonStateStore {
  constructor(filePath) {
    if (!filePath) throw new TypeError('state file path is required');
    this.filePath = filePath;
    this.state = stripSidecars(createDefaultState());
    this.conversations = [];
    this.agent = emptyAgent();
    this.writeQueue = Promise.resolve();
    this.ready = this.initialize();
  }

  sidecarFile(name) {
    return sidecarPath(this.filePath, name);
  }

  get conversationsDir() {
    return sidecarDir(this.filePath, 'conversations');
  }

  conversationFile(id) {
    return join(this.conversationsDir, conversationFileName(id));
  }

  async initialize() {
    await mkdir(dirname(this.filePath), { recursive: true });
    let parsed;
    try {
      parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      this.state = normalizeState(parsed);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        const wrapped = new Error(`状态文件读取失败: ${error.message}`);
        wrapped.code = 'STATE_READ_FAILED';
        throw wrapped;
      }
      this.conversations = [];
      this.agent = emptyAgent();
      this.state = stripSidecars(createDefaultState());
      await this.persist(this.state);
      return this.get();
    }

    const fromDir = await this.loadConversationsFromDir();
    const conversationSidecar = fromDir || await readJsonIfExists(this.sidecarFile('conversations'));
    const agentSidecar = await readJsonIfExists(this.sidecarFile('agent'));
    this.conversations = Array.isArray(conversationSidecar) ? conversationSidecar : normalizeConversations(this.state.conversations);
    this.agent = agentSidecar === undefined ? normalizeAgent(this.state.agent) : normalizeAgent(agentSidecar);

    const embeddedConversations = Array.isArray(parsed?.conversations) && parsed.conversations.length > 0;
    const embeddedAgent = (Array.isArray(parsed?.agent?.runs) && parsed.agent.runs.length > 0)
      || (Array.isArray(parsed?.agent?.confirmations) && parsed.agent.confirmations.length > 0);
    stripSidecars(this.state);
    const needsConversationMigration = (fromDir == null) && ((Array.isArray(conversationSidecar) && conversationSidecar.length > 0) || embeddedConversations);
    if (needsConversationMigration || (embeddedAgent && agentSidecar === undefined)) {
      if (needsConversationMigration) {
        await this.persistConversationRecords(this.conversations, { force: true });
        await unlink(this.sidecarFile('conversations')).catch(() => undefined);
      }
      if (embeddedAgent && agentSidecar === undefined) await this.persistSidecar('agent', this.agent);
      await this.persist(this.state);
    }
    return this.get();
  }

  get() {
    const state = clone(this.state);
    state.conversations = this.conversations.slice();
    state.agent = {
      runs: this.agent.runs.slice(),
      confirmations: this.agent.confirmations.slice()
    };
    return state;
  }

  getConversation(id) {
    const found = this.conversations.find(item => String(item?.id) === String(id));
    return found ? clone(found) : null;
  }

  async update(mutator) {
    // Preserve serialized writes without letting one persistence error poison future updates.
    const operation = this.writeQueue.catch(() => undefined).then(async () => {
      await this.ready;
      const draft = clone(this.state);
      let conversationsDraft;
      let agentDraft;
      Object.defineProperty(draft, 'conversations', {
        configurable: true,
        enumerable: true,
        get: () => {
          if (conversationsDraft === undefined) conversationsDraft = clone(this.conversations);
          return conversationsDraft;
        },
        set: (value) => {
          conversationsDraft = normalizeConversations(value);
        }
      });
      Object.defineProperty(draft, 'agent', {
        configurable: true,
        enumerable: true,
        get: () => {
          if (agentDraft === undefined) agentDraft = clone(this.agent);
          return agentDraft;
        },
        set: (value) => {
          agentDraft = normalizeAgent(value);
        }
      });
      const result = await mutator(draft);
      draft.updatedAt = nowIso();
      const assignedConversations = consumeOwnValue(draft, 'conversations');
      const assignedAgent = consumeOwnValue(draft, 'agent');
      const nextConversations = conversationsDraft !== undefined
        ? conversationsDraft
        : (assignedConversations.present ? normalizeConversations(assignedConversations.value) : this.conversations);
      const nextAgent = agentDraft !== undefined
        ? agentDraft
        : (assignedAgent.present ? normalizeAgent(assignedAgent.value) : this.agent);
      delete draft.conversations;
      delete draft.agent;
      stripSidecars(draft);
      await this.persist(draft);
      if (conversationsDraft !== undefined || assignedConversations.present) await this.persistConversationRecords(nextConversations);
      if (agentDraft !== undefined || assignedAgent.present) await this.persistSidecar('agent', nextAgent);
      this.state = draft;
      this.conversations = nextConversations;
      this.agent = nextAgent;
      return result === undefined ? this.get() : result;
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async replace(nextState) {
    return this.update((draft) => {
      const normalized = normalizeState(nextState);
      for (const key of Object.keys(draft)) delete draft[key];
      Object.assign(draft, normalized);
    });
  }

  async loadConversationsFromDir() {
    try {
      const names = await readdir(this.conversationsDir);
      const files = names.filter(name => name.endsWith('.json'));
      if (!files.length) return null;
      const items = await Promise.all(files.map(async name => {
        try {
          return JSON.parse(await readFile(join(this.conversationsDir, name), 'utf8'));
        } catch {
          return null;
        }
      }));
      const conversations = items.filter(item => item && typeof item === 'object' && item.id);
      conversations.sort((a, b) => String(a.updatedAt || a.createdAt || '').localeCompare(String(b.updatedAt || b.createdAt || '')));
      return conversations;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async persistConversationRecords(nextList, { force = false } = {}) {
    const records = normalizeConversations(nextList);
    await mkdir(this.conversationsDir, { recursive: true });
    const previous = new Map(this.conversations.map(item => [String(item.id), conversationFingerprint(item)]));
    const nextIds = new Set();
    for (const item of records) {
      if (!item?.id) continue;
      const id = String(item.id);
      nextIds.add(id);
      if (force || previous.get(id) !== conversationFingerprint(item)) {
        await atomicWriteJson(this.conversationFile(id), item);
      }
    }
    for (const id of previous.keys()) {
      if (!nextIds.has(id)) await unlink(this.conversationFile(id)).catch(() => undefined);
    }
  }

  async upsertConversation(conversation) {
    if (!conversation?.id) throw new TypeError('conversation id is required');
    const operation = this.writeQueue.catch(() => undefined).then(async () => {
      await this.ready;
      const next = clone(conversation);
      const list = this.conversations.slice();
      const index = list.findIndex(item => String(item.id) === String(next.id));
      if (index >= 0) list[index] = next;
      else list.push(next);
      const trimmed = list.slice(-500);
      await this.persistConversationRecords(trimmed);
      this.conversations = trimmed;
      return clone(next);
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async persistSidecar(name, value) {
    if (name === 'conversations') {
      await this.persistConversationRecords(value, { force: true });
      return;
    }
    await atomicWriteJson(this.sidecarFile(name), value);
  }

  async persist(state) {
    await atomicWriteJson(this.filePath, stripSidecars({ ...state }));
  }
}
