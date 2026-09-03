import { normalizeModelSettings, validateModelSettings } from './config.mjs';

function buildUrl(base, path, replacements = {}) {
  let expanded = String(path || '');
  for (const [key, value] of Object.entries(replacements)) {
    const normalized = key === 'model' ? String(value || '').replace(/^models\//, '') : String(value || '');
    expanded = expanded.replaceAll(`{${key}}`, encodeURIComponent(normalized));
  }
  if (/^https?:\/\//i.test(expanded)) return expanded;
  return `${String(base || '').replace(/\/$/, '')}/${expanded.replace(/^\//, '')}`;
}

function headersFor(settings, apiKey) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream, application/x-ndjson',
    ...settings.extraHeaders
  };
  for (const [key, value] of Object.entries(headers)) {
    headers[key] = String(value).replaceAll('${API_KEY}', apiKey || '');
  }
  if (!apiKey || settings.authMode === 'none') return headers;
  if (settings.authMode === 'bearer') headers.Authorization = `Bearer ${apiKey}`;
  else if (settings.authMode === 'header') headers[settings.apiKeyHeader] = apiKey;
  return headers;
}

function withKeyQuery(target, settings, apiKey) {
  if (!apiKey || settings.authMode !== 'query') return target;
  const parsed = new URL(target);
  const queryName = settings.apiKeyHeader && settings.apiKeyHeader !== 'Authorization' ? settings.apiKeyHeader : 'key';
  parsed.searchParams.set(queryName, apiKey);
  return parsed.toString();
}

function requestBody(settings, messages, stream) {
  const system = messages.filter((item) => item.role === 'system').map((item) => item.content).join('\n\n');
  const nonSystem = messages.filter((item) => item.role !== 'system');
  if (settings.requestFormat === 'openai-responses' || settings.provider === 'openai-responses') {
    return {
      model: settings.model,
      instructions: system || undefined,
      input: nonSystem,
      stream,
      temperature: settings.temperature,
      max_output_tokens: settings.maxTokens
    };
  }
  if (settings.requestFormat === 'anthropic' || settings.provider === 'anthropic') {
    return {
      model: settings.model,
      system: system || undefined,
      messages: nonSystem,
      stream,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens
    };
  }
  if (settings.requestFormat === 'gemini' || settings.provider === 'gemini') {
    return {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: nonSystem.map((item) => ({
        role: item.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: item.content }]
      })),
      generationConfig: { temperature: settings.temperature, maxOutputTokens: settings.maxTokens }
    };
  }
  if (settings.requestFormat === 'ollama' || settings.provider === 'ollama') {
    return {
      model: settings.model,
      messages,
      stream,
      options: { temperature: settings.temperature, num_predict: settings.maxTokens }
    };
  }
  return {
    model: settings.model,
    messages,
    stream,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens
  };
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((item) => {
    if (typeof item === 'string') return item;
    return item?.text || item?.content || item?.value || '';
  }).join('');
}

export function extractModelText(payload) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.delta === 'string') return payload.delta;
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.response === 'string') return payload.response;
  if (typeof payload.output_text === 'string') return payload.output_text;
  if (typeof payload.completion === 'string') return payload.completion;
  const choice = payload.choices?.[0];
  const choiceDelta = textFromContent(choice?.delta?.content);
  if (choiceDelta) return choiceDelta;
  const choiceMessage = textFromContent(choice?.message?.content);
  if (choiceMessage) return choiceMessage;
  if (typeof payload.delta?.text === 'string') return payload.delta.text;
  if (typeof payload.content_block?.text === 'string') return payload.content_block.text;
  const message = textFromContent(payload.message?.content);
  if (message) return message;
  const content = textFromContent(payload.content);
  if (content) return content;
  const gemini = payload.candidates?.[0]?.content?.parts;
  if (Array.isArray(gemini)) return gemini.map((item) => item?.text || '').join('');
  if (Array.isArray(payload.output)) {
    return payload.output.flatMap((item) => item?.content || []).map((item) => item?.text || item?.value || '').join('');
  }
  if (payload.data && typeof payload.data === 'object') return extractModelText(payload.data);
  return '';
}

async function* decodedChunks(response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}

async function* parseSse(response) {
  let buffer = '';
  for await (const chunk of decodedChunks(response)) {
    buffer += chunk;
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    for (const event of events) {
      const data = event.split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
        .trim();
      if (!data || data === '[DONE]') continue;
      try {
        const text = extractModelText(JSON.parse(data));
        if (text) yield text;
      } catch { /* heartbeat or non-JSON event */ }
    }
  }
  const data = buffer.split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
  if (data && data !== '[DONE]') {
    try { const text = extractModelText(JSON.parse(data)); if (text) yield text; } catch { /* ignore */ }
  }
}

async function* parseNdjson(response) {
  let buffer = '';
  for await (const chunk of decodedChunks(response)) {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith(':') || line.startsWith('event:')) continue;
      if (line.startsWith('data:')) line = line.slice(5).trim();
      if (!line || line === '[DONE]') continue;
      try { const text = extractModelText(JSON.parse(line)); if (text) yield text; } catch { /* ignore */ }
    }
  }
  let tail = buffer.trim();
  if (tail.startsWith('data:')) tail = tail.slice(5).trim();
  if (tail && tail !== '[DONE]') {
    try { const text = extractModelText(JSON.parse(tail)); if (text) yield text; } catch { /* ignore */ }
  }
}

