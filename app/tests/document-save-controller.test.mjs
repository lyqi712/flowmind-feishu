import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DocumentSaveError,
  NOTE_SAVE_DEBOUNCE_MS,
  NOTE_VERSION_CONFLICT,
  SAVE_RESPONSE_INCOMPLETE,
  SWITCH_BLOCKED_MESSAGE,
  WRITING_SAVE_DEBOUNCE_MS,
  createDocumentSaveController,
  prepareDocumentSwitch,
  requireSavedRecord,
  sendJsonDocument
} from '../src/workspace/document-save-controller.js';
import { registerWorkspaceSaveGuard, runAfterWorkspaceSave } from '../src/workspace/workspace-save-guard.js';

const here = dirname(fileURLToPath(import.meta.url));
const notesSource = readFileSync(resolve(here, '../src/components/NotesWorkspace.jsx'), 'utf8');
const writingSource = readFileSync(resolve(here, '../src/components/WritingWorkspace.jsx'), 'utf8');

function createClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    schedule(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + Number(ms || 0), fn });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    async advance(ms) {
      now += Number(ms || 0);
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [id, timer] of due) {
        timers.delete(id);
        await timer.fn();
      }
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function snapshot(id, content, extra = {}) {
  return { id, content, ...extra };
}

test('debounce constants stay at the known note/writing delays', () => {
  assert.equal(NOTE_SAVE_DEBOUNCE_MS, 650);
  assert.equal(WRITING_SAVE_DEBOUNCE_MS, 800);
});

test('fast switch flushes the pending snapshot by document id before debounce', async () => {
  const clock = createClock();
  const sent = [];
  const controller = createDocumentSaveController({
    debounceMs: NOTE_SAVE_DEBOUNCE_MS,
    schedule: clock.schedule,
    cancel: clock.cancel,
    send: async snapshotValue => {
      sent.push(snapshotValue);
      return { saved: snapshotValue.content };
    }
  });
  controller.schedule(snapshot('note-a', 'alpha-edit'));
  assert.equal(sent.length, 0);
  assert.equal(controller.inspect('note-a').hasTimer, true);
  const gate = await prepareDocumentSwitch(controller, 'note-a');
  assert.equal(gate.blocked, false);
  assert.deepEqual(sent.map(item => item.content), ['alpha-edit']);
  assert.equal(controller.hasUnsaved('note-a'), false);
  controller.schedule(snapshot('note-b', 'beta-open'));
  assert.equal(controller.hasUnsaved('note-b'), true);
  assert.equal(controller.inspect('note-a').status, 'saved');
});

test('in-flight re-edit ignores the stale response and later sends the newest snapshot', async () => {
  const clock = createClock();
  const events = [];
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const controller = createDocumentSaveController({
    debounceMs: NOTE_SAVE_DEBOUNCE_MS,
    schedule: clock.schedule,
    cancel: clock.cancel,
    onChange: event => events.push(event),
    send: async snapshotValue => {
      calls += 1;
      if (calls === 1) {
        assert.equal(snapshotValue.content, 'one');
        assert.equal(snapshotValue.baseVersion, 1);
        return first.promise;
      }
      assert.equal(snapshotValue.content, 'two');
      assert.equal(snapshotValue.baseVersion, 2);
      return second.promise;
    }
  });
  controller.schedule(snapshot('note-a', 'one', { baseVersion: 1, contentVersionId: 1 }));
  await clock.advance(NOTE_SAVE_DEBOUNCE_MS);
  await Promise.resolve();
  assert.equal(controller.inspect('note-a').sending, true);
  controller.schedule(snapshot('note-a', 'two', { baseVersion: 1, contentVersionId: 1 }));
  first.resolve({ saved: 'one', note: { id: 'note-a', content: 'one', contentVersionId: 2 } });
  await first.promise;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(controller.inspect('note-a').savedRevision, 0);
  assert.equal(controller.inspect('note-a').pending.content, 'two');
  assert.equal(controller.inspect('note-a').pending.baseVersion, 2);
  assert.equal(controller.inspect('note-a').acknowledgedVersion, 2);
  await clock.advance(NOTE_SAVE_DEBOUNCE_MS);
  second.resolve({ saved: 'two', note: { id: 'note-a', content: 'two', contentVersionId: 3 } });
  await controller.flush('note-a');
  const saved = events.filter(event => event.status === 'saved');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].result.saved, 'two');
  assert.equal(saved[0].revision, 2);
  assert.equal(calls, 2);
});

