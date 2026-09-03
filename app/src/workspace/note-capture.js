export function shortenSourceTitle(title, max = 16) {
  const text = String(title || '').trim() || '来源文档';
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join('')}…`;
}

export function buildSourceNoteTitle(item = {}, { selection } = {}) {
  const quote = String(selection?.quote || selection?.text || '').trim();
  return `${quote ? '选区' : '阅读'} · ${shortenSourceTitle(item?.title)}`;
}

export function buildSourceNoteContent(item = {}, { quote } = {}) {
  const excerpt = String(quote || '').trim();
  if (!excerpt) return '';
  return `${excerpt.split(/\r?\n/).map(line => `> ${line}`).join('\n')}\n\n`;
}

export function buildWorkspaceNoteDraft({ title, selectionText } = {}) {
  const quote = String(selectionText || '').trim();
  return {
    title: `${quote ? '选区' : '笔记'} · ${shortenSourceTitle(title || '飞书知识')}`,
    content: buildSourceNoteContent({ title }, { quote })
  };
}

export function plainPreview(content, limit = 80) {
  const text = String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g, '$1')
    .replace(/\[!\s*(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\s*\]?/gi, '')
    .replace(/【!\s*(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\s*】/gi, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/[*_]{1,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  const chars = [...text];
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : text;
}

export function noteListPreview(content, limit = 42) {
  return plainPreview(content, limit) || '空白笔记';
}

const EMPTY_NOTE_TITLES = new Set(['', '无标题笔记', '未命名笔记', '新笔记', '问题记录']);

export function noteHasSubstance(note = {}) {
  if (isProblemNote(note) && (parseQaNote(note.content).question || parseQaNote(note.content).pitfall || parseQaNote(note.content).resolution)) return true;
  const title = String(note.title || '').trim();
  const content = plainPreview(note.content, 80);
  if (content) return true;
  return Boolean(title) && !EMPTY_NOTE_TITLES.has(title);
}

export function pickOpenNote(list = [], { preferredId, selectedId } = {}) {
  const notes = Array.isArray(list) ? list : [];
  return notes.find(note => note.id === preferredId)
    || notes.find(note => note.id === selectedId)
    || notes.find(noteHasSubstance)
    || notes[0]
    || null;
}

export function isProblemNote(note = {}) {
  if (String(note?.artifactKind || '') === 'problem') return true;
  return (Array.isArray(note?.tags) ? note.tags : []).some(tag => String(tag).includes('问题记录'));
}

const KNOWN_QA_HEADINGS = new Set(['问题', '这次怎么解决的', '回答', '下次容易忘的点']);

export function extraQaCards(content = '') {
  return String(content || '').split(/(?=^##\s+)/m).map(part => {
    const heading = String(part.match(/^##\s*([^\n]+)/)?.[1] || '').trim();
    if (!heading || KNOWN_QA_HEADINGS.has(heading)) return null;
    return { heading, body: part.replace(/^##\s*[^\n]+\n?/, '').trim() };
  }).filter(Boolean);
}

export function extraQaMarkdown(content = '') {
  return extraQaCards(content).map(card => `## ${card.heading}${card.body ? `\n${card.body}` : ''}`).join('\n\n').trim();
}

export function parseQaNote(content = '') {
  const text = String(content || '');
  const section = heading => {
    const escaped = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`##[^\\S\\n]*${escaped}[^\\S\\n]*\\n([\\s\\S]*?)(?=\\n##[^\\S\\n]|$)`));
    return String(match?.[1] || '').trim();
  };
  return {
    question: section('问题'),
    resolution: section('这次怎么解决的') || section('回答'),
    pitfall: section('下次容易忘的点'),
    extra: extraQaMarkdown(text)
  };
}

const DEFAULT_PITFALL = '把这次容易漏掉的步骤记下来，而不是整篇答案。';
const PITFALL_LINE = /(?:^|\n)\s*(?:[-*•]\s*)?(?:下次容易忘(?:的点)?|容易忘(?:记)?|别忘了?)\s*[:：]\s*(.+)/;

export function isPlaceholderPitfall(value = '') {
  return !String(value || '').trim() || String(value).includes(DEFAULT_PITFALL);
}

