import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const script = readFileSync(new URL('../../scripts/desktop/build-portable.ps1', import.meta.url), 'utf8');
// Execute only the copy function, never the build/install/archive commands below it.
const copyFunction = script.match(/function Copy-PortableApplication \{[\s\S]*?^\}/m)?.[0];
assert.ok(copyFunction, 'portable packager must expose its isolated copy phase');
const directories = [...copyFunction.match(/\$runtimeDirectories=@\(([^)]+)\)/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
const packageInfo = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const quote = value => `'${value.replaceAll("'", "''")}'`;

function isPackaged(relative) {
  return directories.some(dir => relative === dir || relative.startsWith(`${dir}/`))
    || /^desktop\/[^/]+$/.test(relative)
    || ['package.json', 'package-lock.json'].includes(relative);
}

function verifyImportClosure(entrypoints) {
  const pending = [...entrypoints];
  const visited = new Set();
  while (pending.length) {
    const relative = pending.pop();
    if (visited.has(relative)) continue;
    visited.add(relative);
    assert.ok(isPackaged(relative), `Missing runtime payload: ${relative}`);
    const filename = path.join(appRoot, relative);
    assert.ok(existsSync(filename), `Missing source dependency: ${relative}`);
    const source = readFileSync(filename, 'utf8');
    // Literal ESM imports/re-exports, dynamic imports, and CommonJS requires.
    const imports = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([@\w./:-]+)['"]/g;
    for (const [, specifier] of source.matchAll(imports)) {
      if (specifier.startsWith('.')) {
        pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier)));
      } else if (!specifier.startsWith('node:') && specifier !== 'electron') {
        const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        assert.ok(packageInfo.dependencies?.[name], `${relative} needs production dependency ${name}`);
      }
    }
  }
  return visited;
}

test('portable manifest includes all desktop, API and MCP literal import dependencies', () => {
  assert.match(script, /Copy-PortableApplication -AppRoot \$appRoot -Destination \$resourceApp/);
  for (const dir of ['dist', 'server', 'shared', 'src/workspace', 'mcp', 'desktop/assets']) {
    assert.ok(directories.includes(dir), `Missing runtime directory ${dir}`);
  }
  const visited = verifyImportClosure([packageInfo.main, 'server/index.mjs', 'mcp/server.mjs']);
  assert.ok(visited.has('shared/answer-text.mjs'));
  assert.ok(visited.has('src/workspace/note-capture.js'));
  assert.ok(visited.has('mcp/server.mjs'));
  assert.match(script, /npm\.cmd ci --omit=dev --ignore-scripts/);
});

test('portable copy preserves nested runtime paths and excludes user data and old builds', {
  skip: process.platform !== 'win32' ? 'PowerShell packaging copy is Windows-only' : false,
}, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'flowmind-portable-manifest-'));
  try {
    const source = path.join(root, 'source app');
    const destination = path.join(root, 'resources', 'app');
    const fixtures = [
      'dist/index.html', 'server/content/parser.mjs', 'shared/answer-text.mjs',
      'src/workspace/note-capture.js', 'mcp/server.mjs', 'desktop/assets/icon.ico',
      'desktop/bootstrap.cjs', 'desktop/main.mjs', 'desktop/preload.cjs', 'desktop/runtime.mjs',
      'package.json', 'package-lock.json',
    ];
    const excluded = ['runtime-data/state.json', '.env', 'src/components/private.jsx',
      'desktop/out/old.exe', 'desktop/out-previous/old.exe', 'node_modules/dev-only/index.js'];
    for (const relative of [...fixtures, ...excluded]) {
      const filename = path.join(source, relative);
      mkdirSync(path.dirname(filename), { recursive: true });
      writeFileSync(filename, `fixture ${relative}`);
    }
    const runner = path.join(root, 'copy.ps1');
    writeFileSync(runner, `$ErrorActionPreference='Stop'\n${copyFunction}\nCopy-PortableApplication -AppRoot ${quote(source)} -Destination ${quote(destination)}\n`);
    const run = () => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runner], { encoding: 'utf8', timeout: 30000 });
    const result = run();
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    for (const relative of fixtures) {
      assert.equal(readFileSync(path.join(destination, relative), 'utf8'), `fixture ${relative}`);
    }
    for (const relative of excluded) assert.equal(existsSync(path.join(destination, relative)), false, relative);
    // SkipWebBuild must not silently package a missing renderer entry point.
    rmSync(path.join(source, 'dist/index.html'));
    const missing = run();
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Portable runtime input missing: dist\/index.html/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
