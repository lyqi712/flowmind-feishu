export function hasBrokenEncoding(value) {
  const text = String(value || '');
  return text.includes('�');
}

function looksLikeMojibake(text) {
  if (hasBrokenEncoding(text)) return true;
  const compact = String(text || '').replace(/\s+/g, '');
  if (!compact || compact.length > 6) return false;
  for (const char of compact) {
    const code = char.codePointAt(0);
    if (code < 0x80 || code > 0xFF) return false;
  }
  return true;
}

export function sanitizeDisplayText(value, { fallback = '', limit = 72 } = {}) {
  const text = [...String(value || '')]
    .filter((char) => {
      const code = char.codePointAt(0);
      if (code <= 0x08 || (code >= 0x0B && code <= 0x0C) || (code >= 0x0E && code <= 0x1F)) return false;
      if (code >= 0x7F && code <= 0x9F) return false;
      return true;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || looksLikeMojibake(text)) return fallback;
  const chars = [...text];
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : text;
}

export function displayTitle(title, fallback = '未命名文档') {
  return sanitizeDisplayText(title, { fallback, limit: 80 }) || fallback;
}

export function searchResultType(result) {
  const type = result?.type || result?.kind || result?.itemType;
  if (type === 'note' || type === 'conversation') return type;
  return 'document';
}

export function searchResultTitle(title, fallback = '未命名内容') {
  const cleaned = displayTitle(title, fallback);
  const compact = cleaned.replace(/\s+/g, '');
  if (!compact) return fallback;
  const junk = [...compact].filter((char) => char === '?' || char === '�').length;
  if (junk / compact.length < 0.35) return cleaned;
  const readable = cleaned
    .replace(/[?�]+/g, ' ')
    .replace(/^[\s,，.。;；:：\-—]+|[\s,，.。;；:：\-—]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return displayTitle(readable, fallback);
}

export function humanizeSourceLabel(source) {
  const value = String(source || '').trim();
  if (!value || value === 'local' || value === 'local-content' || value === 'local-files') return '本地';
  if (value === 'feishu' || value === 'feishu-space' || value === 'feishu-mixed') return '飞书';
  if (value === 'local-note') return '笔记';
  if (value === 'local-conversation') return '对话';
  if (value === 'mock') return '演示';
  return value;
}
