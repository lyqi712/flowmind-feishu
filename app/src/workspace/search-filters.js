export function buildWorkspaceSearchUrl(query, { category = 'all', limit = 40 } = {}) {
  const value = String(query || '').trim();
  const params = new URLSearchParams({ q: category === 'tags' ? '' : value, limit: String(limit) });
  const type = { documents: 'document', notes: 'note', conversations: 'conversation' }[category];
  if (type) params.set('type', type);
  if (category === 'tags' && value) params.set('tag', value);
  return `/api/search?${params}`;
}
