function cleanText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}
function safeArray(value) { return Array.isArray(value) ? value : []; }
function safeId(value) { return String(value || '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'flowmind-export'; }
function htmlEscape(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function anchorOf(metadata = {}) { return metadata.pageAnchor || metadata.anchor || (metadata.pageNumber ? `page:${metadata.pageNumber}` : null); }

export function translationSourceSegments(item, chunks = []) {
  const source = safeArray(chunks).filter(chunk => cleanText(chunk.text));
  if (source.length) return source.flatMap(chunk => cleanText(chunk.text).split(/\n{2,}/).filter(Boolean).map(sourceText => ({
    sourceText,
    translatedText: '',
    anchor: anchorOf(chunk.metadata || {}),
    pageNumber: Number(chunk.metadata?.pageNumber || 0) || null,
    timeStart: chunk.metadata?.timeStart == null ? null : Number(chunk.metadata.timeStart),
    timeEnd: chunk.metadata?.timeEnd == null ? null : Number(chunk.metadata.timeEnd),
    speaker: chunk.metadata?.speaker || null
  }))).map((row, index) => ({ ...row, index }));
  return cleanText(item?.content).split(/\n{2,}/).filter(Boolean).slice(0, 80).map((text, index) => ({ index, sourceText: text, translatedText: '', anchor: `chars:${index}`, pageNumber: null, timeStart: null, timeEnd: null, speaker: null }));
}

function parseModelJson(text, count) {
  const raw = cleanText(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const rows = Array.isArray(parsed) ? parsed : parsed?.segments;
  if (!Array.isArray(rows) || !rows.length) return null;
  const mapped = new Map(rows.map((row, index) => [Number(row.index ?? index), cleanText(row.translatedText ?? row.translation ?? row.text)]));
  return Array.from({ length: count }, (_, index) => mapped.get(index) || '');
}

function fallbackTranslation(text, targetLanguage) {
  return `〔${targetLanguage} 待模型翻译〕${cleanText(text)}`;
}

export async function generateTranslation({ modelService, item, chunks, targetLanguage = '简体中文', sourceLanguage = '自动检测', glossary = '', provider = 'auto', signal } = {}) {
  const segments = translationSourceSegments(item, chunks);
  if (!segments.length) throw Object.assign(new Error('当前内容没有可翻译文本'), { code: 'TRANSLATION_SOURCE_EMPTY' });
  const system = '你是专业企业文档翻译器。严格保持段落顺序、数字、专有名词和 Markdown 结构。只输出 JSON，不要解释。';
  const prompt = `把以下段落翻译为${targetLanguage}。源语言：${sourceLanguage}。术语表：${cleanText(glossary) || '无'}。输出 {"segments":[{"index":0,"translatedText":"..."}]}。\n\n${segments.map(row => `[${row.index}] ${row.sourceText}`).join('\n\n')}`;
  let generated = null;
  let model = { provider: 'local', model: '' };
  let fallbackUsed = false;
  if (provider !== 'local') try {
    model = await modelService.generate({ system, prompt, signal });
    generated = parseModelJson(model.text, segments.length);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    fallbackUsed = true;
  } else fallbackUsed = true;
  if (!generated || generated.some(text => !text)) fallbackUsed = true;
  const translated = segments.map((segment, index) => ({ ...segment, translatedText: generated?.[index] || fallbackTranslation(segment.sourceText, targetLanguage) }));
  return { segments: translated, provider: provider === 'auto' ? (model.provider || 'local') : provider, model: model.model || '', fallbackUsed };
}

export function createTranslationRecord(input = {}, idFactory = () => `translation_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`) {
  const timestamp = new Date().toISOString();
  const segments = safeArray(input.segments).map((row, index) => ({
    index,
    sourceText: cleanText(row.sourceText), translatedText: cleanText(row.translatedText),
    anchor: row.anchor || null, pageNumber: Number(row.pageNumber || 0) || null,
    timeStart: row.timeStart == null ? null : Number(row.timeStart), timeEnd: row.timeEnd == null ? null : Number(row.timeEnd), speaker: row.speaker || null
  })).filter(row => row.sourceText);
  return {
    id: input.id || idFactory(), documentId: String(input.documentId || ''), title: cleanText(input.title) || '未命名对照翻译',
    sourceLanguage: cleanText(input.sourceLanguage) || '自动检测', targetLanguage: cleanText(input.targetLanguage) || '简体中文',
    provider: cleanText(input.provider) || 'auto', model: cleanText(input.model), glossary: cleanText(input.glossary),
    segments, sourceRefs: segments.map(row => ({ documentId: String(input.documentId || ''), anchor: row.anchor, pageNumber: row.pageNumber, timeStart: row.timeStart, timeEnd: row.timeEnd })).filter(ref => ref.anchor),
    fallbackUsed: Boolean(input.fallbackUsed), status: input.status || 'completed', createdAt: input.createdAt || timestamp, updatedAt: timestamp
  };
}

function markdownCitations(refs = []) {
  if (!refs.length) return '';
  return `\n\n## 来源引用\n${refs.map((ref, index) => `- [${index + 1}] ${ref.title || ref.documentId || '来源'}${ref.anchor ? ` · ${ref.anchor}` : ''}`).join('\n')}`;
}
function htmlCitations(refs = []) {
  if (!refs.length) return '';
  return `<section><h2>来源引用</h2><ol>${refs.map(ref => `<li>${htmlEscape(ref.title || ref.documentId || '来源')}${ref.anchor ? ` · <code>${htmlEscape(ref.anchor)}</code>` : ''}</li>`).join('')}</ol></section>`;
}

export function renderExport({ entityType, entity, format = 'markdown' } = {}) {
  const type = String(entityType || 'document');
  const title = cleanText(entity?.title) || 'FlowMind 导出';
  const refs = safeArray(entity?.sourceRefs || entity?.citations);
  let markdown = `# ${title}\n\n`;
  let htmlBody = `<h1>${htmlEscape(title)}</h1>`;
  if (type === 'translation') {
    markdown += `> ${cleanText(entity.sourceLanguage)} → ${cleanText(entity.targetLanguage)}\n\n`;
    markdown += safeArray(entity.segments).map(row => `## ${row.anchor || `片段 ${Number(row.index || 0) + 1}`}\n\n**原文**\n\n${cleanText(row.sourceText)}\n\n**译文**\n\n${cleanText(row.translatedText)}`).join('\n\n---\n\n');
    htmlBody += `<p>${htmlEscape(entity.sourceLanguage)} → ${htmlEscape(entity.targetLanguage)}</p><div class="translation-grid">${safeArray(entity.segments).map(row => `<article><h2>${htmlEscape(row.anchor || `片段 ${Number(row.index || 0) + 1}`)}</h2><div class="pair"><section><h3>原文</h3><pre>${htmlEscape(row.sourceText)}</pre></section><section><h3>译文</h3><pre>${htmlEscape(row.translatedText)}</pre></section></div></article>`).join('')}</div>`;
  } else {
    const content = cleanText(entity?.content || entity?.text);
    markdown += content;
    htmlBody += `<pre>${htmlEscape(content)}</pre>`;
  }
  markdown += markdownCitations(refs);
  htmlBody += htmlCitations(refs);
  if (format === 'html') {
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${htmlEscape(title)}</title><style>body{max-width:980px;margin:40px auto;padding:0 24px;font:15px/1.7 system-ui;color:#24324a}pre{white-space:pre-wrap;overflow-wrap:anywhere}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}.pair section{padding:16px;border:1px solid #dce3ef;border-radius:12px;background:#fafbff}code{color:#5362d8}@media(max-width:680px){.pair{grid-template-columns:1fr}}</style></head><body>${htmlBody}</body></html>`;
    return { bytes: Buffer.from(html), mimeType: 'text/html; charset=utf-8', extension: 'html', fileName: `${safeId(title)}.html` };
  }
  return { bytes: Buffer.from(markdown), mimeType: 'text/markdown; charset=utf-8', extension: 'md', fileName: `${safeId(title)}.md` };
}

export { htmlEscape };