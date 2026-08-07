import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ContentRepository } from '../../app/server/content/repository.mjs';
import { startDesktopHost } from '../../app/desktop/runtime.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..', '..');
const appRoot = path.join(projectRoot, 'app');
const portableRoot = path.join(appRoot, 'desktop', 'out', 'FlowMind-portable-x64');
const portableExe = path.join(portableRoot, 'FlowMind.exe');
const packagedAudioParser = path.join(portableRoot, 'resources', 'app', 'server', 'content', 'audio-parser.mjs');
const fixtureAudio = path.join(projectRoot, 'evidence', 'fixtures', 'audio-transcript-release.wav');
const evidenceFile = path.join(projectRoot, 'evidence', 'audio-transcript-desktop-portable-smoke.json');

async function createFixture(root) {
  await mkdir(root, { recursive: true });
  const bytes = await readFile(fixtureAudio);
  const databasePath = path.join(root, 'content.sqlite');
  const repository = new ContentRepository({ databasePath });
  try {
    const source = repository.upsertSourceConnection({ sourceType: 'local', externalId: 'desktop-audio-surface', name: 'Desktop audio surface fixture' });
    const rows = [
      { speaker: 'Alice', text: 'ORBIT AUDIO release gate confirmed.', anchor: 'time:0-2', timeStart: 0, timeEnd: 2, confidence: 0.96 },
      { speaker: 'Bob', text: 'Rollback owner is FlowMind.', anchor: 'time:2-4', timeStart: 2, timeEnd: 4, confidence: 0.94 },
      { speaker: 'Carol', text: 'Save meeting minutes and verify mobile.', anchor: 'time:4-6', timeStart: 4, timeEnd: 6, confidence: 0.92 }
    ];
    let cursor = 0;
    const pages = rows.map(row => {
      const rendered = `[${row.speaker}] ${row.text}`;
      const startChar = cursor;
      cursor += rendered.length;
      const endChar = cursor;
      cursor += 1;
      return { pageNumber: 1, startChar, endChar, charCount: rendered.length, ...row };
    });
    const content = rows.map(row => `[${row.speaker}] ${row.text}`).join('\n');
    const result = repository.upsertContentItem({
      sourceConnectionId: source.id,
      externalId: 'audio-surface-item',
      contentType: 'audio',
      title: 'Desktop audio surface fixture',
      content,
      mimeType: 'audio/wav',
      metadata: { fileName: 'meeting.wav', byteSize: bytes.length, durationMs: 6000, pageCount: 1, textPageCount: 1, pages, audio: { status: 'completed', provider: 'fixture', language: 'en', segmentCount: 3, error: null } }
    });
    repository.upsertAttachment({ contentItemId: result.item.id, externalId: 'original', fileName: 'meeting.wav', mimeType: 'audio/wav', byteSize: bytes.length, metadata: { kind: 'original' }, data: bytes });
    repository.replaceIndexChunks(result.item.id, rows.map(row => ({ text: `[${row.speaker}] ${row.text}`, metadata: { pageNumber: 1, pageAnchor: row.anchor, anchor: row.anchor, timeStart: row.timeStart, timeEnd: row.timeEnd, speaker: row.speaker, confidence: row.confidence } })));
    return { databasePath, itemId: result.item.id, bytes };
  } finally { repository.close(); }
}

