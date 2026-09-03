export function normalizeSearchHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .map(item => ({
      query: String(item?.query || '').trim(),
      resultCount: Number(item?.resultCount || 0),
      count: Number(item?.count || 1),
      lastSearchedAt: item?.lastSearchedAt || item?.timestamp || null
    }))
    .filter(item => item.query);
}

export function generateSuggestions(query, { recentSearches = [], trendingTopics = [], documents = [] } = {}) {
  const text = String(query || '').trim();
  if (!text) return [];
  const lowerQuery = text.toLowerCase();
  const suggestions = [];

  for (const search of normalizeSearchHistory(recentSearches)) {
    if (search.query.toLowerCase().includes(lowerQuery)) {
      suggestions.push({
        text: search.query,
        kind: 'history',
        meta: search.resultCount > 0 ? `${search.resultCount} 个结果` : '最近搜索',
        score: 10
      });
    }
  }

  for (const topic of trendingTopics) {
    const name = String(topic?.name || topic || '').trim();
    if (name && name.toLowerCase().includes(lowerQuery)) {
      suggestions.push({
        text: name,
        kind: 'trending',
        meta: topic?.count ? `${topic.count} 篇文档` : '热门话题',
        score: 8
      });
    }
  }

  for (const doc of documents) {
    const title = String(doc?.title || '').trim();
    const documentId = String(doc?.documentId || doc?.id || '').trim();
    if (title && title.toLowerCase().includes(lowerQuery)) {
      suggestions.push({
        text: title,
        kind: 'document',
        meta: '文档',
        score: 6,
        ...(documentId ? { documentId } : {})
      });
    }
  }

  for (const completion of generateCompletions(text, documents)) {
    suggestions.push({
      text: completion,
      kind: 'completion',
      meta: '补全建议',
      score: 4
    });
  }

  const unique = Array.from(new Map(suggestions.map(item => [item.text, item])).values());
  return unique.sort((a, b) => b.score - a.score).slice(0, 8);
}

export function generateCompletions(query, documents = []) {
  const completions = new Set();
  const lowerQuery = String(query || '').trim().toLowerCase();
  if (lowerQuery.length < 2) return [];

  for (const doc of documents) {
    const words = String(doc?.title || '').toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.startsWith(lowerQuery) && word !== lowerQuery) completions.add(word);
    }
  }
  return Array.from(completions).slice(0, 3);
}