export function serializeQaNote({ question = '', resolution = '', pitfall = '', extra = '' } = {}) {
  const body = [
    '## 问题',
    String(question || '').trim(),
    '',
    '## 这次怎么解决的',
    String(resolution || '').trim(),
    '',
    '## 下次容易忘的点',
    String(pitfall || '').trim()
  ].join('\n');
  const suffix = (() => {
    const value = String(extra || '').trim();
    if (!value) return '';
    return /^##\s+/m.test(value) ? value : `## 其他\n${value}`;
  })();
  return suffix ? `${body}\n\n${suffix}` : body;
}

export function replaceQaSection(content, heading, value) {
  const text = String(content || '');
  const next = String(value || '').trim();
  const escaped = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(##[^\\S\\n]*${escaped}[^\\S\\n]*\\n)([\\s\\S]*?)(?=\\n##[^\\S\\n]|$)`);
  if (pattern.test(text)) {
    return text.replace(pattern, (_, prefix) => `${prefix}${next}${next ? '\n' : ''}`);
  }
  const suffix = next ? `\n\n## ${heading}\n${next}\n` : `\n\n## ${heading}\n`;
  return `${text.trimEnd()}${suffix}`;
}

export function stripPitfallLine(answer = '') {
  return String(answer || '').replace(PITFALL_LINE, '').replace(/\n{3,}/g, '\n\n').trim();
}

export function extractPitfallFromAnswer(answer = '') {
  const text = String(answer || '').trim();
  if (!text) return '';
  const labeled = text.match(PITFALL_LINE);
  if (labeled) return String(labeled[1] || '').trim().replace(/^[-*•]\s*/, '').slice(0, 80);
  const bullets = text.split('\n').map(line => line.trim()).filter(line => /^[-*•]\s+\S/.test(line)).map(line => line.replace(/^[-*•]\s+/, ''));
  const shortBullet = [...bullets].reverse().find(line => {
    const chars = [...line];
    return chars.length >= 4 && chars.length <= 36;
  });
  if (shortBullet) return shortBullet.slice(0, 80);
  const sentences = text.replace(/\s+/g, ' ').split(/[。！？!?]/).map(part => part.trim()).filter(Boolean);
  const actionable = [...sentences].reverse().find(part => {
    const chars = [...part];
    return chars.length >= 4 && chars.length <= 36 && /(?:别忘|不要忘|记得|下次|先|再|一定|出锅|之前|之后)/.test(part);
  });
  if (actionable) return actionable.slice(0, 80);
  return '';
}

export function extractResolutionFromAnswer(answer = '') {
  const body = stripPitfallLine(answer);
  if (!body) return '';
  const para = body.split(/\n{2,}/)[0].replace(/\s+/g, ' ').trim();
  const chars = [...para];
  return chars.length > 180 ? `${chars.slice(0, 180).join('')}…` : para;
}

function appendUniqueLine(existing, addition, { asBullet = false } = {}) {
  const next = String(addition || '').trim();
  if (!next) return String(existing || '').trim();
  const current = String(existing || '').trim();
  if (current.includes(next)) return current;
  const line = asBullet && !/^[-*•]\s+/.test(next) ? `- ${next}` : next;
  return current ? `${current}\n${line}` : line;
}

export function applyAssistantAnswerToProblemNote({ content = '', question = '', answer = '', fields = 'both' } = {}) {
  const qa = parseQaNote(content);
  const pitfall = extractPitfallFromAnswer(answer);
  const resolution = extractResolutionFromAnswer(answer);
  let next = String(content || '');
  if (!qa.question && String(question || '').trim()) {
    next = replaceQaSection(next, '问题', String(question).trim());
  }
  if (fields === 'pitfall' || fields === 'both') {
    const current = isPlaceholderPitfall(qa.pitfall) ? '' : qa.pitfall;
    next = replaceQaSection(next, '下次容易忘的点', appendUniqueLine(current, pitfall, { asBullet: true }));
  }
  if (fields === 'resolution' || fields === 'both') {
    next = replaceQaSection(next, '这次怎么解决的', appendUniqueLine(qa.resolution, resolution));
  }
  return next;
}

export function appendAssistantAnswerToNote(content = '', answer = '') {
  const source = String(content || '');
  const generated = String(answer || '').trim();
  if (!generated) return source;
  if (source.includes(generated)) return source;
  const prefix = !source ? '' : source.endsWith('\n\n') ? '' : source.endsWith('\n') ? '\n' : '\n\n';
  return `${source}${prefix}${generated}`;
}

export function buildProblemNoteAssistantPrompt({ title = '', qa = {} } = {}) {
  return [
    '你正在帮助维护一篇「问题记录」。不要写百科或完整教程。',
    `笔记标题：${title || '问题记录'}`,
    `当前问题：${qa.question || '（空）'}`,
    `这次怎么解决的：${qa.resolution || '（空）'}`,
    `下次容易忘的点：${qa.pitfall || '（空）'}`,
    '先用不超过 8 行说明这次怎么做。最后必须单独一行，格式严格为：',
    '下次容易忘：……',
    '「下次容易忘」只写真正容易漏掉的一步，不要复述整篇做法。'
  ].join('\n\n');
}

export function buildNoteAssistantUserPrompt({ title = '' } = {}) {
  return [
    '请基于当前笔记回答，不要编造笔记里没有的内容。',
    `笔记标题：${title || '无标题笔记'}`
  ].join('\n\n');
}

export function problemNoteDraft({ question = '', pitfall = '' } = {}) {
  const q = String(question || '').trim();
  return {
    title: q ? `问题记录：${q.slice(0, 40)}` : '问题记录',
    content: ['## 问题', q || '', '', '## 这次怎么解决的', '', '## 下次容易忘的点', pitfall ? `- ${pitfall}` : ''].join('\n'),
    tags: ['问题记录'],
    artifactKind: 'problem'
  };
}

export function compactProblemQuestion(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/^问题记录[:：]\s*/u, '')
    .replace(/[\s「」"'“”‘’`~～，。！？!?、,.:：]+/gu, '');
}

const PITFALL_APPEND_PATTERN = /^(?:再记一点|再记一下|再记一句|再补一点|再补一下|再补一句|把这个也记下|把这句也记下|补进刚才那篇|把这个记下来|记下来)(?:[:：].*)?$/u;
const PITFALL_PREFIX_PATTERN = /^(?:再补|再记)[:：].+/u;
const PITFALL_LABEL_PATTERN = /^(?:下次容易忘(?:的点)?|别忘了?)[:：].+/u;
const PITFALL_NATURAL_LEAD = /^(?:对了|哦对了|对哦|还有|另外)[:：,，]?\s*/u;
const PITFALL_REMINDER_PREFIX = /^(?:下次(?:记得|要记得|别忘了?|不要忘(?:记)?|别漏(?:掉)?)?|记住(?:下次)?|记得下次|别忘了下次)[:：,，]?\s*/u;
const PITFALL_QUESTION_PATTERN = /[?？]|怎么|如何|为什么|为啥|是不是|什么|哪些|哪个|谁|哪|吗$|呢$/u;
const PITFALL_TASK_PATTERN = /笔记|知识库|文档|对比|分析|总结|全文|整篇|帮我写|写成/u;

function spokenPitfallBody(value) {
  return String(value || '')
    .trim()
    .replace(PITFALL_NATURAL_LEAD, '')
    .replace(/^(?:再记一点|再记一下|再记一句|再补一点|再补一下|再补一句|把这个也记下|把这句也记下|补进刚才那篇|把这个记下来|记下来)[:：]?\s*/u, '')
    .replace(/^(?:再补|再记)[:：]\s*/u, '')
    .replace(/^(?:下次容易忘(?:的点)?|别忘了?)[:：]\s*/u, '')
    .replace(PITFALL_REMINDER_PREFIX, '')
    .trim();
}

function isNaturalSpokenPitfall(text) {
  const normalized = String(text || '').trim().replace(PITFALL_NATURAL_LEAD, '').trim();
  if (PITFALL_QUESTION_PATTERN.test(normalized) || PITFALL_TASK_PATTERN.test(normalized)) return false;
  if (!PITFALL_REMINDER_PREFIX.test(normalized)) return false;
  const body = spokenPitfallBody(text);
  return [...body].length >= 2 && [...body].length <= 60;
}

export function isPitfallAppendQuestion(value) {
  const text = String(value || '').trim();
  if (!text || [...text].length > 80) return false;
  return PITFALL_APPEND_PATTERN.test(text) || PITFALL_PREFIX_PATTERN.test(text) || PITFALL_LABEL_PATTERN.test(text) || isNaturalSpokenPitfall(text);
}

export function extractSpokenPitfall(value, lastAnswer = '') {
  const stripped = spokenPitfallBody(value);
  if (stripped) return (extractPitfallFromAnswer(`下次容易忘：${stripped}`) || stripped).slice(0, 80);
  return extractPitfallFromAnswer(lastAnswer);
}

export function findRelatedProblemNote(notes = [], { question = '', title = '' } = {}) {
  const target = compactProblemQuestion(question || title);
  if (target.length < 6) return null;
  const list = (Array.isArray(notes) ? notes : []).filter(note => !note?.archived && !note?.deletedAt && isProblemNote(note));
  const keyOf = note => compactProblemQuestion(parseQaNote(note?.content).question || note?.title);
  const exact = list.find(note => keyOf(note) === target);
  if (exact) return exact;
  return list.find(note => {
    const key = keyOf(note);
    if (key.length < 6) return false;
    const shorter = key.length <= target.length ? key : target;
    const longer = key.length <= target.length ? target : key;
    return longer.includes(shorter) && shorter.length >= Math.min(8, longer.length);
  }) || null;
}

export function wikiLinksFromSourceRefs(sourceRefs = []) {
  const seen = new Set();
  const links = [];
  for (const ref of Array.isArray(sourceRefs) ? sourceRefs : []) {
    const title = String(ref?.title || '').trim();
    if (!title || seen.has(title) || /^https?:/i.test(title) || title === '来源文档' || title === '网页') continue;
    seen.add(title);
    links.push(`[[${title}]]`);
    if (links.length >= 6) break;
  }
  return links;
}

export function appendWikiLinksToNote(content = '', sourceRefs = []) {
  const links = wikiLinksFromSourceRefs(sourceRefs).filter(link => !String(content || '').includes(link));
  if (!links.length) return String(content || '');
  const qa = parseQaNote(content);
  const extra = [qa.extra, links.join(' ')].filter(Boolean).join('\n');
  return serializeQaNote({ ...qa, extra });
}

export function mergeProblemNoteContent(existingContent, incomingContent) {
  const incoming = parseQaNote(incomingContent);
  const pitfallText = String(incoming.pitfall || '').replace(/^[-*•]\s*/, '').trim();
  const synthetic = [incoming.resolution, pitfallText ? `下次容易忘：${pitfallText}` : ''].filter(Boolean).join('\n');
  let next = applyAssistantAnswerToProblemNote({
    content: existingContent,
    question: incoming.question,
    answer: synthetic,
    fields: 'both'
  });
  if (incoming.extra) {
    const qa = parseQaNote(next);
    const extra = qa.extra.includes(incoming.extra) ? qa.extra : [qa.extra, incoming.extra].filter(Boolean).join('\n');
    next = serializeQaNote({ ...qa, extra });
  }
  return next;
}

export function noteListQuestion(note = {}) {
  if (!isProblemNote(note)) return note.title || '无标题笔记';
  return parseQaNote(note.content).question || note.title || '问题记录';
}

export function noteListAnswerPreview(note = {}) {
  if (!isProblemNote(note)) return noteListPreview(note.content);
  const qa = parseQaNote(note.content);
  return plainPreview(qa.pitfall || qa.resolution, 42) || '还没记下这次容易忘的点';
}

export function searchExcerptPreview(excerpt, { title = '', limit = 80 } = {}) {
  const preview = plainPreview(excerpt, Math.max(limit + 24, 80));
  if (!preview) return '';
  const heading = String(title || '').trim();
  const stripped = heading && preview.startsWith(heading)
    ? preview.slice(heading.length).replace(/^[\s·—\-|:：,，.。]+/, '')
    : preview;
  const text = stripped || preview;
  const chars = [...text];
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : text;
}

export function noteHasVisibleRelations({ sourceRefs = [], attachments = [], outgoing = [], incoming = [], wikiOutgoing = [], wikiIncoming = [], loading = false } = {}) {
  return Boolean(loading || sourceRefs.length || attachments.length || outgoing.length || incoming.length || wikiOutgoing.length || wikiIncoming.length);
}
