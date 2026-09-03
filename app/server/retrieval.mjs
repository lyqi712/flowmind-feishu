import { bindEvidenceRef } from './evidence.mjs';

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
    pageAnchor: region.anchor || `page:${region.pageNumber || 1}:region:1`,
    region: region.region || null,
    confidence: region.confidence ?? null
  };
  const pages = Array.isArray(document.metadata?.pages) ? document.metadata.pages : [];
  const page = pages.find((entry) => offset >= Number(entry.startChar || 0) && offset <= Number(entry.endChar || 0));
  return page
    ? { pageNumber: Number(page.pageNumber), anchor: page.anchor || `page:${page.pageNumber}`, pageAnchor: page.anchor || `page:${page.pageNumber}`, region: page.region || null, confidence: page.confidence ?? null, timeStart: page.timeStart ?? null, timeEnd: page.timeEnd ?? null, speaker: page.speaker ?? null }
    : { pageNumber: null, anchor: null, pageAnchor: null, region: null, confidence: null, timeStart: null, timeEnd: null, speaker: null };
}

export function distinctiveQueryPhrases(query) {
  const raw = String(query || '').trim();
  const normalized = raw.toLowerCase().normalize('NFKC');
  const phrases = [];
  for (const match of raw.matchAll(/《([^》]{2,40})》/g)) {
    const title = String(match[1] || '').trim();
    if (title) phrases.push(title);
  }
  const latinRuns = normalized.match(/[a-z0-9][a-z0-9._-]*(?:\s+[a-z0-9][a-z0-9._-]*)+/g) || [];
  for (const run of latinRuns) {
    const tokens = run.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) continue;
    phrases.push(tokens.join(' '));
    for (let index = 0; index < tokens.length - 1; index += 1) phrases.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  if (/(?:比较|对比|对照|vs\.?|versus|分别|两份|两篇|两边)/iu.test(raw)) {
    const parts = raw.split(/(?:比较|对比|对照|和|与|以及|、|,|，|vs\.?|versus)/iu);
    for (const part of parts) {
      const cleaned = String(part || '')
        .replace(/[《》]/g, ' ')
        .replace(/(?:一下|这两份|这两篇|这两边|这两|材料|文档|资料|内容|关于)+/gu, ' ')
        .replace(/(?:分别怎么说|怎么说|有什么区别|的区别|差异|关系|联系)/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned.length >= 2 && cleaned.length <= 32) phrases.push(cleaned);
    }
  }
  return unique(phrases.filter((phrase) => {
    if (!phrase) return false;
    if (/[a-z0-9]/i.test(phrase) && !/[\u3400-\u9fff]/.test(phrase)) return phrase.length >= 5;
    return phrase.length >= 2 && !STOP_WORDS.has(phrase);
  }));
}

