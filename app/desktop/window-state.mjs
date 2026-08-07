import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_STATE = Object.freeze({
  width: 1440,
  height: 900,
  isMaximized: false
});

function finiteInteger(value) {
  return Number.isFinite(value) ? Math.round(value) : undefined;
}

export function sanitizeWindowState(value = {}) {
  const width = Math.max(960, finiteInteger(value.width) || DEFAULT_STATE.width);
  const height = Math.max(640, finiteInteger(value.height) || DEFAULT_STATE.height);
  const state = {
    width,
    height,
    isMaximized: value.isMaximized === true
  };
  const x = finiteInteger(value.x);
  const y = finiteInteger(value.y);
  if (x !== undefined) state.x = x;
  if (y !== undefined) state.y = y;
  return state;
}

export function ensureBoundsOnScreen(state, electronScreen) {
  const next = sanitizeWindowState(state);
  if (next.x === undefined || next.y === undefined || !electronScreen) return next;

  const bounds = { x: next.x, y: next.y, width: next.width, height: next.height };
  const display = electronScreen.getDisplayMatching(bounds);
  const area = display?.workArea;
  if (!area) return sanitizeWindowState({ width: next.width, height: next.height, isMaximized: next.isMaximized });

  const visibleWidth = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
  const visibleHeight = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
  if (visibleWidth < 120 || visibleHeight < 80) {
    return sanitizeWindowState({ width: next.width, height: next.height, isMaximized: next.isMaximized });
  }
  return next;
}

export function createWindowStateStore({ filePath, logger } = {}) {
  if (!filePath) throw new Error('filePath is required for window state');
  let timer = null;
  let trackedWindow = null;

  const load = () => {
    try {
      return sanitizeWindowState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (error) {
      if (error?.code !== 'ENOENT') logger?.warn('window state load failed', error);
      return sanitizeWindowState();
    }
  };

  const save = async (browserWindow = trackedWindow) => {
    if (!browserWindow || browserWindow.isDestroyed()) return;
    const bounds = browserWindow.getNormalBounds();
    const state = sanitizeWindowState({ ...bounds, isMaximized: browserWindow.isMaximized() });
    const directory = path.dirname(filePath);
    const temporary = `${filePath}.${process.pid}.tmp`;
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.promises.rename(temporary, filePath);
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => save().catch((error) => logger?.warn('window state save failed', error)), 250);
    timer.unref?.();
  };

  const attach = (browserWindow) => {
    trackedWindow = browserWindow;
    browserWindow.on('resize', schedule);
    browserWindow.on('move', schedule);
    browserWindow.on('maximize', schedule);
    browserWindow.on('unmaximize', schedule);
  };

  const flush = async () => {
    clearTimeout(timer);
    timer = null;
    await save();
  };

  return Object.freeze({ load, attach, flush });
}
