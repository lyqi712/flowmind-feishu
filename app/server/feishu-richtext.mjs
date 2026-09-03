import { createHash } from 'node:crypto';

const BLOCK_KIND = {
  1: 'page', 2: 'text', 3: 'heading1', 4: 'heading2', 5: 'heading3', 6: 'heading4',
  7: 'heading5', 8: 'heading6', 9: 'heading7', 10: 'heading8', 11: 'heading9',
  12: 'bullet', 13: 'ordered', 14: 'code', 15: 'quote', 17: 'todo', 19: 'callout',
  22: 'divider', 23: 'file', 24: 'grid', 25: 'gridColumn', 26: 'iframe', 27: 'image',
  28: 'isv', 29: 'mindnote', 30: 'sheet', 31: 'table', 32: 'tableCell', 33: 'view',
  34: 'quoteContainer', 35: 'task', 36: 'okr', 37: 'okrObjective', 38: 'okrKeyResult',
  39: 'okrProgress', 40: 'addOns'
};

const TEXT_KEYS = ['text', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'heading7', 'heading8', 'heading9', 'bullet', 'ordered', 'code', 'quote', 'todo', 'callout', 'task'];

function clean(value) { return String(value ?? '').replace(/\r\n?/g, '\n'); }
function escapeMarkdown(value) { return clean(value).replace(/([\\`*_[\]<>])/g, '\\$1'); }
function escapeTable(value) { return clean(value).replace(/\|/g, '\\|').replace(/\n+/g, '<br>'); }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

function elementText(element = {}) {
  if (element.text_run) {
    const style = element.text_run.text_element_style || {};
    let value = clean(element.text_run.content);
    const link = style.link?.url || style.link?.href;
    if (style.inline_code) value = '`' + value.replace(/`/g, '\\`') + '`';
    else {
      value = escapeMarkdown(value);
      if (style.bold) value = `**${value}**`;
      if (style.italic) value = `*${value}*`;
      if (style.strikethrough) value = `~~${value}~~`;
      if (style.underline) value = `<u>${value}</u>`;
    }
    if (link) value = `[${value || link}](${link})`;
    return { markdown: value, plain: clean(element.text_run.content), links: link ? [link] : [] };
  }
  if (element.mention_doc) {
    const title = clean(element.mention_doc.title || element.mention_doc.text || '关联文档');
    const url = element.mention_doc.url || element.mention_doc.link;
    return { markdown: url ? `[${escapeMarkdown(title)}](${url})` : escapeMarkdown(title), plain: title, links: url ? [url] : [] };
  }
  if (element.mention_user) {
    const label = clean(element.mention_user.name || element.mention_user.user_name || element.mention_user.user_id || '成员');
    return { markdown: `@${escapeMarkdown(label)}`, plain: `@${label}`, links: [] };
  }
  if (element.reminder) {
    const label = clean(element.reminder.text || element.reminder.expire_time || '提醒');
    return { markdown: `⏰ ${escapeMarkdown(label)}`, plain: label, links: [] };
  }
  if (element.equation) {
    const formula = clean(element.equation.content || element.equation.text);
    return { markdown: `$${formula}$`, plain: formula, links: [] };
  }
  return { markdown: '', plain: '', links: [] };
}

export function renderTextElements(elements = []) {
  const rows = (Array.isArray(elements) ? elements : []).map(elementText);
  return {
    markdown: rows.map(row => row.markdown).join(''),
    plain: rows.map(row => row.plain).join(''),
    links: unique(rows.flatMap(row => row.links))
  };
}

function textPayload(block = {}) {
  for (const key of TEXT_KEYS) if (block[key]) return { key, value: block[key] };
  return { key: BLOCK_KIND[block.block_type] || 'unknown', value: null };
}

function blockAsset(block = {}) {
  if (block.image?.token) {
    const extra = block.image.extra || null;
    return {
      kind: 'image',
      token: block.image.token,
      fileName: block.image.name || `feishu-image-${block.image.token.slice(-8)}.png`,
      mimeType: block.image.mime_type || 'image/png',
      width: block.image.width,
      height: block.image.height,
      ...(extra ? { extra } : {})
    };
  }
  if (block.file?.token) {
    const extra = block.file.extra || null;
    return {
      kind: 'file',
      token: block.file.token,
      fileName: block.file.name || `feishu-file-${block.file.token.slice(-8)}`,
      mimeType: block.file.mime_type || 'application/octet-stream',
      ...(extra ? { extra } : {})
    };
  }
  return null;
}

export function extractFeishuAssetRefs(markdown = '') {
  const refs = [];
  const seen = new Set();
  const push = (kind, token, fileName, mimeType) => {
    const clean = String(token || '').trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    refs.push({ kind, token: clean, fileName: fileName || `${kind}-${clean.slice(-8)}`, mimeType });
  };
  String(markdown || '').replace(/!\[([^\]]*)\]\(feishu-asset:\/\/([^\s)\]}>"']+)\)/gi, (_, alt, token) => {
    push('image', token, alt || `image-${String(token).slice(-8)}`, 'image/png');
    return _;
  });
  String(markdown || '').replace(/\[([^\]]*)\]\(feishu-asset:\/\/([^\s)\]}>"']+)\)/gi, (_, label, token) => {
    const name = String(label || '').replace(/^📎\s*/, '').trim() || 'attachment';
    const html = /\.html?$/i.test(name);
    push('file', token, name, html ? 'text/html' : 'application/octet-stream');
    return _;
  });
  return refs;
}

