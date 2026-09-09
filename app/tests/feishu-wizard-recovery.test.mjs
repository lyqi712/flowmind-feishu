import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/components/FeishuSyncWizard.jsx', import.meta.url), 'utf8');
function method(name, next, context) {
  const body = source.slice(source.indexOf(`  async function ${name}(`), source.indexOf(next, source.indexOf(`  async function ${name}(`)));
  return vm.runInNewContext(`${body}\n${name}`, context);
}

test('source save failure stays in wizard and resolves without an unhandled rejection', async () => {
  const failure = new Error('保存失败，请重试');
  const busy = [], errors = [], steps = [];
  const save = method('saveSources', '  function startProgress', {
    links: ['https://example.feishu.cn/docx/test'], form: { spaceIds: [] },
    setBusy: value => busy.push(value), setError: value => errors.push(value),
    setStep: value => steps.push(value), payload: () => ({}),
    jsonRequest: async () => { throw failure; }
  });
  await assert.doesNotReject(() => save(true));
  assert.deepEqual(busy, ['saving', '']);
  assert.equal(errors.at(-1), failure);
  assert.deepEqual(steps, []);
});

test('zero-source discovery records completed state and gives actionable warning', async () => {
  const notices = [], discoveries = [];
  const discover = method('discover', '  async function saveSources', {
    setBusy() {}, setError() {}, setSpaces() {}, setDiscoveredSources() {}, setForm() {},
    setHasDiscovered: value => discoveries.push(value), payload: () => ({}),
    jsonRequest: async () => ({ spaces: [], sources: [] }),
    notify: (...args) => notices.push(args)
  });
  await discover();
  assert.equal(discoveries.at(-1), true);
  assert.equal(notices[0][1], 'warning');
  assert.match(notices[0][0], /未发现可访问来源.*应用授权/);
  assert.match(source, /hasDiscovered && !spaces.length && !discoveredSources.length && !busy && !error/);
  assert.match(source, /添加文档应用 \/ 添加知识库应用/);
});

test('busy operation locks wizard step navigation and demo action; errors are announced', () => {
  assert.match(source, /if \(busy \|\| \(next > 0 && !settings.credentialsConfigured\)\) return/);
  assert.match(source, /disabled=\{Boolean\(busy\) \|\| \(index > 0 && !settings.credentialsConfigured\)\}/);
  assert.match(source, /className="fw-mock" disabled=\{Boolean\(busy\)\}/);
  assert.match(source, /className="fw-error" role="alert" aria-live="assertive"/);
});
