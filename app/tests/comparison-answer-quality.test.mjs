import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentRuntime } from '../server/agent/runtime.mjs';
import { ToolRegistry } from '../server/agent/tool-registry.mjs';
import { JsonStateStore } from '../server/state-store.mjs';
import { looksTemplatedAnswer } from '../shared/answer-text.mjs';
import { buildAgentAnswerSystemPrompt } from '../server/dialogue-prompts.mjs';

const COMPARE_QUESTION = '对比 Hermes Agent 和 Agent Loop 这两份材料，它们对长时运行幻觉、可验证闭环分别怎么说';
const FIXTURE_DOCS = [
  {
    id: 'acceptance-note',
    title: '知识笔记：对比 Hermes Agent 和 Agent Loop 这两份材料，它们对长时运行幻觉、可验证闭环分别怎么说',
    content: '两者都在谈长时运行幻觉和可验证闭环。'.repeat(8),
    source: 'local-note',
    type: 'note'
  },
  { id: 'agent-loop', title: 'Agent Loop：从长时运行幻觉到可验证的责任闭环', content: 'Agent Loop 强调可验证的责任闭环，适合需要验收的长时运行任务。' },
  { id: 'hermes', title: 'Hermes Agent 实战解析', content: 'Hermes Agent 适合多工具协作和技能组合，也讨论长时运行幻觉与 Harness 防跑偏。' }
];

class FixtureModel {
  constructor(responses = []) { this.responses = [...responses]; this.messages = []; }
  async publicSettings() { return { provider: 'openai-chat', model: 'fixture', configured: true }; }
  async *streamGenerate({ messages = [] }) {
    this.messages.push(structuredClone(messages));
    const response = this.responses.shift();
    for (const part of Array.isArray(response) ? response : [response]) yield String(part || '');
  }
}

async function harness(responses, documents = FIXTURE_DOCS) {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-compare-quality-'));
  const store = new JsonStateStore(join(root, 'state.json'));
  await store.ready;
  const model = new FixtureModel(responses);
  const registry = new ToolRegistry({ getDocuments: () => documents });
  return {
    root,
    model,
    runtime: new AgentRuntime({ modelService: model, registry, store, firstTokenTimeoutMs: 25, maxResearchSteps: 4 }),
    async close() { await rm(root, { recursive: true, force: true }); }
  };
}

async function events(runtime, input) {
  const result = [];
  for await (const event of runtime.run(input)) result.push(event);
  return result;
}

test('comparison auto mode classifies as research and auto-reads source documents', async () => {
  const h = await harness(['Hermes 用 Harness 约束跑偏，Agent Loop 用责任闭环验收长任务 [1][2]。']);
  try {
    const result = await events(h.runtime, { question: COMPARE_QUESTION, mode: 'auto' });
    const start = result.find(event => event.type === 'start');
    assert.equal(start.executionMode, 'research');
    assert.ok(result.some(event => event.type === 'observation' && event.autoRetrieve));
    const reads = result.filter(event => event.type === 'observation' && event.autoRead);
    const readIds = reads.map(event => event.observation?.documentId).filter(Boolean);
    assert.ok(readIds.includes('agent-loop') || readIds.includes('hermes'));
    const done = result.find(event => event.type === 'done');
    assert.match(done.result.answer, /Hermes|Harness/i);
    assert.match(done.result.answer, /Agent Loop|闭环/i);
    assert.equal(looksTemplatedAnswer(done.result.answer), false);
    assert.ok((done.result.sourceRefs || []).length >= 2);
    const system = String(h.model.messages[0]?.[0]?.content || '');
    assert.match(system, /语气示例/);
    assert.match(system, /不要机械罗列覆盖率/);
  } finally { await h.close(); }
});

test('comparison answers strip canned section headers from model output', async () => {
  const templated = '## 结论\n根据以上材料，Hermes 偏 Harness [1]，Agent Loop 强调验收闭环 [2]。\n引用覆盖率 62%';
  const h = await harness([templated]);
  try {
    const result = await events(h.runtime, { question: COMPARE_QUESTION, mode: 'auto' });
    const done = result.find(event => event.type === 'done');
    assert.equal(done.result.answer.includes('## 结论'), false);
    assert.equal(done.result.answer.includes('引用覆盖率'), false);
    assert.match(done.result.answer, /Hermes/);
    assert.match(done.result.answer, /Agent Loop|闭环/);
    assert.equal(looksTemplatedAnswer(done.result.answer), false);
  } finally { await h.close(); }
});

test('buildAgentAnswerSystemPrompt keeps natural dialogue constraints', () => {
  const prompt = buildAgentAnswerSystemPrompt();
  assert.match(prompt, /像懂行的同事/);
  assert.match(prompt, /别用「围绕 X 展开」/);
  assert.doesNotMatch(prompt, /结论\/依据\/下一步/);
});
