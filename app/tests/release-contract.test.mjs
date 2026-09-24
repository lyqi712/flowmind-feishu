import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(appRoot, '..');
const packageJson = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));

function readProjectFile(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

test('release contract keeps direct Vite JSX tooling and verification scripts', () => {
  assert.match(String(packageJson.devDependencies?.esbuild || ''), /^0\.28\.1$/);
  assert.equal(packageJson.scripts['release:verify-tree'], 'node ../scripts/release/verify-tree.mjs');
  assert.equal(packageJson.scripts['release:verify-artifacts'], 'node ../scripts/release/verify-artifacts.mjs');
  assert.equal(existsSync(path.join(projectRoot, 'scripts', 'release', 'verify-tree.mjs')), true);
  assert.equal(existsSync(path.join(projectRoot, 'scripts', 'release', 'verify-artifacts.mjs')), true);
});

test('CI checks MCP and tracked-tree release safety', () => {
  const workflow = readProjectFile('.github/workflows/check.yml');
  assert.match(workflow, /npm run mcp:smoke/);
  assert.match(workflow, /npm run security:audit/);
  assert.match(workflow, /npm run release:verify-tree/);
});

test('release workflow builds and verifies both Windows assets', () => {
  const workflow = readProjectFile('.github/workflows/release.yml');
  assert.match(workflow, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.match(workflow, /npm run mcp:smoke/);
  assert.match(workflow, /npm run security:audit/);
  assert.match(workflow, /npm run desktop:pack/);
  assert.match(workflow, /npm run desktop:portable/);
  assert.match(workflow, /npm run release:verify-artifacts/);
  assert.match(workflow, /FlowMind-Setup-\*-x64\.exe/);
  assert.match(workflow, /FlowMind-Feishu-AI-Workspace-\*-x64-portable\.zip/);
});

test('release tree verification passes for the current tracked tree', () => {
  const output = execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'release', 'verify-tree.mjs')], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  assert.ok(result.trackedFiles > 0);
});
