import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, screen, session, shell } from 'electron';
import { createDesktopLogger } from './logger.mjs';
import { isMcpStdioArgv, startMcpStdio } from './mcp-stdio.mjs';
import { startDesktopHost } from './runtime.mjs';
import { resolveDesktopWorkspace } from './seed-userdata.mjs';
import { createWindowStateStore, ensureBoundsOnScreen } from './window-state.mjs';

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const developmentAppRoot = path.resolve(desktopDir, '..');
const smokeMode = process.env.IMA_DESKTOP_SMOKE_TEST === '1';
const allowedExternalProtocols = new Set(['https:', 'http:', 'mailto:']);
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' https: http:",
  "child-src 'self' https: http: blob:"
].join('; ');

let mainWindow = null;
let desktopHost = null;
let windowStateStore = null;
let logger = null;
let shutdownPromise = null;
let localOrigin = null;
const markdownMirrorRoots = new Map();

function appRootPath() {
  return app.isPackaged ? app.getAppPath() : developmentAppRoot;
}

function isAllowedExternalUrl(candidate) {
  try {
    const url = new URL(candidate);
    return allowedExternalProtocols.has(url.protocol);
  } catch {
    return false;
  }
}

async function openExternal(candidate) {
  if (!isAllowedExternalUrl(candidate)) throw new Error('Unsupported external URL protocol');
  await shell.openExternal(candidate, { activate: true });
  return true;
}

function mirrorRoot(rootId) {
  const root = markdownMirrorRoots.get(String(rootId));
  if (!root) throw Object.assign(new Error('Markdown mirror root is not selected'), { code: 'MIRROR_ROOT_NOT_FOUND' });
  return root;
}

function mirrorPath(root, relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => !part || part === '.' || part === '..') || !/\.md$/i.test(normalized)) {
    throw Object.assign(new Error('Markdown mirror path is invalid'), { code: 'MIRROR_PATH_INVALID' });
  }
  const target = path.resolve(root.path, ...normalized.split('/'));
  const relative = path.relative(root.path, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Object.assign(new Error('Markdown mirror path escapes its selected root'), { code: 'MIRROR_PATH_ESCAPE' });
  return target;
}

async function collectMarkdownFiles(root, directory = root.path, files = []) {
  if (files.length >= 2000) return files;
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdownFiles(root, candidate, files);
      if (files.length >= 2000) break;
      continue;
    }
    if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
    const stat = await fs.promises.stat(candidate);
    if (stat.size > 4 * 1024 * 1024) continue;
    const relativePath = path.relative(root.path, candidate).split(path.sep).join('/');
    files.push({ relativePath, content: await fs.promises.readFile(candidate, 'utf8'), modifiedAt: stat.mtime.toISOString() });
  }
  return files;
}

async function chooseMarkdownMirrorRoot(browserWindow) {
  const result = await dialog.showOpenDialog(browserWindow, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { cancelled: true };
  const selected = path.resolve(result.filePaths[0]);
  const root = { id: `mirror_${randomUUID()}`, path: selected, displayName: path.basename(selected) || 'Markdown vault' };
  markdownMirrorRoots.set(root.id, root);
  return { cancelled: false, rootId: root.id, displayName: root.displayName };
}

function configureSessionSecurity(origin) {
  const appSession = session.defaultSession;
  appSession.setPermissionCheckHandler(() => false);
  appSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
  appSession.webRequest.onHeadersReceived((details, callback) => {
    try {
      if (new URL(details.url).origin !== origin) return callback({ responseHeaders: details.responseHeaders });
    } catch {
      return callback({ responseHeaders: details.responseHeaders });
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    });
  });
}

function configureNavigationSecurity(browserWindow, origin) {
  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void openExternal(url).catch((error) => logger?.warn('external link failed', error));
    return { action: 'deny' };
  });

  browserWindow.webContents.on('will-navigate', (event, target) => {
    let targetOrigin = null;
    try { targetOrigin = new URL(target).origin; } catch {}
    if (targetOrigin === origin) return;
    event.preventDefault();
    if (isAllowedExternalUrl(target)) void openExternal(target).catch((error) => logger?.warn('external navigation failed', error));
  });
}

async function createMainWindow(origin) {
  const state = ensureBoundsOnScreen(windowStateStore.load(), screen);
  const browserWindow = new BrowserWindow({
    ...state,
    show: false,
    minWidth: 960,
    minHeight: 640,
    title: 'FlowMind 飞书 AI 工作台',
    backgroundColor: '#f4f1ea',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(desktopDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
      navigateOnDragDrop: false,
      spellcheck: true,
      devTools: !app.isPackaged && !smokeMode
    }
  });

  windowStateStore.attach(browserWindow);
  configureNavigationSecurity(browserWindow, origin);
  browserWindow.on('ready-to-show', () => {
    if (!smokeMode) browserWindow.show();
  });
  browserWindow.on('closed', () => {
    if (mainWindow === browserWindow) mainWindow = null;
  });
  browserWindow.webContents.on('render-process-gone', (event, details) => logger?.error('renderer exited', details));
  browserWindow.webContents.on('unresponsive', () => logger?.warn('renderer became unresponsive'));

  await browserWindow.loadURL(origin);
  if (state.isMaximized) browserWindow.maximize();
  return browserWindow;
}

async function shutdown(reason, exitCode = 0) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    logger?.info('desktop shutdown requested', reason);
    try { await windowStateStore?.flush(); } catch (error) { logger?.warn('window state flush failed', error); }
    try { await desktopHost?.close(); } catch (error) { logger?.warn('desktop host close failed', error); }
    try { await logger?.close(); } catch {}
    app.exit(exitCode);
  })();
  return shutdownPromise;
}