test('version conflict keeps local pending content and does not adopt remote latest', async () => {
  const applied = [];
  const controller = createDocumentSaveController({
    debounceMs: NOTE_SAVE_DEBOUNCE_MS,
    send: async () => {
      throw new DocumentSaveError('这篇笔记已在其他位置更新。请保留当前编辑，重新打开最新版本后合并，避免覆盖。', {
        code: NOTE_VERSION_CONFLICT,
        status: 409,
        details: { note: { id: 'note-a', content: '远端最新', contentVersionId: 9 } }
      });
    },
    onChange: event => {
      if (event.status === 'saved') applied.push(event.result);
    }
  });
  controller.schedule(snapshot('note-a', '本地编辑', { baseVersion: 1, contentVersionId: 1 }));
  const result = await controller.flush('note-a');
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.equal(result.code, NOTE_VERSION_CONFLICT);
  assert.equal(controller.inspect('note-a').pending.content, '本地编辑');
  assert.equal(controller.inspect('note-a').pending.baseVersion, 1);
  assert.equal(controller.inspect('note-a').acknowledgedVersion, null);
  assert.equal(applied.length, 0);
  assert.equal(controller.hasUnsaved('note-a'), true);
});

test('reloading a newer server version resets baseline only when there is no pending edit', async () => {
  const sent = [];
  const controller = createDocumentSaveController({
    debounceMs: NOTE_SAVE_DEBOUNCE_MS,
    send: async snapshotValue => {
      sent.push(snapshotValue);
      return { note: { id: snapshotValue.id, content: snapshotValue.content, contentVersionId: Number(snapshotValue.baseVersion || 0) + 1 } };
    }
  });
  controller.schedule(snapshot('note-a', 'first', { baseVersion: 1, contentVersionId: 1 }));
  const saved = await controller.flush('note-a');
  assert.equal(saved.ok, true);
  assert.equal(controller.inspect('note-a').acknowledgedVersion, 2);
  assert.equal(controller.acceptBaseline('note-a', 5).ok, true);
  controller.schedule(snapshot('note-a', 'reopened-edit', { baseVersion: 5, contentVersionId: 5 }));
  assert.equal(controller.inspect('note-a').pending.baseVersion, 5);
  await controller.flush('note-a');
  assert.equal(sent.at(-1).content, 'reopened-edit');
  assert.equal(sent.at(-1).baseVersion, 5);

  controller.schedule(snapshot('note-a', 'local-pending', { baseVersion: 6, contentVersionId: 6 }));
  const blocked = controller.acceptBaseline('note-a', 9);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocked, true);
  assert.equal(controller.inspect('note-a').pending.content, 'local-pending');
  assert.equal(controller.inspect('note-a').acknowledgedVersion, 6);
});

test('flush waits for the latest in-flight revision after more typing', async () => {
  const clock = createClock();
  const first = deferred();
  const second = deferred();
  const sent = [];
  let calls = 0;
  const controller = createDocumentSaveController({
    debounceMs: NOTE_SAVE_DEBOUNCE_MS,
    schedule: clock.schedule,
    cancel: clock.cancel,
    send: async snapshotValue => {
      calls += 1;
      sent.push({ content: snapshotValue.content, baseVersion: snapshotValue.baseVersion });
      if (calls === 1) return first.promise;
      return second.promise;
    }
  });
  controller.schedule(snapshot('note-a', 'one', { baseVersion: 1, contentVersionId: 1 }));
  await clock.advance(NOTE_SAVE_DEBOUNCE_MS);
  await Promise.resolve();
  const flushing = controller.flush('note-a');
  controller.schedule(snapshot('note-a', 'two', { baseVersion: 1, contentVersionId: 1 }));
  first.resolve({ note: { id: 'note-a', content: 'one', contentVersionId: 2 } });
  await Promise.resolve();
  await Promise.resolve();
  second.resolve({ note: { id: 'note-a', content: 'two', contentVersionId: 3 } });
  const flushed = await flushing;
  assert.equal(flushed.ok, true);
  assert.equal(Boolean(flushed.stale), false);
  assert.deepEqual(sent.map(item => item.content), ['one', 'two']);
  assert.equal(sent[1].baseVersion, 2);
  assert.equal(controller.hasUnsaved('note-a'), false);
  const gate = await prepareDocumentSwitch(controller, 'note-a');
  assert.equal(gate.blocked, false);
});