function ndjson(text) { return text.trim().split('\n').filter(Boolean).map(JSON.parse); }
async function assertSurface(origin, fixture) {
  const detailResponse = await fetch(`${origin}/api/content/items/${fixture.itemId}`);
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.item.contentType, 'audio');
  assert.equal(detail.item.metadata.audio.status, 'completed');
  assert.equal(detail.item.metadata.pages.length, 3);
  assert.equal(detail.item.metadata.pages[1].anchor, 'time:2-4');
  assert.equal(detail.chunks[1].metadata.pageAnchor, 'time:2-4');
  assert.equal(detail.chunks[1].metadata.speaker, 'Bob');
  assert.equal(detail.attachments.length, 1);
  const original = await fetch(`${origin}/api/content/items/${fixture.itemId}/original`);
  assert.equal(original.status, 200);
  assert.equal(original.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), fixture.bytes);
  const chat = await fetch(`${origin}/api/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'Rollback owner', documentIds: [fixture.itemId] }) });
  const done = ndjson(await chat.text()).find(event => event.type === 'done');
  assert.equal(done.citations[0].anchor, 'time:2-4');
  assert.equal(done.citations[0].timeStart, 2);
  assert.equal(done.citations[0].speaker, 'Bob');
  return { itemId: fixture.itemId, segments: detail.item.metadata.pages.length, citation: done.citations[0].anchor, originalBytes: fixture.bytes.length };
}

async function startHost(root, fixture) {
  return startDesktopHost({ appRoot, distDir: path.join(appRoot, 'dist'), stateFile: path.join(root, 'state.json'), port: 0, env: {}, feishuOptions: { secretFile: path.join(root, 'feishu.enc'), masterKeyFile: path.join(root, 'feishu.key') }, modelOptions: { secretFile: path.join(root, 'model.enc'), masterKeyFile: path.join(root, 'model.key') }, contentOptions: { databasePath: fixture.databasePath } });
}
function collectOutput(child) { let output = ''; child.stdout?.on('data', chunk => { output += chunk.toString(); }); child.stderr?.on('data', chunk => { output += chunk.toString(); }); return () => output; }
async function waitForOrigin(child, logFile, timeoutMs = 30000) {
  const getOutput = collectOutput(child); const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    let text = getOutput(); try { text += `\n${await readFile(logFile, 'utf8')}`; } catch {}
    const match = text.match(/desktop host listening (http:\/\/127\.0\.0\.1:\d+)/); if (match) return match[1];
    if (child.exitCode !== null) break; await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`portable Electron host did not expose origin (exit=${child.exitCode ?? 'running'})`);
}
async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  await new Promise(resolve => { killer.once('close', resolve); killer.once('error', resolve); });
  await new Promise(resolve => setTimeout(resolve, 750));
}

const root = await mkdtemp(path.join(os.tmpdir(), 'flowmind-audio-surface-smoke-'));
try {
  const hostFixture = await createFixture(path.join(root, 'host'));
  const host = await startHost(path.join(root, 'host'), hostFixture);
  let hostResult;
  try { hostResult = await assertSurface(host.origin, hostFixture); } finally { await host.close(); }

  assert.equal(fs.existsSync(portableExe), true, `portable executable missing: ${portableExe}`);
  assert.equal(fs.existsSync(packagedAudioParser), true, `packaged audio parser missing: ${packagedAudioParser}`);
  const packagedSource = await readFile(packagedAudioParser, 'utf8');
  assert.match(packagedSource, /createAudioParsers/);
  assert.match(packagedSource, /timeAnchor/);
  const userData = path.join(root, 'portable-user-data');
  await mkdir(userData, { recursive: true });
  const portableFixture = await createFixture(userData);
  const child = spawn(portableExe, [`--user-data-dir=${userData}`, '--disable-gpu', '--no-sandbox'], { cwd: portableRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, IMA_DESKTOP_SMOKE_TEST: undefined, IMA_DESKTOP_SMOKE_RESULT_FILE: undefined, NODE_ENV: 'production' } });
  let portableResult;
  try { const origin = await waitForOrigin(child, path.join(userData, 'logs', 'desktop.log')); portableResult = await assertSurface(origin, portableFixture); }
  finally { await stopChild(child); }
  const result = { ok: true, verifiedAt: new Date().toISOString(), host: hostResult, portable: { ...portableResult, executable: portableExe }, packagedAudioParser };
  await writeFile(evidenceFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result));
} finally {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); break; }
    catch (error) { if (attempt === 4) throw error; await new Promise(resolve => setTimeout(resolve, 500)); }
  }
}