import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS, resolveSkill } from '../server/skills.mjs';

test('场景化 Skill 定义存在', () => {
  const q2Skill = resolveSkill('q2-planning');
  assert.ok(q2Skill, 'Q2 规划 Skill 应存在');
  assert.strictEqual(q2Skill.id, 'q2-planning');
  assert.strictEqual(q2Skill.category, 'decision-support');
  assert.ok(q2Skill.steps.length === 3, 'Q2 规划应有 3 个步骤');

  const techSkill = resolveSkill('tech-selection');
  assert.ok(techSkill, '技术选型 Skill 应存在');
  assert.strictEqual(techSkill.id, 'tech-selection');
  assert.strictEqual(techSkill.category, 'decision-support');

  const proposalSkill = resolveSkill('customer-proposal');
  assert.ok(proposalSkill, '客户提案 Skill 应存在');
  assert.strictEqual(proposalSkill.id, 'customer-proposal');
  assert.strictEqual(proposalSkill.category, 'decision-support');
});

test('场景化 Skill 别名解析', () => {
  assert.strictEqual(resolveSkill('Q2规划')?.id, 'q2-planning');
  assert.strictEqual(resolveSkill('q2')?.id, 'q2-planning');
  assert.strictEqual(resolveSkill('技术选型')?.id, 'tech-selection');
  assert.strictEqual(resolveSkill('选型')?.id, 'tech-selection');
  assert.strictEqual(resolveSkill('客户提案')?.id, 'customer-proposal');
  assert.strictEqual(resolveSkill('提案')?.id, 'customer-proposal');
});

test('场景化 Skill 包含在 SKILLS 列表', () => {
  const ids = SKILLS.map(s => s.id);
  assert.ok(ids.includes('q2-planning'), 'SKILLS 应包含 q2-planning');
  assert.ok(ids.includes('tech-selection'), 'SKILLS 应包含 tech-selection');
  assert.ok(ids.includes('customer-proposal'), 'SKILLS 应包含 customer-proposal');
});

test('场景化 Skill 有完整元数据', () => {
  const scenarios = ['q2-planning', 'tech-selection', 'customer-proposal'];
  for (const id of scenarios) {
    const skill = resolveSkill(id);
    assert.ok(skill.name, `${id} 应有名称`);
    assert.ok(skill.description, `${id} 应有描述`);
    assert.ok(skill.inputHint, `${id} 应有输入提示`);
    assert.ok(skill.category === 'decision-support', `${id} 应标记为决策支持类`);
    assert.ok(skill.icon, `${id} 应有图标`);
    assert.ok(Array.isArray(skill.steps) && skill.steps.length === 3, `${id} 应有 3 个步骤`);
  }
});
