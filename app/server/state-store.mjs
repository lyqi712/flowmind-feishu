import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const CURRENT_VERSION = 2;

function nowIso() {
  return new Date().toISOString();
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
        provider: 'local', baseUrl: '', model: '', timeoutMs: 120000, temperature: 0.2, maxTokens: 4096,
        fallbackToLocal: true, apiVersion: '2024-10-21', modelsPath: '', chatPath: '', authMode: 'none',
        apiKeyHeader: 'Authorization', requestFormat: 'local', responseFormat: 'auto', extraHeaders: {}
      }
    },
    knowledgeLibraryState: { followedIds: [], discovered: [], refreshedAt: null },
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
    copilots: [{ id: 'copilot-default', name: 'FlowMind 知识伙伴', avatar: '✨', userPrompt: '基于已连接的知识与用户偏好，提供准确、可追溯、可执行的回答。', knowledgeBaseIds: ['feishu-space'], skillIds: [], memoryEnabled: true, memories: [], createdAt: timestamp, updatedAt: timestamp }],
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
    agent: { runs: [], confirmations: [] }
  };
}

function clone(value) {
  return structuredClone(value);
}

function normalizeState(input) {
  const defaults = createDefaultState();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return defaults;

  return {
    ...defaults,
    ...input,
    version: CURRENT_VERSION,
    settings: { ...defaults.settings, ...(input.settings || {}), model: { ...defaults.settings.model, ...(input.settings?.model || {}) } },
    knowledgeLibraryState: {
      ...defaults.knowledgeLibraryState,
      ...(input.knowledgeLibraryState || {}),
      followedIds: Array.isArray(input.knowledgeLibraryState?.followedIds) ? [...new Set(input.knowledgeLibraryState.followedIds.map(String))] : [],
      discovered: Array.isArray(input.knowledgeLibraryState?.discovered) ? input.knowledgeLibraryState.discovered : [],
    },
    knowledgeBases: Array.isArray(input.knowledgeBases) ? input.knowledgeBases : defaults.knowledgeBases,
    documents: Array.isArray(input.documents) ? input.documents : [],
    notes: Array.isArray(input.notes) ? input.notes : [],
    writingDrafts: Array.isArray(input.writingDrafts) ? input.writingDrafts : [],
    translations: Array.isArray(input.translations) ? input.translations : [],
    copilots: Array.isArray(input.copilots) && input.copilots.length ? input.copilots : defaults.copilots,
    conversations: Array.isArray(input.conversations) ? input.conversations : [],
    sync: {
      ...defaults.sync,
      ...(input.sync || {}),
      stats: { ...defaults.sync.stats, ...(input.sync?.stats || {}) }
    },
    skillRuns: Array.isArray(input.skillRuns) ? input.skillRuns : [],
    agent: {
      ...defaults.agent,
      ...(input.agent || {}),
      runs: Array.isArray(input.agent?.runs) ? input.agent.runs : [],
      confirmations: Array.isArray(input.agent?.confirmations) ? input.agent.confirmations : []
    }
  };
}

export class JsonStateStore {
  constructor(filePath) {
    if (!filePath) throw new TypeError('state file path is required');
    this.filePath = filePath;
    this.state = createDefaultState();
    this.writeQueue = Promise.resolve();
    this.ready = this.initialize();
  }

  async initialize() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.state = normalizeState(JSON.parse(raw));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        const wrapped = new Error(`状态文件读取失败: ${error.message}`);
        wrapped.code = 'STATE_READ_FAILED';
        throw wrapped;
      }
      await this.persist(this.state);
    }
    return this.get();
  }

  get() {
    return clone(this.state);
  }

  async update(mutator) {
    this.writeQueue = this.writeQueue.then(async () => {
      await this.ready;
      const draft = clone(this.state);
      const result = await mutator(draft);
      draft.updatedAt = nowIso();
      await this.persist(draft);
      this.state = draft;
      return result === undefined ? this.get() : result;
    });
    return this.writeQueue;
  }

  async replace(nextState) {
    return this.update((draft) => {
      const normalized = normalizeState(nextState);
      for (const key of Object.keys(draft)) delete draft[key];
      Object.assign(draft, normalized);
    });
  }

  async persist(state) {
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}
