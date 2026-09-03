import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithEsbuild } from 'vite';

const source = await readFile(new URL('../src/components/CopilotWorkspace.jsx', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');

test('CopilotWorkspace JSX compiles and does not interpolate fake starter variables', async () => {
  const result = await transformWithEsbuild(source, 'CopilotWorkspace.jsx', { loader: 'jsx', jsx: 'automatic' });
  assert.ok(result.code.includes('CopilotModule'));
  assert.doesNotMatch(source, /\{\{documentTitle\}\}/);
  assert.doesNotMatch(source, /\{\{currentDate\}\}/);
  assert.doesNotMatch(result.code, /\bdocumentTitle\b/);
});

test('opening Copilot cannot take down the whole workspace', () => {
  assert.match(mainSource, /class WorkspaceSurfaceErrorBoundary extends React\.Component/);
  assert.match(mainSource, /renderActiveTab=\{tab => <WorkspaceSurfaceErrorBoundary/);
  assert.match(source, /export function CopilotModule/);
});
