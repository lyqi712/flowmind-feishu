import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { flushSync } from 'react-dom';
import { createDocumentAiRequestController } from '../src/workspace/document-ai-request.js';

function assistantHarness() {
  const { env, source } = workspaceHarness('Notes');
  const result = deferred();
  let onEvent;
  Object.assign(env, {
    assistantQuery: 'question', assistantBusy: false, assistantThread: [],
    assistantAbortRef: { current: null },
    assistantRequestRef: { current: createDocumentAiRequestController() },
    setAssistantQuery() {}, setAssistantBusy(value) { env.assistantBusy = value; },
    setAssistantThread(update) { env.assistantThread = update(env.assistantThread); },
    fetch: async () => ({}),
    readNoteAssistantStream: async (_response, options) => { onEvent = options.onEvent; return result.promise; },
    createStreamEventBatcher: ({ onFlush }) => ({ push: event => onFlush([event]), flush() {} }),
    isProblemNote: () => true,
    parseQaNote: () => ({ question: 'question' }),
    normalizePageAskSelection: (_page, selection) => selection || null,
    currentWritingSnapshot: () => ({ scope: '全文', original: env.draft.content, range: { start: 0, end: String(env.draft.content || '').length } }),
    applyAssistantAnswerToProblemNote: ({ content, answer }) => `${content}\n${answer}`,
    mergeAppliedFields: (_old, fields) => fields,
    update(patch, snapshot = null) {
      const current = env.draft;
      if (snapshot && (!snapshot.requestController.isCurrent(snapshot.requestToken, current.id)
        || current.content !== snapshot.baseContent)) return { accepted: false, applied: false };
      const resolved = typeof patch === 'function' ? patch(current) : patch;
      env.draft = { ...current, ...resolved };
      env.draftRef.current = env.draft;
      return { accepted: true, applied: true };
    }
  });
  const methods = source.slice(source.indexOf('  async function askAssistant('), source.indexOf('  function updateQaField('));
  const handlers = new Function('env', `with (env) { ${methods}; return { askAssistant, writeAssistantIntoNote }; }`)(env);
  return { env, result, handlers, event: event => onEvent(event) };
}

for (const scenario of ['switch', 'close', 'edit']) {
  test(`Notes assistant: ${scenario} prevents stale automatic writeback`, async () => {
    const { env, result, handlers, event } = assistantHarness();
    const pending = handlers.askAssistant();
    await Promise.resolve();
    if (scenario === 'switch') {
      env.draft = { ...env.draft, id: 'b' };
      env.draftRef.current = env.draft;
    } else if (scenario === 'close') env.assistantRequestRef.current.invalidate();
    else env.draft.content = 'new user edit';
    const preserved = env.draft.content;
    event({ type: 'delta', delta: 'late chunk' });
    result.resolve('late answer');
    await pending;
    assert.equal(env.draft.content, preserved);
    if (scenario !== 'edit') assert.equal(env.assistantThread.at(-1).text, '');
    const explicitResult = handlers.writeAssistantIntoNote({ documentId: 'foreign', text: 'bad' });
    assert.equal(explicitResult.accepted, false);
    assert.equal(env.draft.content, preserved);
  });
}

