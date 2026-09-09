import { isProblemNote, noteHasSubstance, noteListQuestion } from './note-capture.js';

export const NOTES_INDEX_TOKEN = ':::notes-index';

export const NOTE_SLASH_COMMANDS = Object.freeze([
  { id: 'page', label: '新建页面', hint: '在这一页链过去，点开就是一篇新笔记' },
  { id: 'index', label: '笔记索引', hint: '像数据库一样看、筛、新建' },
  { id: 'file', label: '放入文件', hint: '图片、PDF 或其他文件' },
  { id: 'web', label: '放入网页', hint: '粘贴公网链接' },
  { id: 'problem', label: '问题记录', hint: '只记这次容易忘的点' },
  { id: 'organize', label: '整理成导航', hint: '用现有笔记生成快速入口和索引' },
  { id: 'ask', label: '问这一页', hint: 'AI 基于这篇回答，可写回正文' }
]);

export function hasNotesIndex(content = '') {
  return String(content || '').includes(NOTES_INDEX_TOKEN);
}

export function stripNotesIndexToken(content = '') {
  return String(content || '').replace(new RegExp(`\\n?${NOTES_INDEX_TOKEN}\\n?`, 'g'), '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function detectNoteSlash(content = '', caret = 0) {
  const text = String(content || '');
  const pos = Math.max(0, Math.min(text.length, Number(caret) || 0));
  const before = text.slice(0, pos);
  const match = before.match(/(^|\n)\/([^\n]*)$/);
  if (!match) return null;
  return {
    start: pos - match[2].length - 1,
    end: pos,
    query: match[2]
  };
}

export function filterNoteSlashCommands(query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [...NOTE_SLASH_COMMANDS];
  return NOTE_SLASH_COMMANDS.filter(item => `${item.id} ${item.label} ${item.hint}`.toLowerCase().includes(q));
}

export function replaceNoteSlash(content = '', slash, insert = '') {
  if (!slash) return String(content || '');
  const source = String(content || '');
  return `${source.slice(0, slash.start)}${insert}${source.slice(slash.end)}`;
}

export function insertNotesIndexBlock(content = '', caret = 0) {
  const source = String(content || '');
  if (hasNotesIndex(source)) return { content: source, caret: Math.max(0, Number(caret) || 0) };
  const pos = Math.max(0, Math.min(source.length, Number(caret) || source.length));
  const before = source.slice(0, pos);
  const after = source.slice(pos);
  const prefix = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = !after || after.startsWith('\n') ? '' : '\n';
  const block = `${prefix}${NOTES_INDEX_TOKEN}${suffix}`;
  return { content: `${before}${block}${after}`, caret: pos + block.length };
}

export function wikiEntryCards(content = '', limit = 12) {
  const cards = [];
  const seen = new Set();
  for (const match of String(content || '').matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
    const title = String(match[1] || '').trim();
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    cards.push({ title });
    if (cards.length >= limit) break;
  }
  return cards;
}

export function notesIndexRows(notes = [], { view = 'all', excludeId = '' } = {}) {
  const exclude = String(excludeId || '');
  let rows = (Array.isArray(notes) ? notes : []).filter(note => note && note.id !== exclude && !note.archived);
  if (view === 'problem') rows = rows.filter(isProblemNote);
  else if (view === 'note') rows = rows.filter(note => !isProblemNote(note));
  const sorted = [...rows].sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
  if (view === 'recent') return sorted.slice(0, 20);
  return sorted;
}

export function buildNotesNavContent({ title = '', notes = [], content = '' } = {}) {
  const existing = stripNotesIndexToken(content);
  const links = (Array.isArray(notes) ? notes : [])
    .filter(note => noteHasSubstance(note) || String(note?.title || '').trim())
    .slice(0, 12)
    .map(note => `- [[${noteListQuestion(note)}]]`);
  const heading = existing.match(/^#\s+/m) ? existing : [`# ${title || '无标题'}`, existing].filter(Boolean).join('\n\n');
  const withoutOldNav = heading.replace(/\n## 快速入口\n(?:- \[\[[^\]]+\]\]\n?)*/u, '\n').trim();
  return [withoutOldNav || `# ${title || '无标题'}`, '', '## 快速入口', links.join('\n') || '- 输入 / 新建页面，或把文件拖进来', '', NOTES_INDEX_TOKEN, ''].join('\n');
}

export function notesIndexKindLabel(note = {}) {
  return isProblemNote(note) ? '问题记录' : '笔记';
}

export function findNoteTextRange(content = '', quote = '') {
  const source = String(content || '');
  const needle = String(quote || '').trim();
  if (!needle) return null;
  const start = source.indexOf(needle);
  if (start < 0) return null;
  return { start, end: start + needle.length };
}

export function buildSelectionAskPrompt(quote = '') {
  const text = String(quote || '').trim();
  if (!text) return '';
  const clipped = [...text].length > 1200 ? `${[...text].slice(0, 1200).join('')}…` : text;
  return `我划了这段：\n“${clipped}”\n\n请直接给出可以写回笔记的改法，保留事实和链接。不要解释过程。`;
}

export function shouldCreateBlankNotePage(list, { archived = false } = {}) {
  return !archived && !(Array.isArray(list) && list.length);
}

let blankPageSeed = null;

export function resetBlankNotePageSeed() {
  blankPageSeed = null;
}

export async function seedBlankNotePage(create) {
  if (!blankPageSeed) {
    blankPageSeed = Promise.resolve()
      .then(() => create())
      .catch(error => {
        blankPageSeed = null;
        throw error;
      });
  }
  return blankPageSeed;
}

export function isEmptyBlockCaret(content = '', caret = 0) {
  const text = String(content || '');
  const pos = Math.max(0, Math.min(text.length, Number(caret) || 0));
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const lineEnd = text.indexOf('\n', pos);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  return !line.trim();
}

export function applyPaperTypeKey(content = '', input = {}) {
  const event = typeof input === 'string' ? { key: input } : (input || {});
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = event.key;
  const source = String(content || '');
  if (key === 'Enter') return { content: source, caret: source.length, openSlash: false };
  if (key !== '/' && key !== '[') return null;
  const prefix = key === '/' && source && !source.endsWith('\n') ? '\n' : '';
  const insert = `${prefix}${key}`;
  return {
    content: `${source}${insert}`,
    caret: source.length + insert.length,
    openSlash: key === '/'
  };
}

export function filterNotesIndexRows(rows = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(note => `${noteListQuestion(note)} ${(note.tags || []).join(' ')} ${note.content || ''}`.toLowerCase().includes(q));
}
