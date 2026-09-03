import { fileURLToPath } from 'node:url';
import { normalizeModelSettings, publicModelSettings, PROVIDERS, validateModelSettings } from './config.mjs';
import { ModelProviderClient } from './providers.mjs';
import { EncryptedSecretStore } from './secret-store.mjs';
import { buildChatSystemPrompt, dialogueTemperature } from '../dialogue-prompts.mjs';
import { ErrorRecoveryService } from '../error-recovery.mjs';
import { AIPerformanceMonitor } from '../performance-monitor.mjs';
import { ContextCompressionService } from '../context-compression.mjs';

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

// Internal retrieval identifiers (source / source-id / selection) are for the model's own
// grounding only; users should never see them leak into the rendered answer text.
const INTERNAL_SOURCE_MARKER = /\[(?:source|source-id|selection)\b[^\]\n]*\]/gi;

function stripInternalSourceMarkers(text) {
  return String(text ?? '').replace(INTERNAL_SOURCE_MARKER, '');
}

// Streaming-safe stripper with smart buffering for code blocks and sentence boundaries
function createInlineMarkerSanitizer() {
  let buffer = '';
  let inCodeBlock = false;
  let codeBlockDelimiter = '';

  return {
    push(chunk) {
      buffer += String(chunk ?? '');

      // Track code block state
      const codeBlockMatches = buffer.match(/```\w*/g) || [];
      const codeBlockCount = codeBlockMatches.length;

      // If we just entered a code block, remember the delimiter
      if (codeBlockCount % 2 === 1 && !inCodeBlock) {
        inCodeBlock = true;
        codeBlockDelimiter = codeBlockMatches[codeBlockMatches.length - 1];
      } else if (codeBlockCount % 2 === 0 && inCodeBlock) {
        inCodeBlock = false;
        codeBlockDelimiter = '';
      }

      // Don't emit incomplete code blocks
      if (inCodeBlock && !buffer.endsWith('```')) {
        // Buffer until we have complete code block
        return '';
      }

      // Clean internal markers
      buffer = stripInternalSourceMarkers(buffer);

      // Check for unclosed citation brackets
      const open = buffer.lastIndexOf('[');
      if (open !== -1 && !buffer.slice(open).includes(']')) {
        // Hold back unclosed bracket
        const emit = buffer.slice(0, open);
        buffer = buffer.slice(open);
        return emit;
      }

      // For non-code content, try to break at sentence boundaries
      if (!inCodeBlock && buffer.length > 150) {
        const sentenceEnd = Math.max(
          buffer.lastIndexOf('。'),
          buffer.lastIndexOf('！'),
          buffer.lastIndexOf('？'),
          buffer.lastIndexOf('\n\n'),
          buffer.lastIndexOf('. '),
          buffer.lastIndexOf('! '),
          buffer.lastIndexOf('? ')
        );

        if (sentenceEnd > 100) {
          const emit = buffer.slice(0, sentenceEnd + 1);
          buffer = buffer.slice(sentenceEnd + 1);
          return emit;
        }
      }

      // Emit everything if code block is complete or buffer is reasonable
      if (!inCodeBlock || buffer.endsWith('```\n') || buffer.endsWith('```')) {
        const emit = buffer;
        buffer = '';
        return emit;
      }

      return '';
    },
    flush() {
      const emit = stripInternalSourceMarkers(buffer).replace(/\[(?:source|source-id|selection)\b[^\]]*$/i, '');
      buffer = '';
      inCodeBlock = false;
      codeBlockDelimiter = '';
      return emit;
    }
  };
}

// Sanitize evidence text to prevent prompt injection from untrusted knowledge base content
function sanitizeEvidenceText(text) {
  return String(text ?? '')
    // 移除常见的提示词注入模式
    .replace(/(?:ignore|忽略)\s*(?:previous|all|above)?\s*(?:instructions?|指令|prompts?|提示)/gi, '[已过滤指令]')
    .replace(/(?:system|系统)\s*(?:prompt|提示词?|message|消息)/gi, '[已过滤]')
    .replace(/(?:you are now|现在你是|你现在是)\s*(?:a|an)?\s*\w+/gi, '[已过滤角色指令]')
    .replace(/(?:forget|忘记|discard|丢弃)\s*(?:everything|所有|all)/gi, '[已过滤]')
    .replace(/(?:new|新的?)\s*(?:instructions?|指令|rules?|规则)/gi, '[已过滤]')
    // 保留原文，只标记可疑部分
    .trim();
}

