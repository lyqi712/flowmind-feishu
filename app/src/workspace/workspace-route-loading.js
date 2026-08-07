const SURFACE_LOADERS = Object.freeze({
  'collection': () => import('../components/CollectionCenter.jsx'),
  'composer-menu': () => import('../components/ComposerCommandMenu.jsx'),
  'content-reader': () => import('../components/ContentReader.jsx'),
  'deep-answer': () => import('../components/DeepAnswerPanel.jsx'),
  'feishu-sync': () => import('../components/FeishuSyncWizard.jsx'),
  'knowledge-graph': () => import('../components/KnowledgeGraph.jsx'),
  'recording': () => import('../components/RecordingWorkspace.jsx'),
  'settings': () => import('../components/SettingsExperience.jsx'),
  'notes': () => import('../components/NotesWorkspace.jsx'),
  'writing': () => import('../components/WritingWorkspace.jsx'),
  'analysis': () => import('../components/DocumentAnalysisWorkspace.jsx'),
  'copilot': () => import('../components/CopilotWorkspace.jsx')
});

const ROUTE_SURFACES = Object.freeze({
  collect: ['collection'],
  knowledge: ['composer-menu'],
  analysis: ['analysis'],
  notes: ['notes'],
  writing: ['writing'],
  recording: ['recording'],
  copilots: ['copilot'],
  settings: ['settings']
});

export function createWorkspaceSurfaceLoader(loaders = SURFACE_LOADERS) {
  const promises = new Map();
  function load(surface) {
    const key = String(surface || '').trim();
    const loader = loaders[key];
    if (!loader) return Promise.reject(new Error(`Unknown workspace surface: ${key || '(empty)'}`));
    if (!promises.has(key)) {
      const promise = Promise.resolve().then(loader).catch(error => {
        promises.delete(key);
        throw error;
      });
      promises.set(key, promise);
    }
    return promises.get(key);
  }
  function preload(surface) {
    return load(surface).then(() => ({ surface, status: 'loaded' }));
  }
  return { load, preload };
}

const surfaceLoader = createWorkspaceSurfaceLoader();

export function workspaceRouteSurfaces(route) {
  return [...(ROUTE_SURFACES[String(route || '').trim()] || [])];
}

export function loadWorkspaceSurface(surface) {
  return surfaceLoader.load(surface);
}

export function preloadWorkspaceSurface(surface) {
  return surfaceLoader.preload(surface).catch(error => ({
    surface,
    status: 'failed',
    error: error?.message || String(error)
  }));
}

export function preloadWorkspaceRoute(route) {
  const surfaces = workspaceRouteSurfaces(route);
  if (!surfaces.length) return Promise.resolve({ route, loaded: [], failed: [] });
  return Promise.all(surfaces.map(preloadWorkspaceSurface)).then(results => ({
    route,
    loaded: results.filter(result => result.status === 'loaded').map(result => result.surface),
    failed: results.filter(result => result.status === 'failed').map(result => ({ surface: result.surface, error: result.error }))
  }));
}
