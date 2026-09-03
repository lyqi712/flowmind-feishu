import { basename } from 'node:path';

export class TranscriptionService {
  constructor({ url = process.env.FLOWMIND_TRANSCRIPTION_URL || '', apiKey = process.env.FLOWMIND_TRANSCRIPTION_API_KEY || '', fetchImpl = globalThis.fetch, transcribeImpl = null, language = process.env.FLOWMIND_TRANSCRIPTION_LANGUAGE || '', logger } = {}) {
    this.url = String(url || '').trim(); this.apiKey = String(apiKey || ''); this.fetchImpl = fetchImpl; this.transcribeImpl = transcribeImpl; this.language = String(language || ''); this.logger = logger;
  }
  async transcribe(bytes, { fileName = 'audio.mp3', mimeType = 'audio/mpeg', signal } = {}) {
    if (this.transcribeImpl) return this.transcribeImpl(bytes, { fileName, mimeType, signal });
    if (!this.url) return { status: 'unavailable', segments: [], provider: null };
    const form = new FormData(); form.append('file', new Blob([bytes], { type: mimeType }), basename(fileName));
    if (this.language) form.append('language', this.language);
    const headers = this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
    const response = await this.fetchImpl(this.url, { method: 'POST', headers, body: form, signal });
    const raw = await response.text(); let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { text: raw }; }
    if (!response.ok) throw Object.assign(new Error(data?.error?.message || data?.message || `转写服务 HTTP ${response.status}`), { code: 'AUDIO_TRANSCRIPTION_FAILED', status: response.status });
    return { ...data, status: data.status || 'completed', provider: data.provider || new URL(this.url).hostname };
  }
  async close() {}
}
export function createTranscriptionService(options) { return new TranscriptionService(options); }