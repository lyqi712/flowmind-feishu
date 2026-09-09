import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { looksTemplatedAnswer, stripTemplatedAnswerSections } from '../../app/shared/answer-text.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const evidenceDir = join(projectRoot, 'evidence', 'agent-graph');
const base = process.env.FLOWMIND_API_BASE || 'http://127.0.0.1:8789';
const question = '对比 Hermes Agent 和 Agent Loop 这两份材料，它们对长时运行幻觉、可验证闭环分别怎么说';

async function collectAgentEvents() {
  const response = await fetch(`${base}/api/agent/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ question, mode: 'auto' })
  });
  assert.equal(response.ok, true, `agent run failed: ${response.status}`);
  const text = await response.text();
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'data: [DONE]') continue;
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    try { events.push(JSON.parse(payload)); } catch {}
  }
  return events;
}

const events = await collectAgentEvents();
const start = events.find(event => event.type === 'start');
const done = events.find(event => event.type === 'done');
const deltas = events.filter(event => event.type === 'delta').map(event => event.delta).join('');
const answer = String(done?.result?.answer || deltas || '').trim();
const displayAnswer = stripTemplatedAnswerSections(answer);
const sourceRefs = done?.result?.sourceRefs || [];
const titles = [...new Set(sourceRefs.map(item => item.title).filter(Boolean))];

assert.ok(answer.length > 120, `answer too short (${answer.length})`);
assert.equal(looksTemplatedAnswer(displayAnswer), false, `display answer still looks templated: ${displayAnswer.slice(0, 240)}`);
assert.ok(!/^\*\*关于[^\n*]{1,48}\*\*\s*$/m.test(displayAnswer), 'display answer should not keep lone **关于…** section headers');
assert.ok(/Hermes/i.test(answer), 'answer should mention Hermes');
assert.ok(/Agent Loop/i.test(answer), 'answer should mention Agent Loop');
assert.ok(sourceRefs.length >= 2, `expected >=2 citations, got ${sourceRefs.length}`);
assert.ok(events.some(event => event.type === 'observation' && (event.autoRetrieve || event.autoRead)), 'comparison should retrieve and read knowledge');

await mkdir(evidenceDir, { recursive: true });
const result = {
  ok: true,
  base,
  executionMode: start?.executionMode || null,
  answerLength: answer.length,
  citationCount: sourceRefs.length,
  sourceTitles: titles.slice(0, 8),
  templateFree: !looksTemplatedAnswer(displayAnswer),
  displayStripped: displayAnswer.length <= answer.length,
  answerPreview: displayAnswer.slice(0, 1200)
};
await writeFile(join(evidenceDir, 'comparison-answer-api-acceptance.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(result, null, 2));
