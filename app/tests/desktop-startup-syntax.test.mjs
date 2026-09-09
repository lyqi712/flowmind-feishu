import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('Electron main entry parses as ESM including the MCP early-return path', () => {
  const path = fileURLToPath(new URL('../desktop/main.mjs', import.meta.url));
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', path], { stdio: 'pipe', windowsHide: true }));
});
