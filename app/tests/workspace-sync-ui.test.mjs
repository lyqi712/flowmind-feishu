import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformWithEsbuild } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const componentPath = resolve(here, '../src/components/WorkspaceSyncPanel.jsx');
const cssPath = resolve(here, '../src/components/WorkspaceSyncPanel.css');
const settingsPath = resolve(here, '../src/components/SettingsExperience.jsx');
const component = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
const settings = readFileSync(settingsPath, 'utf8');

function includesAll(source, fragments, label) {
  for (const fragment of fragments) assert.ok(source.includes(fragment), `${label}: missing ${fragment}`);
}

test('WorkspaceSyncPanel compiles and stays behind the existing Privacy surface', async () => {
  const transformed = await transformWithEsbuild(component, componentPath, { loader: 'jsx', jsx: 'automatic' });
  assert.match(transformed.code, /function WorkspaceSyncPanel/);
  assert.match(settings, /WorkspaceSyncPanel/);
  assert.match(settings, /SECTION_PRIVACY/);
});

test('sync UI has explicit local-first, pairing, preview, conflict and confirmation actions', () => {
  includesAll(component, [
    'data-workspace-sync-panel',
    '只同步可恢复的工作台元数据',
    "'/api/workspace-sync/status'",
    "'/api/workspace-sync/settings'",
    "'/api/workspace-sync/relay'",
    "'/api/workspace-sync/preview'",
    "'/api/workspace-sync/apply'",
    "'/api/workspace-sync/bundle/export'",
    "'/api/workspace-sync/bundle/import'",
    '配对密钥只显示这一次',
    '检查远端变化',
    '同步并恢复',
    '还有 ${unresolved.length} 个冲突未选择',
    '确认恢复',
    'onSessionChange?.(result.session)'
  ], 'workspace sync actions');
  assert.doesNotMatch(component, /pairingToken\s*[:=]\s*['"][^'"]+['"]/i);
  assert.doesNotMatch(component, /private body|private output|apiKey\s*[:=]\s*['"][^'"]+['"]/i);
});

test('sync UI exposes busy, offline, error, status and narrow-screen layout contracts', () => {
  includesAll(component, ['role="alert"', 'role="status"', 'disabled={busyNow}', 'settings?.lastStatus === \'offline\'', 'aria-label="关闭同步错误"'], 'sync state contract');
  includesAll(css, [
    '.workspace-sync-status.is-synced',
    '.workspace-sync-status.is-conflict',
    '.workspace-sync-error',
    '.workspace-sync-conflicts',
    '.workspace-sync-pairing',
    '.workspace-sync-panel button:focus-visible',
    '@media (max-width: 390px)',
    'grid-template-columns: minmax(0, 1fr)',
    'overflow-wrap: anywhere'
  ], 'sync responsive contract');
});
