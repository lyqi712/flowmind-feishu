import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applySkillReasoningEvent,
  isDecisionSupportSkill,
  reasoningSummary,
  shouldShowReasoningChain
} from '../src/workspace/reasoning-chain.js';

const mainSrc = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf-8');
const uiSrc = readFileSync(new URL('../src/components/ReasoningChain.jsx', import.meta.url), 'utf-8');

const skill = { id: 'q2-planning', category: 'decision-support', steps: ['选择输入文档', '提取关键信息', '生成规划草稿'] };

test('仅决策支持 Skill 展示推理链', () => {
  assert.equal(isDecisionSupportSkill(skill), true);
  assert.equal(isDecisionSupportSkill({ id: 'summary' }), false);
  assert.equal(shouldShowReasoningChain({ role: 'assistant', skill, reasoningSteps: [{ step: 1 }] }), true);
  assert.equal(shouldShowReasoningChain({ role: 'assistant', skill: { id: 'summary' }, reasoningSteps: [{ step: 1 }] }), false);
  assert.equal(shouldShowReasoningChain({ role: 'user', skill, reasoningSteps: [{ step: 1 }] }), false);
});

test('推理事件会推进、完成和失败对应步骤', () => {
  let steps = applySkillReasoningEvent([], { type: 'start' }, skill);
  assert.equal(steps[0].status, 'in_progress');
  assert.equal(steps[1].status, 'pending');

  steps = applySkillReasoningEvent(steps, { type: 'step', step: 2, detail: '已提取 4 个关键点' }, skill);
  assert.equal(steps[0].status, 'completed');
  assert.equal(steps[1].status, 'in_progress');
  assert.match(steps[1].detail, /4 个关键点/);

  steps = applySkillReasoningEvent(steps, { type: 'done' }, skill);
  assert.ok(steps.every(step => step.status === 'completed'));
  assert.match(reasoningSummary(steps), /已完成 3 步/);

  const failed = applySkillReasoningEvent(
    applySkillReasoningEvent([], { type: 'start' }, skill),
    { type: 'error', error: { message: '模型不可用' } },
    skill
  );
  assert.equal(failed[0].status, 'failed');
  assert.match(failed[0].detail, /模型不可用/);
});

test('main 和组件接入默认收起的推理链', () => {
  assert.match(mainSrc, /shouldShowReasoningChain\(message\)/);
  assert.match(mainSrc, /<ReasoningChain/);
  assert.match(uiSrc, /defaultExpanded = false/);
  assert.match(uiSrc, /展开.*AI 推理过程/);
});
