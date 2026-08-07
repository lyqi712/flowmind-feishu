import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';

async function harness(fetchImpl) {
  const root = await mkdtemp(join(tmpdir(), 'ima-model-'));
  const stateFile = join(root, 'state.json');
  const app = await createInitializedApp({
    stateFile,
    env: {},
    fetchImpl,
    modelOptions: { secretFile: join(root, 'secret.enc'), masterKeyFile: join(root, 'master.key') }
  });
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  return { root, stateFile, base: `http://127.0.0.1:${server.address().port}`, close: async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); } };
}

async function json(base, path, method = 'GET', body) {
  return fetch(`${base}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
}

test('模型设置保存非敏感字段，API Key 仅进入加密密钥文件', async () => {
  const h = await harness(async () => Response.json({ data: [] }));
  try {
    const response = await json(h.base, '/api/settings/model', 'PUT', { provider: 'openai-chat', baseUrl: 'https://relay.example/v1', model: 'model-a', apiKey: 'secret-key-for-test' });
    assert.equal(response.status, 200);
    const settings = (await response.json()).settings;
    assert.equal(settings.apiKeyConfigured, true);
    assert.equal(settings.apiKey, undefined);
    const stateRaw = await readFile(h.stateFile, 'utf8');
    assert.doesNotMatch(stateRaw, /secret-key-for-test/);
    const secretRaw = await readFile(join(h.root, 'secret.enc'), 'utf8');
    assert.doesNotMatch(secretRaw, /secret-key-for-test/);
  } finally { await h.close(); }
});

test('OpenAI Compatible 模型列表和 SSE 聊天可通过统一接口工作', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), authorization: options.headers?.Authorization, body: options.body });
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'relay-model' }] });
    const stream = new ReadableStream({ start(controller) { const encoder = new TextEncoder(); controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"引用"}}]}\n\n')); controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"回答"}}]}\n\n')); controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); } });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  };
  const h = await harness(fetchImpl);
  try {
    await json(h.base, '/api/settings/model', 'PUT', { provider: 'openai-chat', baseUrl: 'https://relay.example/v1', model: 'relay-model', apiKey: 'relay-secret' });
    const models = await (await json(h.base, '/api/models')).json();
    assert.deepEqual(models.models.map((item) => item.id), ['relay-model']);
    await json(h.base, '/api/sync', 'POST', { source: 'mock' });
    const chat = await json(h.base, '/api/chat/stream', 'POST', { query: '如何保证引用？' });
    const text = await chat.text();
    assert.match(text, /"type":"delta"/);
    assert.match(text, /引用回答/);
    assert.ok(calls.every((call) => call.authorization === 'Bearer relay-secret'));
  } finally { await h.close(); }
});

test('支持 Anthropic、Gemini、Ollama、Azure 和 Custom Provider 配置归一化', async () => {
  const h = await harness(async () => Response.json({ data: [] }));
  try {
    for (const provider of ['anthropic', 'gemini', 'ollama', 'azure-openai', 'custom-http']) {
      const response = await json(h.base, '/api/settings/model', 'PUT', { provider, baseUrl: 'https://provider.example', model: 'm', apiKey: 'k' });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).settings.provider, provider);
    }
  } finally { await h.close(); }
});

test('清除 API Key 后密钥状态可恢复为空且不会触发解密错误', async () => {
  const h = await harness(async () => Response.json({ data: [] }));
  try {
    await json(h.base, '/api/settings/model', 'PUT', { provider: 'openai-chat', baseUrl: 'https://relay.example/v1', model: 'm', apiKey: 'clear-me' });
    const cleared = await json(h.base, '/api/settings/model', 'PUT', { clearApiKey: true });
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).settings.apiKeyConfigured, false);
    const settings = await (await json(h.base, '/api/settings/model')).json();
    assert.equal(settings.apiKeyConfigured, false);
  } finally { await h.close(); }
});

test('Gemini 模型名、Query Key 和 SSE 文本可正确归一化', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body });
    if (String(url).includes('/models?')) return Response.json({ models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' }] });
    const stream = new ReadableStream({ start(controller) { const encoder = new TextEncoder(); controller.enqueue(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"Gemini OK"}]}}]}\n\n')); controller.close(); } });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  };
  const h = await harness(fetchImpl);
  try {
    await json(h.base, '/api/settings/model', 'PUT', { provider: 'gemini', baseUrl: 'https://gemini.example/v1beta', model: 'gemini-2.5-pro', apiKey: 'gemini-key', retries: 0 });
    const listed = await (await json(h.base, '/api/models')).json();
    assert.deepEqual(listed.models.map((item) => item.id), ['gemini-2.5-pro']);
    const tested = await json(h.base, '/api/models/test', 'POST', { chatProbe: true });
    assert.equal(tested.status, 200);
    assert.match((await tested.json()).sample, /Gemini OK/);
    const chatCall = calls.find((call) => call.url.includes(':streamGenerateContent'));
    assert.match(chatCall.url, /\/models\/gemini-2\.5-pro:streamGenerateContent/);
    assert.match(chatCall.url, /[?&]alt=sse/);
    assert.match(chatCall.url, /[?&]key=gemini-key/);
  } finally { await h.close(); }
});

test('Anthropic、Ollama、OpenAI Responses 与自定义 JSON 响应均能提取文本', async () => {
  const scenarios = [
    {
      provider: 'anthropic', authMode: 'header', apiKeyHeader: 'x-api-key', requestFormat: 'anthropic', responseFormat: 'sse',
      expected: 'Anthropic OK', contentType: 'text/event-stream', body: 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Anthropic OK"}}\n\n'
    },
    {
      provider: 'ollama', authMode: 'none', requestFormat: 'ollama', responseFormat: 'ndjson', apiKey: '',
      expected: 'Ollama OK', contentType: 'application/x-ndjson', body: '{"message":{"content":"Ollama OK"},"done":false}\n'
    },
    {
      provider: 'openai-responses', requestFormat: 'openai-responses', responseFormat: 'sse',
      expected: 'Responses OK', contentType: 'text/event-stream', body: 'data: {"type":"response.output_text.delta","delta":"Responses OK"}\n\n'
    },
    {
      provider: 'custom-http', requestFormat: 'openai', responseFormat: 'json',
      expected: 'Custom OK', contentType: 'application/json', body: JSON.stringify({ data: { text: 'Custom OK' } })
    }
  ];
  for (const scenario of scenarios) {
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'm' }] });
      return new Response(scenario.body, { headers: { 'content-type': scenario.contentType } });
    };
    const h = await harness(fetchImpl);
    try {
      await json(h.base, '/api/settings/model', 'PUT', {
        provider: scenario.provider, baseUrl: 'https://provider.example/v1', model: 'm', apiKey: scenario.apiKey ?? 'k',
        authMode: scenario.authMode, apiKeyHeader: scenario.apiKeyHeader, requestFormat: scenario.requestFormat,
        responseFormat: scenario.responseFormat, modelsPath: '/models', chatPath: '/chat', retries: 0
      });
      const tested = await json(h.base, '/api/models/test', 'POST', {});
      assert.equal(tested.status, 200, scenario.provider);
      assert.match((await tested.json()).sample, new RegExp(scenario.expected), scenario.provider);
    } finally { await h.close(); }
  }
});

test('限流响应会按配置重试，成功后不重复输出', async () => {
  let chatCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'm' }] });
    chatCalls += 1;
    if (chatCalls === 1) return Response.json({ error: { message: 'rate limited' } }, { status: 429 });
    return new Response('data: {"choices":[{"delta":{"content":"retry-ok"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const h = await harness(fetchImpl);
  try {
    await json(h.base, '/api/settings/model', 'PUT', { provider: 'openai-chat', baseUrl: 'https://relay.example/v1', model: 'm', apiKey: 'k', retries: 1, retryDelayMs: 100 });
    const tested = await json(h.base, '/api/models/test', 'POST', {});
    assert.equal(tested.status, 200);
    assert.equal((await tested.json()).sample, 'retry-ok');
    assert.equal(chatCalls, 2);
  } finally { await h.close(); }
});

test('Skill 使用当前模型生成产物并把模型与回退信息写入运行记录', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'skill-model' }] });
    return new Response('data: {"choices":[{"delta":{"content":"# 模型总结\\n\\n- 结论 [1]"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const h = await harness(fetchImpl);
  try {
    await json(h.base, '/api/settings/model', 'PUT', { provider: 'openai-chat', baseUrl: 'https://relay.example/v1', model: 'skill-model', apiKey: 'k', retries: 0 });
    await json(h.base, '/api/sync', 'POST', { source: 'mock' });
    const response = await json(h.base, '/api/skills/run', 'POST', { skillId: 'summary', query: '连接器安全' });
    const events = (await response.text()).trim().split('\n').map(JSON.parse);
    assert.ok(events.some((event) => event.type === 'model' && event.model === 'skill-model'));
    assert.ok(events.some((event) => event.type === 'model-delta'));
    const done = events.find((event) => event.type === 'done');
    assert.match(done.result.artifact.content, /模型总结/);
    assert.deepEqual(done.result.model, { provider: 'openai-chat', id: 'skill-model' });
    const runs = await (await json(h.base, '/api/skills/runs')).json();
    assert.deepEqual(runs.runs[0].model, { provider: 'openai-chat', id: 'skill-model' });
    assert.equal(runs.runs[0].fallbackUsed, false);
  } finally { await h.close(); }
});
test('普通寒暄在没有检索命中时仍调用真实模型，而不是返回固定检索模板', async () => {
  let chatBody = null;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'natural-model' }] });
    chatBody = JSON.parse(options.body);
    return new Response('data: {"choices":[{"delta":{"content":"你好！我可以直接和你对话。"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const h = await harness(fetchImpl);
  try {
    await json(h.base, '/api/settings/model', 'PUT', { provider: 'openai-chat', baseUrl: 'https://relay.example/v1', model: 'natural-model', apiKey: 'relay-secret' });
    await json(h.base, '/api/sync', 'POST', { source: 'mock' });
    const events = (await (await json(h.base, '/api/chat/stream', 'POST', { query: '你好' })).text()).trim().split('\n').map(JSON.parse);
    const retrieval = events.find(event => event.type === 'retrieval');
    const done = events.find(event => event.type === 'done');
    assert.equal(retrieval.mode, 'conversation');
    assert.equal(retrieval.matchCount, 0);
    assert.equal(done.answer, '你好！我可以直接和你对话。');
    assert.deepEqual(done.citations, []);
    assert.equal(done.relations, null);
    assert.equal(chatBody.messages.at(-1).content, '你好');
    assert.match(chatBody.messages[0].content, /对话型知识工作助手/);
    assert.doesNotMatch(chatBody.messages[0].content, /只能根据给出的知识库证据/);
    assert.equal((await (await json(h.base, '/api/copilots')).json()).copilots[0].systemPrompt, undefined);
  } finally { await h.close(); }
});

test('普通协作请求默认直达模型，明确要求资料时才检索', async () => {
  let calls = 0;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'routing-model' }] });
    calls += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.messages.at(-1).content.includes('发布计划') || body.messages.at(-1).content.includes('连接器安全'), true);
    return new Response('data: {"choices":[{"delta":{"content":"模型已生成结果"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const h = await harness(fetchImpl);
  try {
    await json(h.base, '/api/settings/model', 'PUT', { provider: 'openai-chat', baseUrl: 'https://relay.example/v1', model: 'routing-model', apiKey: 'relay-secret' });
    await json(h.base, '/api/sync', 'POST', { source: 'mock' });
    const ordinary = (await (await json(h.base, '/api/chat/stream', 'POST', { query: '请帮我拟定下周发布计划' })).text()).trim().split('\n').map(JSON.parse);
    assert.equal(ordinary.find(event => event.type === 'retrieval').mode, 'conversation');
    assert.equal(ordinary.find(event => event.type === 'done').citations.length, 0);
    const evidence = (await (await json(h.base, '/api/chat/stream', 'POST', { query: '请根据飞书资料总结连接器安全' })).text()).trim().split('\n').map(JSON.parse);
    assert.equal(evidence.find(event => event.type === 'retrieval').mode, 'knowledge');
    assert.ok(calls >= 2);
  } finally { await h.close(); }
});

test('selected chat scope reports the selected source and rejects stale document IDs', async () => {
  const h = await harness(async () => Response.json({ data: [] }));
  try {
    const sync = await json(h.base, '/api/sync', 'POST', { source: 'mock' });
    assert.equal(sync.status, 200);
    const documents = await (await json(h.base, '/api/documents')).json();
    const selected = documents.documents[0];
    const scoped = await json(h.base, '/api/chat/stream', 'POST', { query: '请根据已选资料回答', documentIds: [selected.id] });
    const scopedEvents = (await scoped.text()).trim().split('\n').filter(Boolean).map(JSON.parse);
    const retrieval = scopedEvents.find(event => event.type === 'retrieval');
    assert.deepEqual(retrieval.scope.documentIds, [selected.id]);
    assert.equal(retrieval.scope.documents[0].title, selected.title);
    assert.ok(retrieval.citations.every(citation => citation.documentId === selected.id));

    const stale = await json(h.base, '/api/chat/stream', 'POST', { query: '请根据已选资料回答', documentIds: ['missing-document'] });
    const staleEvents = (await stale.text()).trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(staleEvents.find(event => event.type === 'error')?.error?.code, 'KNOWLEDGE_DOCUMENT_SCOPE_UNAVAILABLE');
  } finally { await h.close(); }
});

test('selected full document scope gives the model bounded full-document evidence instead of a short retrieval snippet', async () => {
  let modelBody = null;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'scope-model' }] });
    modelBody = JSON.parse(options.body);
    return new Response('data: {"choices":[{"delta":{"content":"已根据已选资料回答"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const h = await harness(fetchImpl);
  try {
    await json(h.base, '/api/settings/model', 'PUT', { provider: 'openai-chat', baseUrl: 'https://relay.example/v1', model: 'scope-model', apiKey: 'relay-secret', retries: 0 });
    const marker = '中段唯一事实：这份资料已经完整导入本地知识库。';
    const content = `# 长资料\n\n${'背景资料。'.repeat(1800)}\n\n${marker}\n\n${'收尾资料。'.repeat(300)}`;
    const imported = await json(h.base, '/api/content/import', 'POST', { items: [{ fileName: 'full-scope.md', content }] });
    const importedBody = await imported.json();
    assert.equal(imported.status, 201);
    const documentId = importedBody.items[0].item.id;
    const response = await json(h.base, '/api/chat/stream', 'POST', { query: '这份资料是否已经完整导入？', documentIds: [documentId] });
    const events = (await response.text()).trim().split('\n').filter(Boolean).map(JSON.parse);
    const retrieval = events.find(event => event.type === 'retrieval');
    assert.equal(retrieval.scopeContext.selectedDocuments[0].totalChars, content.length);
    assert.equal(retrieval.scopeContext.selectedDocuments[0].truncated, true);
    assert.ok(retrieval.scopeContext.selectedDocuments[0].includedChars < content.length);
    assert.match(modelBody.messages[0].content, /相关片段/);
    assert.match(modelBody.messages[0].content, /完整正文已保存在本地知识库/);
    assert.match(modelBody.messages.at(-1).content, new RegExp(marker));
  } finally { await h.close(); }
});

test('模型上游失败会发送可见 error 事件，不再静默回退固定答案', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'broken-model' }] });
    return Response.json({ error: { message: 'upstream unavailable' } }, { status: 503 });
  };
  const h = await harness(fetchImpl);
  try {
    await json(h.base, '/api/settings/model', 'PUT', { provider: 'openai-chat', baseUrl: 'https://relay.example/v1', model: 'broken-model', apiKey: 'relay-secret' });
    const events = (await (await json(h.base, '/api/chat/stream', 'POST', { query: '你好' })).text()).trim().split('\n').map(JSON.parse);
    assert.ok(events.some(event => event.type === 'error'));
    assert.equal(events.some(event => event.type === 'done'), false);
    assert.equal(events.some(event => event.type === 'model-fallback'), false);
  } finally { await h.close(); }
});
