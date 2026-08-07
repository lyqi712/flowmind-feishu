import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_TABS,
  WORKSPACE_SESSION_VERSION,
  createInitialWorkspaceSession,
  createWorkspaceStorageAdapter,
  migrateWorkspaceSession,
  normalizeWorkspaceSession,
  workspaceSessionReducer
} from '../src/workspace/workspace-session.js';

function reduce(state, action, options) {
  return workspaceSessionReducer(state, action, options);
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    value(key) { return values.get(key); }
  };
}

test('storage adapter persists and restores the complete workspace session', () => {
  const storage = memoryStorage();
  const adapter = createWorkspaceStorageAdapter({ storage, key: 'test-session' });
  let state = createInitialWorkspaceSession();
  state = reduce(state, { type: 'OPEN_TAB', tab: { id: 'doc-1', kind: 'document', title: '方案', resourceId: 'content-1' } });
  state = reduce(state, { type: 'TOUCH_RECENT_WORK', item: { id: 'content-1', kind: 'document', title: '方案' } });
  state = reduce(state, { type: 'SET_READING_POSITION', resourceId: 'content-1', position: { scrollTop: 640, progress: 0.42, anchor: 'section-3' } });
  state = reduce(state, { type: 'ADD_AI_CONTEXT_ITEM', item: { id: 'ctx-1', kind: 'document', sourceId: 'content-1', title: '方案' } });
  state = reduce(state, { type: 'UPSERT_TASK', task: { id: 'sync-1', type: 'feishu-sync', status: 'running', progress: 0.35 } });
  state = reduce(state, { type: 'SET_DRAFT_MARKER', resourceId: 'note-1', marker: { dirty: true, updatedAt: '2026-08-04T10:00:00Z' } });

  assert.equal(adapter.save(state), true);
  const restored = adapter.load();
  assert.deepEqual(restored, state);
  assert.equal(restored.activeTabId, 'doc-1');
  assert.equal(restored.readingPositions['content-1'].anchor, 'section-3');
  assert.equal(restored.tasks[0].status, 'running');
  assert.equal(restored.draftMarkers['note-1'].dirty, true);
});

test('legacy v0 session migrates aliases and percentage task progress to the current version', () => {
  const legacy = {
    openTabs: [{ id: 'legacy-doc', type: 'document', title: '旧文档' }],
    activeTab: 'legacy-doc',
    recent: [{ id: 'legacy-doc', title: '旧文档' }],
    readerPositions: { 'legacy-doc': { scrollTop: 80, progress: 0.2 } },
    context: [{ id: 'legacy-context', sourceId: 'legacy-doc' }],
    backgroundTasks: [{ id: 'legacy-task', status: 'running', progress: 75 }],
    drafts: { 'legacy-note': true }
  };

  const migrated = normalizeWorkspaceSession(migrateWorkspaceSession(legacy));
  assert.equal(migrated.version, WORKSPACE_SESSION_VERSION);
  assert.equal(migrated.tabs[0].kind, 'document');
  assert.equal(migrated.activeTabId, 'legacy-doc');
  assert.equal(migrated.recentWork[0].id, 'legacy-doc');
  assert.equal(migrated.readingPositions['legacy-doc'].scrollTop, 80);
  assert.equal(migrated.aiContextItems[0].id, 'legacy-context');
  assert.equal(migrated.tasks[0].progress, 0.75);
  assert.deepEqual(migrated.draftMarkers['legacy-note'], { dirty: true, updatedAt: null });
});

test('closing the active tab selects the right neighbour then falls back to the left neighbour', () => {
  let state = createInitialWorkspaceSession();
  for (const id of ['a', 'b', 'c']) state = reduce(state, { type: 'OPEN_TAB', tab: { id, title: id } });
  state = reduce(state, { type: 'ACTIVATE_TAB', tabId: 'b' });
  state = reduce(state, { type: 'CLOSE_TAB', tabId: 'b' });
  assert.deepEqual(state.tabs.map((tab) => tab.id), ['a', 'c']);
  assert.equal(state.activeTabId, 'c');

  state = reduce(state, { type: 'CLOSE_TAB', tabId: 'c' });
  assert.equal(state.activeTabId, 'a');
  state = reduce(state, { type: 'CLOSE_TAB', tabId: 'a' });
  assert.equal(state.activeTabId, null);
});

test('workspace home deactivates the current tab without discarding the restored workset', () => {
  let state = createInitialWorkspaceSession();
  state = reduce(state, { type: 'OPEN_TAB', tab: { id: 'doc-home', kind: 'document', title: '方案' } });
  state = reduce(state, { type: 'ACTIVATE_HOME' });
  assert.equal(state.activeTabId, null);
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].id, 'doc-home');
});

test('opening duplicate resources activates and updates the existing tab without duplication', () => {
  let state = createInitialWorkspaceSession();
  state = reduce(state, { type: 'OPEN_TAB', tab: { id: 'first-id', kind: 'document', resourceId: 'doc-9', title: '旧标题' } });
  state = reduce(state, { type: 'OPEN_TAB', tab: { id: 'other-id', kind: 'document', resourceId: 'doc-9', title: '新标题' } });
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].id, 'first-id');
  assert.equal(state.tabs[0].title, '新标题');
  assert.equal(state.activeTabId, 'first-id');
});

