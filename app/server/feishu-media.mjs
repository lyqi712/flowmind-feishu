import { extractFeishuAssetRefs } from './feishu-richtext.mjs';

function unique(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

export function attachmentLookupKeys(attachment = {}) {
  const metadata = attachment.metadata && typeof attachment.metadata === 'object' ? attachment.metadata : {};
  return unique([
    attachment.externalId,
    metadata.feishuToken,
    metadata.token,
    metadata.fileToken,
    metadata.file_token,
    String(attachment.externalId || '').split(':').pop()
  ]);
}

export function mediaExtraCandidates(asset = {}, { documentToken, nodeToken } = {}) {
  const extras = [];
  if (asset?.extra) extras.push(typeof asset.extra === 'string' ? asset.extra : JSON.stringify(asset.extra));
  for (const token of [documentToken, nodeToken]) {
    const value = String(token || '').trim();
    if (value) extras.push(JSON.stringify({ drive_route_token: value }));
  }
  const rows = unique(extras);
  return rows.length ? rows : [''];
}

export function selectAssetsForResync({ content = '', attachments = [], hasBlob = () => false } = {}) {
  const refs = extractFeishuAssetRefs(content);
  return refs.filter((ref) => {
    const match = (Array.isArray(attachments) ? attachments : []).find((attachment) => {
      const keys = attachmentLookupKeys(attachment);
      return keys.includes(ref.token) || keys.includes(`feishu:${ref.kind}:${ref.token}`);
    });
    if (!match) return true;
    try { return !hasBlob(match); } catch { return true; }
  });
}

export function resyncMediaMessage({ imported = 0, warnings = [], remaining = 0, userLoggedIn = false } = {}) {
  const list = Array.isArray(warnings) ? warnings : [];
  const forbidden = list.filter((row) => row?.code === 'FEISHU_MEDIA_FORBIDDEN').length;
  const timeout = list.filter((row) => row?.code === 'FEISHU_MEDIA_TIMEOUT').length;
  if (imported && !list.length) return `已补拉 ${imported} 个附件`;
  if (imported && list.length) return `已补拉 ${imported} 个，仍有 ${list.length} 个拉不下来`;
  if (forbidden && forbidden === list.length) {
    return userLoggedIn
      ? '你的飞书账号也没有下载这些素材的权限，请在飞书打开原文，或让管理员允许下载'
      : '飞书拒绝下载这些素材（应用没有素材权限）';
  }
  if (timeout && !imported) return '附件下载超时，可以再试一次';
  if (list.length) return list[0]?.message || '部分附件仍然拉不下来';
  if (remaining) return '没有需要补拉的附件';
  return '没有需要补拉的附件';
}
