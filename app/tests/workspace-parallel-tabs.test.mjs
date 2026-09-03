import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');

test('每个聊天 Tab 独立保存输入框草稿、附件和知识库开关', () => {
  for (const fragment of [
    'function persistChatComposer(tabId)',
    'function restoreChatComposer(runtime)',
    'runtime.query = String(queryRef.current || \'\')',
    'runtime.chatAttachments =',
    'runtime.chatIncludeKnowledgeBase =',
    'restoreChatComposer(runtime)',
    'if (previousTabId && previousTabId !== tabId) persistChatComposer(previousTabId)',
    "query: '', chatAttachments: [], chatIncludeKnowledgeBase: false"
  ]) assert.ok(mainSource.includes(fragment), `missing per-tab composer isolation: ${fragment}`);
});

test('切换 Tab 时 streaming 状态跟随各自 runtime，而不是全局卡死', () => {
  for (const fragment of [
    'setStreamingState(Boolean(runtime.streaming))',
    'setStreamingForChatTab(chatTabId, true)',
    'setStreamingForChatTab(chatTabId, false)',
    'chatAbortControllersRef.current.set(chatTabId, controller)'
  ]) assert.ok(mainSource.includes(fragment), `missing per-tab streaming: ${fragment}`);
  assert.doesNotMatch(mainSource, /async function runChatSkill[\s\S]*?setStreaming\(true\)/);
});

test('Skill 在对话里运行也绑定到当前 Tab 的 streaming 与消息', () => {
  const block = mainSource.slice(mainSource.indexOf('async function runChatSkill'), mainSource.indexOf('function retryRecoverableChatSkill'));
  assert.match(block, /setStreamingForChatTab\(chatTabId, true\)/);
  assert.match(block, /setMessagesForChatTab\(chatTabId/);
  assert.match(block, /setChatErrorForTab\(chatTabId/);
  assert.match(block, /chatAbortControllersRef\.current\.set\(chatTabId, controller\)/);
});

test('回到首页会持久化当前 Tab 草稿并清空共享输入区', () => {
  const block = mainSource.slice(mainSource.indexOf('function activateWorkspaceTab'), mainSource.indexOf('function closeWorkspaceTab'));
  assert.match(block, /persistChatComposer\(activeChatTabIdRef\.current\)/);
  assert.match(block, /setQuery\(''\)/);
  assert.match(block, /setChatAttachments\(\[\]\)/);
  assert.doesNotMatch(block, /activeChatTabIdRef\.current = chatTab \? tab\.id/);
});

test('切换 Tab 前先持久化旧 Tab，不能在 hydrate 之前抢先改 activeChatTabIdRef', () => {
  const createBlock = mainSource.slice(mainSource.indexOf('function createChatWorkspaceTab'), mainSource.indexOf('async function hydrateChatTab'));
  assert.doesNotMatch(createBlock, /activeChatTabIdRef\.current = tab\.id/);
  assert.match(mainSource, /if \(previousTabId && previousTabId !== tabId\) persistChatComposer\(previousTabId\)/);
});

test('后台 Tab 生成时标签页显示 busy 状态，Agent 确认写入绑定当前 Tab', async () => {
  assert.match(mainSource, /busy: isChatWorkspaceTab\(tab\) \? Boolean\(chatRuntimeRef\.current\.get\(String\(tab\.id\)\)\?\.streaming\) : false/);
  assert.match(mainSource, /function bumpChatRuntimeUI\(\)/);
  assert.match(mainSource, /setMessagesForChatTab\(chatTabId, current => current\.map\(item => item\.id === message\.id/);
  assert.match(mainSource, /setMessagesForChatTab\(currentChatTabId\(\), updater\)/);
  const unifiedSource = await readFile(new URL('../src/components/UnifiedWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(unifiedSource, /unified-workspace-tab-busy/);
  assert.match(unifiedSource, /tab\.busy/);
});

test('知识图谱里点新对话或切换 Tab 必须关掉图谱 overlay，不能把图谱粘在新对话上', () => {
  const helper = mainSource.slice(mainSource.indexOf('function closeKnowledgeOverlays'), mainSource.indexOf('function createChatWorkspaceTab'));
  const createBlock = mainSource.slice(mainSource.indexOf('function createChatWorkspaceTab'), mainSource.indexOf('async function hydrateChatTab'));
  const activateBlock = mainSource.slice(mainSource.indexOf('function activateWorkspaceTab'), mainSource.indexOf('function closeWorkspaceTab'));
  assert.match(helper, /setGraphOpen\(false\)/);
  assert.match(helper, /setGraphFocus\(null\)/);
  assert.match(createBlock, /closeKnowledgeOverlays\(\)/);
  assert.match(activateBlock, /closeKnowledgeOverlays\(\)/);
});

test('阅读器继续到工作区会带上 reader conversationId', () => {
  assert.match(mainSource, /conversationId: readerConversationId \|\| null/);
  assert.match(mainSource, /if \(readerConversationId\) runtime\.loadedConversationId = readerConversationId/);
});