test('maximum tab count evicts the oldest non-pinned inactive tab and protects the new active tab', () => {
  let state = createInitialWorkspaceSession();
  state = reduce(state, { type: 'OPEN_TAB', tab: { id: 'pinned', title: '固定', pinned: true } }, { maxTabs: 3 });
  state = reduce(state, { type: 'OPEN_TAB', tab: { id: 'old', title: '旧标签' } }, { maxTabs: 3 });
  state = reduce(state, { type: 'OPEN_TAB', tab: { id: 'middle', title: '中间标签' } }, { maxTabs: 3 });
  state = reduce(state, { type: 'OPEN_TAB', tab: { id: 'new', title: '新标签' } }, { maxTabs: 3 });
  assert.deepEqual(state.tabs.map((tab) => tab.id), ['pinned', 'middle', 'new']);
  assert.equal(state.activeTabId, 'new');

  const many = normalizeWorkspaceSession({ tabs: Array.from({ length: DEFAULT_MAX_TABS + 5 }, (_, index) => ({ id: `tab-${index}`, title: `${index}` })) });
  assert.equal(many.tabs.length, DEFAULT_MAX_TABS);
});

test('AI context items deduplicate by id and semantic source selection identity', () => {
  let state = createInitialWorkspaceSession();
  state = reduce(state, { type: 'ADD_AI_CONTEXT_ITEM', item: { id: 'context-1', kind: 'selection', sourceId: 'doc-1', quote: '关键段落', title: '旧标题' } });
  state = reduce(state, { type: 'ADD_AI_CONTEXT_ITEM', item: { id: 'context-1', kind: 'selection', sourceId: 'doc-1', quote: '关键段落', title: '新标题' } });
  state = reduce(state, { type: 'ADD_AI_CONTEXT_ITEM', item: { kind: 'selection', sourceId: 'doc-2', quote: '同一段', title: '第一次' } });
  state = reduce(state, { type: 'ADD_AI_CONTEXT_ITEM', item: { kind: 'selection', sourceId: 'doc-2', quote: '同一段', title: '第二次' } });
  assert.equal(state.aiContextItems.length, 2);
  assert.equal(state.aiContextItems[0].title, '新标题');
  assert.equal(state.aiContextItems[1].title, '第二次');
});

test('background task updates preserve task data and normalize status and progress', () => {
  let state = createInitialWorkspaceSession();
  state = reduce(state, { type: 'UPSERT_TASK', task: { id: 'report-1', type: 'research-report', status: 'queued', title: '研究报告' } });
  state = reduce(state, { type: 'UPDATE_TASK', taskId: 'report-1', patch: { status: 'running', progress: 0.55, step: 'evidence' } });
  assert.deepEqual(state.tasks[0], {
    id: 'report-1', type: 'research-report', status: 'running', title: '研究报告', progress: 0.55,
    step: 'evidence', createdAt: null, updatedAt: null
  });

  state = reduce(state, { type: 'UPDATE_TASK', taskId: 'report-1', patch: { status: 'completed', progress: 2 } });
  assert.equal(state.tasks[0].status, 'completed');
  assert.equal(state.tasks[0].progress, 1);
  state = reduce(state, { type: 'UPDATE_TASK', taskId: 'report-1', patch: { status: 'unknown' } });
  assert.equal(state.tasks[0].status, 'queued');
});

test('corrupt persisted JSON is removed and recovered as a clean session', () => {
  const storage = memoryStorage({ broken: '{ definitely-not-json' });
  const errors = [];
  const adapter = createWorkspaceStorageAdapter({ storage, key: 'broken', onError: (_error, operation) => errors.push(operation) });
  assert.deepEqual(adapter.load(), createInitialWorkspaceSession());
  assert.equal(storage.value('broken'), undefined);
  assert.deepEqual(errors, ['parse']);
});

test('adapter safely degrades to in-memory recovery when localStorage is unavailable', () => {
  const adapter = createWorkspaceStorageAdapter({ storage: null });
  const state = reduce(createInitialWorkspaceSession(), { type: 'OPEN_TAB', tab: { id: 'offline', title: '离线工作' } });
  assert.equal(adapter.isPersistent, false);
  assert.equal(adapter.save(state), false);
  assert.equal(adapter.load().activeTabId, 'offline');
  assert.equal(adapter.clear(), false);
  assert.deepEqual(adapter.load(), createInitialWorkspaceSession());
});

test('a throwing storage backend degrades without breaking startup or subsequent in-memory saves', () => {
  const operations = [];
  const storage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };
  const adapter = createWorkspaceStorageAdapter({ storage, onError: (_error, operation) => operations.push(operation) });
  assert.deepEqual(adapter.load(), createInitialWorkspaceSession());
  const state = reduce(createInitialWorkspaceSession(), { type: 'OPEN_TAB', tab: { id: 'safe', title: '安全退化' } });
  assert.equal(adapter.save(state), false);
  assert.equal(adapter.load().activeTabId, 'safe');
  assert.deepEqual(operations, ['read']);
});
