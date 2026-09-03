/**
 * 对话记忆管理 - 滑动窗口、上下文理解
 * Conversation Memory: Sliding window and context tracking
 */

/**
 * 对话记忆配置
 */
const DEFAULT_CONFIG = {
  windowSize: 10,           // 保留最近10轮对话
  summaryThreshold: 20,     // 超过20轮时生成摘要
  contextDecayFactor: 0.9,  // 上下文重要性衰减因子
  maxTokens: 4000          // 最大token数（粗略估计）
};

/**
 * 估算文本token数（简化版，中文约1.5字/token）
 */
function estimateTokens(text) {
  const content = String(text || '').trim();
  const chineseChars = (content.match(/[\u4e00-\u9fa5]/gu) || []).length;
  const englishWords = (content.match(/[a-zA-Z]+/gu) || []).length;
  return Math.ceil(chineseChars / 1.5 + englishWords);
}

/**
 * 计算消息重要性
 */
function calculateImportance(message, position, totalMessages) {
  let score = 1.0;
  
  // 位置因子：越新的消息越重要
  const recencyFactor = 1.0 - (position / totalMessages) * 0.5;
  score *= recencyFactor;
  
  // 长度因子：太短的消息可能不太重要
  const length = String(message.content || '').length;
  if (length < 10) {
    score *= 0.7;
  } else if (length > 100) {
    score *= 1.2;
  }
  
  // 内容因子：包含关键词的消息更重要
  const content = String(message.content || '').toLowerCase();
  const importantKeywords = ['重要', '关键', '必须', '核心', '问题', '建议', '方案'];
  for (const keyword of importantKeywords) {
    if (content.includes(keyword)) {
      score *= 1.3;
      break;
    }
  }
  
  // 角色因子：用户的问题通常更重要
  if (message.role === 'user') {
    score *= 1.1;
  }
  
  return Math.min(2.0, score); // 最高2倍权重
}

/**
 * 生成对话摘要
 */
function generateSummary(messages) {
  if (!messages || messages.length === 0) {
    return { summary: '', topics: [] };
  }
  
  // 提取主题
  const topics = new Set();
  const allContent = messages
    .filter(m => m.role === 'user')
    .map(m => String(m.content || ''))
    .join(' ');
  
  // 简单的主题提取（实际可用NLP）
  const topicPatterns = [
    /关于([^\s，。！？；：]{2,10})/gu,
    /([^\s，。！？；：]{2,10})的(?:问题|方案|分析)/gu
  ];
  
  for (const pattern of topicPatterns) {
    const matches = allContent.matchAll(pattern);
    for (const match of matches) {
      topics.add(match[1]);
    }
  }
  
  // 统计轮次和主要动作
  const userMessages = messages.filter(m => m.role === 'user').length;
  const assistantMessages = messages.filter(m => m.role === 'assistant').length;
  
  const summary = [
    `已对话${userMessages}轮`,
    topics.size > 0 ? `讨论主题：${Array.from(topics).slice(0, 3).join('、')}` : '',
    assistantMessages > 0 ? `提供了${assistantMessages}次回复` : ''
  ].filter(Boolean).join('，');
  
  return {
    summary,
    topics: Array.from(topics),
    userMessages,
    assistantMessages
  };
}

/**
 * 提取关键信息（用于长期记忆）
 */
function extractKeyInfo(messages) {
  const keyInfo = {
    userPreferences: [],
    importantFacts: [],
    decisions: [],
    unresolved: []
  };
  
  for (const message of messages) {
    const content = String(message.content || '').trim();
    
    // 用户偏好
    if (message.role === 'user') {
      if (/我(喜欢|偏好|倾向|习惯)/u.test(content)) {
        keyInfo.userPreferences.push(content);
      }
      
      // 未解决的问题
      if (/[？?]$/u.test(content) && !hasFollowUpAnswer(message, messages)) {
        keyInfo.unresolved.push(content);
      }
    }
    
    // 重要事实
    if (/(?:重要|关键|核心|必须)/u.test(content)) {
      keyInfo.importantFacts.push(content);
    }
    
    // 决策
    if (/(?:决定|选择|采用|使用|不用)/u.test(content)) {
      keyInfo.decisions.push(content);
    }
  }
  
  return keyInfo;
}

/**
 * 检查问题是否有后续回答
 */
function hasFollowUpAnswer(questionMessage, allMessages) {
  const questionIndex = allMessages.indexOf(questionMessage);
  if (questionIndex === -1) return false;
  
  // 检查后续2条消息
  for (let i = questionIndex + 1; i < Math.min(questionIndex + 3, allMessages.length); i++) {
    if (allMessages[i].role === 'assistant') {
      return true;
    }
  }
  return false;
}

/**
 * 对话记忆管理器
 */