function blockChildren(block, byId) {
  return (block.children || []).map(id => byId.get(id)).filter(Boolean);
}

function renderTable(block, byId, context) {
  const table = block.table || {};
  const rows = Math.max(0, Number(table.property?.row_size || table.row_size || 0));
  const columns = Math.max(0, Number(table.property?.column_size || table.column_size || 0));
  const cells = (table.cells || block.children || []).map(id => byId.get(id)).filter(Boolean);
  if (!rows || !columns || !cells.length) return '';
  const matrix = [];
  for (let row = 0; row < rows; row += 1) {
    const values = [];
    for (let column = 0; column < columns; column += 1) {
      const cell = cells[row * columns + column];
      const nested = cell ? blockChildren(cell, byId).map(child => renderBlock(child, byId, context, 0).markdown).join('\n').trim() : '';
      values.push(escapeTable(nested));
    }
    matrix.push(values);
  }
  if (!matrix.length) return '';
  const header = matrix[0];
  const divider = header.map(() => '---');
  return [header, divider, ...matrix.slice(1)].map(row => `| ${row.join(' | ')} |`).join('\n');
}

function renderBlock(block, byId, context, depth = 0) {
  const start = context.length;
  const kind = BLOCK_KIND[block.block_type] || textPayload(block).key || 'unknown';
  const payload = textPayload(block);
  const richText = renderTextElements(payload.value?.elements || []);
  context.links.push(...richText.links);
  const anchor = `block:${block.block_id || context.blocks.length + 1}`;
  const childBlocks = blockChildren(block, byId);
  let markdown = '';

  if (/^heading\d$/.test(kind)) markdown = `${'#'.repeat(Math.min(6, Number(kind.slice(7)) || 1))} ${richText.markdown}`;
  else if (kind === 'bullet') markdown = `${'  '.repeat(depth)}- ${richText.markdown}`;
  else if (kind === 'ordered') markdown = `${'  '.repeat(depth)}1. ${richText.markdown}`;
  else if (kind === 'todo' || kind === 'task') markdown = `${'  '.repeat(depth)}- [${payload.value?.style?.done ? 'x' : ' '}] ${richText.markdown}`;
  else if (kind === 'quote') markdown = richText.markdown.split('\n').map(line => `> ${line}`).join('\n');
  else if (kind === 'quoteContainer') markdown = childBlocks.map(child => renderBlock(child, byId, context, depth + 1).markdown).join('\n').split('\n').map(line => `> ${line}`).join('\n');
  else if (kind === 'code') markdown = `\`\`\`${payload.value?.style?.language || ''}\n${richText.plain}\n\`\`\``;
  else if (kind === 'callout') markdown = `> [!NOTE]\n> ${richText.markdown.replace(/\n/g, '\n> ')}`;
  else if (kind === 'divider') markdown = '---';
  else if (kind === 'table') markdown = renderTable(block, byId, context);
  else if (kind === 'image' || kind === 'file') {
    const asset = blockAsset(block);
    if (asset) {
      context.assets.push({ ...asset, blockId: block.block_id, anchor });
      const href = `feishu-asset://${asset.token}`;
      markdown = asset.kind === 'image' ? `![${escapeMarkdown(asset.fileName)}](${href})` : `[📎 ${escapeMarkdown(asset.fileName)}](${href})`;
    }
  } else if (kind === 'iframe') {
    const url = block.iframe?.component?.url || block.iframe?.url;
    if (url) { context.links.push(url); markdown = `[嵌入内容](${url})`; }
  } else if (kind === 'sheet' || kind === 'bitable' || kind === 'mindnote' || kind === 'view') {
    const value = block[kind] || {};
    const token = value.token || value.sheet_token || value.obj_token || value.view_token;
    markdown = `> [!INFO] 飞书${kind === 'sheet' ? '电子表格' : kind === 'bitable' ? '多维表格' : kind === 'mindnote' ? '思维笔记' : '嵌入视图'}${token ? ` · ${token}` : ''}`;
  } else if (kind !== 'page' && kind !== 'tableCell' && kind !== 'grid' && kind !== 'gridColumn') markdown = richText.markdown;

  if (!['table', 'quoteContainer'].includes(kind) && childBlocks.length) {
    const nested = childBlocks.map(child => renderBlock(child, byId, context, ['bullet', 'ordered', 'todo', 'task'].includes(kind) ? depth + 1 : depth).markdown).filter(Boolean).join('\n');
    markdown = [markdown, nested].filter(Boolean).join('\n');
  }

  markdown = markdown.trimEnd();
  if (markdown) {
    context.length += markdown.length + 2;
    const heading = /^heading\d$/.test(kind) ? richText.plain.trim() : '';
    if (heading) context.outline.push({ level: Math.min(6, Number(kind.slice(7)) || 1), title: heading, anchor, blockId: block.block_id });
    context.anchors.push({ anchor, blockId: block.block_id, kind, startChar: start, endChar: start + markdown.length });
  }
  context.blocks.push({ id: block.block_id, parentId: block.parent_id || null, kind, anchor, text: richText.plain, children: block.children || [], asset: blockAsset(block) });
  return { markdown, anchor, kind };
}

export function renderFeishuDocumentBlocks(blocks = [], { title = '' } = {}) {
  const list = Array.isArray(blocks) ? blocks : [];
  const byId = new Map(list.map(block => [block.block_id, block]));
  const roots = list.filter(block => !block.parent_id || !byId.has(block.parent_id));
  const context = { assets: [], links: [], outline: [], anchors: [], blocks: [], length: 0 };
  const body = roots.map(block => renderBlock(block, byId, context, 0).markdown).filter(Boolean).join('\n\n').trim();
  const content = body || clean(title);
  return {
    content,
    links: unique(context.links),
    assets: [...new Map(context.assets.map(asset => [asset.token, asset])).values()],
    metadata: {
      documentFormat: 'feishu-docx-blocks-v1',
      richText: true,
      blockCount: list.length,
      outline: context.outline,
      blockAnchors: context.anchors,
      structuredBlocks: context.blocks,
      contentHash: digest(content)
    }
  };
}
