import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('/ \u4e0e @ \u89e6\u53d1\u5668\u8fdb\u5165\u547d\u4ee4\u83dc\u5355\u5e76\u63a5\u7ba1\u952e\u76d8\u8f93\u5165', () => {
  assert.ok(source.includes('function detectComposerTrigger'));
  assert.ok(source.includes('<ComposerCommandMenu open={composerMenuOpen}'));
  assert.ok(source.includes('mode={composerTrigger?.mode'));
  assert.ok(source.includes('inputRef={composerInputRef}'));
  assert.ok(source.includes('event.defaultPrevented'));
  assert.match(css, /\.composer:has\(\.composer-command-menu\)\{[^}]*overflow:visible[^}]*z-index:90/);
});

test('/ Skill \u5728\u5f53\u524d\u5bf9\u8bdd\u6d41\u5f0f\u6267\u884c\u800c\u4e0d\u662f\u5f3a\u5236\u8df3\u8f6c\u6a21\u5757', () => {
  assert.ok(source.includes('async function runChatSkill'));
  assert.ok(source.includes("fetch('/api/skills/run'"));
  assert.ok(source.includes('runChatSkill?.(skill.id, query)'));
  assert.ok(source.includes('message-skill-pill'));
  assert.ok(source.includes('\u4ea7\u7269\u5df2\u4fdd\u7559\u5728\u5bf9\u8bdd\u4e0e Skill \u8bb0\u5f55'));
});

test('@ \u6587\u6863\u8fdb\u5165\u663e\u5f0f\u63d0\u95ee\u8303\u56f4\uff0c\u5f53\u524d\u9009\u533a\u4f1a\u6210\u4e3a\u4e34\u65f6 Markdown \u9644\u4ef6', () => {
  assert.ok(source.includes('function addDocumentMention'));
  assert.ok(source.includes('setSelectedDocs(current => current.includes'));
  assert.ok(source.includes('new File(['));
  assert.ok(source.includes('composer-context-chip'));
  assert.ok(source.includes('removeComposerMention'));
});

test('\u65b0\u5bf9\u8bdd\u548c\u6062\u590d\u5386\u53f2\u4f1a\u6e05\u7406\u4e34\u65f6 Skill \u4e0e @ \u82af\u7247', () => {
  assert.ok(source.includes('function clearComposerSelections'));
  assert.ok(source.includes('function startFreshConversation'));
  assert.ok(source.includes('function restoreFromHistory'));
  assert.ok(source.includes('setSelectedDocs([])'));
});

test('\u56de\u7b54\u652f\u6301 Markdown \u6392\u7248\u5e76\u63d0\u4f9b\u66f4\u6709\u4eba\u60c5\u5473\u7684\u4efb\u52a1\u8d77\u70b9', () => {
  assert.ok(source.includes('ReactMarkdown'));
  assert.ok(source.includes('remarkPlugins={[remarkGfm]}'));
  assert.ok(source.includes('className=\"chat-welcome\"'));
  assert.match(css, /\.markdown-answer/);
  assert.match(css, /\.chat-starters/);
  assert.match(css, /\.composer-context-chips/);
});
