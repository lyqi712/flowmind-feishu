import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const skillSource = await readFile(new URL('../server/skills.mjs', import.meta.url), 'utf8');
const artifactSource = await readFile(new URL('../server/task-artifacts.mjs', import.meta.url), 'utf8');

test('报告和播客沿用统一 Composer/Skill 流程，不新增独立导航板块', () => {
  assert.match(mainSource, /composerTaskSkillId/);
  assert.match(mainSource, /return 'podcast'/);
  assert.match(mainSource, /return 'research-report'/);
  assert.match(mainSource, /runChatSkill\?\.\(taskSkillId, query\)/);
  assert.doesNotMatch(mainSource, /route === 'podcast'/);
});

test('任务产物包含真实 WAV、下载入口与来源回跳', () => {
  assert.match(skillSource, /id: 'podcast'/);
  assert.match(skillSource, /const sourceRefs = \(artifact\.sourceRefs \|\| artifact\.references \|\| \[\]\)/);
  assert.match(artifactSource, /System\.Speech\.Synthesis\.SpeechSynthesizer/);
  assert.match(mainSource, /<audio controls preload="metadata"/);
  assert.match(mainSource, /artifactFileLabel\(file\)/);
  assert.match(mainSource, /className="skill-artifact-sources"/);
});

test('脑图与测验复用 Reader 解读面板，博客、生图和 PPT 保持排除', () => {
  assert.match(skillSource, /id: 'mind-map'/);
  assert.match(skillSource, /id: 'quiz'/);
  assert.match(mainSource, /handleReaderInterpretation/);
  assert.match(mainSource, /onRunInterpretation=/);
  for (const route of ['mind-map', 'quiz', 'blog', 'image-generation', 'ppt', 'presentation']) {
    assert.doesNotMatch(mainSource, new RegExp(`route === ['"]${route}['"]`));
  }
});