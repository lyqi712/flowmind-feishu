import { basename, extname } from 'node:path';
import { openZip } from './zip-reader.mjs';

function entities(value) {
  return String(value || '').replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");
}
function tags(value) { return entities(String(value || '').replace(/<\s*br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[^\S\n]+/g, ' ').replace(/\n\s+/g, '\n').trim(); }
function xmlTexts(xml, pattern) {
  const output = []; for (const match of String(xml || '').matchAll(pattern)) { const text = tags(match[1]); if (text) output.push(text); } return output;
}
function titleFromPath(path) { return basename(path, extname(path)); }
function naturalEntrySort(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }

export async function parseDocx({ bytes, path }) {
  const zip = openZip(bytes), names = ['word/document.xml', ...zip.list('word/header').filter((name) => name.endsWith('.xml')), ...zip.list('word/footer').filter((name) => name.endsWith('.xml'))];
  if (!zip.has('word/document.xml')) throw Object.assign(new Error('DOCX 缺少 word/document.xml'), { code: 'DOCX_DOCUMENT_MISSING' });
  const sections = [];
  for (const name of names) {
    const xml = zip.text(name), paragraphs = [];
    for (const paragraph of xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []) {
      const runs = xmlTexts(paragraph, /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g); if (runs.length) paragraphs.push(runs.join(''));
    }
    if (paragraphs.length) sections.push(name === 'word/document.xml' ? paragraphs.join('\n') : `## ${name.includes('header') ? '页眉' : '页脚'}\n${paragraphs.join('\n')}`);
  }
  const content = sections.join('\n\n').trim();
  return { title: content.split(/\r?\n/).find(Boolean)?.slice(0, 160) || titleFromPath(path), content, contentType: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', metadata: { archiveEntries: zip.entries.size } };
}

export async function parsePptx({ bytes, path }) {
  const zip = openZip(bytes), slides = zip.list('ppt/slides/').filter((name) => /slide\d+\.xml$/i.test(name)).sort(naturalEntrySort);
  if (!slides.length) throw Object.assign(new Error('PPTX 没有可读取的幻灯片'), { code: 'PPTX_SLIDES_MISSING' });
  const parts = slides.map((name, index) => {
    const values = xmlTexts(zip.text(name), /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g);
    return `# 第 ${index + 1} 页\n${values.join('\n')}`;
  });
  return { title: titleFromPath(path), content: parts.join('\n\n'), contentType: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', metadata: { slideCount: slides.length } };
}

function attr(source, name) { const match = String(source || '').match(new RegExp(`\\b${name}="([^"]*)"`, 'i')); return match ? entities(match[1]) : ''; }
function sharedStrings(zip) {
  if (!zip.has('xl/sharedStrings.xml')) return [];
  return [...zip.text('xl/sharedStrings.xml').matchAll(/<si\b[\s\S]*?<\/si>/g)].map((match) => xmlTexts(match[0], /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g).join(''));
}
function workbookNames(zip) {
  if (!zip.has('xl/workbook.xml')) return [];
  return [...zip.text('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?\s*>/g)].map((match) => attr(match[1], 'name'));
}
function columnIndex(reference) {
  const letters = String(reference || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase() || 'A'; let value = 0;
  for (const char of letters) value = value * 26 + char.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}
function worksheetRows(xml, strings) {
  const output = [];
  for (const rowMatch of String(xml || '').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1], body = cellMatch[2], type = attr(attributes, 't'), reference = attr(attributes, 'r');
      let value;
      if (type === 'inlineStr') value = xmlTexts(body, /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g).join('');
      else { const raw = entities(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || ''); value = type === 's' ? strings[Number(raw)] ?? raw : type === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE') : raw; }
      const index = columnIndex(reference); while (row.length < index) row.push(''); row[index] = value;
    }
    if (row.some((value) => String(value || '').trim())) output.push(row);
  }
  return output;
}
function markdownTable(rows) {
  if (!rows.length) return '';
  const width = Math.max(...rows.map((row) => row.length)), normalized = rows.map((row) => Array.from({ length: width }, (_, index) => String(row[index] ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()));
  return [normalized[0], Array.from({ length: width }, () => '---'), ...normalized.slice(1)].map((row) => `| ${row.join(' | ')} |`).join('\n');
}
export async function parseXlsx({ bytes, path }) {
  const zip = openZip(bytes), strings = sharedStrings(zip), names = workbookNames(zip), sheets = zip.list('xl/worksheets/').filter((name) => /sheet\d+\.xml$/i.test(name)).sort(naturalEntrySort);
  if (!sheets.length) throw Object.assign(new Error('XLSX 没有可读取的工作表'), { code: 'XLSX_SHEETS_MISSING' });
  const parts = sheets.map((name, index) => `# ${names[index] || `工作表 ${index + 1}`}\n${markdownTable(worksheetRows(zip.text(name), strings))}`);
  return { title: titleFromPath(path), content: parts.join('\n\n'), contentType: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', metadata: { sheetCount: sheets.length, sharedStringCount: strings.length } };
}

export async function parseEpub({ bytes, path }) {
  const zip = openZip(bytes), pages = zip.list().filter((name) => /\.(xhtml|html|htm)$/i.test(name) && !name.startsWith('META-INF/')).sort(naturalEntrySort);
  if (!pages.length) throw Object.assign(new Error('EPUB 没有可读取的正文页面'), { code: 'EPUB_CONTENT_MISSING' });
  const parts = pages.map((name, index) => `# 章节 ${index + 1}\n${tags(zip.text(name))}`).filter((part) => part.trim());
  return { title: titleFromPath(path), content: parts.join('\n\n'), contentType: 'epub', mimeType: 'application/epub+zip', metadata: { chapterCount: pages.length } };
}
function collectXmindJson(value, depth = 0, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (typeof value.title === 'string' && value.title.trim()) output.push(`${'  '.repeat(depth)}- ${value.title.trim()}`);
  if (Array.isArray(value)) for (const child of value) collectXmindJson(child, depth, output);
  else for (const [key, child] of Object.entries(value)) if (key !== 'title') collectXmindJson(child, key === 'children' || key === 'attached' ? depth + 1 : depth, output);
  return output;
}
export async function parseXmind({ bytes, path }) {
  const zip = openZip(bytes); let lines = [];
  if (zip.has('content.json')) lines = collectXmindJson(JSON.parse(zip.text('content.json')));
  else if (zip.has('content.xml')) lines = xmlTexts(zip.text('content.xml'), /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/g).map((title) => `- ${title}`);
  else throw Object.assign(new Error('XMind 缺少 content.json/content.xml'), { code: 'XMIND_CONTENT_MISSING' });
  return { title: titleFromPath(path), content: lines.join('\n'), contentType: 'xmind', mimeType: 'application/vnd.xmind.workbook', metadata: { topicCount: lines.length } };
}

export const OFFICE_LOCAL_PARSERS = Object.freeze({ '.docx': parseDocx, '.pptx': parsePptx, '.xlsx': parseXlsx, '.epub': parseEpub, '.xmind': parseXmind });
