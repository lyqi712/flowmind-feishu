const HTTP_URL = /^https?:\/\/[^\s<>"']+$/i;

export function isHttpUrl(value = '') {
  return HTTP_URL.test(String(value || '').trim());
}

export function isImageFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i.test(String(file.name || ''));
}

export function filesFromList(list) {
  return [...(list || [])].filter(item => item && typeof item === 'object' && Number(item.size) >= 0);
}

function urlsFromText(value = '') {
  const text = String(value || '').replace(/\r/g, '').trim();
  if (!text) return [];
  if (isHttpUrl(text)) return [text];
  return text.split(/\s+/).map(part => part.trim()).filter(isHttpUrl);
}

function filesFromClipboardItems(clipboardData) {
  const files = filesFromList(clipboardData?.files);
  if (files.length) return files;
  const items = [...(clipboardData?.items || [])];
  const fromItems = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile?.();
    if (file) fromItems.push(file);
  }
  return fromItems;
}

export function collectNoteDropPayload(dataTransfer) {
  const files = filesFromList(dataTransfer?.files);
  const urls = [
    ...urlsFromText(dataTransfer?.getData?.('text/uri-list') || ''),
    ...urlsFromText(dataTransfer?.getData?.('text/plain') || '')
  ];
  return {
    files,
    urls: [...new Set(urls)],
    hasPayload: files.length > 0 || urls.length > 0
  };
}

export function collectNotePastePayload(clipboardData) {
  const files = filesFromClipboardItems(clipboardData);
  const text = String(clipboardData?.getData?.('text/plain') || clipboardData?.getData?.('text') || '').trim();
  const urls = files.length ? [] : urlsFromText(text);
  const bareUrl = !files.length && isHttpUrl(text);
  return {
    files,
    urls,
    text,
    intercept: files.length > 0 || bareUrl
  };
}

export function dropLooksLikeFiles(dataTransfer) {
  const types = [...(dataTransfer?.types || [])].map(String);
  return types.includes('Files') || types.includes('text/uri-list');
}

export function noteAttachmentKind(file) {
  return isImageFile(file) ? 'image' : 'file';
}

export function summarizeNoteIngest({ files = [], urls = [] } = {}) {
  const fileCount = files.length;
  const urlCount = urls.length;
  if (fileCount && urlCount) return `已放入 ${fileCount} 个文件和 ${urlCount} 个网页`;
  if (fileCount === 1) return isImageFile(files[0]) ? '图片已放入这篇笔记' : '文件已放入这篇笔记';
  if (fileCount > 1) return `已放入 ${fileCount} 个文件`;
  if (urlCount === 1) return '网页已放入这篇笔记';
  if (urlCount > 1) return `已放入 ${urlCount} 个网页`;
  return '';
}