export class ConversationMemory {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.messages = [];
    this.summaries = [];
    this.metadata = {
      totalMessages: 0,
      startTime: Date.now(),
      lastActivity: Date.now()
    };
  }
  
  /**
   * 添加消息
   */
  addMessage(message) {
    const normalized = {
      role: message.role || 'user',
      content: String(message.content || message.text || '').trim(),
      timestamp: message.timestamp || Date.now(),
      metadata: message.metadata || {}
    };
    
    this.messages.push(normalized);
    this.metadata.totalMessages++;
    this.metadata.lastActivity = Date.now();
    
    // 检查是否需要压缩
    this._compress();
    
    return normalized;
  }
  
  /**
   * 批量添加消息
   */
  addMessages(messages) {
    for (const message of messages) {
      this.addMessage(message);
    }
  }
  
  /**
   * 获取最近的消息（滑动窗口）
   */
  getRecent(count = null) {
    const n = count || this.config.windowSize;
    return this.messages.slice(-n);
  }
  
  /**
   * 获取所有消息
   */
  getAll() {
    return [...this.messages];
  }
  
  /**
   * 获取上下文（带摘要）
   */
  getContext(options = {}) {
    const {
      includeHistory = true,
      maxTokens = this.config.maxTokens,
      minRecent = 5
    } = options;
    
    const context = {
      recent: [],
      summary: null,
      totalMessages: this.metadata.totalMessages,
      keyInfo: null
    };
    
    // 最近的消息必须保留
    const recentMessages = this.getRecent(minRecent);
    let currentTokens = recentMessages.reduce((sum, m) => 
      sum + estimateTokens(m.content), 0
    );
    
    context.recent = recentMessages;
    
    // 如果还有token预算，尝试包含更多历史
    if (includeHistory && currentTokens < maxTokens) {
      const remainingTokens = maxTokens - currentTokens;
      const olderMessages = this.messages.slice(0, -minRecent);
      
      // 按重要性排序
      const sortedOlder = olderMessages.map((msg, idx) => ({
        message: msg,
        importance: calculateImportance(msg, idx, olderMessages.length)
      })).sort((a, b) => b.importance - a.importance);
      
      // 逐条添加，直到超过预算
      const additionalMessages = [];
      let addedTokens = 0;
      
      for (const item of sortedOlder) {
        const tokens = estimateTokens(item.message.content);
        if (addedTokens + tokens <= remainingTokens) {
          additionalMessages.push(item.message);
          addedTokens += tokens;
        }
      }
      
      // 按时间顺序恢复
      context.recent = [
        ...additionalMessages.sort((a, b) => a.timestamp - b.timestamp),
        ...context.recent
      ];
    }
    
    // 生成整体摘要
    if (this.summaries.length > 0) {
      context.summary = this.summaries[this.summaries.length - 1];
    } else if (this.messages.length > this.config.windowSize) {
      context.summary = generateSummary(this.messages);
    }
    
    // 提取关键信息
    context.keyInfo = extractKeyInfo(this.messages);
    
    return context;
  }
  
  /**
   * 搜索历史消息
   */
  search(query, options = {}) {
    const {
      role = null,
      limit = 10,
      minScore = 0.3
    } = options;
    
    const queryLower = String(query || '').toLowerCase();
    const results = [];
    
    for (let i = 0; i < this.messages.length; i++) {
      const message = this.messages[i];
      
      // 角色过滤
      if (role && message.role !== role) continue;
      
      // 简单的文本匹配评分
      const content = String(message.content || '').toLowerCase();
      let score = 0;
      
      // 包含查询词
      if (content.includes(queryLower)) {
        score += 0.5;
      }
      
      // 词重叠度
      const queryWords = queryLower.split(/\s+/);
      const contentWords = content.split(/\s+/);
      const overlap = queryWords.filter(w => contentWords.includes(w)).length;
      score += (overlap / queryWords.length) * 0.5;
      
      if (score >= minScore) {
        results.push({
          message,
          score,
          index: i
        });
      }
    }
    
    // 按分数排序
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, limit);
  }
  
  /**
   * 清空记忆
   */
  clear() {
    this.messages = [];
    this.summaries = [];
    this.metadata = {
      totalMessages: 0,
      startTime: Date.now(),
      lastActivity: Date.now()
    };
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
    const duration = Date.now() - this.metadata.startTime;
    return {
      totalMessages: this.metadata.totalMessages,
      currentMessages: this.messages.length,
      summaryCount: this.summaries.length,
      durationMs: duration,
      durationMinutes: Math.floor(duration / 60000),
      userMessages: this.messages.filter(m => m.role === 'user').length,
      assistantMessages: this.messages.filter(m => m.role === 'assistant').length,
      avgMessageLength: this.messages.length > 0
        ? Math.floor(this.messages.reduce((sum, m) => sum + m.content.length, 0) / this.messages.length)
        : 0
    };
  }
  
  /**
   * 导出记忆（用于持久化）
   */
  export() {
    return {
      messages: this.messages,
      summaries: this.summaries,
      metadata: this.metadata,
      config: this.config
    };
  }
  
  /**
   * 导入记忆（从持久化恢复）
   */
  import(data) {
    if (!data) return;
    
    this.messages = data.messages || [];
    this.summaries = data.summaries || [];
    this.metadata = data.metadata || this.metadata;
    if (data.config) {
      this.config = { ...this.config, ...data.config };
    }
  }
  
  /**
   * 内部：压缩记忆
   */
  _compress() {
    // 如果消息数超过阈值，生成摘要并压缩
    if (this.messages.length > this.config.summaryThreshold) {
      const toCompress = this.messages.slice(0, -this.config.windowSize);
      const summary = generateSummary(toCompress);
      
      this.summaries.push({
        ...summary,
        messageCount: toCompress.length,
        timestamp: Date.now()
      });
      
      // 只保留最近的消息
      this.messages = this.messages.slice(-this.config.windowSize);
    }
  }
}

export {
  estimateTokens,
  calculateImportance,
  generateSummary,
  extractKeyInfo
};
