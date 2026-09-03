function text(value) {
  return String(value || '').trim().toLowerCase();
}

function sourceHint(doc = {}) {
  return text(doc.source || doc.sourceType || doc.metadata?.sourceType);
}

function objectHint(doc = {}) {
  return text(doc.metadata?.objType || doc.metadata?.obj_type || doc.metadata?.fileType || doc.metadata?.type);
}

export function isLibraryNote(doc = {}) {
  return text(doc.contentType || doc.type) === 'note' || text(doc.source) === 'local-note';
}

export function isNotesLibrary(item = {}) {
  const id = text(item.id);
  const name = text(item.name);
  const type = text(item.type || item.kind || item.sourceType);
  return id === 'notes' || name === 'notes' || type === 'notes' || type === 'note';
}

export function libraryFileKind(doc = {}) {
  const mime = text(doc.mimeType);
  const contentType = text(doc.contentType || doc.type);
  const title = text(doc.title || doc.fileName || doc.name);
  const source = sourceHint(doc);
  const obj = objectHint(doc);
  const feishuSource = ['feishu', 'docx', 'wiki', 'doc', 'sheet', 'bitable', 'mindnote', 'slides'].includes(source) || source.includes('feishu');

  if (contentType === 'note' || doc.type === 'note') return 'markdown';
  if (mime.includes('pdf') || contentType === 'pdf' || obj === 'pdf' || title.endsWith('.pdf')) return 'pdf';
  if (mime.includes('html') || contentType === 'html' || obj === 'html' || /\.html?$/.test(title)) return 'html';
  if (mime.includes('epub') || title.endsWith('.epub')) return 'epub';
  const looksLikeWordFile = mime.includes('wordprocessingml') || mime.includes('msword') || title.endsWith('.docx') || title.endsWith('.doc');
  if (looksLikeWordFile && !feishuSource) return 'word';
  if (contentType === 'docx' && feishuSource) return 'doc';
  if (title.endsWith('.md') || title.endsWith('.mdx')) return 'markdown';
  if (feishuSource) return 'doc';
  return 'doc';
}

export function libraryFileLabel(kind) {
  if (kind === 'pdf') return 'PDF';
  if (kind === 'word') return 'Word';
  if (kind === 'html') return 'HTML';
  if (kind === 'epub') return 'EPUB';
  if (kind === 'markdown') return 'MD';
  return 'DOC';
}