test('stale 409 does not automatically hit the server again', async () => {
  const clock = createClock();
  let calls = 0;
  const first = deferred();
  const controller = createDocumentSaveController({
    debounceMs: NOTE_SAVE_DEBOUNCE_MS,
    schedule: clock.schedule,
    cancel: clock.cancel,
    send: async () => {
      calls += 1;
      if (calls === 1) return first.promise;
      throw new Error('should not auto-retry stale conflict');
    }
  });
  controller.schedule(snapshot('note-a', 'one', { baseVersion: 1 }));
  await clock.advance(NOTE_SAVE_DEBOUNCE_MS);
  await Promise.resolve();
  const flushing = controller.flush('note-a');
  controller.schedule(snapshot('note-a', 'two', { baseVersion: 1 }));
  first.reject(new DocumentSaveError('冲突', { code: NOTE_VERSION_CONFLICT, status: 409 }));
  const flushed = await flushing;
  assert.equal(calls, 1);
  assert.equal(flushed.conflict, true);
  assert.equal(flushed.ok, false);
  assert.equal(controller.inspect('note-a').pending.content, 'two');
});

test('incomplete 200 save payload keeps pending instead of clearing it', () => {
  assert.throws(() => requireSavedRecord({ ok: true }, 'note', '笔记保存响应缺少正文，已保留未保存编辑'), error => {
    assert.equal(error.code, SAVE_RESPONSE_INCOMPLETE);
    assert.equal(error.status, 200);
    return true;
  });
  assert.throws(() => requireSavedRecord({ ok: true, draft: null }, 'draft'), error => error.code === SAVE_RESPONSE_INCOMPLETE);
  const record = requireSavedRecord({ note: { id: 'n1', content: 'ok' } }, 'note');
  assert.equal(record.id, 'n1');
});

test('workspace save guard schedules the latest draft then blocks navigation when flushAll fails', async () => {
  const sent = [];
  let fail = true;
  const controller = createDocumentSaveController({
    debounceMs: NOTE_SAVE_DEBOUNCE_MS,
    send: async snapshotValue => {
      sent.push(snapshotValue.content);
      if (fail) throw new Error('HTTP 503');
      return { note: { id: snapshotValue.id, content: snapshotValue.content, contentVersionId: 2 } };
    }
  });
  const draftRef = { current: { id: 'note-a', content: 'guard-edit', title: 'A' } };
  const dirtyRef = { current: true };
  const unregister = registerWorkspaceSaveGuard(async () => {
    const current = draftRef.current;
    if (current?.id && dirtyRef.current) controller.schedule(current);
    return controller.flushAll();
  });
  try {
    const blocked = await runAfterWorkspaceSave(() => 'navigated');
    assert.equal(blocked.ok, false);
    assert.match(String(blocked.error || ''), /503/);
    assert.deepEqual(sent, ['guard-edit']);
    assert.equal(controller.hasUnsaved('note-a'), true);
    fail = false;
    const allowed = await runAfterWorkspaceSave(() => 'navigated');
    assert.equal(allowed.ok, true);
    assert.equal(allowed.result, 'navigated');
    assert.equal(controller.hasUnsaved('note-a'), false);
  } finally {
    unregister();
  }
});

test('failed save keeps the pending snapshot and retry sends the same document', async () => {
  const clock = createClock();
  const sent = [];
  let fail = true;
  const controller = createDocumentSaveController({
    debounceMs: WRITING_SAVE_DEBOUNCE_MS,
    schedule: clock.schedule,
    cancel: clock.cancel,
    send: async snapshotValue => {
      sent.push(snapshotValue.content);
      if (fail) throw new Error('网络中断');
      return { saved: snapshotValue.content };
    }
  });
  controller.schedule(snapshot('draft-a', 'keep-me'));
  assert.equal(controller.inspect('draft-a').hasTimer, true);
  const first = await controller.flush('draft-a');
  assert.equal(first.ok, false);
  assert.equal(controller.inspect('draft-a').status, 'error');
  assert.equal(controller.inspect('draft-a').error, '网络中断');
  assert.equal(controller.hasUnsaved('draft-a'), true);
  const blocked = await prepareDocumentSwitch(controller, 'draft-a');
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.error, '网络中断');
  fail = false;
  const retried = await controller.retry('draft-a');
  assert.equal(retried.ok, true);
  assert.deepEqual(sent, ['keep-me', 'keep-me', 'keep-me']);
  assert.equal(controller.hasUnsaved('draft-a'), false);
});