function compactRetrievalText(value) {
  return String(value || '').toLowerCase().normalize('NFKC').replace(/[\s「」"'`~～，。！？!?、,.:：]+/gu, '');
}

const QUERY_ALIASES = [
  ['拍板', ['负责', '负责人']],
  ['点头', ['审批', '批准']],
  ['闸门', ['审批']],
  ['卡点', ['审批']],
  ['准入', ['审批']],
  ['门槛', ['准入', '审批']],
  ['签字', ['审批', '批准']],
  ['过审', ['审批']],
  ['放行', ['审批', '批准']],
  ['发车', ['发布', '上线']],
  ['上线', ['发布']],
  ['发版', ['发布']],
  ['谁负责', ['负责人']]
];

export function expandQueryAliases(query) {
  const text = String(query || '').trim();
  if (!text) return '';
  const extras = [];
  for (const [trigger, aliases] of QUERY_ALIASES) {
    if (!text.includes(trigger)) continue;
    for (const alias of aliases) {
      if (!text.includes(alias)) extras.push(alias);
    }
  }
  return extras.length ? `${text} ${unique(extras).join(' ')}`.trim() : text;
}

export function softenRetrievalQuery(query) {
  return String(query || '')
    .replace(/[?？!！。，,、]/g, ' ')
    .replace(/(?:怎么办|怎么做|怎么写的|怎么写|如何处理|如何|为什么|为啥|是不是|要不要|能不能|可以吗|吗|呢|啊|呀|请你|请|帮我|一下|这篇|那篇|这个|那个|有关|关于)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function relaxedTitleSearch(documents, query, { limit = 4 } = {}) {
  const softened = softenRetrievalQuery(expandQueryAliases(query)) || String(query || '').trim();
  const terms = tokenize(softened).slice(0, 24);
  const compactQuery = compactRetrievalText(softened);
  const scored = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document?.id) continue;
    const title = String(document.title || '');
    const compactTitle = compactRetrievalText(title);
    let score = 0;
    for (const term of terms) {
      if (title.toLowerCase().includes(term)) score += term.length >= 3 ? 8 : 3;
    }
    if (compactQuery.length >= 4 && compactTitle) {
      const cjk = /[\u3400-\u9fff]/.test(compactQuery);
      const gramSize = cjk ? 2 : 4;
      const need = cjk ? 2 : 1;
      let overlap = 0;
      for (let index = 0; index <= compactQuery.length - gramSize; index += 1) {
        if (compactTitle.includes(compactQuery.slice(index, index + gramSize))) overlap += 1;
      }
      if (overlap >= need) score += overlap;
    }
    if (score <= 0) continue;
    scored.push({
      document,
      score,
      excerpt: title,
      excerptStart: 0,
      matchKind: 'title-only'
    });
  }
  const safeLimit = Math.max(1, Math.min(Number(limit) || 4, 12));
  return scored.sort((left, right) => right.score - left.score || String(left.document.title || '').localeCompare(String(right.document.title || ''), 'zh-CN')).slice(0, safeLimit);
}

export function isDerivedKnowledgeNote(document = {}) {
  const source = String(document.source || document.sourceType || '').toLowerCase();
  const type = String(document.type || document.contentType || document.itemType || '').toLowerCase();
  const title = String(document.title || '').trim();
  if (source === 'local-note' || source === 'note') return true;
  if (type === 'note') return true;
  return /^知识笔记[:：]/.test(title);
}

export function isProblemKnowledgeNote(document = {}) {
  if (String(document?.artifactKind || '') === 'problem') return true;
  const tags = Array.isArray(document?.tags) ? document.tags : [];
  if (tags.some(tag => String(tag).includes('问题记录'))) return true;
  return /^问题记录[:：]/.test(String(document?.title || '').trim());
}

export function isQueryEchoTitle(title, query) {
  const compactTitle = compactRetrievalText(title);
  const compactQuery = compactRetrievalText(query);
  if (!compactTitle || !compactQuery || compactQuery.length < 8) return false;
  if (compactTitle.includes(compactQuery) && compactTitle.length >= compactQuery.length + 4) return true;
  return /^知识笔记[:：]/.test(String(title || '').trim()) && compactTitle.includes(compactQuery.slice(0, Math.min(20, compactQuery.length)));
}

function derivedNoteScoreMultiplier(document, query) {
  if (!isDerivedKnowledgeNote(document)) return 1;
  if (isQueryEchoTitle(document?.title, query)) return 0.18;
  return 0.72;
}

function titleContainsPhrase(document, phrase) {
  return String(document?.title || '').toLowerCase().includes(String(phrase || '').toLowerCase());
}

function bestTitleEntityEntry(entries, phrase) {
  const matches = (entries || []).filter((entry) => titleContainsPhrase(entry.document, phrase));
  if (!matches.length) return null;
  return matches.find((entry) => !isDerivedKnowledgeNote(entry.document)) || matches[0];
}

function applyEntityCoverage(ranked, query) {
  const phrases = distinctiveQueryPhrases(query);
  if (phrases.length < 2 || !Array.isArray(ranked) || ranked.length < 2) return ranked;
  const reserved = [];
  const seen = new Set();
  for (const phrase of phrases) {
    const entry = bestTitleEntityEntry(ranked, phrase);
    const documentId = entry ? String(entry.document?.id || '') : '';
    if (!entry || !documentId || seen.has(documentId)) continue;
    seen.add(documentId);
    reserved.push(entry);
  }
  if (!reserved.length) return ranked;
  return [...reserved, ...ranked.filter((entry) => !seen.has(String(entry.document?.id || '')))];
}

function phraseHits(text, phrases) {
  return phrases.filter((phrase) => text.includes(phrase)).length;
}

export function pruneDocumentsForQuery(documents = [], query = '', {
  requiredDocumentIds = [],
  ftsIds = [],
  limit = 48
} = {}) {
  const available = (Array.isArray(documents) ? documents : []).filter(document => document?.id);
  if (!available.length) return [];
  const cap = Math.max(8, Number(limit) || 48);
  const required = new Set((requiredDocumentIds || []).map(String).filter(Boolean));
  const fts = [...new Set((ftsIds || []).map(String).filter(Boolean))];
  const byId = new Map(available.map(document => [String(document.id), document]));
  const picked = [];
  const seen = new Set();
  const add = id => {
    const key = String(id || '');
    if (!key || seen.has(key)) return false;
    const document = byId.get(key);
    if (!document) return false;
    seen.add(key);
    picked.push(document);
    return true;
  };

  for (const id of required) add(id);
  if (fts.length) {
    for (const id of fts) {
      if (picked.length >= cap) break;
      add(id);
    }
    return picked.length ? picked : available.slice(0, cap);
  }
  if (available.length <= cap) return available;

  const terms = tokenize(expandQueryAliases(query)).slice(0, 16);
  if (terms.length) {
    for (const document of available) {
      if (picked.length >= cap) break;
      if (seen.has(String(document.id))) continue;
      const title = String(document.title || '').toLowerCase();
      const head = String(document.content || '').slice(0, 1200).toLowerCase();
      if (terms.some(term => title.includes(term) || head.includes(term))) add(document.id);
    }
  }
  if (picked.length < Math.min(cap, available.length)) {
    for (const document of available) {
      if (picked.length >= cap) break;
      add(document.id);
    }
  }
  return picked;
}

export function searchDocuments(documents, query, { limit = 4, requiredDocumentIds = [] } = {}) {
  const effectiveQuery = expandQueryAliases(query);
  const terms = tokenize(effectiveQuery).slice(0, 36);
  const phrases = distinctiveQueryPhrases(effectiveQuery);
  const normalizedQuery = String(effectiveQuery).trim().toLowerCase();
  const required = new Set((requiredDocumentIds || []).map(String));
  const scored = documents.map((document) => {
    const title = String(document.title || '').toLowerCase();
    const content = String(document.content || '').toLowerCase();
    const isRequired = required.has(String(document.id));
    
    // 标题精确匹配2倍加权
    let score = normalizedQuery && title.includes(normalizedQuery) ? 36 : 0;
    score += normalizedQuery && content.includes(normalizedQuery) ? 10 : 0;
    score += phraseHits(title, phrases) * 112;  // 标题短语加倍
    score += phraseHits(content, phrases) * 18;
    
    let contentTermScore = 0;
    for (const term of terms) {
      score += countOccurrences(title, term, 4) * 10;  // 标题词频加倍
      contentTermScore += countOccurrences(content, term, 8) * 1.25;
    }
    
    // 长文惩罚：避免长文因词频高而霸榜
    const lengthPenalty = Math.min(1, 3000 / Math.max(content.length, 1));
    score += Math.min(contentTermScore, 24) * lengthPenalty;
    if (!terms.length && content) score = 1;
    const contentTerms = matchedTerms(content, terms);
    const titleTerms = matchedTerms(title, terms);
    const exactContent = Boolean(normalizedQuery && content.includes(normalizedQuery));
    const exactTitle = Boolean(normalizedQuery && title.includes(normalizedQuery));
    let matchKind = contentTerms.length || exactContent ? 'text-match' : titleTerms.length || exactTitle ? 'title-only' : isRequired ? 'scope-fallback' : null;
    if (!terms.length && content) matchKind = isRequired ? 'scope-fallback' : null;
    if (isRequired && content) score = Math.max(score, 0.5);
    
    // 应用长度惩罚到最终分数
    score *= derivedNoteScoreMultiplier(document, query);
    const excerptMatch = makeExcerptMatch(document, terms);
    return { document, score: Number(score.toFixed(3)), excerpt: excerptMatch.excerpt, excerptStart: excerptMatch.start, required: isRequired, matchKind };
  }).filter((entry) => entry.score > 0);

  const safeLimit = Math.max(1, Math.min(Number(limit) || 4, 48));
  const requiredResults = scored.filter((entry) => entry.required)
    .sort((left, right) => right.score - left.score || left.document.title.localeCompare(right.document.title, 'zh-CN'));
  const optionalResults = applyEntityCoverage(
    scored.filter((entry) => !entry.required)
      .sort((left, right) => right.score - left.score || left.document.title.localeCompare(right.document.title, 'zh-CN')),
    query
  );
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

function chunkInput(document, chunksByDocument) {
  const documentId = String(document?.id || '');
  const supplied = chunksByDocument instanceof Map ? chunksByDocument.get(documentId)
    : chunksByDocument && typeof chunksByDocument === 'object' ? chunksByDocument[documentId]
      : null;
  const source = Array.isArray(supplied) && supplied.length ? supplied : [{ id: `document-${documentId}`, ordinal: 0, text: document?.content || '', metadata: {} }];
  return source.map((entry, index) => {
    const metadata = entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
    const startChar = Number(metadata.startChar);
    return {
      id: String(entry?.id || `document-${documentId}-chunk-${index}`),
      ordinal: Number.isFinite(Number(entry?.ordinal)) ? Number(entry.ordinal) : index,
      text: String(entry?.text ?? entry?.content ?? '').replace(/\r\n?/g, '\n'),
      // Preserve the most specific index anchor. Page anchors remain the stable fallback for media.
      anchor: String(entry?.anchor || metadata.anchor || metadata.pageAnchor || '').trim() || null,
      pageAnchor: String(entry?.pageAnchor || metadata.pageAnchor || '').trim() || null,
      pageNumber: Number.isFinite(Number(entry?.pageNumber ?? metadata.pageNumber)) ? Number(entry?.pageNumber ?? metadata.pageNumber) : null,
      region: entry?.region ?? metadata.region ?? null,
      confidence: entry?.confidence ?? metadata.confidence ?? null,
      timeStart: entry?.timeStart ?? metadata.timeStart ?? null,
      timeEnd: entry?.timeEnd ?? metadata.timeEnd ?? null,
      speaker: entry?.speaker ?? metadata.speaker ?? null,
      contentVersionId: entry?.contentVersionId ?? metadata.contentVersionId ?? document?.currentVersionId ?? null,
      revision: entry?.revision ?? metadata.revision ?? document?.revision ?? null,
      contentHash: entry?.sourceContentHash ?? metadata.sourceContentHash ?? document?.contentHash ?? null,
      startChar: Number.isFinite(startChar) ? startChar : null
    };
  }).filter((chunk) => chunk.text.trim());
}

function makeChunkExcerpt(chunk, terms, maxLength = 420) {
  const content = String(chunk?.text || '');
  const lower = content.toLocaleLowerCase();
  let best = { position: -1, term: '', score: -1 };
  for (const term of terms.slice(0, 36)) {
    const position = lower.indexOf(term);
    if (position < 0) continue;
    const score = term.length * 1000 - Math.min(position, 100000) / 1000;
    if (score > best.score) best = { position, term, score };
  }
  if (best.position < 0) {
    const excerpt = content.slice(0, maxLength).trim();
    return { excerpt: content.length > maxLength ? `${excerpt.slice(0, Math.max(0, maxLength - 1))}…` : excerpt, start: 0 };
  }
  const bounds = excerptBounds(content, best.position, best.term.length, maxLength);
  let excerpt = content.slice(bounds.start, bounds.end).trim();
  if (bounds.start > 0) excerpt = '…' + excerpt;
  if (bounds.end < content.length) excerpt += '…';
  return { excerpt, start: bounds.start };
}

function matchedTerms(text, terms) {
  const normalized = String(text || '').toLocaleLowerCase();
  return terms.filter(term => normalized.includes(term));
}

export const PARENT_CHILD = Object.freeze({
  childChars: 400,
  childOverlap: 50,
  parentChars: 2000
});

export function childWindows(text, { size = PARENT_CHILD.childChars, overlap = PARENT_CHILD.childOverlap } = {}) {
  const value = String(text || '');
  if (!value) return [{ start: 0, text: '' }];
  if (value.length <= size) return [{ start: 0, text: value }];
  const step = Math.max(1, size - overlap);
  const windows = [];
  for (let start = 0; start < value.length; start += step) {
    windows.push({ start, text: value.slice(start, start + size) });
    if (start + size >= value.length) break;
  }
  return windows;
}

export function parentEvidenceWindow(text, hitStart = 0, parentChars = PARENT_CHILD.parentChars) {
  const value = String(text || '');
  if (value.length <= parentChars) return value;
  const start = Math.max(0, Math.min(value.length, Number(hitStart) || 0) - Math.floor((parentChars - 400) / 2));
  const end = Math.min(value.length, start + parentChars);
  return value.slice(Math.max(0, end - parentChars), end);
}

function scoreTextWindow(document, text, ordinal, terms, normalizedQuery, phrases = []) {
  const title = String(document?.title || '').toLocaleLowerCase();
  const haystack = String(text || '').toLocaleLowerCase();
  const textTerms = matchedTerms(haystack, terms);
  const titleTerms = matchedTerms(title, terms);
  const exactText = Boolean(normalizedQuery && haystack.includes(normalizedQuery));
  const exactTitle = Boolean(normalizedQuery && title.includes(normalizedQuery));
  let score = exactText ? 48 : 0;
  let termScore = 0;
  for (const term of textTerms) {
    const weight = Math.max(1, Math.min(8, term.length / 2));
    termScore += countOccurrences(haystack, term, 6) * weight;
  }
  score += Math.min(termScore, 36);
  if (textTerms.length || exactText) {
    score += phraseHits(title, phrases) * 40;
    score += phraseHits(haystack, phrases) * 20;
  }
  if (ordinal === 0 && !textTerms.length && (titleTerms.length || exactTitle)) score = 0.5;
  score *= derivedNoteScoreMultiplier(document, normalizedQuery);
  return {
    score: Number(score.toFixed(3)),
    matchKind: textTerms.length || exactText ? 'text-match' : titleTerms.length || exactTitle ? 'title-only' : 'scope-fallback'
  };
}

function scoreEvidenceChunk(document, chunk, terms, normalizedQuery, phrases = []) {
  const windows = childWindows(chunk?.text);
  let best = { score: -1, matchKind: 'scope-fallback', window: windows[0] };
  for (const window of windows) {
    const scored = scoreTextWindow(document, window.text, chunk.ordinal, terms, normalizedQuery, phrases);
    if (scored.score > best.score) best = { ...scored, window };
  }
  return best;
}

export function searchEvidenceChunks(documents, query, {
  limit = 6,
  requiredDocumentIds = [],
  chunksByDocument = {},
  maxChunksPerDocument = 3,
  excerptLength = 420
} = {}) {
  const effectiveQuery = expandQueryAliases(query);
  const terms = tokenize(effectiveQuery).slice(0, 36);
  const phrases = distinctiveQueryPhrases(effectiveQuery);
  const normalizedQuery = String(effectiveQuery || '').trim().toLocaleLowerCase();
  const required = new Set((requiredDocumentIds || []).map(String));
  const candidates = [];
  for (const document of documents || []) {
    const documentId = String(document?.id || '');
    if (!documentId) continue;
    const isRequired = required.has(documentId);
    for (const chunk of chunkInput(document, chunksByDocument)) {
      const scored = scoreEvidenceChunk(document, chunk, terms, normalizedQuery, phrases);
      if (scored.score <= 0 && !isRequired) continue;
      const excerptMatch = makeChunkExcerpt(chunk, terms, excerptLength);
      const windowStart = Number(scored.window?.start || excerptMatch.start || 0);
      const excerptStart = Number.isFinite(chunk.startChar) ? chunk.startChar + excerptMatch.start : excerptMatch.start;
      const fallback = locateDocumentAnchor(document, excerptStart);
      candidates.push({
        document,
        chunkId: chunk.id,
        ordinal: chunk.ordinal,
        sourceId: `source:${documentId}:${chunk.id}`,
        score: Math.max(scored.score, isRequired ? 0.25 : 0),
        matchKind: scored.matchKind,
        excerpt: excerptMatch.excerpt,
        evidenceText: parentEvidenceWindow(chunk.text, windowStart),
        parentChild: true,
        excerptStart,
        anchor: chunk.anchor || fallback.anchor,
        pageAnchor: chunk.pageAnchor || fallback.pageAnchor || fallback.anchor,
        pageNumber: chunk.pageNumber ?? fallback.pageNumber,
        region: chunk.region ?? fallback.region,
        confidence: chunk.confidence ?? fallback.confidence,
        timeStart: chunk.timeStart ?? fallback.timeStart,
        timeEnd: chunk.timeEnd ?? fallback.timeEnd,
        speaker: chunk.speaker ?? fallback.speaker,
        contentVersionId: chunk.contentVersionId ?? document.currentVersionId ?? null,
        revision: chunk.revision ?? document.revision ?? null,
        contentHash: chunk.contentHash ?? document.contentHash ?? null,
        required: isRequired
      });
    }
  }
  const matchRank = { 'text-match': 0, 'title-only': 1, 'scope-fallback': 2 };
  const compare = (left, right) => right.score - left.score || (matchRank[left.matchKind] ?? 3) - (matchRank[right.matchKind] ?? 3) || left.ordinal - right.ordinal || String(left.document.title || '').localeCompare(String(right.document.title || ''), 'zh-CN');
  const byDocument = new Map();
  for (const candidate of candidates) {
    const entries = byDocument.get(String(candidate.document.id)) || [];
    entries.push(candidate);
    byDocument.set(String(candidate.document.id), entries);
  }
  for (const entries of byDocument.values()) entries.sort(compare);
  const output = [];
  const selected = new Set();
  const perDocument = new Map();
  const add = (candidate) => {
    if (!candidate) return false;
    const key = `${candidate.document.id}:${candidate.chunkId}`;
    const documentId = String(candidate.document.id);
    if (selected.has(key) || (perDocument.get(documentId) || 0) >= Math.max(1, maxChunksPerDocument)) return false;
    selected.add(key);
    perDocument.set(documentId, (perDocument.get(documentId) || 0) + 1);
    output.push(candidate);
    return true;
  };
  for (const documentId of required) add(byDocument.get(documentId)?.[0]);
  const entityPhrases = distinctiveQueryPhrases(query);
  if (entityPhrases.length >= 2) {
    for (const phrase of entityPhrases) {
      const covered = output.some((entry) => titleContainsPhrase(entry.document, phrase));
      if (covered) continue;
      const extra = [...candidates]
        .filter((entry) => titleContainsPhrase(entry.document, phrase) && !isDerivedKnowledgeNote(entry.document))
        .sort(compare)[0];
      if (extra) add(extra);
    }
  }
  const safeLimit = Math.max(1, Math.min(Number(limit) || 6, 36));
  for (const candidate of [...candidates].sort(compare)) {
    if (output.length >= Math.max(safeLimit, required.size)) break;
    add(candidate);
  }
  return output;
}

function citationFromResult(result, index) {
  const location = result.anchor || result.pageNumber || result.region || result.timeStart != null || result.timeEnd != null || result.speaker
    ? { pageNumber: result.pageNumber ?? null, anchor: result.anchor || null, pageAnchor: result.pageAnchor || null, region: result.region || null, confidence: result.confidence ?? null, timeStart: result.timeStart ?? null, timeEnd: result.timeEnd ?? null, speaker: result.speaker ?? null }
    : locateDocumentAnchor(result.document, Number(result.excerptStart || 0));
  const citation = {
    index: index + 1,
    sourceId: result.sourceId || null,
    documentId: result.document.id,
    nodeToken: result.document.nodeToken || null,
    title: result.document.title,
    excerpt: result.excerpt,
    url: result.document.url || null,
    score: result.score,
    chunkId: result.chunkId || null,
    pageNumber: location.pageNumber,
    anchor: location.anchor,
    pageAnchor: location.pageAnchor || null,
    region: location.region,
    confidence: location.confidence,
    timeStart: location.timeStart,
    timeEnd: location.timeEnd,
    speaker: location.speaker,
    contentVersionId: result.contentVersionId ?? result.document.currentVersionId ?? null,
    revision: result.revision ?? result.document.revision ?? null,
    contentHash: result.contentHash ?? result.document.contentHash ?? null
  };
  return bindEvidenceRef(citation, result.document, { excerpt: result.excerpt, anchor: location.anchor, chunkId: result.chunkId, sourceId: result.sourceId });
}

export function answerQuestion(documents, question, options = {}) {
  const results = options.chunksByDocument
    ? searchEvidenceChunks(documents, question, options)
    : searchDocuments(documents, question, options);
  const fallbackEvidenceDocuments = new Set((options.allowScopeFallbackDocumentIds || []).map(String));
  const evidenceResults = results.filter(result => result.matchKind === undefined || result.matchKind === 'text-match' || (
    result.matchKind === 'scope-fallback' && fallbackEvidenceDocuments.has(String(result?.document?.id || result?.documentId || ''))
  ));
  if (!evidenceResults.length) {
    return {
      answer: '当前范围内没有找到与问题直接对应的正文证据。已保留选中资料的范围信息，但不会把标题或任意段落当作支撑结论。请换用资料中的关键词、指定章节，或继续追问具体主题。',
      citations: [],
      matches: results
    };
  }
  const citations = evidenceResults.map(citationFromResult);
  const scopeFallbackEvidence = evidenceResults.some(result => result.matchKind === 'scope-fallback');
  const evidenceLines = citations.map((citation) => `- ${citation.excerpt} [${citation.index}]`);
  const answer = [
    scopeFallbackEvidence
      ? '以下片段来自你明确加入当前对话的附件。问题没有命中正文关键词，因此它们仅作为可回到原文核验的附件范围材料，而不是直接问答结论：'
      : `根据本地知识库中与“${String(question).trim()}”最相关的材料：`,
    '',
    ...evidenceLines,
    '',
    `以上结论来自 ${new Set(citations.map(citation => String(citation.documentId))).size} 份本地文档的 ${citations.length} 条证据；可通过引用标题和链接回到原文核验。`
  ].join('\n');
  return { answer, citations, matches: results };
}

export function chunkText(text, size = 28) {
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += size) chunks.push(text.slice(offset, offset + size));
  return chunks;
}
