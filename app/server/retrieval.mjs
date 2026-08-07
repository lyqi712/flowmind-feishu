const STOP_WORDS = new Set([
  '的', '了', '和', '与', '是', '在', '有', '这', '那', '什么', '怎么', '如何', '请', '帮我', '以及', '进行', '相关',
  'the', 'a', 'an', 'and', 'or', 'is', 'are', 'of', 'to', 'in', 'for', 'on', 'with', 'what', 'how'
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function tokenize(text = '') {
  const normalized = String(text).toLowerCase().normalize('NFKC');
  const latin = normalized.match(/[a-z0-9][a-z0-9._-]*/g) || [];
  const chineseRuns = normalized.match(/[\u3400-\u9fff]+/g) || [];
  const chinese = [];
  for (const run of chineseRuns) {
    if (run.length <= 12) chinese.push(run);
    if (run.length > 2) for (let index = 0; index < run.length - 2; index += 1) chinese.push(run.slice(index, index + 3));
    if (run.length > 1) for (let index = 0; index < run.length - 1; index += 1) chinese.push(run.slice(index, index + 2));
  }
  return unique([...latin, ...chinese]).filter((token) => token.length > 1 && !STOP_WORDS.has(token)).slice(0, 48);
}

function countOccurrences(haystack, needle, max = Infinity) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (count < max && (offset = haystack.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function excerptBounds(content, position, termLength, maxLength) {
  if (content.length <= maxLength) return { start: 0, end: content.length };
  let start = Math.max(0, position - Math.floor((maxLength - termLength) / 2));
  let end = Math.min(content.length, start + maxLength);
  start = Math.max(0, end - maxLength);
  const leftBoundary = Math.max(content.lastIndexOf('\n', position), content.lastIndexOf('。', position), content.lastIndexOf('！', position), content.lastIndexOf('？', position));
  if (leftBoundary >= start && leftBoundary < position) start = leftBoundary + 1;
  const candidates = ['\n', '。', '！', '？'].map(marker => content.indexOf(marker, position + termLength)).filter(index => index >= 0 && index + 1 <= start + maxLength);
  if (candidates.length) end = Math.min(...candidates) + 1;
  else end = Math.min(content.length, start + maxLength);
  return { start, end };
}

function makeExcerptMatch(document, terms, maxLength = 220) {
  const content = String(document.content || '');
  const lower = content.toLowerCase();
  let best = { position: -1, term: '', score: -1 };
  for (const term of terms.slice(0, 36)) {
    const position = lower.indexOf(term);
    if (position < 0) continue;
    const score = term.length * 1000 - Math.min(position, 100000) / 1000;
    if (score > best.score) best = { position, term, score };
  }
  if (best.position < 0) {
    const excerpt = content.slice(0, maxLength).trim();
    return { excerpt: content.length > maxLength ? excerpt.slice(0, maxLength - 1) + '…' : excerpt, start: 0 };
  }
  const bounds = excerptBounds(content, best.position, best.term.length, maxLength);
  let excerpt = content.slice(bounds.start, bounds.end).trim();
  if (bounds.start > 0) excerpt = '…' + excerpt;
  if (bounds.end < content.length) excerpt += '…';
  return { excerpt, start: best.position };
}

export function makeExcerpt(document, terms, maxLength = 220) {
  return makeExcerptMatch(document, terms, maxLength).excerpt;
}

function locateDocumentAnchor(document, offset) {
  const regions = Array.isArray(document.metadata?.ocrRegions) ? document.metadata.ocrRegions : [];
  const region = regions.find((entry) => offset >= Number(entry.startChar || 0) && offset <= Number(entry.endChar || 0));
  if (region) return {
    pageNumber: Number(region.pageNumber || 1),
    anchor: region.anchor || `page:${region.pageNumber || 1}:region:1`,
    region: region.region || null,
    confidence: region.confidence ?? null
  };
  const pages = Array.isArray(document.metadata?.pages) ? document.metadata.pages : [];
  const page = pages.find((entry) => offset >= Number(entry.startChar || 0) && offset <= Number(entry.endChar || 0));
  return page
    ? { pageNumber: Number(page.pageNumber), anchor: page.anchor || `page:${page.pageNumber}`, region: page.region || null, confidence: page.confidence ?? null, timeStart: page.timeStart ?? null, timeEnd: page.timeEnd ?? null, speaker: page.speaker ?? null }
    : { pageNumber: null, anchor: null, region: null, confidence: null, timeStart: null, timeEnd: null, speaker: null };
}

export function searchDocuments(documents, query, { limit = 4, requiredDocumentIds = [] } = {}) {
  const terms = tokenize(query).slice(0, 36);
  const normalizedQuery = String(query).trim().toLowerCase();
  const required = new Set((requiredDocumentIds || []).map(String));
  const scored = documents.map((document) => {
    const title = String(document.title || '').toLowerCase();
    const content = String(document.content || '').toLowerCase();
    const isRequired = required.has(String(document.id));
    let score = normalizedQuery && title.includes(normalizedQuery) ? 18 : 0;
    score += normalizedQuery && content.includes(normalizedQuery) ? 10 : 0;
    for (const term of terms) {
      score += countOccurrences(title, term, 4) * 5;
      score += countOccurrences(content, term, 8) * 1.25;
    }
    if (!terms.length && content) score = 1;
    if (isRequired && content) score = Math.max(score, 0.5);
    const excerptMatch = makeExcerptMatch(document, terms);
    return { document, score: Number(score.toFixed(3)), excerpt: excerptMatch.excerpt, excerptStart: excerptMatch.start, required: isRequired };
  }).filter((entry) => entry.score > 0);

  const safeLimit = Math.max(1, Math.min(Number(limit) || 4, 10));
  const requiredResults = scored.filter((entry) => entry.required)
    .sort((left, right) => right.score - left.score || left.document.title.localeCompare(right.document.title, 'zh-CN'));
  const optionalResults = scored.filter((entry) => !entry.required)
    .sort((left, right) => right.score - left.score || left.document.title.localeCompare(right.document.title, 'zh-CN'));
  const output = [];
  const seen = new Set();
  for (const entry of [...requiredResults, ...optionalResults]) {
    const documentId = String(entry.document.id);
    if (seen.has(documentId)) continue;
    seen.add(documentId);
    output.push(entry);
    if (output.length >= Math.max(safeLimit, Math.min(requiredResults.length, 10))) break;
  }
  return output;
}

function citationFromResult(result, index) {
  const location = locateDocumentAnchor(result.document, Number(result.excerptStart || 0));
  return {
    index: index + 1,
    documentId: result.document.id,
    nodeToken: result.document.nodeToken || null,
    title: result.document.title,
    excerpt: result.excerpt,
    url: result.document.url || null,
    score: result.score,
    pageNumber: location.pageNumber,
    anchor: location.anchor,
    region: location.region,
    confidence: location.confidence,
    timeStart: location.timeStart,
    timeEnd: location.timeEnd,
    speaker: location.speaker
  };
}

export function answerQuestion(documents, question, options = {}) {
  const results = searchDocuments(documents, question, options);
  if (!results.length) {
    return {
      answer: '当前本地知识库中没有找到与问题直接相关的材料。请先同步飞书知识库，或换一个包含更具体关键词的问题。',
      citations: [],
      matches: []
    };
  }
  const citations = results.map(citationFromResult);
  const evidenceLines = citations.map((citation) => `- ${citation.excerpt} [${citation.index}]`);
  const answer = [
    `根据本地知识库中与“${String(question).trim()}”最相关的材料：`,
    '',
    ...evidenceLines,
    '',
    `以上结论来自 ${citations.length} 份本地文档；可通过引用标题和链接回到原文核验。`
  ].join('\n');
  return { answer, citations, matches: results };
}

export function chunkText(text, size = 28) {
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += size) chunks.push(text.slice(offset, offset + size));
  return chunks;
}
