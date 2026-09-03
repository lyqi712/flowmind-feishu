import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAssistantStreamEvent, coalesceStreamEvents, createStreamEventBatcher, isStickToBottom, scrollTranscriptToEnd } from '../src/workspace/stream-events.js';

test('consecutive token deltas collapse into one paint', () => {
  const coalesced = coalesceStreamEvents([
    { type: 'status', detail: '正在回答' },
    { type: 'delta', delta: '发' },
    { type: 'delta', delta: '布' },
    { type: 'delta', delta: '前先过闸门' },
    { type: 'done', result: { answer: '发布前先过闸门 [1]。' } }
  ]);
  assert.equal(coalesced.length, 3);
  assert.equal(coalesced[1].delta, '发布前先过闸门');
  assert.equal(coalesced[2].type, 'done');
});

test('batcher holds token deltas and flushes immediately on done', async () => {
  const flushes = [];
  let scheduled = 0;
  const batcher = createStreamEventBatcher({
    delayMs: 50,
    schedule: fn => {
      scheduled += 1;
      return setTimeout(fn, 50);
    },
    onFlush: events => flushes.push(events)
  });
  batcher.push({ type: 'delta', delta: 'A' });
  batcher.push({ type: 'delta', delta: 'B' });
  assert.equal(flushes.length, 0);
  assert.equal(scheduled, 1);
  batcher.push({ type: 'done', result: { answer: 'AB' } });
  assert.equal(flushes.length, 1);
  assert.equal(flushes[0].length, 2);
  assert.equal(flushes[0][0].delta, 'AB');
  assert.equal(flushes[0][1].type, 'done');
});

test('assistant stream reducer keeps citations and status in one message', () => {
  const start = applyAssistantStreamEvent({ id: 'a1', role: 'assistant', text: '', agent: { mode: 'auto' } }, { type: 'start', runId: 'run-1', executionMode: 'answer', conversationId: 'c1' });
  assert.equal(start.status, '我先查看知识库里的资料');
  assert.equal(start.conversationId, 'c1');
  const streamed = applyAssistantStreamEvent(start, { type: 'delta', delta: 'Alice 负责闸门' });
  assert.equal(streamed.text, 'Alice 负责闸门');
  assert.equal(streamed.status, '');
  const done = applyAssistantStreamEvent(streamed, {
    type: 'done',
    conversationId: 'c1',
    result: { answer: 'Alice 负责闸门 [1]。', sourceRefs: [{ documentId: 'doc-1', title: '发布计划' }] }
  });
  assert.equal(done.text, 'Alice 负责闸门 [1]。');
  assert.equal(done.citations[0].documentId, 'doc-1');
  assert.equal(done.done, true);
});

test('Skill model-delta tokens also collapse, and transcript only auto-follows when near the bottom', () => {
  const coalesced = coalesceStreamEvents([
    { type: 'model-delta', delta: '更' },
    { type: 'model-delta', delta: '清楚' },
    { type: 'artifact', artifact: { content: '更清楚的表达' } }
  ]);
  assert.equal(coalesced[0].delta, '更清楚');
  assert.equal(coalesced[1].type, 'artifact');
  const scroller = { scrollHeight: 800, scrollTop: 200, clientHeight: 400 };
  assert.equal(isStickToBottom(scroller), false);
  scroller.scrollTop = 720;
  assert.equal(isStickToBottom(scroller), true);
  const calls = [];
  const endNode = {
    parentElement: scroller,
    scrollIntoView: options => calls.push(options)
  };
  scroller.scrollTop = 200;
  assert.equal(scrollTranscriptToEnd(endNode, { streaming: true }), false);
  assert.equal(calls.length, 0);
  assert.equal(scrollTranscriptToEnd(endNode, { streaming: true, force: true }), true);
  assert.deepEqual(calls[0], { behavior: 'auto', block: 'end' });
});
