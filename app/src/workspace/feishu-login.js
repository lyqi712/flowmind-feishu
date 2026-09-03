export function feishuLoginReturnTo(location = globalThis.location) {
  if (!location) return '';
  return `${location.origin}${location.pathname}${location.search || ''}`;
}

export async function startFeishuUserLogin({ fetcher = globalThis.fetch, location = globalThis.location } = {}) {
  const returnTo = feishuLoginReturnTo(location);
  const response = await fetcher(`/api/feishu/oauth/start?returnTo=${encodeURIComponent(returnTo)}`);
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { message: text }; }
  }
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `飞书登录入口不可用（${response.status}）`);
    error.code = data?.error?.code || 'FEISHU_OAUTH_START_FAILED';
    error.hint = data?.hint || data?.error?.hint || '';
    throw error;
  }
  if (!data.url) throw new Error('飞书登录地址缺失');
  if (location?.assign) location.assign(data.url);
  return data;
}

export function consumeFeishuLoginQuery(search = '') {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const status = params.get('feishuLogin');
  if (!status) return null;
  const message = params.get('message') || (status === 'ok' ? '飞书账号已登录，可以重新拉取被拒绝的图片' : '飞书登录未完成');
  params.delete('feishuLogin');
  params.delete('message');
  const nextSearch = params.toString();
  return {
    ok: status === 'ok',
    message,
    nextSearch: nextSearch ? `?${nextSearch}` : ''
  };
}
