const RELATED_LIMIT = 3;
const MIN_RELATED_SCORE = 30;
const GENERIC_TAGS = new Set(['来源笔记', '选区笔记', '标签测试', '文档标注', 'pdf标注', 'agent task', '组织']);
const GENERIC_TITLE_TOKENS = new Set([
  '文档', '知识库', '指南', '总结', '笔记', '资料', '教程', '分享', '完整', '建议', '问题',
  '方案', '实战', '模板', '应用', '企业', '落地', '工作流', '智能体', '提示词',
  '未命名', '飞书文档', '未命名飞书文档', '俗人', '六哥', '俗人六哥', '团队原创',
  '俗人六哥团队', '俗人六哥团队原创', '案例教程', '源码分享',
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'ai', 'v4', 'v3', 'pro', 'sop'
]);
const FEISHU_DOC_RE = /https?:\/\/(?:[a-z0-9-]+\.)?feishu\.cn\/(?:docx|wiki|docs)\/([A-Za-z0-9]+)/gi;
const WIKI_RE = /\[\[([^\]\n]+)\]\]/g;

function clean(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeLookup(value) {
  return clean(value)
    .toLocaleLowerCase()
    .replace(/^\[\[/, '')
    .replace(/\]\]$/, '')
    .split('|')[0]
    .split('#')[0]
    .replace(/\.md$/i, '')
    .replace(/\s+/g, '');
}

function tagLabel(value) {
  if (value && typeof value === 'object') return clean(value.name || value.label || value.title).replace(/^#/, '');
  return clean(value).replace(/^#/, '');
}

function itemTags(item = {}) {
  return unique([...(item.tags || []), ...((item.metadata && item.metadata.tags) || [])].map(tagLabel).filter(Boolean));
}

function meaningfulTags(item) {
  return itemTags(item).filter((tag) => !GENERIC_TAGS.has(tag.toLocaleLowerCase()));
}

function collapseSubstrings(tokens) {
  return unique(tokens)
    .sort((left, right) => right.length - left.length || left.localeCompare(right, 'zh-CN'))
    .filter((token, index, list) => !list.slice(0, index).some((kept) => kept.includes(token)));
}

function titleTokens(title) {
  let text = clean(title).normalize('NFKC').toLocaleLowerCase()
    .replace(/【[^】]*】/g, ' ')
    .replace(/[^\u3400-\u9fffa-z0-9._+-]+/g, ' ');
  for (const generic of [...GENERIC_TITLE_TOKENS].sort((left, right) => right.length - left.length)) {
    text = text.split(generic).join(' ');
  }
  const tokens = [];
  for (const part of text.split(/\s+/).filter(Boolean)) {
    for (const token of part.match(/[a-z0-9][a-z0-9._+-]*/g) || []) {
      if (token.length >= 3) tokens.push(token);
    }
    for (const run of part.match(/[\u3400-\u9fff]{2,}/g) || []) {
      if (run.length <= 6) tokens.push(run);
    }
  }
  return collapseSubstrings(tokens);
}

function sharedTitleTokens(leftTitle, rightTitle) {
  const right = new Set(titleTokens(rightTitle));
  return collapseSubstrings(titleTokens(leftTitle).filter((token) => right.has(token)));
}

function isStrongTitleMatch(tokens) {
  if (!tokens.length) return false;
  const ascii = tokens.filter((token) => /[a-z0-9]/.test(token));
  if (ascii.some((token) => token.length >= 3)) return true;
  if (tokens.length >= 2 && tokens.every((token) => token.length >= 3)) return true;
  return tokens.some((token) => token.length >= 4);
}

export function extractOutboundRefs(text = '') {
  const refs = [];
  const seen = new Set();
  const source = String(text || '');
  for (const match of source.matchAll(FEISHU_DOC_RE)) {
    const token = match[1];
    const key = `url:${token}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ kind: 'url', token, raw: match[0] });
  }
  for (const match of source.matchAll(WIKI_RE)) {
    const title = clean(match[1]).split('|')[0].split('#')[0];
    const key = `wiki:${normalizeLookup(title)}`;
    if (!title || seen.has(key)) continue;
    seen.add(key);
    refs.push({ kind: 'wiki', title });
  }
  return refs;
}

function documentKeys(document = {}) {
  const metadata = document.metadata && typeof document.metadata === 'object' ? document.metadata : {};
  return unique([
    document.id,
    document.documentId,
    document.externalId,
    document.sourceUrl,
    document.url,
    metadata.nodeToken,
    metadata.documentId
  ].map(clean));
}

function resolveRef(ref, documents, selfId) {
  if (ref.kind === 'url') {
    return documents.find((document) => String(document.id) !== String(selfId) && documentKeys(document).some((key) => key.includes(ref.token)));
  }
  if (ref.kind === 'wiki') {
    const lookup = normalizeLookup(ref.title);
    return documents.find((document) => String(document.id) !== String(selfId) && normalizeLookup(document.title) === lookup);
  }
  return null;
}

function noteDocumentIds(note = {}) {
  return unique((Array.isArray(note.sourceRefs) ? note.sourceRefs : []).map((ref) => clean(ref?.documentId || ref?.contentItemId || ref?.id)));
}

function conversationDocumentIds(conversation = {}) {
  return unique([
    ...(Array.isArray(conversation.documentIds) ? conversation.documentIds : []),
    ...(Array.isArray(conversation.selectedDocs) ? conversation.selectedDocs : []),
    ...(Array.isArray(conversation.resources) ? conversation.resources.map((item) => item?.documentId || item?.id) : [])
  ].map(clean));
}

function graphNeighborIds(graphRelations = null, selfId) {
  if (!graphRelations) return [];
  const rows = [...(graphRelations.incoming || []), ...(graphRelations.outgoing || [])];
  const ids = [];
  for (const row of rows) {
    const type = clean(row.edge?.type || row.type).toLocaleLowerCase();
    if (!['link', 'embed', 'source'].includes(type)) continue;
    const node = row.node || {};
    if (node.type && node.type !== 'document') continue;
    const id = clean(node.sourceId || node.contentItemId || node.raw?.id);
    if (id && id !== String(selfId)) ids.push(id);
  }
  return unique(ids);
}

export function formatRelatedReason(signals = []) {
  const primary = signals[0];
  if (!primary) return '';
  if (primary.kind === 'link') return `这篇提到了《${primary.title}》`;
  if (primary.kind === 'backlink') return `《${primary.title}》提到了这篇`;
  if (primary.kind === 'shared-note') return `共同笔记：${primary.noteTitle}`;
  if (primary.kind === 'conversation') return '曾一起用来提问';
  if (primary.kind === 'tag') return `同标签 ${primary.tags.map((tag) => `#${tag}`).join(' ')}`;
  if (primary.kind === 'title') return `主题相近：${primary.tokens.join('、')}`;
  return primary.label || '';
}

function collectSignals({ item, candidate, notes, conversations, outboundFromSelf, outboundFromCandidate, graphNeighbor }) {
  const signals = [];
  const selfId = String(item.id);
  const otherId = String(candidate.id);
  if (outboundFromSelf.has(otherId)) signals.push({ kind: 'link', title: candidate.title || '未命名文档', weight: 100 });
  else if (outboundFromCandidate.has(otherId)) signals.push({ kind: 'backlink', title: candidate.title || '未命名文档', weight: 90 });
  else if (graphNeighbor) signals.push({ kind: 'link', title: candidate.title || '未命名文档', weight: 85 });

  const sharedNotes = notes.filter((note) => {
    const ids = noteDocumentIds(note);
    return ids.includes(selfId) && ids.includes(otherId);
  });
  if (sharedNotes.length) {
    signals.push({
      kind: 'shared-note',
      noteTitle: clean(sharedNotes[0].title) || '未命名笔记',
      weight: 80
    });
  }

  const sharedTalk = conversations.some((conversation) => {
    const ids = conversationDocumentIds(conversation);
    return ids.includes(selfId) && ids.includes(otherId);
  });
  if (sharedTalk) signals.push({ kind: 'conversation', weight: 50 });

  const tags = meaningfulTags(item).filter((tag) => meaningfulTags(candidate).includes(tag)).slice(0, 3);
  if (tags.length) signals.push({ kind: 'tag', tags, weight: 30 + tags.length * 6 });

  const distinctive = sharedTitleTokens(item.title, candidate.title);
  if (isStrongTitleMatch(distinctive)) {
    signals.push({
      kind: 'title',
      tokens: distinctive.slice(0, 3),
      weight: 12 * distinctive.length + Math.min(12, distinctive.join('').length)
    });
  }
  return signals.sort((left, right) => right.weight - left.weight);
}

export function findRelatedDocuments({
  item,
  documents = [],
  notes = [],
  conversations = [],
  graphRelations = null
} = {}, { limit = RELATED_LIMIT } = {}) {
  if (!item?.id) return [];
  const selfId = String(item.id);
  const catalog = (Array.isArray(documents) ? documents : []).filter((document) => document?.id && String(document.id) !== selfId);
  const selfRefs = extractOutboundRefs(item.content);
  const outboundFromSelf = new Set(selfRefs.map((ref) => resolveRef(ref, catalog, selfId)?.id).filter(Boolean).map(String));
  const outboundFromCandidate = new Map();
  for (const candidate of catalog) {
    const hits = extractOutboundRefs(candidate.content)
      .map((ref) => resolveRef(ref, [item, ...catalog], candidate.id))
      .filter((document) => String(document?.id) === selfId);
    if (hits.length) outboundFromCandidate.set(String(candidate.id), true);
  }
  const graphNeighbors = new Set(graphNeighborIds(graphRelations, selfId));

  return catalog
    .map((candidate) => {
      const signals = collectSignals({
        item,
        candidate,
        notes,
        conversations,
        outboundFromSelf,
        outboundFromCandidate,
        graphNeighbor: graphNeighbors.has(String(candidate.id))
      });
      const score = signals.reduce((sum, signal) => sum + Number(signal.weight || 0), 0);
      return {
        documentId: String(candidate.id),
        title: clean(candidate.title) || '未命名文档',
        score,
        signals,
        reason: formatRelatedReason(signals)
      };
    })
    .filter((row) => row.score >= MIN_RELATED_SCORE && row.signals.length > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, 'zh-CN'))
    .slice(0, Math.max(1, Math.min(5, Number(limit) || RELATED_LIMIT)))
    .map(({ signals, ...row }) => ({ ...row, kinds: signals.map((signal) => signal.kind) }));
}

export { RELATED_LIMIT, MIN_RELATED_SCORE };