async function* parseResponse(response, responseFormat) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const format = responseFormat === 'auto'
    ? (contentType.includes('text/event-stream') ? 'sse' : contentType.includes('ndjson') || contentType.includes('stream') ? 'ndjson' : 'json')
    : responseFormat;
  if (format === 'sse') return yield* parseSse(response);
  if (format === 'ndjson') return yield* parseNdjson(response);
  const payload = await response.json();
  const text = extractModelText(payload);
  if (text) yield text;
}

function normalizeModelList(payload, provider) {
  const values = Array.isArray(payload) ? payload : payload?.data || payload?.models || payload?.items || [];
  return values.map((item) => {
    if (typeof item === 'string') return { id: item, name: item };
    let id = item?.id || item?.model || item?.name;
    if (provider === 'gemini' && typeof id === 'string') id = id.replace(/^models\//, '');
    const name = item?.displayName || item?.display_name || item?.name || item?.id || item?.model || id;
    return { id, name, ownedBy: item?.owned_by || item?.publisher || undefined };
  }).filter((item) => item.id);
}

function humanUpstreamMessage(status) {
  if (status === 401 || status === 403) return '模型密钥无效或没有权限，请到设置里检查接口配置';
  if (status === 404) return '找不到指定的模型，请到设置里核对模型名称';
  if (status === 408) return '模型响应超时，请稍后重试';
  if (status === 409) return '模型请求冲突，请稍后重试';
  if (status === 429) return '提问太频繁，请稍等一会儿再试';
  if (status >= 500) return '模型暂时连不上，请稍后重试';
  if (status >= 400) return '模型请求没有被接受，请检查设置后重试';
  return '模型暂时不可用，请稍后重试';
}

async function responseError(response, apiKey) {
  let text = await response.text().catch(() => '');
  if (apiKey) text = text.replaceAll(apiKey, '[REDACTED]');
  const error = new Error(humanUpstreamMessage(response.status));
  error.code = 'MODEL_UPSTREAM_ERROR';
  error.status = response.status;
  error.retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
  error.upstreamBody = String(text || '').slice(0, 500);
  return error;
}

function retryableError(error) {
  return error?.retryable === true || error?.name === 'TypeError' || error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT';
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => { clearTimeout(timer); reject(signal?.reason || Object.assign(new Error('请求已取消'), { name: 'AbortError' })); };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export class ModelProviderClient {
  constructor({ fetchImpl = globalThis.fetch } = {}) { this.fetch = fetchImpl; }

  async listModels(rawSettings, apiKey = '') {
    const settings = validateModelSettings(normalizeModelSettings(rawSettings));
    if (settings.provider === 'local') return [{ id: 'local-retrieval', name: 'Local deterministic retrieval' }];
    if (settings.provider === 'azure-openai' || !settings.modelsPath) {
      return settings.model ? [{ id: settings.model, name: settings.model }] : [];
    }
    let target = withKeyQuery(buildUrl(settings.baseUrl, settings.modelsPath, { model: settings.model }), settings, apiKey);
    let lastError;
    for (let attempt = 0; attempt <= settings.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
      try {
        const response = await this.fetch(target, { headers: headersFor(settings, apiKey), signal: controller.signal });
        if (!response.ok) throw await responseError(response, apiKey);
        const models = normalizeModelList(await response.json(), settings.provider);
        if (settings.model && !models.some((item) => item.id === settings.model)) models.unshift({ id: settings.model, name: settings.model });
        return models;
      } catch (error) {
        lastError = error.name === 'AbortError'
          ? Object.assign(new Error('模型列表请求超时'), { code: 'MODEL_REQUEST_ABORTED', retryable: true })
          : error;
        if (attempt >= settings.retries || !retryableError(lastError)) throw lastError;
        await sleep(settings.retryDelayMs * (2 ** attempt));
      } finally { clearTimeout(timer); }
    }
    throw lastError;
  }

  async *streamChat(rawSettings, apiKey, messages, { signal } = {}) {
    const settings = validateModelSettings(normalizeModelSettings(rawSettings), { requireModel: true });
    let target = buildUrl(settings.baseUrl, settings.chatPath, { model: settings.model });
    if (settings.provider === 'azure-openai') {
      const parsed = new URL(target);
      parsed.searchParams.set('api-version', settings.apiVersion);
      target = parsed.toString();
    }
    if (settings.provider === 'gemini') {
      const parsed = new URL(target);
      parsed.searchParams.set('alt', 'sse');
      target = parsed.toString();
    }
    target = withKeyQuery(target, settings, apiKey);
    let lastError;
    for (let attempt = 0; attempt <= settings.retries; attempt += 1) {
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
      let emitted = false;
      try {
        const response = await this.fetch(target, {
          method: 'POST',
          headers: {
            ...headersFor(settings, apiKey),
            ...(settings.provider === 'anthropic' ? { 'anthropic-version': settings.apiVersion } : {})
          },
          body: JSON.stringify(requestBody(settings, messages, true)),
          signal: controller.signal
        });
        if (!response.ok) throw await responseError(response, apiKey);
        for await (const text of parseResponse(response, settings.responseFormat)) {
          emitted = true;
          yield text;
        }
        return;
      } catch (error) {
        if (signal?.aborted) throw Object.assign(new Error('模型请求已取消'), { code: 'MODEL_REQUEST_ABORTED' });
        lastError = error.name === 'AbortError'
          ? Object.assign(new Error('模型请求超时'), { code: 'MODEL_REQUEST_ABORTED', retryable: true })
          : error;
        if (emitted || attempt >= settings.retries || !retryableError(lastError)) throw lastError;
        await sleep(settings.retryDelayMs * (2 ** attempt), signal);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    }
    throw lastError;
  }
}