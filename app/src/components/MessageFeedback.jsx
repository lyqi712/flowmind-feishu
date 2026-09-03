import React, { useState } from 'react';
import { ThumbsUp, ThumbsDown, AlertCircle, CheckCircle2 } from 'lucide-react';
import { buildAnswerFeedbackPayload } from '../workspace/answer-feedback.js';
import './MessageFeedback.css';

/**
 * 用户反馈组件 - 对AI回答进行评价和反馈
 */
export function MessageFeedback({ conversationId, messageId, onFeedback }) {
  const [rating, setRating] = useState(null); // 'positive' | 'negative'
  const [showDetail, setShowDetail] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleRating = (newRating) => {
    setRating(newRating);
    if (newRating === 'negative') {
      setShowDetail(true);
    } else {
      // 正面反馈直接提交
      submitFeedback(newRating, null, '');
    }
  };

  const submitFeedback = async (ratingValue, issue, commentValue) => {
    setSubmitting(true);

    try {
      const payload = buildAnswerFeedbackPayload({
        conversationId,
        messageId,
        rating: ratingValue || rating,
        issueType: issue || selectedIssue || null,
        comment: commentValue || comment
      });
      if (!payload.valid) {
        onFeedback?.({ success: false, error: new Error('缺少会话或回答标识，无法提交反馈') });
        return;
      }
      const { valid, ...body } = payload;
      const response = await fetch('/api/feedback/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (response.ok) {
        setSubmitted(true);
        onFeedback?.({ success: true, rating: ratingValue || rating });

        // 3秒后隐藏
        setTimeout(() => {
          setShowDetail(false);
          setSubmitted(false);
        }, 3000);
      }
    } catch (error) {
      console.error('提交反馈失败:', error);
      onFeedback?.({ success: false, error });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitDetail = () => {
    if (!selectedIssue) {
      alert('请选择问题类型');
      return;
    }
    submitFeedback(rating, selectedIssue, comment);
  };

  if (submitted) {
    return (
      <div className="message-feedback submitted">
        <CheckCircle2 size={16} />
        <span>感谢反馈！</span>
      </div>
    );
  }

  return (
    <div className="message-feedback">
      {!rating && (
        <div className="feedback-buttons">
          <button
            className="feedback-btn positive"
            onClick={() => handleRating('positive')}
            title="这个回答有帮助"
          >
            <ThumbsUp size={14} />
            有帮助
          </button>
          <button
            className="feedback-btn negative"
            onClick={() => handleRating('negative')}
            title="这个回答不准确"
          >
            <ThumbsDown size={14} />
            不准确
          </button>
        </div>
      )}

      {showDetail && (
        <div className="feedback-detail">
          <div className="detail-header">
            <AlertCircle size={16} />
            <span>请告诉我们哪里不准确：</span>
          </div>

          <div className="issue-options">
            <label className={selectedIssue === 'incorrect-citation' ? 'selected' : ''}>
              <input
                type="radio"
                name="issue"
                value="incorrect-citation"
                checked={selectedIssue === 'incorrect-citation'}
                onChange={(e) => setSelectedIssue(e.target.value)}
              />
              <span>引用编号不对</span>
              <small>引用 [1] [2] 对应的文档不正确</small>
            </label>

            <label className={selectedIssue === 'wrong-answer' ? 'selected' : ''}>
              <input
                type="radio"
                name="issue"
                value="wrong-answer"
                checked={selectedIssue === 'wrong-answer'}
                onChange={(e) => setSelectedIssue(e.target.value)}
              />
              <span>答案内容错误</span>
              <small>回答的结论或事实不符合知识库内容</small>
            </label>

            <label className={selectedIssue === 'incomplete' ? 'selected' : ''}>
              <input
                type="radio"
                name="issue"
                value="incomplete"
                checked={selectedIssue === 'incomplete'}
                onChange={(e) => setSelectedIssue(e.target.value)}
              />
              <span>回答不完整</span>
              <small>遗漏了重要信息或没有完全回答问题</small>
            </label>

            <label className={selectedIssue === 'fabricated' ? 'selected' : ''}>
              <input
                type="radio"
                name="issue"
                value="fabricated"
                checked={selectedIssue === 'fabricated'}
                onChange={(e) => setSelectedIssue(e.target.value)}
              />
              <span>编造事实</span>
              <small>回答包含知识库中不存在的内容</small>
            </label>

            <label className={selectedIssue === 'other' ? 'selected' : ''}>
              <input
                type="radio"
                name="issue"
                value="other"
                checked={selectedIssue === 'other'}
                onChange={(e) => setSelectedIssue(e.target.value)}
              />
              <span>其他问题</span>
            </label>
          </div>

          <textarea
            className="feedback-comment"
            placeholder="补充说明（可选）..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />

          <div className="detail-actions">
            <button
              className="btn-cancel"
              onClick={() => {
                setShowDetail(false);
                setRating(null);
                setSelectedIssue('');
                setComment('');
              }}
            >
              取消
            </button>
            <button
              className="btn-submit"
              onClick={handleSubmitDetail}
              disabled={!selectedIssue || submitting}
            >
              {submitting ? '提交中...' : '提交反馈'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 反馈统计仪表板
 */
export function FeedbackDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/feedback/stats');
      const data = await response.json();
      if (data.ok) {
        setStats(data.stats);
      }
    } catch (error) {
      console.error('获取反馈统计失败:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="feedback-dashboard loading">加载中...</div>;
  }

  if (!stats) {
    return null;
  }

  const satisfactionRate = stats.total > 0
    ? Math.round((stats.positive / stats.total) * 100)
    : 0;

  return (
    <div className="feedback-dashboard">
      <h3>用户反馈统计</h3>

      <div className="dashboard-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">总反馈数</div>
        </div>

        <div className="stat-card positive">
          <div className="stat-value">{stats.positive}</div>
          <div className="stat-label">
            <ThumbsUp size={14} />
            正面反馈
          </div>
        </div>

        <div className="stat-card negative">
          <div className="stat-value">{stats.negative}</div>
          <div className="stat-label">
            <ThumbsDown size={14} />
            负面反馈
          </div>
        </div>

        <div className={`stat-card satisfaction ${satisfactionRate >= 80 ? 'good' : satisfactionRate >= 60 ? 'medium' : 'low'}`}>
          <div className="stat-value">{satisfactionRate}%</div>
          <div className="stat-label">满意度</div>
        </div>
      </div>

      <div className="issues-breakdown">
        <h4>问题类型分布</h4>
        <div className="issue-list">
          <div className="issue-item">
            <span>引用编号不对</span>
            <span className="issue-count">{stats.issues?.incorrectCitation || 0}</span>
          </div>
          <div className="issue-item">
            <span>答案内容错误</span>
            <span className="issue-count">{stats.issues?.wrongAnswer || 0}</span>
          </div>
          <div className="issue-item">
            <span>回答不完整</span>
            <span className="issue-count">{stats.issues?.incomplete || 0}</span>
          </div>
          <div className="issue-item">
            <span>编造事实</span>
            <span className="issue-count">{stats.issues?.fabricated || 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
