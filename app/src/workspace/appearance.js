const STORAGE_KEY = 'flowmind-appearance';

export const THEME_OPTIONS = Object.freeze([
  { id: 'system', label: '系统' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' }
]);

export const FONT_SIZE_OPTIONS = Object.freeze([
  { id: 'small', label: '小' },
  { id: 'standard', label: '标准' },
  { id: 'large', label: '大' }
]);

export function normalizeAppearance(value = {}) {
  const theme = THEME_OPTIONS.some(item => item.id === value.theme) ? value.theme : 'system';
  const fontSize = FONT_SIZE_OPTIONS.some(item => item.id === value.fontSize) ? value.fontSize : 'standard';
  return { theme, fontSize };
}

export function prefersDarkColorScheme(media = globalThis.matchMedia) {
  try {
    return Boolean(typeof media === 'function' && media.call(globalThis, '(prefers-color-scheme: dark)').matches);
  } catch {
    return false;
  }
}

export function resolveTheme(theme, isDark = prefersDarkColorScheme()) {
  if (theme === 'dark' || theme === 'light') return theme;
  return isDark ? 'dark' : 'light';
}

export function loadAppearance() {
  if (typeof localStorage === 'undefined') return normalizeAppearance();
  try {
    return normalizeAppearance(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch {
    return normalizeAppearance();
  }
}

export function applyAppearance(value = {}, options = {}) {
  const appearance = normalizeAppearance(value);
  if (typeof document === 'undefined') return appearance;
  const resolved = resolveTheme(appearance.theme, options.isDark ?? prefersDarkColorScheme());
  const root = document.documentElement;
  root.dataset.theme = appearance.theme;
  root.dataset.themeResolved = resolved;
  root.dataset.fontScale = appearance.fontSize;
  root.style.colorScheme = resolved;
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  return appearance;
}

let stopWatching = null;

export function watchSystemAppearance() {
  if (typeof window === 'undefined') return () => {};
  stopWatching?.();
  applyAppearance(loadAppearance());
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!media) return () => {};
  const onChange = () => applyAppearance(loadAppearance());
  if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
  else media.addListener?.(onChange);
  stopWatching = () => {
    if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onChange);
    else media.removeListener?.(onChange);
    stopWatching = null;
  };
  return stopWatching;
}
