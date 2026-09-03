/**
 * 智能首屏：今日待办 + 推荐操作
 */

import { sanitizeDisplayText } from '../src/workspace/display-text.js';

function asDocuments(state = {}) {
  return Array.isArray(state.contentItems) && state.contentItems.length
    ? state.contentItems
    : Array.isArray(state.documents) ? state.documents : [];
}

export function itemTimestamp(item = {}) {
  const raw = item.lastModified ?? item.updatedAt ?? item.sourceModifiedAt ?? item.createdAt;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildSmartHome(state = {}) {
  const documents = asDocuments(state);
  const todayItems = buildTodayItems({ ...state, documents });
  const recommendations = buildRecommendations({ ...state, documents });
  return {
    todayItems: todayItems.slice(0, 8),
    recommendations: recommendations.slice(0, 5)
  };
}

function buildTodayItems(state) {
  const items = [];
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const docs = state.documents || [];

  const recentDocs = docs
    .filter(doc => itemTimestamp(doc) && (now - itemTimestamp(doc)) < oneDayMs)
    .sort((a, b) => itemTimestamp(b) - itemTimestamp(a))
    .slice(0, 3);

  for (const doc of recentDocs) {
    items.push({
      type: 'recent-document',
      documentId: doc.id,
      title: sanitizeDisplayText(doc.title, { fallback: '未命名文档', limit: 42 }),
      timeAgo: formatTimeAgo(now - itemTimestamp(doc)),
      action: 'open-document'
    });
  }

  const recentRuns = (state.skillRuns || [])
    .filter(run => {
      const time = itemTimestamp(run);
      return time && (now - time) < oneDayMs * 2 && ['completed', 'failed', 'running', 'paused'].includes(String(run.status || ''));
    })
    .sort((a, b) => itemTimestamp(b) - itemTimestamp(a))
    .slice(0, 2);

  for (const run of recentRuns) {
    items.push({
      type: 'continue-skill',
      skillRunId: run.id,
      skillId: run.skillId,
      title: sanitizeDisplayText(run.artifact?.title || run.input, { fallback: '继续上次 Skill', limit: 42 }),
      timeAgo: formatTimeAgo(now - itemTimestamp(run)),
      action: 'continue-editing'
    });
  }

  const recentConvs = (state.conversations || [])
    .filter(conv => itemTimestamp(conv) && (now - itemTimestamp(conv)) < oneDayMs)
    .sort((a, b) => itemTimestamp(b) - itemTimestamp(a))
    .slice(0, 2);

  for (const conv of recentConvs) {
    items.push({
      type: 'recent-conversation',
      conversationId: conv.id,
      title: sanitizeDisplayText(conv.question || conv.title, { fallback: '继续上次对话', limit: 42 }),
      timeAgo: formatTimeAgo(now - itemTimestamp(conv)),
      action: 'continue-conversation'
    });
  }

  const recentExports = (state.feishuExports || [])
    .filter((item) => item?.url && itemTimestamp(item) && (now - itemTimestamp(item)) < oneDayMs * 7)
    .sort((a, b) => itemTimestamp(b) - itemTimestamp(a))
    .slice(0, 3);

  for (const item of recentExports) {
    const documentId = String(item.contentItemId || '').trim();
    items.push({
      type: 'recent-export',
      title: sanitizeDisplayText(item.folderName ? `${item.title} · ${item.folderName}` : `飞书导出 · ${item.title}`, { fallback: '飞书导出', limit: 42 }),
      url: item.url,
      documentId,
      timeAgo: formatTimeAgo(now - itemTimestamp(item)),
      action: documentId ? 'open-document' : 'open-export'
    });
  }

  return items.sort((a, b) => parseTimeAgo(a.timeAgo) - parseTimeAgo(b.timeAgo));
}

function titleMatches(doc, keywords) {
  const title = String(doc?.title || '');
  return keywords.some(keyword => title.includes(keyword));
}

function buildRecommendations(state) {
  const docs = state.documents || [];
  if (!docs.length) {
    return [
      {
        action: 'open-sync',
        title: '同步飞书文档',
        reason: '把飞书知识库接进来后，才能基于原文做决策',
        priority: 'high'
      },
      {
        action: 'open-collect',
        title: '先收一份材料',
        reason: '链接、文件或随手记都可以立刻开始',
        priority: 'medium'
      }
    ];
  }

  const recommendations = [];
  if (docs.some(doc => titleMatches(doc, ['Q1', '复盘', '回顾']))) {
    recommendations.push({
      action: 'run-skill',
      skillId: 'q2-planning',
      title: '生成 Q2 规划',
      reason: '基于 Q1 复盘和用户反馈',
      documentIds: docs.filter(doc => titleMatches(doc, ['Q1', '用户', '反馈', '复盘'])).map(doc => doc.id),
      priority: 'high'
    });
  }
  if (docs.some(doc => titleMatches(doc, ['技术', '架构', '选型']))) {
    recommendations.push({
      action: 'run-skill',
      skillId: 'tech-selection',
      title: '技术选型分析',
      reason: '整合技术方案和需求',
      documentIds: docs.filter(doc => titleMatches(doc, ['技术', '需求', '架构', '选型'])).map(doc => doc.id),
      priority: 'medium'
    });
  }
  if (docs.some(doc => titleMatches(doc, ['客户', '提案', '商务']))) {
    recommendations.push({
      action: 'run-skill',
      skillId: 'customer-proposal',
      title: '生成客户提案',
      reason: '基于客户需求和产品能力',
      documentIds: docs.filter(doc => titleMatches(doc, ['客户', '产品', '需求', '提案'])).map(doc => doc.id),
      priority: 'medium'
    });
  }
  if (docs.length >= 3) {
    recommendations.push({
      action: 'run-skill',
      skillId: 'summary',
      title: '生成知识总结',
      reason: `整合 ${Math.min(docs.length, 24)} 份资料的结论和下一步`,
      documentIds: docs.slice(0, 24).map(doc => doc.id),
      priority: recommendations.length ? 'low' : 'high'
    });
  }
  if (docs.length >= 2) {
    recommendations.push({
      action: 'run-skill',
      skillId: 'compare',
      title: '对比分析',
      reason: '比较不同方案或观点',
      documentIds: docs.slice(0, 12).map(doc => doc.id),
      priority: 'low'
    });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

function formatTimeAgo(ms) {
  const minutes = Math.floor(ms / 1000 / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} 天前`;
  if (hours > 0) return `${hours} 小时前`;
  if (minutes > 0) return `${minutes} 分钟前`;
  return '刚刚';
}

function parseTimeAgo(timeAgo) {
  if (timeAgo === '刚刚') return 0;
  const match = String(timeAgo || '').match(/(\d+)\s*(天|小时|分钟)/);
  if (!match) return 0;
  const value = Number(match[1]);
  if (match[2] === '天') return value * 24 * 60 * 60 * 1000;
  if (match[2] === '小时') return value * 60 * 60 * 1000;
  return value * 60 * 1000;
}
