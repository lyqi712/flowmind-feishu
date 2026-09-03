const PROVIDER_ALIASES = {
  'openai-compatible': 'openai-chat', openai: 'openai-chat', chat: 'openai-chat',
  responses: 'openai-responses', anthropic: 'anthropic', gemini: 'gemini', ollama: 'ollama', azure: 'azure-openai', custom: 'custom-http', local: 'local'
};

export const PROVIDERS = Object.freeze([
  { id: 'openai-chat', name: 'OpenAI Compatible · Chat Completions', defaultBaseUrl: 'https://api.openai.com/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'openai-responses', name: 'OpenAI Compatible · Responses', defaultBaseUrl: 'https://api.openai.com/v1', modelsPath: '/models', chatPath: '/responses' },
  { id: 'anthropic', name: 'Anthropic Messages', defaultBaseUrl: 'https://api.anthropic.com/v1', modelsPath: '/models', chatPath: '/messages' },
  { id: 'gemini', name: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', modelsPath: '/models', chatPath: '/models/{model}:streamGenerateContent' },
  { id: 'ollama', name: 'Ollama', defaultBaseUrl: 'http://127.0.0.1:11434', modelsPath: '/api/tags', chatPath: '/api/chat' },
  { id: 'azure-openai', name: 'Azure OpenAI', defaultBaseUrl: '', modelsPath: '', chatPath: '/openai/deployments/{model}/chat/completions' },
  { id: 'custom-http', name: 'Custom HTTP/SSE/NDJSON', defaultBaseUrl: '', modelsPath: '/v1/models', chatPath: '/v1/chat/completions' },
  { id: 'local', name: 'Local deterministic retrieval', defaultBaseUrl: '', modelsPath: '', chatPath: '' }
]);

export function normalizeProvider(value) {
  const normalized = String(value || 'local').trim().toLowerCase();
  return PROVIDER_ALIASES[normalized] || (PROVIDERS.some((item) => item.id === normalized) ? normalized : 'openai-chat');
}

function number(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function boolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') return !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
  return Boolean(value);
}

export function normalizeModelSettings(input = {}, env = {}) {
  const provider = normalizeProvider(input.provider || env.MODEL_PROVIDER || (env.MODEL_BASE_URL ? 'openai-chat' : 'local'));
  const definition = PROVIDERS.find((item) => item.id === provider);
  let extraHeaders = input.extraHeaders || {};
  if (typeof extraHeaders === 'string') {
    try { extraHeaders = JSON.parse(extraHeaders); } catch { extraHeaders = {}; }
  }
  return {
    provider,
    baseUrl: String(input.baseUrl ?? env.MODEL_BASE_URL ?? definition.defaultBaseUrl ?? '').trim().replace(/\/$/, ''),
    model: String(input.model ?? env.MODEL_DEFAULT ?? '').trim(),
    timeoutMs: number(input.timeoutMs ?? env.MODEL_TIMEOUT_MS, 120000, 5000, 600000),
    temperature: number(input.temperature, 0.4, 0, 2),
    maxTokens: number(input.maxTokens, 4096, 128, 131072),
    fallbackToLocal: false,
    retries: number(input.retries ?? env.MODEL_RETRIES, 2, 0, 5),
    retryDelayMs: number(input.retryDelayMs ?? env.MODEL_RETRY_DELAY_MS, 500, 100, 10000),
    apiVersion: String(input.apiVersion || '2024-10-21').trim(),
    modelsPath: String(input.modelsPath || definition.modelsPath || '').trim(),
    chatPath: String(input.chatPath || definition.chatPath || '').trim(),
    authMode: String(input.authMode || (provider === 'anthropic' || provider === 'azure-openai' ? 'header' : provider === 'gemini' ? 'query' : provider === 'ollama' || provider === 'local' ? 'none' : 'bearer')),
    apiKeyHeader: String(input.apiKeyHeader || (provider === 'anthropic' ? 'x-api-key' : provider === 'azure-openai' ? 'api-key' : 'Authorization')),
    requestFormat: String(input.requestFormat || (provider === 'custom-http' ? 'openai' : provider)),
    responseFormat: String(input.responseFormat || 'auto'),
    extraHeaders: Object.fromEntries(Object.entries(extraHeaders).filter(([key, value]) => /^[A-Za-z0-9-]+$/.test(key) && typeof value === 'string'))
  };
}

export function validateModelSettings(settings, { requireModel = false } = {}) {
  if (settings.provider === 'local') return settings;
  if (!settings.baseUrl) throw Object.assign(new Error('模型 Base URL 不能为空'), { code: 'MODEL_BASE_URL_MISSING' });
  let parsed;
  try { parsed = new URL(settings.baseUrl); } catch {
    throw Object.assign(new Error('模型 Base URL 不是有效 URL'), { code: 'MODEL_BASE_URL_INVALID' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('模型 Base URL 仅支持 HTTP/HTTPS'), { code: 'MODEL_BASE_URL_PROTOCOL_UNSUPPORTED' });
  }
  if (requireModel && !settings.model) throw Object.assign(new Error('尚未选择模型'), { code: 'MODEL_NOT_SELECTED' });
  if (!['bearer', 'header', 'query', 'none'].includes(settings.authMode)) {
    throw Object.assign(new Error(`不支持的鉴权方式: ${settings.authMode}`), { code: 'MODEL_AUTH_MODE_UNSUPPORTED' });
  }
  if (!['auto', 'sse', 'ndjson', 'json'].includes(settings.responseFormat)) {
    throw Object.assign(new Error(`不支持的响应格式: ${settings.responseFormat}`), { code: 'MODEL_RESPONSE_FORMAT_UNSUPPORTED' });
  }
  return settings;
}

export function publicModelSettings(settings, apiKeyConfigured = false) {
  return { ...settings, apiKeyConfigured, apiKey: undefined, providerOptions: PROVIDERS };
}