test('Notes assistant: current unedited note receives the answer and preserves existing text', async () => {
  const { env, result, handlers } = assistantHarness();
  const pending = handlers.askAssistant();
  await Promise.resolve();
  result.resolve('answer');
  await pending;
  assert.equal(env.draft.content, 'same text\nanswer');
  assert.equal(env.assistantThread.at(-1).done, true);
  assert.equal(env.assistantBusy, false);
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function workspaceHarness(name) {
  const source = readFileSync(new URL(`../src/components/${name}Workspace.jsx`, import.meta.url), 'utf8');
  // Execute the actual component handlers, not a second implementation of the guards.
  const functionSource = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const requests = [];
  const frames = [];
  const controller = createDocumentAiRequestController();
  const env = {
    draft: { id: 'a', content: 'same text', sourceRefs: [] },
    draftRef: { current: null },
    aiWriter: { tone: 'professional' },
    aiRequestRef: { current: controller },
    attachmentBusyRef: { current: false },
    editorRef: { current: null },
    NOTES_AI_TONES: ['professional'], WRITING_AI_TONES: ['professional'],
    initialNotesAiWriter: () => ({ open: false }), initialWritingAssistant: () => ({ open: false }),
    currentWritingSnapshot: () => ({ original: env.draft.content, baseContent: env.draft.content, range: { start: 0, end: 9 } }),
    buildNotesAiWritingPrompt: () => 'prompt', buildWritingAiPrompt: () => 'prompt',
    jsonOptions: () => ({ method: 'POST' }),
    setAiWriter: updater => { env.aiWriter = typeof updater === 'function' ? updater(env.aiWriter) : updater; },
    setDraft: updater => {
      const prev = env.draft;
      env.draft = typeof updater === 'function' ? updater(env.draft) : updater;
      env.draftRef.current = env.draft;
    },
    flushSync: callback => callback(),
    applyPageAiResult: ({ result }) => ({ content: result, selection: { start: 0, end: String(result || '').length } }),
    normalizePageAiResult: value => String(value || '').trim(),
    setDirty() {}, setSaveError() {}, setEditorSelection() {}, setBodyFocused() {}, onToast() {},
    mergeNoteSourceRefs: (refs) => refs, mergeWritingSourceRefs: (refs) => refs,
    applyNotesAiWritingResult: ({ result }) => ({ content: result, selection: { start: 0, end: result.length } }),
    applyWritingAiResult: ({ result }) => ({ content: result, selection: { start: 0, end: result.length } }),
    ownsAiRequest(token) {
      return env.aiRequestRef.current.isCurrent(token, env.draftRef.current?.id);
    },
    update(patch, aiSnapshot = null) {
      const documentId = env.draftRef.current?.id;
      const result = { accepted: false, applied: false };
      flushSync(() => env.setDraft(current => {
        result.accepted = result.applied = false;
        if (!current || current.id !== documentId) return current;
        const requestController = aiSnapshot?.requestController || env.aiRequestRef.current;
        if (aiSnapshot && (!requestController.isCurrent(aiSnapshot.requestToken, current?.id)
          || String(current?.content || '') !== aiSnapshot.baseContent)) return current;
        result.accepted = result.applied = true;
        return { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
      }));
      return result;
    },
    requestAnimationFrame: fn => frames.push(fn),
    fetch: async (_url, options) => {
      const pending = deferred();
      requests.push({ ...pending, options });
      return { pending: requests.at(-1) };
    },
    readNotesAiWritingStream: async ({ pending }, { onDelta }) => { pending.delta = onDelta; return pending.promise; },
    readWritingAiStream: async ({ pending }, { onDelta }) => { pending.delta = onDelta; return pending.promise; }
  };
  env.draftRef.current = env.draft;
  const run = functionSource('  async function runAiWriting(', '  function applyAiWriting(');
  const apply = functionSource('  function applyAiWriting(', name === 'Notes' ? '  async function createNote(' : '  const sourceRefs = Array.isArray');
  const helpers = functionSource('  function closeAiWriting(', '  function ownsAiRequest(token)');
  const owns = functionSource('  function ownsAiRequest(token)', '  function publishAiWriting(token');
  const publish = functionSource('  function publishAiWriting(token', name === 'Notes' ? '  const visible = useMemo' : '  async function load()');
  const update = functionSource('  function update(patch', name === 'Notes' ? '  function openLinkedNote(' : '  async function createDraft(');

  // 清理可能的 JSX 残留（WritingWorkspace applyAiWriting 可能包含 JSX）
  const cleanedApply = name === 'Writing' ? apply.replace(/<[^>]+>/g, '') : apply;

  const handlers = new Function('env', `with (env) { ${helpers}\n${owns}\n${publish}\n${update}\n${run}\n${cleanedApply}\nreturn { runAiWriting, applyAiWriting, closeAiWriting }; }`)(env);
  return { env, requests, frames, handlers, source };
}

test('request generations reject ABA, foreign controllers, and abort before callbacks', () => {
  const controller = createDocumentAiRequestController();
  const a = controller.begin('a');
  let validOnAbort;
  a.signal.addEventListener('abort', () => { validOnAbort = controller.isCurrent(a, 'a'); });
  controller.invalidate();
  assert.equal(validOnAbort, false);
  const b = controller.begin('a');
  assert.equal(controller.isCurrent(a, 'a'), false);
  assert.equal(controller.isCurrent(b, 'b'), false);
  assert.equal(controller.isCurrent(b, 'a'), true);
  assert.equal(createDocumentAiRequestController().isCurrent(b, 'a'), false);
});

for (const name of ['Notes', 'Writing']) {
  test(`${name}: late response cannot preview or apply to an identical different document`, async () => {
    const { env, handlers, requests } = workspaceHarness(name);
    const pending = handlers.runAiWriting('polish');
    await Promise.resolve();
    env.draft = { ...env.draft, id: 'b' };
    env.draftRef.current = env.draft;
    requests[0].delta('stale delta');
    requests[0].resolve({ result: 'stale result', citations: [] });
    await pending;
    assert.equal(env.aiWriter.result, '');
    // Even an accidentally retained preview must be rejected at the write boundary.
    env.aiWriter.status = 'preview'; env.aiWriter.result = 'wrong document';
    handlers.applyAiWriting('replace');
    assert.equal(env.draft.content, 'same text');
  });

  test(`${name}: close, restart and late failure cannot overwrite the new generation`, async () => {
    const { env, handlers, requests } = workspaceHarness(name);
    const old = handlers.runAiWriting('polish');
    await Promise.resolve();
    handlers.closeAiWriting();
    assert.equal(requests[0].options.signal.aborted, true);
    const current = handlers.runAiWriting('continue');
    await Promise.resolve();
    requests[1].delta('new delta');
    requests[0].delta('old delta');
    requests[0].reject(new Error('old failure'));
    await old.catch(() => {});
    assert.equal(env.aiWriter.result, 'new delta');
    assert.equal(env.aiWriter.status, 'loading');
    requests[1].resolve({ result: 'new result', citations: [] });
    await current;
    handlers.applyAiWriting('replace');
    assert.equal(env.draft.content, 'new result');
    assert.equal(env.aiWriter.status, 'applied');
  });

  test(`${name}: late success after close stays closed; same-document edits remain protected`, async () => {
    const { env, handlers, requests } = workspaceHarness(name);
    const old = handlers.runAiWriting('polish');
    await Promise.resolve();
    handlers.closeAiWriting();
    requests[0].resolve({ result: 'old result', citations: [] });
    await old;
    assert.deepEqual(env.aiWriter, { open: false });
    const current = handlers.runAiWriting('polish');
    await Promise.resolve();
    requests[1].resolve({ result: 'new result', citations: [] });
    await current;
    env.draft.content = 'typed during generation';
    handlers.applyAiWriting('replace');
    assert.equal(env.draft.content, 'typed during generation');
    assert.equal(env.aiWriter.status, 'error');
  });

  test(`${name}: queued state updates and post-unmount completions are rechecked`, async () => {
    const { env, handlers, requests, source } = workspaceHarness(name);
    const pending = handlers.runAiWriting('polish');
    await Promise.resolve();
    const queued = [];
    env.setAiWriter = update => queued.push(update);
    requests[0].delta('buffered');
    env.aiRequestRef.current.invalidate();
    for (const update of queued) env.aiWriter = update(env.aiWriter);
    requests[0].resolve({ result: 'late', citations: [] });
    await pending;
    assert.equal(env.aiWriter.result, '');
    assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*?return \(\) =>[\s\S]*?aiRequestRef\.current\.invalidate\(\)[\s\S]*?\}, \[draft\?\.id\]\)/);
    assert.match(source, /onClose=\{closeAiWriting\}/);
    assert.match(source, /prepareDocumentSwitch/);
  });
}
