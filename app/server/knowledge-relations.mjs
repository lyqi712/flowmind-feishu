const MAX_EXCERPT = 240;
const MAX_RELATED_DOCUMENTS = 8;

const STOP_WORDS = new Set([
  '一个', '一种', '一些', '这个', '这些', '那个', '那些', '以及', '并且', '或者', '如果', '因为', '所以', '对于', '关于',
  '如何', '什么', '哪些', '是否', '可以', '能够', '需要', '进行', '通过', '相关', '之间', '其中', '我们', '你们', '他们',
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'these', 'those', 'what', 'which', 'how', 'why', 'are', 'was',
  'were', 'have', 'has', 'had', 'into', 'onto', 'about', 'between', 'can', 'could', 'should', 'would', 'will'
]);

const NEGATIVE_MARKERS = [
  '不应', '不应该', '不支持', '不启用', '不采用', '禁止', '反对', '避免', '不能', '不可', '无需', '取消', '停止', '未启用',
  'should not', 'must not', 'do not', 'does not', 'not support', 'not enable', 'not adopt', 'disable', 'reject', 'avoid', 'never'
];
const POSITIVE_MARKERS = [
  '应该', '应当', '必须', '支持', '启用', '采用', '推荐', '需要', '允许', '保留', '建立', '接入',
  'should', 'must', 'support', 'enable', 'adopt', 'recommend', 'require', 'allow', 'retain', 'establish', 'integrate'
];

