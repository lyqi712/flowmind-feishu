import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const componentPath = resolve(here, '../src/components/SettingsExperience.jsx');
const cssPath = resolve(here, '../src/components/SettingsExperience.css');
const component = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

function includesAll(source, expected, label) {
  for (const fragment of expected) assert.ok(source.includes(fragment), `${label}: missing ${fragment}`);
}

function sourceSection(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return source.slice(from, to);
}

test('SettingsExperience JSX compiles independently before main.jsx integration', async () => {
  const transformed = await transformWithEsbuild(component, componentPath, { loader: 'jsx', jsx: 'automatic' });
  assert.match(transformed.code, /function SettingsSidebar/);
  assert.match(transformed.code, /function SettingsWorkspace/);
});

test('exports standalone SettingsSidebar and SettingsWorkspace components', () => {
  includesAll(component, [
    "import './SettingsExperience.css'",
    'export function SettingsSidebar({',
    'export function SettingsWorkspace({',
    'activeSection = SECTION_MODEL',
    'onSectionChange',
    'onManageModels',
    'onOpenFeishuWizard',
    'onToast',
    'fetcher = globalThis.fetch'
  ], 'public component contract');
});

test('all three settings sections are real controlled navigation actions', () => {
  includesAll(component, [
    "{ id: SECTION_MODEL, label: '模型与 Provider'",
    "{ id: SECTION_KNOWLEDGE, label: '知识库连接'",
    "{ id: SECTION_PRIVACY, label: '安全与隐私'",
    'const active = activeSection === id',
    "aria-current={active ? 'page' : undefined}",
    'data-settings-section={id}',
    'onClick={() => onSectionChange?.(id)}',
    'activeSection === SECTION_MODEL &&',
    'activeSection === SECTION_KNOWLEDGE &&',
    'activeSection === SECTION_PRIVACY &&'
  ], 'controlled section behavior');
  assert.doesNotMatch(sourceSection(component, 'export function SettingsSidebar', 'function ModelSettingsSection'), /useState\s*\(/, 'sidebar must not own the active section');
});

test('model section preserves provider summary and model management entry', () => {
  const model = sourceSection(component, 'function ModelSettingsSection', 'function Metric');
  includesAll(model, [
    '当前模型配置摘要',
    'settings.configured',
    'providerName(provider, settings)',
    'settings.baseUrl',
    '默认模型',
    '超时',
    'API Key',
    "settings.hasApiKey ? '已安全保存'",
    'onClick={() => onManageModels?.()}',
    '管理模型',
    '第三方中转站'
  ], 'model settings');
});

test('knowledge section loads Feishu and content status and exposes refresh plus wizard actions', () => {
  includesAll(component, [
    "requestJson(fetcher, '/api/settings/feishu')",
    "requestJson(fetcher, '/api/content/status')",
    'Promise.all([',
    'refreshKnowledgeStatus',
    'knowledgeInitialized',
    'setKnowledgeInitialized(true)',
    'aria-label="刷新飞书与索引状态"',
    'onClick={onRefresh}',
    'onClick={() => onOpenFeishuWizard?.()}',
    '打开飞书连接向导',
    'feishu?.credentialsConfigured',
    'feishu.appIdMasked',
    'feishu?.sourceCount',
    'counts.content_items',
    'counts.index_chunks',
    'counts.spaces',
    'counts.ingestion_jobs'
  ], 'knowledge settings interactions');
});

test('privacy section downloads backup and restores selected JSON through merge API', () => {
  includesAll(component, [
    '本地存储',
    '密钥不回显',
    '可导出与恢复',
    "fetcher('/api/content/backup', { method: 'GET'",
    "anchor.download = 'flowmind-content-backup.json'",
    'type="file"',
    'accept="application/json,.json"',
    "archive.format !== 'flowmind-content-backup'",
    "requestJson(fetcher, '/api/content/backup/restore'",
    "method: 'POST'",
    "body: JSON.stringify({ archive, mode: 'merge' })",
    'onToast?.(`备份恢复成功：',
    "onToast?.(errorMessage(error), 'error')",
    "input.value = ''"
  ], 'backup interactions');
});

test('settings experience never embeds a credential fixture or renders secret values', () => {
  assert.doesNotMatch(component, /cli_[a-z0-9]{8,}/i);
  assert.doesNotMatch(component, /appSecret\s*[:=]\s*['"][^'"]+['"]/i);
  assert.doesNotMatch(component, /apiKey\s*[:=]\s*['"][^'"]+['"]/i);
  includesAll(component, ['密钥只提交给本机服务端', '设置接口不会返回明文', '前端无法读取已保存密钥'], 'secret display policy');
});

test('layout has visible active states, busy states and a 390px no-overflow contract', () => {
  includesAll(css, [
    '.settings-experience-nav button.is-active',
    '.settings-experience-primary:disabled',
    '.settings-experience-error',
    '.settings-experience-provider-card',
    '.settings-experience-source-breakdown',
    '.settings-experience-metrics',
    '.settings-experience-backup-actions',
    'overflow-wrap: anywhere',
    '@media (max-width: 390px)',
    'overflow-x: hidden',
    'grid-template-columns: minmax(0, 1fr)'
  ], 'responsive interaction styles');
});
