import React from 'react';
import { Clock3, FileText, MessageSquareText, Sparkles, ChevronRight } from 'lucide-react';

/**
 * 智能首屏组件
 */
export function SmartHome({ data, onAction, compact = false }) {
  if (!data) return null;

  const { todayItems = [], recommendations = [] } = data;
  const visibleToday = compact ? todayItems.slice(0, 3) : todayItems;
  const visibleRecs = compact ? recommendations.slice(0, 2) : recommendations;

  const handleItemClick = (item) => {
    if (item.type === 'recent-document') {
      onAction('open-document', item.documentId);
    } else if (item.type === 'continue-skill') {
      onAction('continue-skill', item.skillRunId);
    } else if (item.type === 'recent-conversation') {
      onAction('continue-conversation', item.conversationId);
    } else if (item.type === 'recent-export') {
      if (item.action === 'open-document' && item.documentId) onAction('open-document', item.documentId);
      else onAction('open-export', item.url);
    }
  };

  const handleRecommendationClick = (rec) => {
    const action = rec.action || 'run-skill';
    if (action === 'run-skill') {
      onAction('run-skill', {
        skillId: rec.skillId,
        documentIds: rec.documentIds || [],
        title: rec.title
      });
      return;
    }
    onAction(action, rec);
  };

  const itemIcon = (type) => {
    if (type === 'recent-document') return FileText;
    if (type === 'continue-skill') return Sparkles;
    if (type === 'recent-conversation') return MessageSquareText;
    if (type === 'recent-export') return FileText;
    return Clock3;
  };

  const priorityLabel = (priority) => {
    if (priority === 'high') return '推荐';
    if (priority === 'medium') return '建议';
    return '';
  };

  return (
    <div className={compact ? 'smart-home is-home' : 'smart-home'}>
      {visibleToday.length > 0 && (
        <section className="smart-home-section">
          <h2><Clock3 size={18} />今日待办</h2>
          <div className="smart-home-items">
            {visibleToday.map((item, idx) => {
              const Icon = itemIcon(item.type);
              return (
                <button
                  key={idx}
                  className="smart-home-item"
                  onClick={() => handleItemClick(item)}
                >
                  <Icon size={16} />
                  <div className="smart-home-item-content">
                    <div className="smart-home-item-title">{item.title}</div>
                    <div className="smart-home-item-meta">{item.timeAgo}</div>
                  </div>
                  <ChevronRight size={16} className="smart-home-item-arrow" />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {visibleRecs.length > 0 && (
        <section className="smart-home-section">
          <h2><Sparkles size={18} />推荐操作</h2>
          <div className="smart-home-recommendations">
            {visibleRecs.map((rec, idx) => (
              <button
                key={idx}
                className={`smart-home-recommendation priority-${rec.priority}`}
                onClick={() => handleRecommendationClick(rec)}
              >
                <div className="smart-home-recommendation-header">
                  <span className="smart-home-recommendation-title">{rec.title}</span>
                  {rec.priority === 'high' && (
                    <span className="smart-home-recommendation-badge">推荐</span>
                  )}
                </div>
                <div className="smart-home-recommendation-reason">{rec.reason}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {visibleToday.length === 0 && visibleRecs.length === 0 && (
        <div className="smart-home-empty">
          <Sparkles size={32} />
          <p>暂无待办事项和推荐</p>
          <p className="smart-home-empty-hint">开始同步飞书文档或创建内容</p>
        </div>
      )}
    </div>
  );
}