let SEMANTIC_IGNORED_TOKENS;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sanitizeText(value, maxLength = Infinity) {
  let text = String(value ?? '');
  text = text
    .replace(/file:\/\/{2,3}[^\s<>'"）)]+/gi, '[本地路径已隐藏]')
    .replace(/\\\\[^\s\\/]+[\\/][^\s<>'"）)]+/g, '[本地路径已隐藏]')
    .replace(/\b[A-Za-z]:[\\/](?:[^\s<>'"）)]*[\\/])*[^\s<>'"）)]*/g, '[本地路径已隐藏]')
    .replace(/(^|[\s(（])\/(?:Users|home|tmp|var|private|mnt|opt|srv)\/[^\s<>'"）)]+/g, '$1[本地路径已隐藏]')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
  if (Number.isFinite(maxLength) && text.length > maxLength) return text.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
  return text;
}

function normalizeSpace(value) {
  return sanitizeText(value).replace(/\s+/g, ' ').trim();
}

function splitSentences(value) {
  return sanitizeText(value)
    .split(/(?<=[。！？!?；;])|\n+/u)
    .map((entry) => normalizeSpace(entry))
    .filter((entry) => entry.length >= 4);
}

function tokenize(value) {
  const normalized = normalizeSpace(value).normalize('NFKC').toLowerCase();
  const tokens = [];
  for (const token of normalized.match(/[a-z0-9][a-z0-9._+-]*/g) || []) {
    if (token.length > 1 && !STOP_WORDS.has(token)) tokens.push(token);
  }
  for (const run of normalized.match(/[\u3400-\u9fff]{2,}/g) || []) {
    if (run.length <= 8 && !STOP_WORDS.has(run)) tokens.push(run);
    const maxSize = Math.min(6, run.length);
    for (let size = 2; size <= maxSize; size += 1) {
      for (let index = 0; index <= run.length - size; index += 1) {
        const token = run.slice(index, index + size);
        if (!STOP_WORDS.has(token)) tokens.push(token);
      }
    }
  }
  return unique(tokens);
}

function tokenSet(value) {
  return new Set(tokenize(value));
}

function intersection(left, right) {
  const result = [];
  for (const value of left) if (right.has(value)) result.push(value);
  return result;
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  const shared = intersection(left, right).length;
  return shared / (left.size + right.size - shared);
}

function textOverlap(queryTokens, textTokens) {
  if (!queryTokens.size || !textTokens.size) return 0;
  return intersection(queryTokens, textTokens).length / queryTokens.size;
}

function getDocumentId(document, index) {
  return normalizeSpace(document?.id || document?.documentId || document?.nodeToken || 'document-' + (index + 1));
}

function chunkCollection(chunksByDocument, documentId) {
  if (chunksByDocument instanceof Map) return chunksByDocument.get(documentId) || [];
  if (chunksByDocument && typeof chunksByDocument === 'object') return chunksByDocument[documentId] || [];
  return [];
}

function normalizeChunk(chunk, index) {
  const metadata = chunk?.metadata && typeof chunk.metadata === 'object' ? chunk.metadata : {};
  const text = sanitizeText(chunk?.content ?? chunk?.text ?? chunk?.excerpt ?? '', 2400);
  return {
    id: normalizeSpace(chunk?.id || 'chunk-' + (index + 1)),
    text,
    anchor: normalizeSpace(chunk?.anchor || metadata.anchor || '') || null,
    pageNumber: numberOrNull(chunk?.pageNumber ?? metadata.pageNumber),
    region: cleanRegion(chunk?.region ?? metadata.region),
    timeStart: numberOrNull(chunk?.timeStart ?? metadata.timeStart),
    timeEnd: numberOrNull(chunk?.timeEnd ?? metadata.timeEnd),
    speaker: normalizeSpace(chunk?.speaker ?? metadata.speaker ?? '') || null
  };
}

function normalizeDocument(document, index, chunksByDocument) {
  const id = getDocumentId(document, index);
  const chunks = chunkCollection(chunksByDocument, id).slice(0, 60).map(normalizeChunk).filter((chunk) => chunk.text);
  const content = sanitizeText(document?.content ?? document?.text ?? chunks.map((chunk) => chunk.text).join('\n'), 18000);
  return {
    id,
    title: sanitizeText(document?.title || '未命名文档', 160),
    url: /^https?:\/\//i.test(String(document?.sourceUrl || document?.url || '')) ? String(document.sourceUrl || document.url) : null,
    content,
    chunks: chunks.length ? chunks : [{ id: 'document-content', text: content, anchor: null, pageNumber: null, region: null, timeStart: null, timeEnd: null, speaker: null }]
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanRegion(region) {
  if (!region || typeof region !== 'object') return null;
  const cleaned = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    const value = numberOrNull(region[key]);
    if (value !== null) cleaned[key] = value;
  }
  return Object.keys(cleaned).length ? cleaned : null;
}

function makeSourceRef(document, chunk = {}, excerpt = '') {
  const source = {
    documentId: document.id,
    title: document.title,
    anchor: normalizeSpace(chunk.anchor || '') || null,
    excerpt: sanitizeText(excerpt || chunk.text || document.content, MAX_EXCERPT)
  };
  const pageNumber = numberOrNull(chunk.pageNumber);
  const timeStart = numberOrNull(chunk.timeStart);
  const timeEnd = numberOrNull(chunk.timeEnd);
  const region = cleanRegion(chunk.region);
  if (pageNumber !== null) source.pageNumber = pageNumber;
  if (region) source.region = region;
  if (timeStart !== null) source.timeStart = timeStart;
  if (timeEnd !== null) source.timeEnd = timeEnd;
  if (chunk.speaker) source.speaker = sanitizeText(chunk.speaker, 80);
  return source;
}

function normalizeCitation(citation, documentsById) {
  const documentId = normalizeSpace(citation?.documentId || citation?.id || '');
  const document = documentsById.get(documentId) || {
    id: documentId || 'unknown-document',
    title: sanitizeText(citation?.title || '未知来源', 160),
    content: sanitizeText(citation?.excerpt || citation?.content || '')
  };
  return makeSourceRef(document, {
    anchor: citation?.anchor,
    pageNumber: citation?.pageNumber,
    region: citation?.region,
    timeStart: citation?.timeStart,
    timeEnd: citation?.timeEnd,
    speaker: citation?.speaker,
    text: citation?.excerpt || citation?.content || ''
  }, citation?.excerpt || citation?.content || '');
}

function sourceRefKey(source) {
  return [source.documentId, source.anchor || '', source.excerpt || ''].join('|');
}

function dedupeSourceRefs(sources, limit = 20) {
  const seen = new Set();
  const result = [];
  for (const source of sources.filter(Boolean)) {
    const key = sourceRefKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
    if (result.length >= limit) break;
  }
  return result;
}

function previousUserQuestion(history) {
  if (!Array.isArray(history)) return '';
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] || {};
    if (String(entry.role || '').toLowerCase() !== 'user') continue;
    const text = normalizeSpace(entry.content ?? entry.text ?? entry.query ?? '');
    if (text) return text;
  }
  return '';
}

function rewriteQuestion(question, history) {
  const current = normalizeSpace(question).replace(/^[请帮我]+/u, '').trim() || '梳理当前知识内容';
  const previous = previousUserQuestion(history);
  const contextual = /^(它|这|这个|这些|上述|前面|那|其中|继续|为什么|怎么)(\b|，|。|？|\s)/u.test(current) || current.length <= 8;
  if (previous && contextual && previous !== current) {
    return '结合上一轮关于「' + sanitizeText(previous, 80) + '」的讨论，' + current.replace(/[。?？]+$/u, '') + '？';
  }
  return current.replace(/[。?？]+$/u, '') + '？';
}

function detectIntent(question) {
  const text = normalizeSpace(question).toLowerCase();
  const definitions = [
    ['conflict', '冲突分析', ['冲突', '矛盾', '分歧', '不一致', 'contradiction', 'conflict', 'disagree']],
    ['timeline', '时间线梳理', ['时间线', '演进', '先后', '历程', 'timeline', 'chronology', 'history']],
    ['comparison', '方案比较', ['比较', '对比', '区别', '差异', '优缺点', 'compare', 'difference', 'versus', ' vs ']],
    ['relationship', '知识关联', ['关联', '联系', '关系', '共同', '上下游', '依赖', 'relate', 'relationship', 'connection']],
    ['action', '行动规划', ['落地', '执行', '行动', '步骤', '计划', '怎么做', '实施', 'action', 'plan', 'implement']],
    ['summary', '归纳总结', ['总结', '概括', '梳理', '提炼', '摘要', 'summary', 'summarize']],
    ['fact', '事实问答', []]
  ];
  const scored = definitions.map(([type, label, markers], index) => ({
    type,
    label,
    index,
    signals: markers.filter((marker) => text.includes(marker)),
  })).map((entry) => ({ ...entry, score: entry.signals.length }));
  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = scored[0];
  return {
    type: selected.score ? selected.type : 'fact',
    label: selected.score ? selected.label : '事实问答',
    confidence: selected.score ? round(clamp(0.62 + selected.score * 0.11, 0, 0.95), 2) : 0.55,
    signals: selected.signals,
    requiresCrossDocument: /关联|联系|关系|比较|对比|冲突|共同|跨文档|between|compare|conflict|relationship/i.test(text)
  };
}

function buildPlan(intent, documentCount) {
  const steps = [
    { id: 'retrieve', title: '定位证据', description: '从 ' + documentCount + ' 篇文档中定位与问题直接相关的段落和锚点。' },
    { id: 'connect', title: '建立关联', description: '按共同主题、实体和引用来源计算跨文档关联。' }
  ];
  if (intent.type === 'conflict' || intent.type === 'comparison') {
    steps.push({ id: 'compare', title: '比较观点', description: '对齐相同议题下的共识、差异和相反主张。' });
  } else if (intent.type === 'timeline') {
    steps.push({ id: 'timeline', title: '整理时间线', description: '提取带日期的事件并按时间顺序排列。' });
  } else {
    steps.push({ id: 'synthesize', title: '综合结论', description: '合并互补证据并标记证据不足之处。' });
  }
  steps.push({ id: 'verify', title: '核对引用', description: '计算回答的引用覆盖率并保留可点击来源。' });
  return { steps };
}

function phraseCandidates(text) {
  const normalized = normalizeSpace(text);
  const candidates = [];
  for (const match of normalized.matchAll(/[「“\"']([^」”\"']{2,40})[」”\"']/g)) candidates.push(match[1]);
  for (const match of normalized.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[ ._-]+[A-Z][A-Za-z0-9]*){0,3}\b/g)) candidates.push(match[0]);
  for (const match of normalized.matchAll(/[\u3400-\u9fff]{2,12}(?:系统|平台|模型|框架|流程|机制|策略|方案|项目|团队|组织|知识库|知识图谱)/g)) candidates.push(match[0]);
  return unique(candidates.map((entry) => normalizeSpace(entry)).filter((entry) => entry.length >= 2));
}

function extractTopics(documents, question, answer) {
  const stats = new Map();
  for (const document of documents) {
    const local = new Set();
    const phrases = phraseCandidates(document.title + '\n' + document.content);
    const frequentTokens = tokenize(document.title + '\n' + document.content).filter((token) => token.length >= 3 && token.length <= 18);
    for (const candidate of [...phrases, ...frequentTokens]) {
      const normalized = candidate.toLowerCase();
      if (STOP_WORDS.has(normalized) || /^\d+$/.test(normalized)) continue;
      if (!stats.has(normalized)) stats.set(normalized, { name: candidate, count: 0, documentIds: new Set(), documents: [] });
      const entry = stats.get(normalized);
      entry.count += 1;
      if (!local.has(normalized)) {
        local.add(normalized);
        entry.documentIds.add(document.id);
        entry.documents.push(document);
      }
    }
  }
  const focusTokens = tokenSet(question + '\n' + answer);
  const ranked = [...stats.values()]
    .map((entry) => {
      const focus = focusTokens.has(entry.name.toLowerCase()) || tokenize(entry.name).some((token) => focusTokens.has(token));
      const namedPhraseBonus = /\s/.test(entry.name) || /[A-Z].*[A-Z]/.test(entry.name) ? 5 : 0;
      const score = entry.documentIds.size * 4 + Math.min(entry.count, 8) + (focus ? 6 : 0) + namedPhraseBonus + Math.min(entry.name.length, 8) * 0.1;
      const sourceRefs = entry.documents.slice(0, 3).map((document) => {
        const chunk = bestChunk(document, tokenSet(entry.name));
        return makeSourceRef(document, chunk, chunk.text);
      });
      return { name: entry.name, score: round(score, 2), documentIds: [...entry.documentIds].sort(), sourceRefs };
    })
    .filter((entry) => entry.documentIds.length >= 2 || entry.score >= 12)
    .sort((left, right) => right.score - left.score || right.documentIds.length - left.documentIds.length || left.name.localeCompare(right.name, 'zh-CN'));
  const selected = [];
  for (const candidate of ranked) {
    const candidateTokens = tokenSet(candidate.name);
    const redundant = selected.some((existing) => {
      if (existing.documentIds.join('|') !== candidate.documentIds.join('|')) return false;
      const left = existing.name.toLowerCase();
      const right = candidate.name.toLowerCase();
      return left.includes(right) || right.includes(left) || jaccard(tokenSet(existing.name), candidateTokens) >= 0.62;
    });
    if (!redundant) selected.push(candidate);
    if (selected.length >= 10) break;
  }
  return selected;
}

function extractEntities(documents, question, answer) {
  const stats = new Map();
  for (const document of documents) {
    const local = new Set();
    const text = document.title + '\n' + document.content;
    const candidates = phraseCandidates(text);
    for (const match of text.matchAll(/(?:[\u3400-\u9fffA-Za-z0-9_-]{2,20})(?:公司|团队|组织|项目|系统|平台|模型|框架|产品|工作台|知识库)/g)) candidates.push(match[0]);
    for (const candidate of unique(candidates)) {
      const key = candidate.toLowerCase();
      if (!stats.has(key)) stats.set(key, { name: candidate, documentIds: new Set(), count: 0, documents: [] });
      const entry = stats.get(key);
      entry.count += 1;
      if (!local.has(key)) {
        local.add(key);
        entry.documentIds.add(document.id);
        entry.documents.push(document);
      }
    }
  }
  const focus = tokenSet(question + '\n' + answer);
  return [...stats.values()]
    .map((entry) => ({
      name: entry.name,
      type: /公司|团队|组织$/.test(entry.name) ? 'organization' : /项目|系统|平台|模型|框架|产品|工作台|知识库$/.test(entry.name) ? 'concept' : 'named-entity',
      score: round(entry.documentIds.size * 5 + Math.min(entry.count, 6) + (tokenize(entry.name).some((token) => focus.has(token)) ? 5 : 0), 2),
      documentIds: [...entry.documentIds].sort(),
      sourceRefs: entry.documents.slice(0, 3).map((document) => {
        const chunk = bestChunk(document, tokenSet(entry.name));
        return makeSourceRef(document, chunk, chunk.text);
      })
    }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, 'zh-CN'))
    .slice(0, 12);
}

function bestChunk(document, queryTokens) {
  return [...document.chunks]
    .map((chunk, index) => ({ chunk, index, score: textOverlap(queryTokens, tokenSet(chunk.text)) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.chunk || document.chunks[0];
}

function rankRelatedDocuments(documents, question, answer, citations, topics, entities) {
  const focusTokens = tokenSet([question, answer, topics.slice(0, 6).map((entry) => entry.name).join(' '), entities.slice(0, 6).map((entry) => entry.name).join(' ')].join('\n'));
  const citedIds = new Set(citations.map((citation) => citation.documentId));
  return documents
    .map((document) => {
      const titleTokens = tokenSet(document.title);
      const contentTokens = tokenSet(document.content);
      const titleMatch = textOverlap(focusTokens, titleTokens);
      const contentMatch = textOverlap(focusTokens, contentTokens);
      const matchingTopics = topics.filter((entry) => entry.documentIds.includes(document.id)).slice(0, 4).map((entry) => entry.name);
      const matchingEntities = entities.filter((entry) => entry.documentIds.includes(document.id)).slice(0, 4).map((entry) => entry.name);
      const citationBoost = citedIds.has(document.id) ? 0.24 : 0;
      const raw = titleMatch * 0.25 + contentMatch * 0.45 + Math.min(matchingTopics.length, 3) * 0.04 + Math.min(matchingEntities.length, 3) * 0.03 + citationBoost;
      const score = round(clamp(raw * 100, citedIds.has(document.id) ? 42 : 0, 100), 1);
      const candidateChunks = document.chunks
        .map((chunk, index) => ({ chunk, index, score: textOverlap(focusTokens, tokenSet(chunk.text)) }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, 2);
      const reasons = [];
      if (citedIds.has(document.id)) reasons.push('回答已直接引用');
      if (matchingTopics.length) reasons.push('共同主题：' + matchingTopics.join('、'));
      if (matchingEntities.length) reasons.push('共同实体：' + matchingEntities.join('、'));
      if (!reasons.length) reasons.push('正文与问题存在关键词交集');
      return {
        documentId: document.id,
        title: document.title,
        url: document.url,
        relationReason: reasons.join('；'),
        score,
        sourceRefs: candidateChunks.map((entry) => makeSourceRef(document, entry.chunk, entry.chunk.text))
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, 'zh-CN'))
    .slice(0, MAX_RELATED_DOCUMENTS);
}

function statementRecords(documents) {
  const records = [];
  for (const document of documents) {
    let documentRecords = 0;
    for (const chunk of document.chunks) {
      for (const sentence of splitSentences(chunk.text)) {
        if (sentence.length < 8 || sentence.length > 320) continue;
        const tokens = tokenSet(sentence);
        if (tokens.size < 2) continue;
        records.push({ document, chunk, sentence, tokens, polarity: sentencePolarity(sentence), numbers: sentence.match(/\d+(?:\.\d+)?%?/g) || [] });
        documentRecords += 1;
        if (documentRecords >= 24 || records.length >= 280) break;
      }
      if (documentRecords >= 24 || records.length >= 280) break;
    }
    if (records.length >= 280) break;
  }
  return records;
}

function sentencePolarity(sentence) {
  const lower = sentence.toLowerCase();
  if (NEGATIVE_MARKERS.some((marker) => lower.includes(marker))) return -1;
  if (POSITIVE_MARKERS.some((marker) => lower.includes(marker))) return 1;
  return 0;
}

function semanticTokens(record) {
  if (record.semanticTokens) return record.semanticTokens;
  SEMANTIC_IGNORED_TOKENS ||= new Set([...NEGATIVE_MARKERS.flatMap(tokenize), ...POSITIVE_MARKERS.flatMap(tokenize)]);
  record.semanticTokens = new Set([...record.tokens].filter((token) => !SEMANTIC_IGNORED_TOKENS.has(token) && !/^\d/.test(token)));
  return record.semanticTokens;
}

function findConsensus(records) {
  const used = new Set();
  const results = [];
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    if (used.has(leftIndex)) continue;
    const left = records[leftIndex];
    const group = [left];
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const right = records[rightIndex];
      if (right.document.id === left.document.id) continue;
      if (left.polarity && right.polarity && left.polarity !== right.polarity) continue;
      const similarity = jaccard(semanticTokens(left), semanticTokens(right));
      if (similarity >= 0.5) group.push(right);
    }
    const documentIds = unique(group.map((entry) => entry.document.id));
    if (documentIds.length < 2) continue;
    group.forEach((entry) => used.add(records.indexOf(entry)));
    const representative = [...group].sort((a, b) => a.sentence.length - b.sentence.length || a.document.id.localeCompare(b.document.id))[0];
    results.push({
      summary: sanitizeText(representative.sentence, 220),
      documentIds: documentIds.sort(),
      confidence: round(clamp(0.55 + documentIds.length * 0.1, 0, 0.9), 2),
      sourceRefs: dedupeSourceRefs(group.map((entry) => makeSourceRef(entry.document, entry.chunk, entry.sentence)), 6)
    });
  }
  return results.sort((left, right) => right.documentIds.length - left.documentIds.length || left.summary.localeCompare(right.summary, 'zh-CN')).slice(0, 6);
}

function findConflicts(records) {
  const results = [];
  const seen = new Set();
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    const left = records[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const right = records[rightIndex];
      if (left.document.id === right.document.id) continue;
      const similarity = jaccard(semanticTokens(left), semanticTokens(right));
      if (similarity < 0.3) continue;
      const polarityConflict = left.polarity !== 0 && right.polarity !== 0 && left.polarity !== right.polarity;
      const numericConflict = left.numbers.length && right.numbers.length && left.numbers.join('|') !== right.numbers.join('|');
      if (!polarityConflict && !numericConflict) continue;
      const ids = [left.document.id, right.document.id].sort();
      const key = ids.join('|') + '|' + [...intersection(semanticTokens(left), semanticTokens(right))].sort().slice(0, 4).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const shared = intersection(semanticTokens(left), semanticTokens(right)).sort((a, b) => b.length - a.length || a.localeCompare(b, 'zh-CN'));
      const sourceRefs = [makeSourceRef(left.document, left.chunk, left.sentence), makeSourceRef(right.document, right.chunk, right.sentence)];
      results.push({
        topic: shared.slice(0, 3).join(' / ') || '同一议题',
        explanation: numericConflict && !polarityConflict ? '不同文档对同一议题给出了不同数值。' : '不同文档对同一议题给出了相反或不兼容的主张。',
        viewpoints: [
          { documentId: left.document.id, title: left.document.title, statement: sanitizeText(left.sentence, 220), sourceRefs: [sourceRefs[0]] },
          { documentId: right.document.id, title: right.document.title, statement: sanitizeText(right.sentence, 220), sourceRefs: [sourceRefs[1]] }
        ],
        sourceRefs
      });
    }
  }
  return results.slice(0, 6);
}

function normalizeDate(match) {
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : 1;
  const day = match[3] ? Number(match[3]) : 1;
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function findTimeline(records) {
  const results = [];
  const pattern = /\b(20\d{2})(?:[-/.年](1[0-2]|0?[1-9]))?(?:[-/.月](3[01]|[12]\d|0?[1-9])日?)?/g;
  for (const record of records) {
    pattern.lastIndex = 0;
    for (const match of record.sentence.matchAll(pattern)) {
      const date = normalizeDate(match);
      const sourceRef = makeSourceRef(record.document, record.chunk, record.sentence);
      results.push({
        date,
        label: match[0],
        summary: sanitizeText(record.sentence, 220),
        documentId: record.document.id,
        title: record.document.title,
        anchor: sourceRef.anchor,
        excerpt: sourceRef.excerpt,
        sourceRefs: [sourceRef]
      });
    }
  }
  const seen = new Set();
  return results
    .sort((left, right) => left.date.localeCompare(right.date) || left.documentId.localeCompare(right.documentId) || left.summary.localeCompare(right.summary, 'zh-CN'))
    .filter((entry) => {
      const key = entry.date + '|' + entry.documentId + '|' + entry.summary;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

function calculateCitationCoverage(answer, citations, relatedDocuments) {
  const claims = splitSentences(answer).filter((sentence) => sentence.length >= 8);
  const citationTokens = citations.map((citation) => tokenSet(citation.title + ' ' + citation.excerpt));
  const supported = [];
  const uncovered = [];
  for (const claim of claims) {
    const claimTokens = tokenSet(claim);
    const supportScore = citationTokens.reduce((max, tokens) => Math.max(max, textOverlap(claimTokens, tokens), jaccard(claimTokens, tokens)), 0);
    if (supportScore >= 0.16) supported.push(claim);
    else uncovered.push(sanitizeText(claim, 180));
  }
  const totalClaims = claims.length;
  const supportedClaims = supported.length;
  const score = totalClaims ? round(supportedClaims / totalClaims * 100, 1) : citations.length ? 100 : 0;
  return {
    score,
    level: score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low',
    totalClaims,
    supportedClaims,
    unsupportedClaims: Math.max(0, totalClaims - supportedClaims),
    citedDocuments: unique(citations.map((citation) => citation.documentId)).filter(Boolean).sort(),
    relevantDocuments: unique(relatedDocuments.map((document) => document.documentId)).sort(),
    uncoveredClaims: uncovered.slice(0, 6)
  };
}

function buildFollowUps(intent, relatedDocuments, consensus, conflicts, timeline, citationCoverage) {
  const suggestions = [];
  if (relatedDocuments.length > 1) suggestions.push('比较「' + relatedDocuments[0].title + '」与「' + relatedDocuments[1].title + '」的关键差异和互补关系。');
  if (conflicts.length) suggestions.push('针对“' + conflicts[0].topic + '”的冲突，逐条核对来源并给出取舍建议。');
  if (consensus.length) suggestions.push('把已识别的共识转化为可执行的检查清单。');
  if (timeline.length) suggestions.push('沿时间线解释关键决策为什么发生变化。');
  if (citationCoverage.level !== 'high') suggestions.push('继续检索未被引用覆盖的结论，并补充可点击证据。');
  if (intent.type !== 'action') suggestions.push('基于这些关联生成下一步行动计划和负责人建议。');
  return unique(suggestions).slice(0, 5);
}

function buildKnowledgeMap(rewrittenQuestion, topics, entities, relatedDocuments) {
  const nodes = [{ id: 'question', type: 'question', label: sanitizeText(rewrittenQuestion || '当前问题', 120) }];
  const edges = [];
  const topicNodes = topics.slice(0, 6).map((topic, index) => ({ id: 'topic:' + index, type: 'topic', label: topic.name, score: topic.score, documentIds: topic.documentIds }));
  const entityNodes = entities.slice(0, 6).map((entity, index) => ({ id: 'entity:' + index, type: 'entity', label: entity.name, score: entity.score, documentIds: entity.documentIds }));
  const documentNodes = relatedDocuments.map((document) => ({ id: 'document:' + document.documentId, type: 'document', documentId: document.documentId, label: document.title, score: document.score, url: document.url || null }));
  nodes.push(...topicNodes, ...entityNodes, ...documentNodes);
  for (const node of [...topicNodes, ...entityNodes]) {
    edges.push({ from: 'question', to: node.id, type: node.type === 'topic' ? 'has-topic' : 'mentions-entity', reason: node.type === 'topic' ? '问题与回答的共同主题' : '问题与回答涉及的共同实体' });
    for (const documentId of node.documentIds || []) {
      if (relatedDocuments.some((document) => document.documentId === documentId)) edges.push({ from: node.id, to: 'document:' + documentId, type: 'supported-by', reason: node.label + ' 出现在该文档中' });
    }
  }
  for (const document of relatedDocuments) edges.push({ from: 'question', to: 'document:' + document.documentId, type: 'related-document', reason: document.relationReason, score: document.score });
  const bidirectionalLinks = [];
  for (let leftIndex = 0; leftIndex < relatedDocuments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < relatedDocuments.length; rightIndex += 1) {
      const left = relatedDocuments[leftIndex];
      const right = relatedDocuments[rightIndex];
      const sharedTopics = topics.filter((topic) => topic.documentIds.includes(left.documentId) && topic.documentIds.includes(right.documentId)).map((topic) => topic.name).slice(0, 4);
      const sharedEntities = entities.filter((entity) => entity.documentIds.includes(left.documentId) && entity.documentIds.includes(right.documentId)).map((entity) => entity.name).slice(0, 4);
      if (!sharedTopics.length && !sharedEntities.length) continue;
      const reasons = [];
      if (sharedTopics.length) reasons.push('共同主题：' + sharedTopics.join('、'));
      if (sharedEntities.length) reasons.push('共同实体：' + sharedEntities.join('、'));
      bidirectionalLinks.push({
        fromDocumentId: left.documentId,
        toDocumentId: right.documentId,
        fromTitle: left.title,
        toTitle: right.title,
        reason: reasons.join('；'),
        strength: round(Math.min(100, 28 + sharedTopics.length * 14 + sharedEntities.length * 10), 1)
      });
    }
  }
  return { nodes, edges, bidirectionalLinks: bidirectionalLinks.sort((left, right) => right.strength - left.strength).slice(0, 16) };
}

function cleanInputDocuments(documents, chunksByDocument) {
  return (Array.isArray(documents) ? documents : []).map((document, index) => normalizeDocument(document, index, chunksByDocument));
}

export function analyzeKnowledgeRelations({ documents = [], chunksByDocument = {}, question = '', answer = '', citations = [], history = [] } = {}) {
  const normalizedDocuments = cleanInputDocuments(documents, chunksByDocument);
  const documentsById = new Map(normalizedDocuments.map((document) => [document.id, document]));
  const normalizedCitations = (Array.isArray(citations) ? citations : []).map((citation) => normalizeCitation(citation, documentsById));
  const rewrittenQuestion = rewriteQuestion(question, history);
  const intent = detectIntent(rewrittenQuestion);
  const topics = extractTopics(normalizedDocuments, rewrittenQuestion, answer);
  const entities = extractEntities(normalizedDocuments, rewrittenQuestion, answer);
  const relatedDocuments = rankRelatedDocuments(normalizedDocuments, rewrittenQuestion, answer, normalizedCitations, topics, entities);
  const records = statementRecords(normalizedDocuments);
  const consensus = findConsensus(records);
  const conflicts = findConflicts(records);
  const timeline = findTimeline(records);
  const citationCoverage = calculateCitationCoverage(answer, normalizedCitations, relatedDocuments);
  const followUpSuggestions = buildFollowUps(intent, relatedDocuments, consensus, conflicts, timeline, citationCoverage);
  const knowledgeMap = buildKnowledgeMap(rewrittenQuestion, topics, entities, relatedDocuments);
  return {
    rewrittenQuestion,
    intent,
    plan: buildPlan(intent, normalizedDocuments.length),
    topics,
    entities,
    relatedDocuments,
    knowledgeMap,
    consensus,
    conflicts,
    timeline,
    citationCoverage,
    followUpSuggestions
  };
}

function artifactTitle(prefix, question) {
  const normalized = normalizeSpace(question) || '知识整理';
  return sanitizeText(prefix + normalized.replace(/[？?。]+$/u, ''), 80);
}

function artifactTags(kind, relations) {
  const topicTags = (relations?.topics || []).slice(0, 4).map((entry) => normalizeSpace(entry.name));
  const entityTags = (relations?.entities || []).slice(0, 3).map((entry) => normalizeSpace(entry.name));
  const kindTag = kind === 'note' ? '\u77e5\u8bc6\u7b14\u8bb0' : kind === 'task' ? '\u884c\u52a8\u4efb\u52a1' : kind === 'writing' ? '\u5199\u4f5c\u8349\u7a3f' : '\u8bc1\u636e\u56fe\u8868';
  return unique([kindTag, ...topicTags, ...entityTags]).filter(Boolean).slice(0, 8);
}

function artifactSources(citations, relations) {
  const documentsById = new Map();
  for (const relation of relations?.relatedDocuments || []) {
    documentsById.set(normalizeSpace(relation.documentId), { id: normalizeSpace(relation.documentId), title: sanitizeText(relation.title || '未知来源', 160), content: '' });
  }
  const citationSources = (Array.isArray(citations) ? citations : []).map((citation) => normalizeCitation(citation, documentsById));
  const relationSources = (relations?.relatedDocuments || []).flatMap((relation) => (relation.sourceRefs || []).map((source) => ({
    documentId: normalizeSpace(source.documentId || relation.documentId),
    title: sanitizeText(source.title || relation.title || '未知来源', 160),
    anchor: normalizeSpace(source.anchor || '') || null,
    excerpt: sanitizeText(source.excerpt || '', MAX_EXCERPT),
    ...(numberOrNull(source.pageNumber) !== null ? { pageNumber: numberOrNull(source.pageNumber) } : {}),
    ...(cleanRegion(source.region) ? { region: cleanRegion(source.region) } : {}),
    ...(numberOrNull(source.timeStart) !== null ? { timeStart: numberOrNull(source.timeStart) } : {}),
    ...(numberOrNull(source.timeEnd) !== null ? { timeEnd: numberOrNull(source.timeEnd) } : {})
  })));
  return dedupeSourceRefs([...citationSources, ...relationSources]);
}

function buildEvidenceChart(relations = {}, sourceRefs = []) {
  const topics = (relations.topics || []).map((entry) => ({
    label: normalizeSpace(entry.name || entry.title || entry.label),
    value: Number(entry.count || entry.score || entry.relevance || 0),
    sourceRefs: entry.sourceRefs || []
  })).filter((entry) => entry.label);
  const documents = (relations.relatedDocuments || []).map((entry) => ({
    label: normalizeSpace(entry.title || entry.documentId),
    value: Number(entry.score || entry.relevance || 0),
    sourceRefs: entry.sourceRefs || []
  })).filter((entry) => entry.label);
  const timeline = (relations.timeline || []).map((entry) => ({
    label: normalizeSpace(entry.date || entry.time || entry.period || entry.event || entry.text),
    value: 1,
    sourceRefs: entry.sourceRefs || []
  })).filter((entry) => entry.label);
  const entries = topics.length >= 2 ? topics.slice(0, 8) : documents.slice(0, 8);
  const chartEntries = entries.length >= 2 ? entries : timeline.slice(0, 8);
  const fallbackEntries = chartEntries.length >= 2 ? chartEntries : sourceRefs.slice(0, 6).map((entry) => ({ label: normalizeSpace(entry.title || entry.documentId), value: 1, sourceRefs: [entry] })).filter((entry) => entry.label);
  const labels = fallbackEntries.map((entry) => entry.label);
  const rawValues = fallbackEntries.map((entry) => Number.isFinite(entry.value) && entry.value > 0 ? entry.value : 1);
  const maxValue = Math.max(...rawValues, 1);
  const values = rawValues.map((value) => Math.round((value / maxValue) * 100));
  const chartSourceRefs = dedupeSourceRefs(fallbackEntries.flatMap((entry) => entry.sourceRefs || []).concat(sourceRefs.slice(0, 12)));
  return {
    type: topics.length >= 2 ? 'topic-bar' : timeline.length >= 2 ? 'timeline-bar' : 'source-bar',
    title: topics.length >= 2 ? '\u56de\u7b54\u6d89\u53ca\u7684\u4e3b\u9898\u5206\u5e03' : timeline.length >= 2 ? '\u6765\u6e90\u65f6\u95f4\u7ebf\u5206\u5e03' : '\u56de\u7b54\u5f15\u7528\u6765\u6e90\u5206\u5e03',
    unit: topics.length >= 2 ? '\u4e3b\u9898\u5173\u8054\u5ea6' : '\u8bc1\u636e\u5f3a\u5ea6',
    labels,
    values,
    sourceRefs: chartSourceRefs,
    generatedAt: new Date().toISOString()
  };
}

function bulletList(values, fallback) {
  const cleaned = values.map((value) => sanitizeText(value, 220)).filter(Boolean);
  return cleaned.length ? cleaned.map((value) => '- ' + value).join('\n') : '- ' + fallback;
}

export function createAnswerArtifactPayload(kind, { question = '', answer = '', citations = [], relations = {} } = {}) {
  if (!['note', 'task', 'writing', 'chart'].includes(kind)) throw new TypeError('Unsupported answer artifact kind: ' + kind);
  const safeQuestion = sanitizeText(question, 500) || '知识整理';
  const safeAnswer = sanitizeText(answer) || '暂无回答正文。';
  const sourceRefs = artifactSources(citations, relations);
  const tags = artifactTags(kind, relations);
  const chartSpec = kind === 'chart' ? buildEvidenceChart(relations, sourceRefs) : null;
  const relationLines = (relations.relatedDocuments || []).slice(0, 5).map((entry) => entry.title + '：' + entry.relationReason);
  const consensusLines = (relations.consensus || []).slice(0, 5).map((entry) => entry.summary);
  const conflictLines = (relations.conflicts || []).slice(0, 4).map((entry) => entry.topic + '：' + entry.explanation);
  const followUps = (relations.followUpSuggestions || []).slice(0, 5);
  let title;
  let content;
  if (kind === 'note') {
    title = artifactTitle('知识笔记：', safeQuestion);
    content = [
      '## 问题', safeQuestion,
      '## 回答', safeAnswer,
      '## 关联知识', bulletList(relationLines, '暂无额外关联文档。'),
      '## 共识', bulletList(consensusLines, '暂无跨文档共识。'),
      '## 分歧与待核对', bulletList(conflictLines, '暂无明确冲突。'),
      '## 后续问题', bulletList(followUps, '继续补充来源和上下文。')
    ].join('\n\n');
  } else if (kind === 'task') {
    title = artifactTitle('行动任务：', safeQuestion);
    const planSteps = (relations.plan?.steps || []).map((step) => '[ ] ' + (step.title || step.description) + (step.description ? ' — ' + step.description : ''));
    content = [
      '## 任务背景', safeQuestion,
      '## 参考结论', safeAnswer,
      '## 待办清单', bulletList([...planSteps, ...followUps.map((entry) => '[ ] ' + entry)], '确认目标、负责人和完成时间。'),
      '## 风险与分歧', bulletList(conflictLines, '暂无明确冲突，执行前仍需核对来源。')
    ].join('\n\n');
  } else if (kind === 'chart') {
    title = artifactTitle('\u8bc1\u636e\u56fe\u8868\uff1a', safeQuestion);
    content = [
      '## \u56fe\u8868\u8bf4\u660e', chartSpec.title,
      '## \u6838\u5fc3\u7ed3\u8bba', safeAnswer,
      '\u56fe\u8868\u6570\u636e', chartSpec.labels.map((label, index) => '- ' + label + '\uff1a' + chartSpec.values[index] + '?' + chartSpec.unit + '?').join('\n')
    ].join('\n\n');
  } else {
    title = artifactTitle('写作草稿：', safeQuestion);
    content = [
      '# ' + safeQuestion.replace(/[？?。]+$/u, ''),
      '## 核心回答', safeAnswer,
      '## 可展开的知识关联', bulletList(relationLines, '补充相关文档和案例。'),
      '## 可引用的共同结论', bulletList(consensusLines, '补充跨来源共识。'),
      '## 值得讨论的分歧', bulletList(conflictLines, '补充不同观点。'),
      '## 后续展开方向', bulletList(followUps, '补充背景、案例与结论。')
    ].join('\n\n');
  }
  return { title, content: sanitizeText(content), tags, sourceRefs, ...(chartSpec ? { chartSpec } : {}) };
}
