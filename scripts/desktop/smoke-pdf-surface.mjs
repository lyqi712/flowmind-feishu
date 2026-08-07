import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertPdfSurface,
  createPdfSurfaceFixture,
  getPdfFixtureSummary,
  startPdfFixtureHost
} from './pdf-surface-fixture.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..', '..');
const appRoot = path.join(projectRoot, 'app');
const portableRoot = path.join(appRoot, 'desktop', 'out', 'FlowMind-portable-x64');
const portableExe = path.join(portableRoot, 'FlowMind.exe');
const portableServer = path.join(portableRoot, 'resources', 'app', 'server', 'app.mjs');

async function runHostSurface(root, fixture) {
  let host;
  try {
    host = await startPdfFixtureHost({ projectRoot, root, fixture });
    await assertPdfSurface(host.origin, fixture);
    return { ok: true, mode: 'desktop-host' };
  } finally {
    await host?.close().catch(() => {});
  }
}

function collectOutput(child) {
  let output = '';
  child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { output += chunk.toString(); });
  return () => output;
}

async function waitForOrigin(child, logFile, timeoutMs = 30000) {
  const getOutput = collectOutput(child);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    let text = getOutput();
    try { text += `\n${await readFile(logFile, 'utf8')}`; } catch {}
    const match = text.match(/desktop host listening (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) return { origin: match[1], output: text };
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`portable Electron host did not expose a loopback origin (exit=${child.exitCode ?? 'running'})`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('close', resolve);
      killer.once('error', resolve);
    });
  } else child.kill('SIGTERM');
  await new Promise((resolve) => child.once('close', resolve));
}

async function runPortableSurface(root) {
  assert.equal(fs.existsSync(portableExe), true, `portable executable missing: ${portableExe}`);
  assert.equal(fs.existsSync(portableServer), true, `portable server missing: ${portableServer}`);
  const packagedSource = await readFile(portableServer, 'utf8');
  assert.match(packagedSource, /\/api\/content\/items\/:id\/original/, 'portable package does not contain the PDF original route');
  assert.match(packagedSource, /publicAttachment/, 'portable package does not contain attachment redaction');

  const userData = path.join(root, 'portable-user-data');
  await fs.promises.mkdir(userData, { recursive: true });
  const fixture = await createPdfSurfaceFixture(userData);
  const child = spawn(portableExe, [`--user-data-dir=${userData}`, '--disable-gpu', '--no-sandbox'], {
    cwd: portableRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, IMA_DESKTOP_SMOKE_TEST: undefined, IMA_DESKTOP_SMOKE_RESULT_FILE: undefined, NODE_ENV: 'production' }
  });
  const logFile = path.join(userData, 'logs', 'desktop.log');
  try {
    const { origin } = await waitForOrigin(child, logFile);
    await assertPdfSurface(origin, fixture);
    return { ok: true, mode: 'portable', package: path.basename(portableExe) };
  } finally {
    await stopChild(child).catch(() => {});
  }
}

const root = await mkdtemp(path.join(os.tmpdir(), 'flowmind-pdf-surface-smoke-'));
try {
  const fixture = await createPdfSurfaceFixture(root);
  const results = [await runHostSurface(root, fixture)];
  if (process.argv.includes('--skip-portable')) results.push({ ok: true, mode: 'portable', skipped: true });
  else results.push(await runPortableSurface(root));
  console.log(JSON.stringify({ ok: true, fixture: getPdfFixtureSummary(fixture), results }));
} finally {
  await rm(root, { recursive: true, force: true });
}
