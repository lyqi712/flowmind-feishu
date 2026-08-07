import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';
import { audioMetadata, parseAudio } from '../server/content/audio-parser.mjs';
import { TranscriptionService } from '../server/content/transcription-service.mjs';

function wavFixture(seconds = 5, sampleRate = 8000) {
  const dataLength = seconds * sampleRate * 2;
  const bytes = Buffer.alloc(44 + dataLength);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + dataLength, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(dataLength, 40);
  return bytes;
}
const transcript = { status: 'completed', provider: 'fixture', language: 'zh', durationMs: 5000, segments: [
  { start: 0, end: 2.5, speaker: 'Alice', confidence: 97, text: 'ORBIT AUDIO release gate' },
  { start: 2.5, end: 5, speaker: 'Bob', confidence: 95, text: 'Rollback owner is FlowMind' }
] };
async function harness(service = { transcribe: async () => transcript, close: async () => {} }) {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-audio-api-'));
  const app = await createInitializedApp({ stateFile: join(root, 'state.json'), env: {}, ocrService: false, transcriptionService: service, modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') }, feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') } });
  const server = await new Promise(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  return { base: `http://127.0.0.1:${server.address().port}`, async close() { await new Promise(resolve => server.close(resolve)); await app.locals.close(); await rm(root, { recursive: true, force: true }); } };
}
function ndjson(text) { return text.trim().split('\n').filter(Boolean).map(JSON.parse); }

test('WAV metadata and transcript segments normalize into stable time anchors', async () => {
  const bytes = wavFixture(); const metadata = audioMetadata(bytes); assert.equal(metadata.durationMs, 5000); assert.equal(metadata.sampleRate, 8000); assert.equal(metadata.channels, 1);
  const parsed = await parseAudio({ bytes, path: 'meeting.wav', extension: '.wav' }, { transcribeImpl: async () => transcript });
  assert.equal(parsed.contentType, 'audio'); assert.equal(parsed.metadata.audio.status, 'completed'); assert.equal(parsed.pageSegments[0].anchor, 'time:0-2.5'); assert.equal(parsed.pageSegments[1].anchor, 'time:2.5-5'); assert.equal(parsed.pageSegments[1].speaker, 'Bob');
});

test('audio upload persists original and returns timestamp-aware chunks and citations', async () => {
  const h = await harness();
  try {
    const bytes = wavFixture(); const response = await fetch(`${h.base}/api/content/import/file`, { method: 'POST', headers: { 'content-type': 'audio/wav', 'x-file-name': 'meeting.wav' }, body: bytes }); const body = await response.json(); assert.equal(response.status, 201); const itemId = body.items[0].item.id;
    const detail = await (await fetch(`${h.base}/api/content/items/${itemId}`)).json(); assert.equal(detail.item.contentType, 'audio'); assert.equal(detail.attachments.length, 1); assert.equal(detail.chunks[1].metadata.pageAnchor, 'time:2.5-5'); assert.equal(detail.chunks[1].metadata.timeStart, 2.5); assert.equal(detail.chunks[1].metadata.speaker, 'Bob');
    assert.deepEqual(Buffer.from(await (await fetch(`${h.base}/api/content/items/${itemId}/original`)).arrayBuffer()), bytes);
    const chat = await fetch(`${h.base}/api/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'Rollback owner', documentIds: [itemId] }) }); const done = ndjson(await chat.text()).find(event => event.type === 'done'); assert.equal(done.citations[0].anchor, 'time:2.5-5'); assert.equal(done.citations[0].timeStart, 2.5); assert.equal(done.citations[0].speaker, 'Bob');
  } finally { await h.close(); }
});

test('audio without configured transcription still persists original with explicit status', async () => {
  const h = await harness({ transcribe: async () => ({ status: 'unavailable', segments: [] }), close: async () => {} });
  try { const response = await fetch(`${h.base}/api/content/import/file`, { method: 'POST', headers: { 'content-type': 'audio/mpeg', 'x-file-name': 'pending.mp3' }, body: Buffer.from('ID3 pending audio') }); const body = await response.json(); assert.equal(response.status, 201); const detail = await (await fetch(`${h.base}/api/content/items/${body.items[0].item.id}`)).json(); assert.equal(detail.item.metadata.audio.status, 'unavailable'); assert.equal(detail.attachments.length, 1); assert.match(detail.item.content, /待配置转写服务/); }
  finally { await h.close(); }
});

test('OpenAI-compatible transcription adapter sends multipart audio to a custom relay', async () => {
  let captured = null;
  const service = new TranscriptionService({
    url: 'https://relay.example.test/v1/audio/transcriptions',
    apiKey: 'fixture-key',
    language: 'zh',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ provider: 'relay-fixture', segments: [{ start: 0, end: 1.5, text: 'adapter works' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const result = await service.transcribe(Buffer.from('ID3 fixture'), { fileName: 'meeting.mp3', mimeType: 'audio/mpeg' });
  assert.equal(captured.url, 'https://relay.example.test/v1/audio/transcriptions');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.authorization, 'Bearer fixture-key');
  assert.equal(captured.options.body.get('language'), 'zh');
  const file = captured.options.body.get('file');
  assert.equal(file.name, 'meeting.mp3');
  assert.equal(file.type, 'audio/mpeg');
  assert.equal(result.status, 'completed');
  assert.equal(result.provider, 'relay-fixture');
  assert.equal(result.segments[0].text, 'adapter works');
});
