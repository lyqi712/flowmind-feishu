export const WORKSPACE_SESSION_VERSION = 4;
export const CHAT_TAB_SCENE_VERSION = 2;
export const WORKSPACE_SESSION_STORAGE_KEY = 'flowmind.workspace.session';
export const DEFAULT_MAX_TABS = 20;
export const DEFAULT_MAX_RECENT_WORK = 40;
export const DEFAULT_MAX_CONTEXT_ITEMS = 50;

const SHELL_MODULE_ROUTES = new Set([
  'settings', 'copilots', 'skills', 'graph', 'evidence', 'analysis', 'writing', 'recording'
]);

const CHAT_AGENT_MODES = new Set(['auto', 'chat', 'quick', 'research', 'write']);
const CHAT_TERMINAL_SKILL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

const TASK_STATUSES = new Set(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value) {
  return isRecord(value) ? value : {};
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveLimit(value, fallback) {
  const number = Math.trunc(finiteNumber(value, fallback));
  return number > 0 ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value, minimum)));
}

function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

function stableHash(input) {
  let hash = 2166136261;
  for (const character of String(input)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isReusableChatTab(tab) {
  return isChatWorkspaceTab(tab) && !String(tab?.id || '').startsWith('module-');
}

function chatConversationId(tab) {
  if (!isReusableChatTab(tab)) return null;
  return nonEmptyString(
    asRecord(tab?.chat).conversationId
    ?? asRecord(tab?.chatScene).conversationId
    ?? tab?.chatConversationId
  );
}

function tabIdentity(tab) {
  const resource = nonEmptyString(tab?.resourceId ?? tab?.documentId ?? tab?.noteId ?? tab?.url);
  const kind = nonEmptyString(tab?.kind ?? tab?.type) ?? 'workspace';
  if (resource) return `resource:${kind}:${resource}`;
  const conversationId = chatConversationId(tab);
  if (conversationId) return `conversation:${conversationId}`;
  const explicitId = nonEmptyString(tab?.id);
  if (explicitId) return `id:${explicitId}`;
  const title = nonEmptyString(tab?.title) ?? 'untitled';
  return `fallback:${kind}:${title}`;
}

function tabId(tab, index = 0) {
  return nonEmptyString(tab?.id) ?? `tab-${stableHash(`${tabIdentity(tab)}:${index}`)}`;
}

export function isChatWorkspaceTab(tab) {
  const kind = nonEmptyString(tab?.kind ?? tab?.type) ?? '';
  const route = nonEmptyString(tab?.route) ?? '';
  return kind === 'chat' || (route === 'knowledge' && kind !== 'document');
}

export function isPersistedWorkspaceTab(tab) {
  const route = nonEmptyString(tab?.route) ?? '';
  const id = nonEmptyString(tab?.id) ?? '';
  if (SHELL_MODULE_ROUTES.has(route)) return false;
  if (id.startsWith('module-') && id !== 'module-knowledge' && id !== 'module-notes') return false;
  return true;
}

function normalizeChatDocumentIds(value) {
  return [...new Set(asArray(value).map(item => nonEmptyString(item)).filter(Boolean))].slice(0, 200);
}

function normalizeChatScopeExplicit(value) {
  return value === true;
}

function normalizeChatSelection(value) {
  if (!isRecord(value)) return null;
  const documentId = nonEmptyString(value.documentId ?? value.sourceId ?? value.id);
  const quote = String(value.quote ?? value.text ?? '').trim().slice(0, 1600);
  const anchor = nonEmptyString(value.anchor ?? value.sourceAnchor);
  const startOffset = Number(value.startOffset);
  const endOffset = Number(value.endOffset);
  if (!documentId && !quote && !anchor) return null;
  return {
    documentId,
    quote,
    anchor,
    ...(Number.isFinite(startOffset) ? { startOffset } : {}),
    ...(Number.isFinite(endOffset) ? { endOffset } : {})
  };
}

function normalizeChatSkillRun(value) {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id ?? value.runId);
  if (!id) return null;
  const requestedStatus = nonEmptyString(value.status);
  const status = CHAT_TERMINAL_SKILL_STATUSES.has(requestedStatus) ? requestedStatus : 'recoverable';
  return {
    id,
    skillId: nonEmptyString(value.skillId),
    title: nonEmptyString(value.title),
    status,
    startedAt: timestamp(value.startedAt),
    completedAt: timestamp(value.completedAt),
    error: nonEmptyString(value.error)
  };
}

/**
 * Persistent chat scene deliberately excludes message bodies and generated output.
 * Those are recovered from the conversation or run records held by the server.
 */
export function createChatTabScene(value = {}) {
  const scene = asRecord(value);
  return {
    version: CHAT_TAB_SCENE_VERSION,
    conversationId: nonEmptyString(scene.conversationId),
    documentIds: normalizeChatDocumentIds(scene.documentIds ?? scene.scopeDocumentIds),
    scopeExplicit: normalizeChatScopeExplicit(scene.scopeExplicit ?? scene.hasExplicitScope),
    selection: normalizeChatSelection(scene.selection),
    agentMode: CHAT_AGENT_MODES.has(nonEmptyString(scene.agentMode)) ? nonEmptyString(scene.agentMode) : 'auto',
    skillRun: normalizeChatSkillRun(scene.skillRun)
  };
}

export function getChatTabScene(tab) {
  if (!isChatWorkspaceTab(tab)) return createChatTabScene();
  return createChatTabScene(tab?.chat ?? tab?.chatScene ?? {
    conversationId: tab?.chatConversationId,
    documentIds: tab?.documentIds,
    scopeExplicit: tab?.scopeExplicit,
    selection: tab?.selection,
    agentMode: tab?.agentMode,
    skillRun: tab?.skillRun
  });
}

export function findChatTabByConversationId(tabs, conversationId) {
  const id = nonEmptyString(conversationId);
  if (!id) return null;
  return asArray(tabs).find(tab => isReusableChatTab(tab) && getChatTabScene(tab).conversationId === id) || null;
}

function normalizeTab(tab, index = 0) {
  if (!isRecord(tab)) return null;
  const id = tabId(tab, index);
  const normalized = {
    ...tab,
    id,
    kind: nonEmptyString(tab.kind ?? tab.type) ?? 'workspace',
    title: nonEmptyString(tab.title) ?? '未命名',
    pinned: Boolean(tab.pinned),
    dirty: Boolean(tab.dirty),
    openedAt: timestamp(tab.openedAt),
    lastActiveAt: timestamp(tab.lastActiveAt)
  };
  if (!isChatWorkspaceTab(normalized)) return normalized;
  const { messages, chatScene, ...rest } = normalized;
  return { ...rest, chat: getChatTabScene(tab) };
}

function dedupeTabs(tabs) {
  const result = [];
  const indexes = new Map();
  for (const [index, candidate] of asArray(tabs).entries()) {
    const tab = normalizeTab(candidate, index);
    if (!tab) continue;
    const identity = tabIdentity(tab);
    const duplicateIndex = indexes.get(identity) ?? indexes.get(`id:${tab.id}`);
    if (duplicateIndex !== undefined) {
      result[duplicateIndex] = { ...result[duplicateIndex], ...tab, id: result[duplicateIndex].id };
      continue;
    }
    indexes.set(identity, result.length);
    indexes.set(`id:${tab.id}`, result.length);
    result.push(tab);
  }
  return result;
}

function enforceTabLimit(tabs, maximum, protectedId = null) {
  const result = [...tabs];
  while (result.length > maximum) {
    let index = result.findIndex((tab) => !tab.pinned && tab.id !== protectedId);
    if (index < 0) index = result.findIndex((tab) => tab.id !== protectedId);
    if (index < 0) index = 0;
    result.splice(index, 1);
  }
  return result;
}

function workIdentity(item) {
  const resource = nonEmptyString(item?.resourceId ?? item?.documentId ?? item?.noteId ?? item?.draftId ?? item?.url);
  const kind = nonEmptyString(item?.kind ?? item?.type) ?? 'item';
  if (resource) return `resource:${kind}:${resource}`;
  const explicitId = nonEmptyString(item?.id);
  if (explicitId) return `id:${explicitId}`;
  return `fallback:${kind}:${nonEmptyString(item?.title) ?? ''}`;
}

function normalizeRecentWork(items, maximum) {
  const result = [];
  const indexes = new Map();
  for (const candidate of asArray(items)) {
    if (!isRecord(candidate)) continue;
    const item = { ...candidate };
    const identity = workIdentity(item);
    let next = item;
    if (indexes.has(identity)) {
      const oldIndex = indexes.get(identity);
      const existing = result[oldIndex];
      const existingUseCount = Math.max(0, Number(existing?.useCount) || 0);
      const itemUseCount = Math.max(0, Number(item.useCount) || 0);
      next = { ...existing, ...item };
      if (existingUseCount || itemUseCount) next.useCount = existingUseCount + itemUseCount;
      result.splice(oldIndex, 1);
      for (const [key, value] of indexes) {
        if (value > oldIndex) indexes.set(key, value - 1);
      }
    }
    indexes.set(identity, result.length);
    result.push(next);
  }
  return result.slice(-maximum);
}

function contextIdentity(item) {
  const explicitId = nonEmptyString(item?.id);
  if (explicitId) return `id:${explicitId}`;
  const source = nonEmptyString(item?.sourceId ?? item?.documentId ?? item?.noteId ?? item?.url) ?? 'local';
  const selection = nonEmptyString(item?.selectionId ?? item?.rangeId ?? item?.quote ?? item?.content) ?? '';
  const kind = nonEmptyString(item?.kind ?? item?.type) ?? 'resource';
  return `context:${kind}:${source}:${stableHash(selection)}`;
}

function normalizeContextItems(items, maximum) {
  const result = [];
  const indexes = new Map();
  for (const candidate of asArray(items)) {
    if (!isRecord(candidate)) continue;
    const item = { ...candidate };
    const identity = contextIdentity(item);
    const oldIndex = indexes.get(identity);
    if (oldIndex !== undefined) {
      result[oldIndex] = { ...result[oldIndex], ...item };
      continue;
    }
    indexes.set(identity, result.length);
    result.push(item);
  }
  return result.slice(-maximum);
}

function normalizeTask(task, index = 0, options = {}) {
  if (!isRecord(task)) return null;
  const id = nonEmptyString(task.id) ?? `task-${stableHash(`${task.type ?? 'task'}:${task.title ?? ''}:${index}`)}`;
  const requestedStatus = TASK_STATUSES.has(task.status) ? task.status : 'queued';
  const recovered = Boolean(options.recoverRunningTasks) && ['running', 'queued'].includes(requestedStatus);
  const status = recovered ? 'paused' : requestedStatus;
  return {
    ...task,
    id,
    status,
    ...(recovered || task.recoverable === true ? { recoverable: true } : {}),
    progress: clamp(task.progress ?? (status === 'completed' ? 1 : 0), 0, 1),
    createdAt: timestamp(task.createdAt),
    updatedAt: timestamp(task.updatedAt)
  };
}

function normalizeTasks(tasks, options = {}) {
  const result = [];
  const indexes = new Map();
  for (const [index, candidate] of asArray(tasks).entries()) {
    const task = normalizeTask(candidate, index, options);
    if (!task) continue;
    const oldIndex = indexes.get(task.id);
    if (oldIndex !== undefined) result[oldIndex] = { ...result[oldIndex], ...task };
    else {
      indexes.set(task.id, result.length);
      result.push(task);
    }
  }
  return result;
}

function normalizeReadingPositions(positions) {
  const result = {};
  for (const [resourceId, candidate] of Object.entries(asRecord(positions))) {
    if (!nonEmptyString(resourceId) || !isRecord(candidate)) continue;
    result[resourceId] = {
      ...candidate,
      scrollTop: Math.max(0, finiteNumber(candidate.scrollTop, 0)),
      progress: clamp(candidate.progress, 0, 1),
      page: Math.max(0, Math.trunc(finiteNumber(candidate.page, 0))),
      updatedAt: timestamp(candidate.updatedAt)
    };
  }
  return result;
}

function normalizeDraftMarkers(markers) {
  const result = {};
  for (const [resourceId, candidate] of Object.entries(asRecord(markers))) {
    if (!nonEmptyString(resourceId)) continue;
    if (typeof candidate === 'boolean') {
      result[resourceId] = { dirty: candidate, updatedAt: null };
      continue;
    }
    if (!isRecord(candidate)) continue;
    result[resourceId] = {
      ...candidate,
      dirty: candidate.dirty !== false,
      updatedAt: timestamp(candidate.updatedAt)
    };
  }
  return result;
}

export function createInitialWorkspaceSession() {
  return {
    version: WORKSPACE_SESSION_VERSION,
    tabs: [],
    activeTabId: null,
    recentWork: [],
    readingPositions: {},
    aiContextItems: [],
    tasks: [],
    draftMarkers: {}
  };
}

/**
 * Converts every supported historical shape to the current schema. This function
 * does not mutate the supplied value and is safe to call for already-current data.
 */
export function migrateWorkspaceSession(value) {
  if (!isRecord(value)) return createInitialWorkspaceSession();

  const version = Math.max(0, Math.trunc(finiteNumber(value.version ?? value.schemaVersion, 0)));
  let migrated = { ...value };

  if (version < 1) {
    migrated = {
      ...migrated,
      tabs: migrated.tabs ?? migrated.openTabs ?? [],
      activeTabId: migrated.activeTabId ?? migrated.activeTab ?? null,
      recentWork: migrated.recentWork ?? migrated.recent ?? [],
      readingPositions: migrated.readingPositions ?? migrated.readerPositions ?? {},
      aiContextItems: migrated.aiContextItems ?? migrated.context ?? [],
      tasks: migrated.tasks ?? migrated.backgroundTasks ?? [],
      draftMarkers: migrated.draftMarkers ?? migrated.drafts ?? {}
    };
  }

  if (version < 2) {
    migrated = {
      ...migrated,
      aiContextItems: migrated.aiContextItems ?? migrated.contextItems ?? [],
      draftMarkers: migrated.draftMarkers ?? migrated.dirtyDrafts ?? {}
    };
  }

  if (version < 3) {
    migrated = {
      ...migrated,
      tasks: asArray(migrated.tasks).map((task) => ({
        ...task,
        progress: finiteNumber(task?.progress, 0) > 1
          ? finiteNumber(task?.progress, 0) / 100
          : task?.progress
      }))
    };
  }

  if (version < 4) {
    migrated = {
      ...migrated,
      tabs: asArray(migrated.tabs).map(tab => isChatWorkspaceTab(tab)
        ? { ...tab, chat: getChatTabScene(tab) }
        : tab)
    };
  }

  return { ...migrated, version: WORKSPACE_SESSION_VERSION };
}

export function normalizeWorkspaceSession(value, options = {}) {
  const migrated = migrateWorkspaceSession(value);
  const maxTabs = positiveLimit(options.maxTabs, DEFAULT_MAX_TABS);
  const maxRecentWork = positiveLimit(options.maxRecentWork, DEFAULT_MAX_RECENT_WORK);
  const maxContextItems = positiveLimit(options.maxContextItems, DEFAULT_MAX_CONTEXT_ITEMS);
  const requestedActive = nonEmptyString(migrated.activeTabId);
  let tabs = enforceTabLimit(dedupeTabs(migrated.tabs), maxTabs, requestedActive).filter(isPersistedWorkspaceTab);
  const activeTabId = tabs.some((tab) => tab.id === requestedActive) ? requestedActive : null;

  return {
    version: WORKSPACE_SESSION_VERSION,
    tabs,
    activeTabId,
    recentWork: normalizeRecentWork(migrated.recentWork, maxRecentWork),
    readingPositions: normalizeReadingPositions(migrated.readingPositions),
    aiContextItems: normalizeContextItems(migrated.aiContextItems, maxContextItems),
    tasks: normalizeTasks(migrated.tasks, options),
    draftMarkers: normalizeDraftMarkers(migrated.draftMarkers)
  };
}

function openTab(state, action, options) {
  const source = action.tab ?? action.payload;
  const candidate = normalizeTab(source, state.tabs.length);
  if (!candidate) return state;
  const identity = tabIdentity(candidate);
  const existing = state.tabs.find((tab) => tab.id === candidate.id || tabIdentity(tab) === identity);
  const hasExplicitChatScene = isRecord(source) && (Object.hasOwn(source, 'chat') || Object.hasOwn(source, 'chatScene'));
  const merged = existing
    ? state.tabs.map((tab) => {
      if (tab.id !== existing.id) return tab;
      const next = { ...tab, ...candidate, id: existing.id };
      if (isChatWorkspaceTab(next) && !hasExplicitChatScene) next.chat = getChatTabScene(tab);
      if (tab.readerConversationId && !candidate.readerConversationId) next.readerConversationId = tab.readerConversationId;
      return next;
    })
    : [...state.tabs, candidate];
  const activeTabId = existing?.id ?? candidate.id;
  return {
    ...state,
    tabs: enforceTabLimit(merged, positiveLimit(options.maxTabs, DEFAULT_MAX_TABS), activeTabId),
    activeTabId
  };
}

function closeTab(state, tabIdToClose) {
  const id = nonEmptyString(tabIdToClose);
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (state.activeTabId !== id) return { ...state, tabs };
  return { ...state, tabs, activeTabId: tabs[index]?.id ?? tabs[index - 1]?.id ?? null };
}

function updateTask(state, action) {
  const patch = action.patch ?? action.task ?? action.payload ?? {};
  const id = nonEmptyString(action.id ?? action.taskId ?? patch.id);
  if (!id) return state;
  const index = state.tasks.findIndex((task) => task.id === id);
  const current = index >= 0 ? state.tasks[index] : { id, status: 'queued', progress: 0 };
  const task = normalizeTask({ ...current, ...patch, id }, index >= 0 ? index : state.tasks.length);
  const tasks = [...state.tasks];
  if (index >= 0) tasks[index] = task;
  else tasks.push(task);
  return { ...state, tasks };
}

/** Pure state transition function. Supply timestamps and generated IDs in actions. */
export function workspaceSessionReducer(currentState, action = {}, options = {}) {
  const state = normalizeWorkspaceSession(currentState, options);
  switch (action.type) {
    case 'RESTORE_SESSION':
    case 'HYDRATE':
      return normalizeWorkspaceSession(action.session ?? action.payload, options);

    case 'OPEN_TAB':
      return openTab(state, action, options);

    case 'ACTIVATE_HOME':
      return state.activeTabId === null ? state : { ...state, activeTabId: null };

    case 'ACTIVATE_TAB': {
      const id = nonEmptyString(action.id ?? action.tabId ?? action.payload);
      if (!state.tabs.some((tab) => tab.id === id) || state.activeTabId === id) return state;
      return {
        ...state,
        activeTabId: id,
        tabs: state.tabs.map((tab) => tab.id === id && action.at !== undefined
          ? { ...tab, lastActiveAt: timestamp(action.at) }
          : tab)
      };
    }

    case 'UPDATE_TAB': {
      const id = nonEmptyString(action.id ?? action.tabId ?? action.payload?.id);
      if (!id) return state;
      const tabs = state.tabs.map((tab) => tab.id === id
        ? normalizeTab({ ...tab, ...(action.patch ?? action.payload), id }, 0)
        : tab);
      return { ...state, tabs: dedupeTabs(tabs) };
    }

    case 'SET_CHAT_TAB_SCENE':
    case 'PATCH_CHAT_TAB_SCENE': {
      const id = nonEmptyString(action.id ?? action.tabId ?? action.payload?.id);
      const patch = asRecord(action.patch ?? action.scene ?? action.payload);
      if (!id) return state;
      let changed = false;
      const tabs = state.tabs.map(tab => {
        if (tab.id !== id || !isChatWorkspaceTab(tab)) return tab;
        changed = true;
        return { ...tab, chat: createChatTabScene({ ...getChatTabScene(tab), ...patch }) };
      });
      return changed ? { ...state, tabs } : state;
    }

    case 'CLOSE_TAB':
      return closeTab(state, action.id ?? action.tabId ?? action.payload);

    case 'CLOSE_OTHER_TABS': {
      const id = nonEmptyString(action.id ?? action.tabId ?? state.activeTabId);
      const tabs = state.tabs.filter((tab) => tab.id === id || tab.pinned);
      return { ...state, tabs, activeTabId: tabs.some((tab) => tab.id === id) ? id : tabs.at(-1)?.id ?? null };
    }

    case 'TOUCH_RECENT_WORK':
    case 'ADD_RECENT_WORK': {
      const item = action.item ?? action.payload;
      if (!isRecord(item)) return state;
      const identity = workIdentity(item);
      const existing = state.recentWork.find(entry => workIdentity(entry) === identity);
      const merged = { ...(existing || {}), ...item };
      if (action.type === 'TOUCH_RECENT_WORK') {
        const previousCount = Math.max(0, Number(existing?.useCount ?? item.useCount ?? 0) || 0);
        merged.useCount = previousCount + 1;
        merged.lastUsedAt = timestamp(action.at ?? Date.now());
      }
      return {
        ...state,
        recentWork: normalizeRecentWork(
          [...state.recentWork.filter((entry) => workIdentity(entry) !== identity), merged],
          positiveLimit(options.maxRecentWork, DEFAULT_MAX_RECENT_WORK)
        )
      };
    }

    case 'SET_RECENT_WORK':
      return { ...state, recentWork: normalizeRecentWork(action.items ?? action.payload, positiveLimit(options.maxRecentWork, DEFAULT_MAX_RECENT_WORK)) };

    case 'SET_READING_POSITION': {
      const resourceId = nonEmptyString(action.resourceId ?? action.documentId ?? action.id);
      const position = action.position ?? action.payload;
      if (!resourceId || !isRecord(position)) return state;
      return {
        ...state,
        readingPositions: normalizeReadingPositions({
          ...state.readingPositions,
          [resourceId]: { ...state.readingPositions[resourceId], ...position }
        })
      };
    }

    case 'REMOVE_READING_POSITION': {
      const resourceId = nonEmptyString(action.resourceId ?? action.documentId ?? action.id ?? action.payload);
      if (!resourceId || !(resourceId in state.readingPositions)) return state;
      const readingPositions = { ...state.readingPositions };
      delete readingPositions[resourceId];
      return { ...state, readingPositions };
    }

    case 'ADD_AI_CONTEXT_ITEM': {
      const item = action.item ?? action.payload;
      if (!isRecord(item)) return state;
      return {
        ...state,
        aiContextItems: normalizeContextItems(
          [...state.aiContextItems, item],
          positiveLimit(options.maxContextItems, DEFAULT_MAX_CONTEXT_ITEMS)
        )
      };
    }

    case 'REMOVE_AI_CONTEXT_ITEM': {
      const identity = action.identity ?? (isRecord(action.item) ? contextIdentity(action.item) : null);
      const id = nonEmptyString(action.id ?? action.contextId ?? action.payload);
      return {
        ...state,
        aiContextItems: state.aiContextItems.filter((item) => {
          if (id && item.id === id) return false;
          if (identity && contextIdentity(item) === identity) return false;
          return true;
        })
      };
    }

    case 'CLEAR_AI_CONTEXT':
      return { ...state, aiContextItems: [] };

    case 'UPSERT_TASK':
    case 'UPDATE_TASK':
      return updateTask(state, action);

    case 'REMOVE_TASK': {
      const id = nonEmptyString(action.id ?? action.taskId ?? action.payload);
      return id ? { ...state, tasks: state.tasks.filter((task) => task.id !== id) } : state;
    }

    case 'SET_DRAFT_MARKER': {
      const resourceId = nonEmptyString(action.resourceId ?? action.documentId ?? action.noteId ?? action.id);
      if (!resourceId) return state;
      const marker = isRecord(action.marker ?? action.payload) ? (action.marker ?? action.payload) : {};
      return {
        ...state,
        draftMarkers: normalizeDraftMarkers({
          ...state.draftMarkers,
          [resourceId]: { ...state.draftMarkers[resourceId], ...marker, dirty: marker.dirty !== false }
        })
      };
    }

    case 'CLEAR_DRAFT_MARKER': {
      const resourceId = nonEmptyString(action.resourceId ?? action.documentId ?? action.noteId ?? action.id ?? action.payload);
      if (!resourceId || !(resourceId in state.draftMarkers)) return state;
      const draftMarkers = { ...state.draftMarkers };
      delete draftMarkers[resourceId];
      return { ...state, draftMarkers };
    }

    case 'RESET_SESSION':
      return createInitialWorkspaceSession();

    default:
      return state;
  }
}

function resolveBrowserStorage() {
  try {
    const storage = globalThis?.localStorage;
    if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') return storage;
  } catch {
    // Browser privacy/security settings may make the localStorage getter throw.
  }
  return null;
}

/**
 * Safe JSON storage adapter. When localStorage is absent or starts throwing, it
 * continues in memory for the lifetime of this adapter and never breaks startup.
 */
export function createWorkspaceStorageAdapter(options = {}) {
  const key = nonEmptyString(options.key) ?? WORKSPACE_SESSION_STORAGE_KEY;
  let storage = options.storage === undefined ? resolveBrowserStorage() : options.storage;
  let memoryValue = null;
  let persistent = Boolean(storage);

  function report(error, operation) {
    if (typeof options.onError === 'function') options.onError(error, operation);
  }

  function readRaw() {
    if (storage) {
      try {
        return storage.getItem(key);
      } catch (error) {
        report(error, 'read');
        storage = null;
        persistent = false;
      }
    }
    return memoryValue;
  }

  return {
    key,
    get isPersistent() {
      return persistent;
    },
    load(loadOptions = {}) {
      const raw = readRaw();
      if (typeof raw !== 'string' || !raw.trim()) return createInitialWorkspaceSession();
      try {
        return normalizeWorkspaceSession(JSON.parse(raw), { ...options, ...loadOptions });
      } catch (error) {
        report(error, 'parse');
        memoryValue = null;
        if (storage) {
          try { storage.removeItem(key); } catch (removeError) { report(removeError, 'remove-corrupt'); }
        }
        return createInitialWorkspaceSession();
      }
    },
    save(session, saveOptions = {}) {
      let raw;
      try {
        raw = JSON.stringify(normalizeWorkspaceSession(session, { ...options, ...saveOptions }));
      } catch (error) {
        report(error, 'serialize');
        return false;
      }
      memoryValue = raw;
      if (!storage) return false;
      try {
        storage.setItem(key, raw);
        return true;
      } catch (error) {
        report(error, 'write');
        storage = null;
        persistent = false;
        return false;
      }
    },
    clear() {
      memoryValue = null;
      if (!storage) return false;
      try {
        storage.removeItem(key);
        return true;
      } catch (error) {
        report(error, 'clear');
        storage = null;
        persistent = false;
        return false;
      }
    }
  };
}