const mcpMode = isMcpStdioArgv();
const hasSingleInstanceLock = mcpMode || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  if (!mcpMode) {
    app.on('second-instance', () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });

    app.on('before-quit', (event) => {
      if (shutdownPromise) return;
      event.preventDefault();
      void shutdown('before-quit');
    });

    app.on('activate', async () => {
      if (!mainWindow && localOrigin) mainWindow = await createMainWindow(localOrigin);
    });
  }

  app.on('window-all-closed', () => {
    if (mcpMode) return;
    app.quit();
  });

  process.on('uncaughtException', (error) => {
    logger?.error('uncaught exception', error);
    void shutdown('uncaught-exception', 1);
  });
  process.on('unhandledRejection', (error) => {
    logger?.error('unhandled rejection', error);
  });

  await app.whenReady();
  app.setAppUserModelId('com.flowmind.feishucopilot');

  const userData = app.getPath('userData');
  logger = createDesktopLogger({ filePath: path.join(userData, 'logs', 'desktop.log') });
  windowStateStore = createWindowStateStore({ filePath: path.join(userData, 'window-state.json'), logger });
  const workspace = resolveDesktopWorkspace({
    userData,
    unpackagedRoot: app.isPackaged ? null : developmentAppRoot,
    isolated: smokeMode
  });
  logger.info('desktop workspace ready', { mode: workspace.mode, dataDir: workspace.dataDir, mcpMode });

  if (mcpMode) {
    await startMcpStdio({
      stateFile: workspace.stateFile,
      contentDatabase: workspace.databasePath,
      apiBaseUrl: process.env.FLOWMIND_API_URL || 'http://127.0.0.1:8789'
    });
    logger.info('desktop mcp stdio ready', { stateFile: workspace.stateFile });
    return;
  }

  const root = appRootPath();
  desktopHost = await startDesktopHost({
    appRoot: root,
    distDir: path.join(root, 'dist'),
    stateFile: workspace.stateFile,
    feishuOptions: { secretFile: workspace.feishuSecretFile, masterKeyFile: workspace.feishuMasterKeyFile },
    contentOptions: { databasePath: workspace.databasePath },
    modelOptions: { secretFile: workspace.modelSecretFile, masterKeyFile: workspace.modelMasterKeyFile },
    logger
  });
  localOrigin = desktopHost.origin;
  configureSessionSecurity(localOrigin);

  ipcMain.handle('desktop:get-app-info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform
  }));
  ipcMain.handle('desktop:open-external', (event, url) => openExternal(url));
  ipcMain.handle('desktop:choose-markdown-root', event => chooseMarkdownMirrorRoot(BrowserWindow.fromWebContents(event.sender) || mainWindow));
  ipcMain.handle('desktop:scan-markdown-root', async (event, rootId) => {
    const root = mirrorRoot(rootId);
    return { rootId: root.id, displayName: root.displayName, files: await collectMarkdownFiles(root) };
  });
  ipcMain.handle('desktop:confirm-markdown-write', async (event, request = {}) => {
    const root = mirrorRoot(request.rootId);
    const target = mirrorPath(root, request.relativePath);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(temporary, String(request.content || ''), 'utf8');
    await fs.promises.rename(temporary, target);
    return { rootId: root.id, relativePath: String(request.relativePath), written: true };
  });
  ipcMain.handle('desktop:confirm-markdown-rename', async (event, request = {}) => {
    const root = mirrorRoot(request.rootId);
    const from = mirrorPath(root, request.from);
    const to = mirrorPath(root, request.to);
    try { await fs.promises.access(to); throw Object.assign(new Error('Markdown mirror target already exists'), { code: 'MIRROR_TARGET_EXISTS' }); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await fs.promises.rename(from, to);
    return { rootId: root.id, from: String(request.from), to: String(request.to), renamed: true };
  });

  mainWindow = await createMainWindow(localOrigin);
  logger.info('desktop renderer loaded', { packaged: app.isPackaged, origin: localOrigin });

  if (smokeMode) {
    const response = await fetch(`${localOrigin}/desktop-healthz`);
    if (!response.ok) throw new Error(`desktop smoke health failed with HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.ok !== true) throw new Error('desktop smoke health payload invalid');
    let model = null;
    if (process.env.IMA_DESKTOP_SMOKE_MODEL_TEST === '1') {
      const settingsResponse = await fetch(`${localOrigin}/api/settings/model`);
      const settings = await settingsResponse.json();
      const testResponse = await fetch(`${localOrigin}/api/models/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chatProbe: true }) });
      const test = await testResponse.json();
      if (!testResponse.ok || test.ok !== true) throw new Error(`desktop model smoke failed: ${test.error?.code || testResponse.status}`);
      model = { provider: settings.provider, id: test.model, configured: settings.apiKeyConfigured, latencyMs: test.latencyMs, sampleLength: String(test.sample || '').length };
    }
    const smokeResultFile = process.env.IMA_DESKTOP_SMOKE_RESULT_FILE;
    if (smokeResultFile) {
      fs.mkdirSync(path.dirname(smokeResultFile), { recursive: true });
      fs.writeFileSync(smokeResultFile, `${JSON.stringify({ ok: true, origin: localOrigin, loaded: true, userData, model })}\n`, 'utf8');
    }
    console.log('DESKTOP_SMOKE_OK');
    await shutdown('smoke-test');
  }
}
