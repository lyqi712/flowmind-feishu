import { fileURLToPath } from 'node:url';
import { normalizeModelSettings, publicModelSettings, PROVIDERS, validateModelSettings } from './config.mjs';
import { ModelProviderClient } from './providers.mjs';
import { EncryptedSecretStore } from './secret-store.mjs';

export const DEFAULT_SECRET_FILE = fileURLToPath(new URL('../../../runtime-data/model-secret.enc', import.meta.url));
export const DEFAULT_MASTER_KEY_FILE = fileURLToPath(new URL('../../../runtime-data/.model-master-key', import.meta.url));

function preferredModel(models) {
  const preferences = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'claude', 'gemini'];
  for (const preferred of preferences) {
    const found = models.find((item) => item.id === preferred || item.id.toLowerCase().includes(preferred));
    if (found) return found.id;
  }
  return models[0]?.id || '';
}

export class ModelService {
  constructor({ store, env = process.env, fetchImpl = globalThis.fetch, secretFile = DEFAULT_SECRET_FILE, masterKeyFile = DEFAULT_MASTER_KEY_FILE, secretStore } = {}) {
    this.store = store;
    this.env = env;
    this.client = new ModelProviderClient({ fetchImpl });
    this.secrets = secretStore || new EncryptedSecretStore({ secretFile, keyFile: masterKeyFile, envKey: env.MODEL_API_KEY });
    this.ready = Promise.all([store.ready, this.secrets.ready]);
  }

  settings() {
    const state = this.store.get();
    const saved = state.settings?.model || {};
    const untouchedLocal = saved.provider === 'local' && !saved.baseUrl && !saved.model && this.env.MODEL_BASE_URL;
    return normalizeModelSettings(untouchedLocal ? {} : saved, this.env);
  }

  async publicSettings() {
    await this.ready;
    return publicModelSettings(this.settings(), await this.secrets.has());
  }

  async update(input = {}) {
    await this.ready;
    const current = this.settings();
    const providerChanged = input.provider && String(input.provider) !== current.provider;
    const base = providerChanged ? {
      timeoutMs: current.timeoutMs,
      temperature: current.temperature,
      maxTokens: current.maxTokens,
      fallbackToLocal: current.fallbackToLocal,
      retries: current.retries,
      retryDelayMs: current.retryDelayMs
    } : current;
    const next = normalizeModelSettings({ ...base, ...input }, this.env);
    validateModelSettings(next, { requireModel: false });
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) await this.secrets.set(input.apiKey);
    if (input.clearApiKey === true) await this.secrets.clear();
    await this.store.update((state) => { state.settings.model = next; });
    return this.publicSettings();
  }

  async credential(settings = this.settings(), override = '') {
    const apiKey = String(override || '').trim() || await this.secrets.get();
    if (!apiKey && settings.authMode !== 'none' && settings.provider !== 'local') {
      throw Object.assign(new Error('模型 API Key 尚未配置'), { code: 'MODEL_API_KEY_MISSING' });
    }
    return apiKey;
  }

  async listModels({ refresh = false } = {}) {
    await this.ready;
    const settings = this.settings();
    const apiKey = await this.credential(settings);
    const models = await this.client.listModels(settings, apiKey);
    return { provider: settings.provider, models, selected: settings.model || preferredModel(models), refresh };
  }

  async test(overrides = {}) {
    await this.ready;
    const settings = normalizeModelSettings({ ...this.settings(), ...overrides }, this.env);
    validateModelSettings(settings, { requireModel: false });
    const apiKey = await this.credential(settings, overrides.apiKey);
    const started = Date.now();
    const models = await this.client.listModels(settings, apiKey);
    const selected = settings.model || preferredModel(models);
    let sample = '';
    if (selected && overrides.chatProbe !== false) {
      const chunks = [];
      for await (const delta of this.client.streamChat({ ...settings, model: selected }, apiKey, [
        { role: 'system', content: 'Reply with exactly: OK' },
        { role: 'user', content: 'connection test' }
      ])) {
        chunks.push(delta);
        if (chunks.join('').length >= 32) break;
      }
      sample = chunks.join('').slice(0, 64);
    }
    return {
      ok: true,
      provider: settings.provider,
      model: selected,
      modelCount: models.length,
      models,
      latencyMs: Date.now() - started,
      sample
    };
  }

  async *streamGenerate({ system = '', prompt = '', messages, signal, settings: overrides = {} } = {}) {
    await this.ready;
    const settings = normalizeModelSettings({ ...this.settings(), ...overrides }, this.env);
    if (settings.provider === 'local') return;
    validateModelSettings(settings, { requireModel: true });
    const apiKey = await this.credential(settings);
    const normalizedMessages = Array.isArray(messages) && messages.length
      ? messages
      : [
          ...(system ? [{ role: 'system', content: String(system) }] : []),
          { role: 'user', content: String(prompt) }
        ];
    yield* this.client.streamChat(settings, apiKey, normalizedMessages, { signal });
  }

  async generate(options = {}) {
    const settings = this.settings();
    const chunks = [];
    for await (const delta of this.streamGenerate(options)) chunks.push(delta);
    return { text: chunks.join(''), provider: settings.provider, model: settings.model };
  }

  async *answer({ question, matches = [], history = [], userPrompt = '', memories = [], signal }) {
    const context = matches.map((entry, index) => `[${index + 1}] ${entry.document.title}\n${entry.excerpt}\nURL: ${entry.document.url || 'local'}`).join('\n\n');
    const evidenceInstruction = context
      ? '当回答涉及知识库事实时，优先使用下面的证据，并在对应结论后保留 [1] 这种引用编号；证据不足时明确说明，不编造链接。'
      : '当前没有检索到可引用的知识库证据。可以正常回应寒暄、解释概念、整理计划或提出澄清问题；不要伪造引用。';
    const memoryInstruction = memories.length ? `\n\n已保存的用户偏好（仅用于改善表达，不要声称这是事实证据）：\n${memories.map(item => '- ' + String(item)).join('\n')}` : '';
    const customInstruction = String(userPrompt || '').trim();
    const baseSystem = `你是 FlowMind 的对话型知识工作助手。你的职责是把用户的问题转化为有用、可执行、自然的回答：先直接回应，再按需要给出依据、步骤、取舍或下一步。

${evidenceInstruction}
不要输出隐藏的思维链或虚构的“思考过程”；可以用简短的“结论 / 依据 / 下一步”结构呈现可核验结果。输出简体中文，避免固定套话和无关长模板。${memoryInstruction}${customInstruction ? '\n\n用户为当前 Copilot 设置的自定义指令：\n' + customInstruction : ''}`;
    const userContent = context ? `用户问题：${question}\n\n可用知识库证据：\n${context}` : String(question);
    const messages = [
      { role: 'system', content: baseSystem },
      ...history.slice(-20).filter((message) => ['user', 'assistant'].includes(message.role)).map((message) => ({ role: message.role, content: String(message.content || message.text || '') })),
      { role: 'user', content: userContent }
    ];
    yield* this.streamGenerate({ messages, signal });
  }
}

export { PROVIDERS };