test('unmount flush sends keepalive before debounce and does not drop other documents', async () => {
  const clock = createClock();
  const sent = [];
  const controller = createDocumentSaveController({
    debounceMs: NOTE_SAVE_DEBOUNCE_MS,
    schedule: clock.schedule,
    cancel: clock.cancel,
    send: async (snapshotValue, options) => {
      sent.push({ id: snapshotValue.id, content: snapshotValue.content, keepalive: Boolean(options.keepalive) });
      return { saved: snapshotValue.id };
    }
  });
  controller.schedule(snapshot('note-a', 'unsaved-a'));
  controller.schedule(snapshot('note-b', 'unsaved-b'));
  assert.equal(sent.length, 0);
  const detached = await controller.detach({ keepalive: true });
  assert.equal(detached.ok, true);
  assert.deepEqual(sent.map(item => item.id).sort(), ['note-a', 'note-b']);
  assert.ok(sent.every(item => item.keepalive));
  assert.equal(controller.hasUnsaved('note-a'), false);
  assert.equal(controller.hasUnsaved('note-b'), false);
});

test('sendJsonDocument surfaces server error text and can mark keepalive', async () => {
  const calls = [];
  await assert.rejects(() => sendJsonDocument('/api/notes/n1', { content: 'x' }, {
    fetchImpl: async (url, options) => {
      calls.push({ url, keepalive: options.keepalive, method: options.method });
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: { message: '写入失败' } })
      };
    }
  }), /写入失败/);
  const ok = await sendJsonDocument('/api/writing/drafts/d1', { content: 'y' }, {
    keepalive: true,
    fetchImpl: async (_url, options) => {
      calls.push({ keepalive: options.keepalive, body: options.body });
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, draft: { id: 'd1' } }) };
    }
  });
  assert.equal(ok.draft.id, 'd1');
  assert.equal(calls[0].keepalive, false);
  assert.equal(calls[1].keepalive, true);
});

test('sendJsonDocument preserves NOTE_VERSION_CONFLICT without treating it as success', async () => {
  await assert.rejects(() => sendJsonDocument('/api/notes/n1', { content: '本地', baseVersion: 1 }, {
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({
        ok: false,
        error: { code: NOTE_VERSION_CONFLICT, message: '这篇笔记已在其他位置更新。请保留当前编辑，重新打开最新版本后合并，避免覆盖。' },
        note: { id: 'n1', content: '远端最新', contentVersionId: 9 }
      })
    })
  }), error => {
    assert.equal(error.code, NOTE_VERSION_CONFLICT);
    assert.equal(error.status, 409);
    assert.match(error.message, /保留当前编辑/);
    assert.equal(error.details?.note?.content, '远端最新');
    return true;
  });
});

test('NotesWorkspace and WritingWorkspace flush by document id instead of only clearing timers', () => {
  for (const fragment of [
    "from '../workspace/document-save-controller.js'",
    'NOTE_SAVE_DEBOUNCE_MS',
    'prepareDocumentSwitch',
    'saveControllerRef.current.schedule(noteSaveSnapshot(draft))',
    'await prepareDocumentSwitch(saveControllerRef.current, current?.id)',
    'controller.detach({ keepalive: true })',
    'saveControllerRef.current.retry(draft.id)',
    'jsonBodyWithBaseVersion',
    'baseVersion: note?.baseVersion ?? note?.contentVersionId',
    'requireSavedRecord(data, \'note\'',
    'acceptBaseline(next.id, next)',
    'acceptBaseline(note.id, note)',
    "from '../workspace/workspace-save-guard.js'",
    'registerWorkspaceSaveGuard',
    'controller.flushAll()'
  ]) assert.ok(notesSource.includes(fragment), `missing notes save contract: ${fragment}`);
  assert.doesNotMatch(notesSource, /clearTimeout\(saveTimer\.current\)/);
  assert.doesNotMatch(notesSource, /editRevisionRef\.current \+= 1;\s*setSelectedId/);
  for (const fragment of [
    "from '../workspace/document-save-controller.js'",
    'WRITING_SAVE_DEBOUNCE_MS',
    'prepareDocumentSwitch',
    'saveControllerRef.current.schedule(writingSaveSnapshot(draft))',
    'await prepareDocumentSwitch(saveControllerRef.current, current?.id)',
    'controller.detach({ keepalive: true })',
    'jsonBodyWithBaseVersion',
    'requireSavedRecord(data, \'draft\'',
    'acceptBaseline(next.id, next)',
    'acceptBaseline(item.id, item)',
    "from '../workspace/workspace-save-guard.js'",
    'registerWorkspaceSaveGuard',
    'controller.flushAll()'
  ]) assert.ok(writingSource.includes(fragment), `missing writing save contract: ${fragment}`);
  assert.doesNotMatch(writingSource, /clearTimeout\(timer\.current\)/);
  assert.equal(SWITCH_BLOCKED_MESSAGE.includes('阻止切换'), true);
});
