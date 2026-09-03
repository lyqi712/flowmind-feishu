import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAppearance, loadAppearance, normalizeAppearance, resolveTheme } from '../src/workspace/appearance.js';

test('appearance defaults to system theme and standard font', () => {
  assert.deepEqual(normalizeAppearance({}), { theme: 'system', fontSize: 'standard' });
  assert.deepEqual(normalizeAppearance({ theme: 'neon', fontSize: 'huge' }), { theme: 'system', fontSize: 'standard' });
  assert.deepEqual(normalizeAppearance({ theme: 'dark', fontSize: 'small' }), { theme: 'dark', fontSize: 'small' });
});

test('system theme resolves to the actual light or dark surface', () => {
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

test('applyAppearance writes theme and font scale to the document root when DOM exists', () => {
  if (typeof document === 'undefined') {
    assert.deepEqual(applyAppearance({ theme: 'dark', fontSize: 'large' }), { theme: 'dark', fontSize: 'large' });
    return;
  }
  const next = applyAppearance({ theme: 'dark', fontSize: 'large' }, { isDark: false });
  assert.equal(next.theme, 'dark');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(document.documentElement.dataset.themeResolved, 'dark');
  assert.equal(document.documentElement.style.colorScheme, 'dark');
  assert.equal(document.documentElement.dataset.fontScale, 'large');
  assert.deepEqual(loadAppearance(), next);
  applyAppearance({ theme: 'system', fontSize: 'standard' }, { isDark: true });
  assert.equal(document.documentElement.dataset.theme, 'system');
  assert.equal(document.documentElement.dataset.themeResolved, 'dark');
});
