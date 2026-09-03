import { basename, extname } from 'node:path';

const MIME_BY_EXTENSION = Object.freeze({ '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac' });
const defaultService = { async transcribe() { return null; } };

function formatSeconds(value) {
  const seconds = Math.max(0, Number(value) || 0);
  return String(Number(seconds.toFixed(2)));

}
function timeAnchor(start, end) { return `time:${formatSeconds(start)}-${formatSeconds(end)}`; }
function wavMetadata(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return {};
  let offset = 12, sampleRate = 0, channels = 0, dataBytes = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4); const size = bytes.readUInt32LE(offset + 4); const body = offset + 8;
    if (id === 'fmt ' && size >= 16 && body + size <= bytes.length) { channels = bytes.readUInt16LE(body + 2); sampleRate = bytes.readUInt32LE(body + 4); }
    if (id === 'data') { dataBytes = size; break; }
    offset = body + size + (size % 2);
  }
  const byteRate = (bytes.length >= 32 ? bytes.readUInt32LE(28) : 0) || (sampleRate * channels * (bytes.readUInt16LE(34) || 0) / 8);
  return { sampleRate, channels, durationMs: byteRate ? Math.round(dataBytes / byteRate * 1000) : null };
}
function normalizeSegment(segment, index, totalDurationMs = null) {
  const start = Math.max(0, Number(segment?.start ?? segment?.startSeconds ?? segment?.from ?? 0));
  const rawEnd = Number(segment?.end ?? segment?.endSeconds ?? segment?.to ?? NaN);
  const end = Number.isFinite(rawEnd) ? Math.max(start, rawEnd) : (index + 1 === 1 && totalDurationMs ? totalDurationMs / 1000 : start + 2);
  const text = String(segment?.text ?? segment?.transcript ?? segment?.content ?? '').replace(/\s+/g, ' ').trim();
  return { text, start, end, speaker: segment?.speaker ? String(segment.speaker) : null, confidence: segment?.confidence == null ? null : Number(segment.confidence), anchor: timeAnchor(start, end) };
}

export function audioMetadata(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  return wavMetadata(buffer);
}

export async function parseAudio({ bytes, path = 'audio.mp3', extension, mimeType, signal } = {}, { transcriptionService, transcribeImpl } = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const fileName = basename(String(path || 'audio.mp3'));
  const fileExtension = String(extension || extname(fileName)).toLowerCase();
  const measured = audioMetadata(buffer);
  if (signal?.aborted) throw Object.assign(new Error('Audio import cancelled'), { code: 'INGESTION_CANCELLED' });
  let transcript = null;
  try {
    if (transcribeImpl) transcript = await transcribeImpl(buffer, { fileName, mimeType: mimeType || MIME_BY_EXTENSION[fileExtension], signal });
    else transcript = await (transcriptionService || defaultService).transcribe(buffer, { fileName, mimeType: mimeType || MIME_BY_EXTENSION[fileExtension], signal });
  } catch (error) {
    if (error?.code === 'INGESTION_CANCELLED' || error?.name === 'AbortError') throw error;
    transcript = { status: 'error', error: error.message || '转写失败', segments: [] };
  }
  const sourceSegments = Array.isArray(transcript?.segments) ? transcript.segments : Array.isArray(transcript?.data?.segments) ? transcript.data.segments : [];
  const durationMs = Number(transcript?.durationMs ?? transcript?.data?.durationMs ?? measured.durationMs ?? 0) || 0;
  const segments = sourceSegments.map((segment, index) => normalizeSegment(segment, index, durationMs)).filter(segment => segment.text);
  const status = transcript?.status || (segments.length ? 'completed' : 'unavailable');
  const content = segments.length ? segments.map(segment => `${segment.speaker ? `[${segment.speaker}] ` : ''}${segment.text}`).join('\n') : `音频文件：${fileName}\n转写状态：${status === 'error' ? '失败' : '待配置转写服务'}`;
  let cursor = 0;
  const pageSegments = segments.length ? segments.map(segment => {
    const prefix = segment.speaker ? `[${segment.speaker}] ` : '';
    const text = `${prefix}${segment.text}`; const startChar = cursor; cursor += text.length; const endChar = cursor; cursor += 1;
    return { pageNumber: 1, text, startChar, endChar, charCount: text.length, anchor: segment.anchor, timeStart: segment.start, timeEnd: segment.end, speaker: segment.speaker, confidence: segment.confidence };
  }) : [{ pageNumber: 1, text: content, startChar: 0, endChar: content.length, charCount: content.length, anchor: 'time:0-0', timeStart: 0, timeEnd: durationMs / 1000, speaker: null, confidence: null }];
  return {
    title: fileName.replace(extname(fileName), '') || '音频转写', content, contentType: 'audio', mimeType: mimeType || MIME_BY_EXTENSION[fileExtension] || 'application/octet-stream', persistOriginal: true,
    pageSegments,
    metadata: { pageCount: 1, textPageCount: 1, pages: pageSegments.map(({ text, ...segment }) => segment), durationMs, sampleRate: measured.sampleRate || null, channels: measured.channels || null, audio: { status, provider: transcript?.provider || null, language: transcript?.language || null, segmentCount: segments.length, error: transcript?.error || null } }
  };
}

export function createAudioParsers(transcriptionService) {
  const parse = input => parseAudio(input, { transcriptionService });
  return Object.freeze({ '.mp3': parse, '.m4a': parse, '.wav': parse, '.aac': parse });
}
export const AUDIO_LOCAL_PARSERS = createAudioParsers();
export { timeAnchor };