import React, { useEffect, useRef, useState } from 'react';
import { Search, Clock, TrendingUp, X, FileText, Tag } from 'lucide-react';
import { generateSuggestions, normalizeSearchHistory } from '../workspace/smart-search.js';

export default function SmartSearch({
  open = false,
  searchHistory = [],
  trendingTopics = [],
  documents = [],
  onSearch,
  onOpenDocument,
  onDeleteHistory,
  onClearHistory,
  onClose
}) {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const inputRef = useRef(null);
  const recentSearches = normalizeSearchHistory(searchHistory);
  const suggestions = query.trim()
    ? generateSuggestions(query, { recentSearches, trendingTopics, documents })
    : [];

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveTab('all');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  const handleSearch = (searchQuery) => {
    const value = String(searchQuery || query || '').trim();
    if (!value) return;
    onSearch?.(value, activeTab);
  };

  const handleSuggestion = (suggestion) => {
    if (suggestion?.kind === 'document' && (suggestion.documentId || suggestion.id) && onOpenDocument) {
      onOpenDocument(suggestion);
      return;
    }
    handleSearch(suggestion?.text);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSearch(query);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
    }
  };

  return (
    <div className="smart-search-overlay" onClick={onClose}>
      <div className="smart-search-panel" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="智能搜索">
        <div className="smart-search-header">
          <div className="smart-search-input-wrapper">
            <Search size={18} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="搜索文档、对话、标签..."
              className="smart-search-input"
            />
            {query ? (
              <button type="button" className="smart-search-clear" onClick={() => setQuery('')}>
                <X size={16} />
              </button>
            ) : null}
          </div>
          <button type="button" className="smart-search-close" onClick={onClose} aria-label="关闭搜索">
            <X size={18} />
          </button>
        </div>

        <div className="smart-search-tabs">
          {[['all', '全部'], ['documents', '文档'], ['conversations', '对话'], ['tags', '标签']].map(([id, label]) => (
            <button key={id} type="button" className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>
              {id === 'documents' ? <FileText size={14} /> : null}
              {id === 'tags' ? <Tag size={14} /> : null}
              {label}
            </button>
          ))}
        </div>

        <div className="smart-search-body">
          {!query && recentSearches.length > 0 && (
            <div className="smart-search-section">
              <div className="smart-search-section-header">
                <Clock size={14} />
                <span>最近搜索</span>
                {onClearHistory ? (
                  <button type="button" className="smart-search-clear-history" onClick={onClearHistory}>清空</button>
                ) : null}
              </div>
              <div className="smart-search-items">
                {recentSearches.slice(0, 5).map(item => (
                  <div key={item.query} className="smart-search-item-row">
                    <button type="button" className="smart-search-item" onClick={() => handleSearch(item.query)}>
                      <Search size={14} />
                      <span>{item.query}</span>
                      {item.resultCount > 0 ? <small>{item.resultCount} 个结果</small> : null}
                    </button>
                    {onDeleteHistory ? (
                      <button type="button" className="smart-search-item-remove" aria-label={`删除 ${item.query}`} onClick={() => onDeleteHistory(item.query)}>
                        <X size={13} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!query && trendingTopics.length > 0 && (
            <div className="smart-search-section">
              <div className="smart-search-section-header">
                <TrendingUp size={14} />
                <span>热门话题</span>
              </div>
              <div className="smart-search-items">
                {trendingTopics.slice(0, 5).map(topic => (
                  <button
                    key={topic.name || topic}
                    type="button"
                    className="smart-search-item"
                    onClick={() => handleSearch(topic.name || topic)}
                  >
                    <Tag size={14} />
                    <span>{topic.name || topic}</span>
                    {topic.count ? <small>{topic.count} 篇文档</small> : null}
                  </button>
                ))}
              </div>
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="smart-search-section">
              <div className="smart-search-section-header">
                <Search size={14} />
                <span>搜索建议</span>
              </div>
              <div className="smart-search-items">
                {suggestions.map(suggestion => (
                  <button
                    key={`${suggestion.kind}-${suggestion.text}`}
                    type="button"
                    className="smart-search-item"
                    onClick={() => handleSuggestion(suggestion)}
                  >
                    {suggestion.kind === 'history' ? <Clock size={14} /> : suggestion.kind === 'trending' ? <TrendingUp size={14} /> : suggestion.kind === 'document' ? <FileText size={14} /> : <Search size={14} />}
                    <span>{suggestion.text}</span>
                    {suggestion.meta ? <small>{suggestion.meta}</small> : null}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!query && !recentSearches.length && !trendingTopics.length && (
            <div className="smart-search-empty">输入关键词，或按文档标题直接跳转</div>
          )}
        </div>

        <div className="smart-search-footer">
          <small>
            <kbd>↵</kbd> 搜索 · <kbd>ESC</kbd> 关闭 · 右下角按钮打开
          </small>
        </div>
      </div>
    </div>
  );
}
