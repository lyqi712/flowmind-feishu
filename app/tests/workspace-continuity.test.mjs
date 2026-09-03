import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createChatTabScene,
  createInitialWorkspaceSession,
  createWorkspaceStorageAdapter,
  getChatTabScene,
  workspaceSessionReducer
} from '../src/workspace/workspace-session.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    value(key) { return values.get(key); }
  };
}

function reduce(state, action) {
  return workspaceSessionReducer(state, action);
}

test('chat Tabs retain independent recoverable scenes while keeping message bodies out of local storage', () => {
  let session = createInitialWorkspaceSession();
  session = reduce(session, {
    type: 'OPEN_TAB',
    tab: {
      id: 'chat-a', kind: 'chat', route: 'knowledge', title: 'A',
      chat: createChatTabScene({
        conversationId: 'conversation-a', documentIds: ['doc-a'], agentMode: 'research',
        selection: { documentId: 'doc-a', quote: 'A selected evidence', anchor: 'chars:10-29' },
        skillRun: { id: 'run-a', skillId: 'summary', title: 'A summary', status: 'completed', output: 'do not persist this body' },
        messages: [{ role: 'assistant', text: 'A answer must stay on the server' }]
      })
    }
  });
  session = reduce(session, {
    type: 'OPEN_TAB',
    tab: {
      id: 'chat-b', kind: 'chat', route: 'knowledge', title: 'B',
      chat: createChatTabScene({
        conversationId: 'conversation-b', documentIds: ['doc-b'], agentMode: 'write',
        selection: { documentId: 'doc-b', quote: 'B selected evidence', anchor: 'chars:42-61' },
        skillRun: { id: 'run-b', skillId: 'compare', title: 'B comparison', status: 'running', output: 'also not persisted' },
        messages: [{ role: 'assistant', text: 'B answer must stay on the server' }]
      })
    }
  });
  session = reduce(session, { type: 'SET_CHAT_TAB_SCENE', tabId: 'chat-a', patch: { documentIds: ['doc-a', 'doc-a-extra'], agentMode: 'quick', scopeExplicit: true } });

  const sceneA = getChatTabScene(session.tabs.find(tab => tab.id === 'chat-a'));
  const sceneB = getChatTabScene(session.tabs.find(tab => tab.id === 'chat-b'));
  assert.deepEqual(sceneA.documentIds, ['doc-a', 'doc-a-extra']);
  assert.equal(sceneA.agentMode, 'quick');
  assert.equal(sceneA.conversationId, 'conversation-a');
  assert.equal(sceneA.scopeExplicit, true);
  assert.equal(sceneA.selection.quote, 'A selected evidence');
  assert.equal(sceneA.skillRun.status, 'completed');
  assert.equal(sceneB.conversationId, 'conversation-b');
  assert.deepEqual(sceneB.documentIds, ['doc-b']);
  assert.equal(sceneB.agentMode, 'write');
  assert.equal(sceneB.selection.quote, 'B selected evidence');
  assert.equal(sceneB.skillRun.status, 'recoverable');

  const storage = memoryStorage();
  const adapter = createWorkspaceStorageAdapter({ storage, key: 'chat-continuity' });
  assert.equal(adapter.save(session), true);
  const serialized = storage.value('chat-continuity');
  assert.doesNotMatch(serialized, /A answer must stay on the server|B answer must stay on the server|do not persist this body|also not persisted/);
  const restored = adapter.load();
  assert.deepEqual(getChatTabScene(restored.tabs.find(tab => tab.id === 'chat-a')), sceneA);
  assert.deepEqual(getChatTabScene(restored.tabs.find(tab => tab.id === 'chat-b')), sceneB);
});

test('recoverable Skill state has a visible retry path after a Tab is rehydrated', async () => {
  const source = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  for (const fragment of [
    'function retryRecoverableChatSkill(run = skillRun)',
    'skillRun={skillRun}',
    'onRetrySkillRun={retryRecoverableChatSkill}',
    'skillRun?.recoverable',
    '重新运行'
  ]) assert.ok(source.includes(fragment), `missing recoverable Skill UI contract: ${fragment}`);
});

test('root chat handlers bind asynchronous output and restoration to the captured Tab instead of shared state', async () => {
  const source = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  for (const fragment of [
    'function setMessagesForChatTab(tabId, updater)',
    'const chatTabId = currentChatTabId()',
    'setMessagesForChatTab(chatTabId, current =>',
    'function restoreConversation(conversation, tabId = currentChatTabId())',
    'function hydrateChatTab(tab)',
    'setChatTabScene(tabId, { conversationId:',
    'chat: createChatTabScene('
  ]) assert.ok(source.includes(fragment), `missing Tab isolation binding: ${fragment}`);
});

test('opening the current document version clears the historical Tab binding before reloading', async () => {
  const source = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('async function openCurrentReaderVersion'), source.indexOf('function toggleReaderQuestionScope'));
  for (const fragment of [
    "type: 'UPDATE_TAB'",
    "tabId: `document-${id}`",
    'contentVersionId: currentVersionId',
    'isHistoricalVersion: false',
    "evidenceStatus: 'current'",
    'evidenceStatusReason: null',
    'await openContentReader(id)'
  ]) assert.ok(block.includes(fragment), `missing current-version Tab reset: ${fragment}`);
});

test('document Tabs preserve historical Evidence identity and status across normalization and reload', () => {
  const session = workspaceSessionReducer(createInitialWorkspaceSession(), {
    type: 'OPEN_TAB',
    tab: {
      id: 'document-doc-1', kind: 'document', type: 'document', route: 'knowledge', resourceId: 'doc-1', title: 'Versioned source',
      contentVersionId: 3, evidenceStatus: 'stale', evidenceStatusReason: 'content_version_changed',
      evidenceId: 'evidence_3', revision: 'r3', contentHash: 'hash-3', currentVersionId: 4, currentRevision: 'r4', currentContentHash: 'hash-4'
    }
  });
  const storage = memoryStorage();
  const adapter = createWorkspaceStorageAdapter({ storage, key: 'evidence-tab-continuity' });
  assert.equal(adapter.save(session), true);
  const restored = adapter.load();
  const tab = restored.tabs[0];
  assert.equal(tab.contentVersionId, 3);
  assert.equal(tab.evidenceStatus, 'stale');
  assert.equal(tab.evidenceStatusReason, 'content_version_changed');
  assert.equal(tab.revision, 'r3');
  assert.equal(tab.contentHash, 'hash-3');
  assert.equal(tab.currentVersionId, 4);
  assert.equal(tab.currentRevision, 'r4');
  assert.equal(tab.currentContentHash, 'hash-4');
});