export class ModelService {
  constructor({ store, env = process.env, fetchImpl = globalThis.fetch, secretFile = DEFAULT_SECRET_FILE, masterKeyFile = DEFAULT_MASTER_KEY_FILE, secretStore } = {}) {
    this.store = store;
    this.env = env;
    this.client = new ModelProviderClient({ fetchImpl });
    this.secrets = secretStore || new EncryptedSecretStore({ secretFile, keyFile: masterKeyFile, envKey: env.MODEL_API_KEY });
    this.ready = Promise.all([store.ready, this.secrets.ready]);

    // 初始化错误恢复、性能监控和上下文压缩服务
    this.errorRecovery = new ErrorRecoveryService();
    this.performanceMonitor = new AIPerformanceMonitor();
    this.contextCompression = new ContextCompressionService();
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
      fallbackToLocal: false,
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
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = 3;
    let forceCompress = false;
    let maxContextTokens = 100000;
    let timeoutOverride;
    let modelOverride;

    while (retryCount <= maxRetries) {
      try {
        const evidenceBlock = matches.map((entry, index) => {
          const citationNumber = index + 1;
          const sourceId = String(entry.sourceId || `source-${index + 1}`);
          const anchor = entry.anchor ? `\n锚点: ${entry.anchor}` : '';
          const safeTitle = sanitizeEvidenceText(entry.document.title);
          const safeExcerpt = sanitizeEvidenceText(entry.excerpt);

          return `证据 [${citationNumber}]
标题: ${safeTitle}
内容: ${safeExcerpt}${anchor}
URL: ${entry.document.url || 'local'}

【重要】引用这条证据时，必须在相关语句末尾写 [${citationNumber}]，不要写 [${sourceId}] 或其他标识。
内部标识 [${sourceId}] 仅供系统追踪，不可出现在回答中。`;
        }).join('\n\n---\n\n');

        const settings = this.settings();
        const baseSystem = buildChatSystemPrompt({
          userPrompt,
          memories,
          hasEvidence: Boolean(evidenceBlock)
        });
        const userContent = evidenceBlock ? `用户问题：${question}\n\n可用知识库证据：\n${evidenceBlock}` : String(question);

        let messages = [
          { role: 'system', content: baseSystem },
          ...history.slice(-20).filter((message) => ['user', 'assistant'].includes(message.role)).map((message) => ({ role: message.role, content: String(message.content || message.text || '') })),
          { role: 'user', content: userContent }
        ];

        const totalTokens = this.contextCompression.estimateTokens(JSON.stringify(messages));
        if (forceCompress || totalTokens > maxContextTokens) {
          const compressed = await this.contextCompression.compress(messages, {
            targetTokens: Math.max(2000, Math.floor(maxContextTokens * 0.7)),
            force: forceCompress
          });
          if (Array.isArray(compressed.compressed) && compressed.compressed.length) {
            messages = compressed.compressed;
          }
        }

        const sanitizer = createInlineMarkerSanitizer();
        let firstChunkTime = null;
        let totalChunks = 0;
        const generateSettings = {
          temperature: dialogueTemperature(settings, { mode: 'chat' }),
          ...(timeoutOverride ? { timeoutMs: timeoutOverride } : {}),
          ...(modelOverride ? { model: modelOverride } : {})
        };

        for await (const delta of this.streamGenerate({
          messages,
          signal,
          settings: generateSettings
        })) {
          if (firstChunkTime === null) {
            firstChunkTime = Date.now();
          }
          totalChunks++;
          const cleaned = sanitizer.push(delta);
          if (cleaned) yield cleaned;
        }

        const tail = sanitizer.flush();
        if (tail) yield tail;

        const duration = Date.now() - startTime;
        const ttfb = firstChunkTime ? firstChunkTime - startTime : duration;
        this.performanceMonitor.recordRequest({
          requestId,
          provider: settings.provider,
          model: modelOverride || settings.model,
          ttfb,
          duration,
          inputTokens: totalTokens,
          outputTokens: totalChunks * 10,
          success: true
        });

        return;

      } catch (error) {
        const settings = this.settings();
        const errorType = this.errorRecovery.classifyError(error);
        const context = {
          provider: settings.provider,
          model: modelOverride || settings.model,
          timeout: timeoutOverride || settings.timeoutMs,
          maxContextTokens,
          conversationLength: history.length,
          hasEvidence: matches.length > 0,
          fallbackModel: settings.fallbackModel || ''
        };

        const strategy = this.errorRecovery.selectStrategy(errorType, retryCount, context);
        this.performanceMonitor.recordRequest({
          requestId,
          provider: context.provider,
          model: context.model,
          ttfb: 0,
          duration: Date.now() - startTime,
          inputTokens: 0,
          outputTokens: 0,
          success: false,
          error: errorType
        });

        if (strategy.action === 'fail' || retryCount >= maxRetries) {
          throw error;
        }

        retryCount += 1;
        if (strategy.delay) {
          await new Promise(resolve => setTimeout(resolve, strategy.delay));
        }
        if (strategy.action === 'compress' || strategy.modify?.summarizeHistory) {
          forceCompress = true;
          if (Number(strategy.modify?.maxContextTokens) > 0) {
            maxContextTokens = Number(strategy.modify.maxContextTokens);
          }
        }
        if (Number(strategy.modify?.timeout) > 0) {
          timeoutOverride = Number(strategy.modify.timeout);
        }
        if (strategy.action === 'fallback') {
          if (!strategy.modify?.model) throw error;
          modelOverride = strategy.modify.model;
        }
      }
    }
  }
}

export { PROVIDERS, stripInternalSourceMarkers, createInlineMarkerSanitizer, INTERNAL_SOURCE_MARKER };
