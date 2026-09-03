import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const unifiedSource = await readFile(new URL('../src/components/UnifiedWorkspace.jsx', import.meta.url), 'utf8');

test('Ctrl+K 只由 UnifiedWorkspace 命令面板接管，不再与 SmartSearch 双开', () => {
  assert.doesNotMatch(mainSource, /setSmartSearchOpen\(current => !current\)/);
  assert.match(unifiedSource, /isWorkspaceCommandShortcut\(event\)/);
  assert.match(unifiedSource, /openCommandPalette\(\)/);
});

test('Agent 确认写入会路由到消息所属 Tab，而不是当前激活 Tab', () => {
  for (const fragment of [
    'function resolveChatTabIdForMessage(message, fallbackTabId = currentChatTabId())',
    'const chatTabId = resolveChatTabIdForMessage(message)',
    'setMessagesForChatTab(chatTabId, current => current.map(item => item.id === message.id',
    'chatTabId,'
  ]) assert.ok(mainSource.includes(fragment), `missing agent tab routing: ${fragment}`);
});

test('切换 Tab 时保留失败附件的 file 引用，便于重试上传', () => {
  for (const fragment of [
    'runtime.attachmentFiles = Object.fromEntries',
    'attachmentFiles[item.clientId] ? { ...item, file: attachmentFiles[item.clientId] } : item'
  ]) assert.ok(mainSource.includes(fragment), `missing attachment tab routing: ${fragment}`);
});

test('阅读器继续到工作区会带上 reader conversationId', () => {
  assert.match(mainSource, /conversationId: readerConversationId \|\| null/);
  assert.match(mainSource, /if \(readerConversationId\) runtime\.loadedConversationId = readerConversationId/);
});

test('重新生成会路由到消息所属 Tab，而不是当前激活 Tab', () => {
  const block = mainSource.slice(mainSource.indexOf('function regenerateAnswer'), mainSource.indexOf('function openWrittenArtifact'));
  assert.match(block, /const chatTabId = resolveChatTabIdForMessage\(message\)/);
  assert.match(block, /ask\(prompt, docIds, message\.id, message\.attachments \|\| \[\], mode, selection, chatTabId\)/);
});

test('对话输入框聚焦时不应触发全局 Ctrl+K 命令面板', () => {
  assert.match(unifiedSource, /isComposerFocused\(\)/);
  assert.match(unifiedSource, /if \(isComposerFocused\(\)\) return;/);
});
