export function extractNoteAttachmentText(fileName = '', mimeType = '', bytes) {
  const name = String(fileName || '');
  const mime = String(mimeType || '').toLowerCase();
  const buffer = Buffer.isBuffer(bytes) ? bytes : bytes instanceof Uint8Array ? Buffer.from(bytes) : Buffer.alloc(0);
  if (!buffer.length) return '';
  const textual = mime.startsWith('text/')
    || mime.includes('json')
    || mime.includes('markdown')
    || mime.includes('csv')
    || /\.(txt|md|markdown|csv|json|html|htm|xml|log)$/i.test(name);
  if (!textual) return '';
  return buffer.toString('utf8').replace(/\u0000/g, '').slice(0, 80000);
}

export function noteAttachmentBodies(note = {}) {
  return (Array.isArray(note.attachments) ? note.attachments : [])
    .map(item => {
      const text = String(item?.extractedText || item?.metadata?.extractedText || '').trim();
      if (!text) return '';
      return `## 附件：${item.fileName || '未命名文件'}\n${text}`;
    })
    .filter(Boolean);
}

export function noteSearchableContent(note = {}) {
  const body = String(note.content || '').trim();
  const extras = noteAttachmentBodies(note);
  return [body, ...extras].filter(Boolean).join('\n\n');
}

export function webClipMarkdown({ title = '', url = '', excerpt = '' } = {}) {
  const heading = String(title || url || '网页').trim();
  const href = String(url || '').trim();
  const quote = String(excerpt || '').trim();
  const lines = [`## 网页 · ${heading}`];
  if (href) lines.push('', href);
  if (quote) lines.push('', quote.split(/\r?\n/).map(line => `> ${line}`).join('\n'));
  return `${lines.join('\n')}\n`;
}
