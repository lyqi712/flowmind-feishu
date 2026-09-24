export function attachLocalApiAuthorization({ url, origin, resourceType = 'other', webContentsId, mainWebContentsId, requestHeaders = {}, token = '' }) {
  if (!token || !origin || resourceType !== 'xhr' || webContentsId !== mainWebContentsId) return requestHeaders;
  try {
    const target = new URL(url);
    if (target.origin !== origin || !target.pathname.startsWith('/api/')) return requestHeaders;
  } catch {
    return requestHeaders;
  }
  return { ...requestHeaders, Authorization: `Bearer ${token}` };
}
